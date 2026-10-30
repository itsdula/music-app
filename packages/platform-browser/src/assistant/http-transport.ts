import { AssistantError, unwrapAssistantResult } from '@studio/assistant-core';
import type {
  AssistantRequest,
  AssistantResponse,
  AssistantTransport,
} from '@studio/platform-contracts';
import { DEFAULT_SERVER_TRANSPORT_LABEL, type AssistantSignal } from './result-transport';

export interface HttpAssistantTransportOptions {
  /** Absolute URL of the Studio `/api/assistant` endpoint. */
  readonly url: string;
  /**
   * Shared secret sent as `Authorization: Bearer …` when the server sets
   * `STUDIO_ASSISTANT_TOKEN`. Anything shipped in a client bundle is readable by its users, so
   * this only keeps casual callers out; it is not a user credential.
   */
  readonly token?: string;
  readonly label?: string;
  /** Injectable for tests; defaults to the global `fetch`. */
  readonly fetch?: typeof fetch;
}

/** Bridges the contract's minimal signal to a real `AbortSignal` for `fetch`. */
function toAbortSignal(signal: AssistantSignal): { signal?: AbortSignal; dispose(): void } {
  if (!signal) return { dispose() {} };
  if (typeof AbortSignal !== 'undefined' && signal instanceof AbortSignal) {
    return { signal, dispose() {} };
  }
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  if (signal.aborted) controller.abort();
  else signal.addEventListener('abort', onAbort, { once: true });
  return { signal: controller.signal, dispose: () => signal.removeEventListener('abort', onAbort) };
}

/** POSTs one assistant turn to a Studio server endpoint and unwraps its `AssistantResult`. */
export function createHttpAssistantTransport(
  options: HttpAssistantTransportOptions,
): AssistantTransport {
  const fetchImpl = options.fetch ?? ((input, init) => fetch(input, init));
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
  if (options.token) headers.Authorization = `Bearer ${options.token}`;

  return {
    label: options.label ?? DEFAULT_SERVER_TRANSPORT_LABEL,
    async complete(
      request: AssistantRequest,
      signal?: AssistantSignal,
    ): Promise<AssistantResponse> {
      const abort = toAbortSignal(signal);
      let status: number;
      let text: string;
      try {
        const init: RequestInit = {
          method: 'POST',
          headers,
          body: JSON.stringify(request),
          credentials: 'omit',
          cache: 'no-store',
        };
        if (abort.signal) init.signal = abort.signal;
        const response = await fetchImpl(options.url, init);
        status = response.status;
        text = await response.text();
      } catch (error) {
        if (signal?.aborted) throw error;
        throw new AssistantError('network', 'Could not reach the Studio assistant server.');
      } finally {
        abort.dispose();
      }
      let json: unknown;
      try {
        json = JSON.parse(text) as unknown;
      } catch {
        throw new AssistantError(
          status === 404 ? 'not-configured' : 'provider-error',
          `The Studio assistant server returned an unexpected response (HTTP ${status}).`,
        );
      }
      return unwrapAssistantResult(json);
    },
  };
}
