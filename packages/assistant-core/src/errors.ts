/**
 * Assistant errors and the serialisable result shape shared by every route (server action,
 * HTTP endpoint, direct provider calls). Messages are written for end users and operators and
 * never contain credentials (see `safeProviderMessage`).
 */
import type {
  AssistantErrorCode,
  AssistantMessage,
  AssistantResponse,
  AssistantToolCall,
} from '@studio/platform-contracts';

export const ASSISTANT_ERROR_CODES: readonly AssistantErrorCode[] = [
  'not-configured',
  'unauthorized',
  'rate-limited',
  'bad-request',
  'provider-error',
  'network',
];

export function isAssistantErrorCode(value: unknown): value is AssistantErrorCode {
  return typeof value === 'string' && (ASSISTANT_ERROR_CODES as readonly string[]).includes(value);
}

/**
 * Thrown by transports and provider clients. Consumers that cannot import this class (e.g. the
 * chat UI, which depends only on platform-contracts) can duck-type it: `name === 'AssistantError'`
 * and a string `code` that is an `AssistantErrorCode`.
 */
export class AssistantError extends Error {
  override readonly name = 'AssistantError';
  readonly code: AssistantErrorCode;
  /** Upstream HTTP status, when the error came from an HTTP response. */
  readonly status: number | undefined;

  constructor(code: AssistantErrorCode, message: string, status?: number) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

export function isAssistantError(value: unknown): value is AssistantError {
  if (value instanceof AssistantError) return true;
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as { name?: unknown; code?: unknown; message?: unknown };
  return (
    candidate.name === 'AssistantError' &&
    isAssistantErrorCode(candidate.code) &&
    typeof candidate.message === 'string'
  );
}

/** Serialisable outcome of one assistant turn (server actions and HTTP responses). */
export type AssistantResult =
  | { readonly ok: true; readonly response: AssistantResponse }
  | { readonly ok: false; readonly code: AssistantErrorCode; readonly message: string };

export type AssistantFailure = Extract<AssistantResult, { ok: false }>;

const GENERIC_FAILURE = 'The assistant request failed.';

/** Converts anything thrown into a safe failure result (unknown errors never leak details). */
export function toAssistantFailure(error: unknown): AssistantFailure {
  if (isAssistantError(error)) return { ok: false, code: error.code, message: error.message };
  return { ok: false, code: 'provider-error', message: GENERIC_FAILURE };
}

/** Runs one turn and captures failures as a result instead of throwing. */
export async function captureAssistantResult(
  run: () => Promise<AssistantResponse>,
): Promise<AssistantResult> {
  try {
    return { ok: true, response: await run() };
  } catch (error) {
    return toAssistantFailure(error);
  }
}

const FINISH_REASONS: ReadonlySet<string> = new Set([
  'stop',
  'tool_calls',
  'length',
  'error',
  'other',
]);

function isToolCall(value: unknown): value is AssistantToolCall {
  if (typeof value !== 'object' || value === null) return false;
  const call = value as Record<string, unknown>;
  return (
    typeof call.id === 'string' &&
    typeof call.name === 'string' &&
    typeof call.arguments === 'string'
  );
}

function parseResponse(value: unknown): AssistantResponse | null {
  if (typeof value !== 'object' || value === null) return null;
  const response = value as Record<string, unknown>;
  const message = response.message as Record<string, unknown> | null | undefined;
  if (typeof message !== 'object' || message === null) return null;
  if (message.role !== 'assistant' || typeof message.content !== 'string') return null;
  if (typeof response.model !== 'string') return null;
  if (typeof response.finishReason !== 'string' || !FINISH_REASONS.has(response.finishReason)) {
    return null;
  }
  let toolCalls: AssistantToolCall[] | undefined;
  if (message.toolCalls !== undefined) {
    if (!Array.isArray(message.toolCalls) || !message.toolCalls.every(isToolCall)) return null;
    toolCalls = message.toolCalls.map((call) => ({
      id: call.id,
      name: call.name,
      arguments: call.arguments,
    }));
  }
  const assistantMessage: Extract<AssistantMessage, { role: 'assistant' }> = toolCalls
    ? { role: 'assistant', content: message.content, toolCalls }
    : { role: 'assistant', content: message.content };
  return {
    message: assistantMessage,
    model: response.model,
    finishReason: response.finishReason as AssistantResponse['finishReason'],
  };
}

/**
 * Validates an `AssistantResult` received over a wire (server action return value or HTTP JSON)
 * and returns the response, or throws `AssistantError`.
 */
export function unwrapAssistantResult(value: unknown): AssistantResponse {
  if (typeof value === 'object' && value !== null) {
    const result = value as Record<string, unknown>;
    if (result.ok === true) {
      const response = parseResponse(result.response);
      if (response) return response;
    } else if (result.ok === false && isAssistantErrorCode(result.code)) {
      const message = typeof result.message === 'string' ? result.message : GENERIC_FAILURE;
      throw new AssistantError(result.code, message);
    }
  }
  throw new AssistantError('provider-error', 'The assistant server returned an invalid response.');
}

const MAX_PROVIDER_MESSAGE = 300;

/**
 * Makes an upstream error message safe to show: strips control characters, redacts the given
 * secrets and anything that looks like a bearer token or API key, and truncates.
 */
export function safeProviderMessage(raw: unknown, secrets: readonly string[] = []): string {
  if (typeof raw !== 'string') return '';
  let text = raw;
  for (const secret of secrets) {
    if (secret.length >= 4) text = text.split(secret).join('[redacted]');
  }
  text = text
    .replace(/Bearer\s+[^\s"',]+/gi, 'Bearer [redacted]')
    .replace(/\bsk-[A-Za-z0-9_-]{6,}/g, '[redacted]')
    // eslint-disable-next-line no-control-regex -- deliberately strips control characters
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .trim();
  return text.length > MAX_PROVIDER_MESSAGE ? `${text.slice(0, MAX_PROVIDER_MESSAGE)}…` : text;
}
