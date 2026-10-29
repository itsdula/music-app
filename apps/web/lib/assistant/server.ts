/**
 * Server-only assistant service shared by the `completeAssistant` server action and the
 * `/api/assistant` route. It holds the OpenRouter key (never sent to browsers), validates input
 * with the shared guards, applies a per-client rate limit and returns a serialisable
 * `AssistantResult` instead of throwing.
 *
 * Environment (Vercel → Project → Settings → Environment Variables):
 *   OPENROUTER_API_KEY                 required; without it every call returns `not-configured`
 *   OPENROUTER_MODEL                   optional model id (default DEFAULT_OPENROUTER_MODEL)
 *   OPENROUTER_ALLOWED_MODELS          optional comma list of ids clients may request
 *   STUDIO_PUBLIC_URL                  optional public site URL, sent as OpenRouter HTTP-Referer
 *   STUDIO_ASSISTANT_RATE_LIMIT        optional requests per client per minute (default 30, 0 = off)
 */
import {
  captureAssistantResult,
  createOpenRouterClient,
  DEFAULT_ASSISTANT_LIMITS,
  DEFAULT_OPENROUTER_MODEL,
  validateAssistantRequest,
  type AssistantLimits,
  type AssistantResult,
  type FetchLike,
} from '@studio/assistant-core';
import { createRateLimiter, type RateLimiter } from './rate-limit';

if (typeof window !== 'undefined') {
  throw new Error('lib/assistant/server must only be imported on the server');
}

export type AssistantEnv = Readonly<Record<string, string | undefined>>;

export interface AssistantServerOptions {
  /** Read on every call, so a live `process.env` (or a test stub) works. */
  readonly env: AssistantEnv;
  readonly fetch: FetchLike;
  readonly now?: () => number;
  readonly limits?: AssistantLimits;
}

export interface AssistantCallContext {
  /** Rate-limit key, normally the client IP (see `clientKeyFromHeaders`). */
  readonly clientKey: string;
}

export interface AssistantServer {
  complete(input: unknown, context: AssistantCallContext): Promise<AssistantResult>;
}

export const DEFAULT_RATE_LIMIT_PER_MINUTE = 30;

export const NOT_CONFIGURED_MESSAGE =
  'The AI assistant is not configured on this server. The operator needs to set ' +
  'OPENROUTER_API_KEY (e.g. in Vercel project settings → Environment Variables) and redeploy.';

function list(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function rateLimitFromEnv(env: AssistantEnv): number {
  const raw = env.STUDIO_ASSISTANT_RATE_LIMIT?.trim();
  if (!raw) return DEFAULT_RATE_LIMIT_PER_MINUTE;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_RATE_LIMIT_PER_MINUTE;
}

export function createAssistantServer(options: AssistantServerOptions): AssistantServer {
  const limits = options.limits ?? DEFAULT_ASSISTANT_LIMITS;
  let limiter: { limit: number; instance: RateLimiter } | null = null;

  function rateLimiter(): RateLimiter {
    const limit = rateLimitFromEnv(options.env);
    if (!limiter || limiter.limit !== limit) {
      limiter = {
        limit,
        instance: createRateLimiter({
          limit,
          windowMs: 60_000,
          ...(options.now ? { now: options.now } : {}),
        }),
      };
    }
    return limiter.instance;
  }

  return {
    async complete(input, context) {
      const { env } = options;
      const apiKey = env.OPENROUTER_API_KEY?.trim();
      if (!apiKey) return { ok: false, code: 'not-configured', message: NOT_CONFIGURED_MESSAGE };

      if (!rateLimiter().take(context.clientKey)) {
        return {
          ok: false,
          code: 'rate-limited',
          message: 'Too many assistant requests. Wait a minute and try again.',
        };
      }

      const validation = validateAssistantRequest(input, limits);
      if (!validation.ok) return validation;

      const referer = env.STUDIO_PUBLIC_URL?.trim();
      const client = createOpenRouterClient({
        fetch: options.fetch,
        apiKey,
        model: env.OPENROUTER_MODEL?.trim() || DEFAULT_OPENROUTER_MODEL,
        allowedModels: list(env.OPENROUTER_ALLOWED_MODELS),
        title: 'Studio',
        limits,
        ...(referer ? { referer } : {}),
      });
      return captureAssistantResult(() => client.complete(validation.request));
    },
  };
}

/** Wraps the global fetch in the shape assistant-core expects. */
export const globalFetch: FetchLike = (url, init) =>
  fetch(url, {
    method: init.method,
    headers: init.headers,
    body: init.body,
    cache: 'no-store',
    ...(init.signal ? { signal: init.signal as AbortSignal } : {}),
  });

let shared: AssistantServer | null = null;

/** The process-wide service (one rate limiter per server instance). */
export function getAssistantServer(): AssistantServer {
  shared ??= createAssistantServer({ env: process.env, fetch: globalFetch });
  return shared;
}

export interface HeaderReader {
  get(name: string): string | null;
}

/**
 * Client identity for rate limiting. Vercel overwrites these headers at its edge, so they are
 * trustworthy there; elsewhere they are only as trustworthy as the proxy in front of the app.
 */
export function clientKeyFromHeaders(headers: HeaderReader): string {
  const direct = headers.get('x-vercel-forwarded-for') ?? headers.get('x-real-ip');
  const forwarded = direct ?? headers.get('x-forwarded-for');
  const first = forwarded?.split(',')[0]?.trim();
  return first ? `ip:${first}` : 'ip:unknown';
}
