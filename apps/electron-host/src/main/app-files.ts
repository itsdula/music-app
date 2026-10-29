/**
 * Maps `studio://app/<path>` requests onto files inside the built renderer directory.
 * Pure (node:path only) so the traversal guard is unit-tested in plain Node.
 */
import { extname, resolve, sep } from 'node:path';
import { APP_HOST, APP_SCHEME } from '../shared/host-api';

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.wasm': 'application/wasm',
  '.wav': 'audio/wav',
};

export function contentTypeFor(filePath: string): string {
  return CONTENT_TYPES[extname(filePath).toLowerCase()] ?? 'application/octet-stream';
}

/**
 * Resolves a request URL to an absolute file path under `rootDir`, or `null` if the URL is
 * not `studio://app/…`, is malformed, or escapes the root (`..`, encoded separators, NUL).
 */
export function resolveAppFile(rootDir: string, requestUrl: string): string | null {
  let url: URL;
  try {
    url = new URL(requestUrl);
  } catch {
    return null;
  }
  if (url.protocol !== `${APP_SCHEME}:` || url.host !== APP_HOST) return null;
  let pathname: string;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    return null;
  }
  if (pathname.includes('\0') || pathname.includes('\\')) return null;
  if (pathname === '' || pathname.endsWith('/')) pathname += 'index.html';
  const root = resolve(rootDir);
  const target = resolve(root, `.${pathname}`);
  if (!target.startsWith(root + sep)) return null;
  return target;
}
