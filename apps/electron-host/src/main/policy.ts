/**
 * Side-effect-free security policy for the Electron host: origin checks, the permission
 * policy, navigation rules and the renderer Content-Security-Policy. No Electron imports, so
 * everything here is unit-tested in plain Node (tests/policy.test.ts).
 */
import { APP_HOST, APP_ORIGIN, APP_SCHEME } from '../shared/host-api';

/**
 * Origin of a URL or origin string, computed by hand because WHATWG `URL#origin` is `"null"`
 * for non-special schemes such as `studio:`. Returns `null` for unparsable input.
 */
export function originOf(urlOrOrigin: string): string | null {
  try {
    const url = new URL(urlOrOrigin);
    if (!url.host) return null;
    return `${url.protocol}//${url.host}`;
  } catch {
    return null;
  }
}

/** True only for the packaged renderer origin `studio://app`. */
export function isAppOrigin(urlOrOrigin: string | null | undefined): boolean {
  if (!urlOrOrigin) return false;
  return originOf(urlOrOrigin) === APP_ORIGIN;
}

/** Navigation (top-level or `window.open`) is allowed only within the app origin. */
export function isAllowedNavigation(url: string): boolean {
  return isAppOrigin(url);
}

/**
 * Permissions the renderer may hold. Everything else — notably `midiSysex`, camera,
 * geolocation, notifications, HID/USB/serial — is denied.
 */
export const ALLOWED_PERMISSIONS: ReadonlySet<string> = new Set([
  'media', // audio capture only (see mediaTypes check below)
  'midi', // Web MIDI without SysEx
  'clipboard-sanitized-write',
]);

/**
 * Permission policy shared by `setPermissionRequestHandler` and `setPermissionCheckHandler`.
 *
 * @param mediaTypes for `media`: the requested kinds. Any `video` request is denied, so the
 *   permission is effectively "microphone only". `unknown` (used by checks such as
 *   `enumerateDevices`) is tolerated; it never grants a camera stream by itself because the
 *   actual `getUserMedia` request reports its concrete types.
 */
export function isPermissionAllowed(
  permission: string,
  origin: string | null | undefined,
  mediaTypes?: readonly string[],
): boolean {
  if (!isAppOrigin(origin)) return false;
  if (!ALLOWED_PERMISSIONS.has(permission)) return false;
  if (permission === 'media' && mediaTypes) {
    return mediaTypes.every((type) => type === 'audio' || type === 'unknown');
  }
  return true;
}

export interface CspOptions {
  /**
   * Extra `connect-src` sources: the configured assistant endpoint origin (see
   * `assistantConnectSources`) or a dev server. None by default.
   */
  readonly extraConnectSrc?: readonly string[];
}

const LOOPBACK_HOSTS: ReadonlySet<string> = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * `connect-src` entry for the AI assistant endpoint baked in at build time
 * (`STUDIO_ASSISTANT_URL`): exactly its origin, and only for `https:` URLs (plain `http:` is
 * accepted for loopback hosts, for local development). Anything else yields no source, so the
 * CSP stays fully locked down.
 */
export function assistantConnectSources(url: string | null | undefined): string[] {
  if (!url) return [];
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return [];
  }
  if (parsed.username || parsed.password) return [];
  const secure = parsed.protocol === 'https:';
  const loopbackHttp = parsed.protocol === 'http:' && LOOPBACK_HOSTS.has(parsed.hostname);
  if (!secure && !loopbackHttp) return [];
  return [parsed.origin];
}

/**
 * Builds the renderer CSP. Scripts may come only from the app origin and from Blob URLs
 * (Studio's AudioWorklet modules and Workers are inline Blob bundles). No `unsafe-eval`, no
 * inline scripts. `style-src 'unsafe-inline'` is required because Radix UI (Select,
 * ScrollArea) and react-remove-scroll inject `<style>` elements at runtime.
 */
export function buildContentSecurityPolicy(options: CspOptions = {}): string {
  const self = "'self'";
  const directives: ReadonlyArray<readonly [string, readonly string[]]> = [
    ['default-src', [self]],
    ['script-src', [self, 'blob:']],
    ['worker-src', [self, 'blob:']],
    ['style-src', [self, "'unsafe-inline'"]],
    ['img-src', [self, 'data:', 'blob:']],
    ['font-src', [self, 'data:']],
    ['media-src', [self, 'blob:', 'data:']],
    ['connect-src', [self, 'blob:', 'data:', ...(options.extraConnectSrc ?? [])]],
    ['object-src', ["'none'"]],
    ['frame-src', ["'none'"]],
    ['base-uri', ["'none'"]],
    ['form-action', ["'none'"]],
    ['frame-ancestors', ["'none'"]],
  ];
  return directives.map(([name, sources]) => `${name} ${sources.join(' ')}`).join('; ');
}

/** Response headers attached to every `studio://app/` response. */
export function securityHeaders(
  contentType: string,
  cspOptions: CspOptions = {},
): Record<string, string> {
  return {
    'Content-Type': contentType,
    'Content-Security-Policy': buildContentSecurityPolicy(cspOptions),
    'X-Content-Type-Options': 'nosniff',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Referrer-Policy': 'no-referrer',
    'Cache-Control': 'no-cache',
  };
}

export const PRIVILEGED_SCHEME = {
  scheme: APP_SCHEME,
  host: APP_HOST,
  privileges: {
    standard: true, // real origin (studio://app), relative URLs, IndexedDB/localStorage
    secure: true, // secure context: Web MIDI, getUserMedia, AudioWorklet
    supportFetchAPI: true,
    stream: true, // range/streamed responses for media elements
    codeCache: true,
  },
} as const;
