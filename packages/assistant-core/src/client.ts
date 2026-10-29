/**
 * OpenAI-compatible chat-completions client. Host-neutral: the caller injects `fetch`, so the
 * same code runs on a Next.js server (server-held key), in Tauri (user key) or against a local
 * model server. One `complete` call = one model turn; tools run on the client.
 */
import type {
  AssistantRequest,
  AssistantResponse,
  AssistantTransport,
} from '@studio/platform-contracts';
import { AssistantError, safeProviderMessage } from './errors';
import { resolveAssistantLimits, validateAssistantRequest, type AssistantLimits } from './guards';
import { fromChatCompletionsBody, toChatCompletionsBody } from './mapping';

/** The contract's abort-signal shape (re-derived so this package depends only on platform-contracts). */
export type AbortSignalLike = NonNullable<Parameters<AssistantTransport['complete']>[1]>;

export interface FetchLikeInit {
  readonly method: 'POST';
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
  readonly signal?: AbortSignalLike;
}

export interface FetchLikeResponse {
  readonly ok: boolean;
  readonly status: number;
  text(): Promise<string>;
}

/**
 * The subset of WHATWG `fetch` the client needs. Hosts pass a thin wrapper, e.g.
 * `(url, init) => fetch(url, { ...init, signal: init.signal as AbortSignal | undefined })`.
 */
export type FetchLike = (url: string, init: FetchLikeInit) => Promise<FetchLikeResponse>;

export interface OpenAiCompatibleClientOptions {
  readonly fetch: FetchLike;
  /** API root without the trailing `/chat/completions`, e.g. `https://openrouter.ai/api/v1`. */
  readonly baseUrl: string;
  /** Sent as `Authorization: Bearer …`; optional for local servers. Never echoed in errors. */
  readonly apiKey?: string;
  /** Model used when the request names none (or names one that is not allowed). */
  readonly defaultModel: string;
  /**
   * Models a request may select via `request.model`. Default: none (the default model is always
   * used, so callers cannot pick a more expensive model). `['*']` allows any model id.
   */
  readonly allowedModels?: readonly string[];
  /** Extra request headers (e.g. OpenRouter attribution). */
  readonly headers?: Readonly<Record<string, string>>;
  readonly limits?: Partial<AssistantLimits>;
  /** Transport label shown in the UI. */
  readonly label?: string;
}

export function chatCompletionsUrl(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/chat/completions`;
}

function isAbort(error: unknown, signal: AbortSignalLike | undefined): boolean {
  if (signal?.aborted) return true;
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { name?: unknown }).name === 'AbortError'
  );
}

function errorFromStatus(status: number, detail: string): AssistantError {
  const suffix = detail ? ` (${detail})` : '';
  if (status === 401 || status === 403) {
    return new AssistantError(
      'unauthorized',
      `The model provider rejected the credentials${suffix}.`,
      status,
    );
  }
  if (status === 429) {
    return new AssistantError(
      'rate-limited',
      `The model provider is rate limiting requests; try again shortly${suffix}.`,
      status,
    );
  }
  if (status === 402) {
    return new AssistantError(
      'provider-error',
      `The model provider account has insufficient credits${suffix}.`,
      status,
    );
  }
  if (status === 400 || status === 404 || status === 413 || status === 422) {
    return new AssistantError(
      'bad-request',
      `The model provider rejected the request${suffix}.`,
      status,
    );
  }
  return new AssistantError(
    'provider-error',
    `The model provider failed (HTTP ${status})${suffix}.`,
    status,
  );
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

/** Extracts `{ error: { message, code } }` (OpenAI/OpenRouter error envelope). */
function errorEnvelope(body: unknown): { message: unknown; code: unknown } | null {
  if (typeof body !== 'object' || body === null) return null;
  const error = (body as { error?: unknown }).error;
  if (typeof error === 'string') return { message: error, code: undefined };
  if (typeof error !== 'object' || error === null) return null;
  const { message, code } = error as { message?: unknown; code?: unknown };
  return { message, code };
}

export function createOpenAiCompatibleClient(
  options: OpenAiCompatibleClientOptions,
): AssistantTransport {
  const limits = resolveAssistantLimits(options.limits);
  const url = chatCompletionsUrl(options.baseUrl);
  const secrets = options.apiKey ? [options.apiKey] : [];
  const allowed = new Set(options.allowedModels ?? []);

  function pickModel(requested: string | undefined): string {
    if (requested && (allowed.has('*') || allowed.has(requested))) return requested;
    return options.defaultModel;
  }

  async function complete(
    input: AssistantRequest,
    signal?: AbortSignalLike,
  ): Promise<AssistantResponse> {
    const validation = validateAssistantRequest(input, limits);
    if (!validation.ok) throw new AssistantError('bad-request', validation.message);
    const model = pickModel(validation.request.model);
    const body = toChatCompletionsBody(validation.request, {
      model,
      maxTokens: limits.maxOutputTokens,
    });

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...options.headers,
    };
    if (options.apiKey) headers.Authorization = `Bearer ${options.apiKey}`;

    let status: number;
    let ok: boolean;
    let text: string;
    try {
      const init: FetchLikeInit = signal
        ? { method: 'POST', headers, body: JSON.stringify(body), signal }
        : { method: 'POST', headers, body: JSON.stringify(body) };
      const response = await options.fetch(url, init);
      status = response.status;
      ok = response.ok;
      text = await response.text();
    } catch (error) {
      if (isAbort(error, signal)) throw error;
      throw new AssistantError('network', 'Could not reach the model provider.');
    }

    const json = parseJson(text);
    const envelope = errorEnvelope(json);
    if (!ok) {
      throw errorFromStatus(status, safeProviderMessage(envelope?.message, secrets));
    }
    // OpenRouter can report upstream failures with HTTP 200 and an error envelope.
    if (envelope && !(typeof json === 'object' && json !== null && 'choices' in json)) {
      const code = typeof envelope.code === 'number' ? envelope.code : 502;
      throw errorFromStatus(code, safeProviderMessage(envelope.message, secrets));
    }
    if (json === undefined) {
      throw new AssistantError('provider-error', 'The model provider returned invalid JSON.');
    }
    return fromChatCompletionsBody(json, model);
  }

  return { label: options.label ?? 'OpenAI-compatible provider', complete };
}
