/**
 * HTTP handling for `POST /api/assistant` (Electron, Vite and other non-Next clients): CORS,
 * optional shared-secret auth, body limits, then the same `AssistantServer` the server action
 * uses. Built on the standard Request/Response so it is unit-testable without Next.
 *
 * Environment:
 *   STUDIO_ASSISTANT_ALLOWED_ORIGINS  extra comma-separated browser origins (the Electron origin
 *                                     `studio://app` and the site's own origin are always allowed)
 *   STUDIO_ASSISTANT_TOKEN            optional; when set, requests need `Authorization: Bearer <token>`
 */
import type { AssistantErrorCode, AssistantResult } from '@studio/assistant-core';
import { clientKeyFromHeaders, type AssistantEnv, type AssistantServer } from './server';

/** The Electron renderer's origin (apps/electron-host/src/shared/host-api.ts). */
export const ELECTRON_APP_ORIGIN = 'studio://app';

/** Request bodies above this are rejected before parsing. */
export const MAX_BODY_BYTES = 1_000_000;

const STATUS_BY_CODE: Record<AssistantErrorCode, number> = {
  'not-configured': 503,
  unauthorized: 401,
  'rate-limited': 429,
  'bad-request': 400,
  'provider-error': 502,
  network: 502,
};

function originOf(value: string): string | null {
  try {
    const url = new URL(value);
    // WHATWG `origin` is "null" for non-special schemes such as studio:, so build it by hand.
    return url.host ? `${url.protocol}//${url.host}` : null;
  } catch {
    return null;
  }
}

export function allowedOrigins(env: AssistantEnv, requestUrl: string): Set<string> {
  const origins = new Set<string>([ELECTRON_APP_ORIGIN]);
  const self = originOf(requestUrl);
  if (self) origins.add(self);
  const publicUrl = env.STUDIO_PUBLIC_URL?.trim();
  const publicOrigin = publicUrl ? originOf(publicUrl) : null;
  if (publicOrigin) origins.add(publicOrigin);
  for (const entry of (env.STUDIO_ASSISTANT_ALLOWED_ORIGINS ?? '').split(',')) {
    const origin = entry.trim() ? originOf(entry.trim()) : null;
    if (origin) origins.add(origin);
  }
  return origins;
}

function corsHeaders(origin: string | null): Record<string, string> {
  const headers: Record<string, string> = { Vary: 'Origin' };
  if (origin) {
    headers['Access-Control-Allow-Origin'] = origin;
    headers['Access-Control-Allow-Methods'] = 'POST, OPTIONS';
    headers['Access-Control-Allow-Headers'] = 'Content-Type, Authorization';
    headers['Access-Control-Max-Age'] = '600';
  }
  return headers;
}

function json(result: AssistantResult, status: number, origin: string | null): Response {
  return new Response(JSON.stringify(result), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      ...corsHeaders(origin),
    },
  });
}

function failure(code: AssistantErrorCode, message: string, origin: string | null): Response {
  return json({ ok: false, code, message }, STATUS_BY_CODE[code], origin);
}

/** Constant-time string comparison (length is not secret). */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Resolves the CORS origin to echo. `undefined` = request is not allowed. Requests without an
 * `Origin` header (curl, server-to-server) are not browser cross-origin requests; they get no
 * CORS headers and rely on the token and rate limit.
 */
function resolveOrigin(request: Request, env: AssistantEnv): string | null | undefined {
  const origin = request.headers.get('origin');
  if (!origin) return null;
  return allowedOrigins(env, request.url).has(origin) ? origin : undefined;
}

export function handleAssistantOptions(request: Request, env: AssistantEnv): Response {
  const origin = resolveOrigin(request, env);
  if (origin === undefined) return new Response(null, { status: 403, headers: { Vary: 'Origin' } });
  return new Response(null, { status: 204, headers: corsHeaders(origin) });
}

export async function handleAssistantPost(
  request: Request,
  server: AssistantServer,
  env: AssistantEnv,
): Promise<Response> {
  const origin = resolveOrigin(request, env);
  if (origin === undefined) {
    return failure('unauthorized', 'This origin may not use the Studio assistant.', null);
  }

  const token = env.STUDIO_ASSISTANT_TOKEN?.trim();
  if (token) {
    const header = request.headers.get('authorization') ?? '';
    const presented = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
    if (!safeEqual(presented, token)) {
      return failure('unauthorized', 'Missing or invalid assistant token.', origin);
    }
  }

  const declared = Number(request.headers.get('content-length') ?? '0');
  if (declared > MAX_BODY_BYTES) return failure('bad-request', 'The request is too large.', origin);
  let text: string;
  try {
    text = await request.text();
  } catch {
    return failure('bad-request', 'Could not read the request body.', origin);
  }
  if (text.length > MAX_BODY_BYTES)
    return failure('bad-request', 'The request is too large.', origin);
  let body: unknown;
  try {
    body = JSON.parse(text) as unknown;
  } catch {
    return failure('bad-request', 'The request body must be JSON.', origin);
  }

  const result = await server.complete(body, { clientKey: clientKeyFromHeaders(request.headers) });
  return json(result, result.ok ? 200 : STATUS_BY_CODE[result.code], origin);
}
