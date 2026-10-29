/**
 * Assistant transports for browser-based hosts. Both talk to a Studio server route that runs
 * the provider call with a server-held key and answers with an `AssistantResult`:
 *   - `createResultAssistantTransport` wraps any call returning a result (e.g. a Next.js server
 *     action),
 *   - `createHttpAssistantTransport` POSTs to the `/api/assistant` endpoint (Electron, Vite).
 * Failures reject with `AssistantError` (`name === 'AssistantError'`, `code: AssistantErrorCode`);
 * aborts reject with a DOM `AbortError`.
 */
import { AssistantError, isAssistantError, unwrapAssistantResult } from '@studio/assistant-core';
import type {
  AssistantRequest,
  AssistantResponse,
  AssistantTransport,
} from '@studio/platform-contracts';

export type AssistantSignal = Parameters<AssistantTransport['complete']>[1];

export const DEFAULT_SERVER_TRANSPORT_LABEL = 'OpenRouter via Studio server';

function abortError(): Error {
  return new DOMException('The assistant request was aborted.', 'AbortError');
}

/** Rejects as soon as `signal` aborts, otherwise settles with `work`. */
export function raceAbort<T>(work: Promise<T>, signal: AssistantSignal): Promise<T> {
  if (!signal) return work;
  if (signal.aborted) return Promise.reject(abortError());
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(abortError());
    signal.addEventListener('abort', onAbort, { once: true });
    work.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}

/**
 * Wraps a call that returns an `AssistantResult` (server actions cannot be cancelled, so an
 * abort only stops waiting for the answer).
 */
export function createResultAssistantTransport(
  call: (request: AssistantRequest) => Promise<unknown>,
  label: string = DEFAULT_SERVER_TRANSPORT_LABEL,
): AssistantTransport {
  return {
    label,
    async complete(
      request: AssistantRequest,
      signal?: AssistantSignal,
    ): Promise<AssistantResponse> {
      let result: unknown;
      try {
        result = await raceAbort(call(request), signal);
      } catch (error) {
        if (signal?.aborted || isAssistantError(error)) throw error;
        throw new AssistantError('network', 'Could not reach the Studio assistant server.');
      }
      return unwrapAssistantResult(result);
    },
  };
}
