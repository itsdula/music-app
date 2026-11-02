/**
 * The monitor's HTTP server (node:http, loopback only):
 *   POST /v1/logs              OTLP/HTTP logs receiver (JSON or protobuf, optional gzip)
 *   GET  /events               SSE: `status`, `log`, `clear` events (ring buffer replayed first)
 *   GET  /api/services         service statuses as JSON
 *   POST /api/electron/open    launch Electron, or focus the running window
 *   POST /api/electron/restart restart Electron
 *   POST /api/logs/clear       empty the ring buffer
 *   GET  /, /assets/*          the monitor page
 * Only loopback Host headers and Origins are accepted (no DNS rebinding, no cross-site POSTs).
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { LogHub } from './log-hub';
import { decodeLogsBody, encodingFor, OtlpBodyTooLargeError } from './otlp';

export const MAX_OTLP_BODY_BYTES = 8 * 1024 * 1024;
const KEEP_ALIVE_MS = 15_000;

export interface PageAssets {
  readonly html: string;
  readonly js: string;
  readonly css: string;
}

export interface MonitorActions {
  openElectron(): Promise<void> | void;
  restartElectron(): Promise<void> | void;
}

export interface MonitorServerOptions {
  readonly hub: LogHub;
  readonly assets: () => PageAssets;
  readonly actions: MonitorActions;
  /** Extra fields for GET /api/services (e.g. the site's dev-server URL). */
  readonly info?: () => Record<string, unknown>;
}

const LOOPBACK_HOST = /^(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/i;

export function isLoopbackOrigin(origin: string): boolean {
  try {
    const url = new URL(origin);
    return (url.protocol === 'http:' || url.protocol === 'https:') && LOOPBACK_HOST.test(url.host);
  } catch {
    return false;
  }
}

function corsHeaders(req: IncomingMessage): Record<string, string> {
  const origin = req.headers.origin;
  if (!origin || !isLoopbackOrigin(origin)) return {};
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'access-control-allow-headers': 'content-type, content-encoding',
    'access-control-max-age': '600',
    vary: 'origin',
  };
}

function send(
  req: IncomingMessage,
  res: ServerResponse,
  status: number,
  body: string,
  contentType = 'application/json; charset=utf-8',
): void {
  res.writeHead(status, {
    'content-type': contentType,
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    ...corsHeaders(req),
  });
  res.end(req.method === 'HEAD' ? undefined : body);
}

function readBody(req: IncomingMessage, limit: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error('body too large'));
        req.destroy();
      } else chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

const PAGE_CSP =
  "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

export function createMonitorServer(options: MonitorServerOptions): Server {
  const { hub, actions } = options;

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!LOOPBACK_HOST.test(req.headers.host ?? '')) return send(req, res, 421, '{"error":"host"}');
    const origin = req.headers.origin;
    if (origin && !isLoopbackOrigin(origin)) return send(req, res, 403, '{"error":"origin"}');
    const { pathname } = new URL(req.url ?? '/', 'http://localhost');
    const method = req.method ?? 'GET';

    if (method === 'OPTIONS') {
      res.writeHead(204, corsHeaders(req)).end();
      return;
    }

    if (pathname === '/v1/logs') {
      if (method !== 'POST') return send(req, res, 405, '{}');
      const encoding = encodingFor(req.headers['content-type']);
      if (!encoding) return send(req, res, 415, '{"error":"unsupported content-type"}');
      try {
        const body = await readBody(req, MAX_OTLP_BODY_BYTES);
        hub.publishAll(decodeLogsBody(body, encoding, req.headers['content-encoding']));
      } catch (error) {
        if (error instanceof OtlpBodyTooLargeError) {
          return send(req, res, 413, JSON.stringify({ error: error.message }));
        }
        return send(req, res, 400, JSON.stringify({ error: String(error) }));
      }
      // Empty ExportLogsServiceResponse = full success.
      if (encoding === 'protobuf') return send(req, res, 200, '', 'application/x-protobuf');
      return send(req, res, 200, '{}');
    }

    if (pathname === '/events' && method === 'GET') {
      res.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-store',
        connection: 'keep-alive',
        'x-accel-buffering': 'no',
      });
      const remove = hub.addClient(res);
      req.on('close', remove);
      return;
    }

    if (pathname === '/api/services' && method === 'GET') {
      return send(
        req,
        res,
        200,
        JSON.stringify({ ...options.info?.(), services: hub.allStatuses() }),
      );
    }

    if (method === 'POST' && pathname.startsWith('/api/')) {
      // Drain (and ignore) any body so keep-alive connections stay usable.
      await readBody(req, 64 * 1024).catch(() => Buffer.alloc(0));
      if (pathname === '/api/electron/open') await actions.openElectron();
      else if (pathname === '/api/electron/restart') await actions.restartElectron();
      else if (pathname === '/api/logs/clear') hub.clear();
      else return send(req, res, 404, '{"error":"not found"}');
      return send(req, res, 202, '{"ok":true}');
    }

    if (method === 'GET' || method === 'HEAD') {
      const assets = options.assets();
      if (pathname === '/' || pathname === '/index.html') {
        res.setHeader('content-security-policy', PAGE_CSP);
        return send(req, res, 200, assets.html, 'text/html; charset=utf-8');
      }
      if (pathname === '/assets/monitor.js') {
        return send(req, res, 200, assets.js, 'text/javascript; charset=utf-8');
      }
      if (pathname === '/assets/monitor.css') {
        return send(req, res, 200, assets.css, 'text/css; charset=utf-8');
      }
    }
    return send(req, res, 404, '{"error":"not found"}');
  }

  const server = createServer((req, res) => {
    handle(req, res).catch((error: unknown) => {
      if (!res.headersSent) send(req, res, 500, JSON.stringify({ error: String(error) }));
      else res.end();
    });
  });
  const ping = setInterval(() => hub.ping(), KEEP_ALIVE_MS);
  ping.unref();
  server.on('close', () => clearInterval(ping));
  return server;
}
