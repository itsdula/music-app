import type { AssistantRequest } from '@studio/platform-contracts';
import { describe, expect, it, vi } from 'vitest';
import { createHttpAssistantTransport, createResultAssistantTransport } from '../../src';

const request: AssistantRequest = { messages: [{ role: 'user', content: 'hi' }], tools: [] };
const response = {
  message: { role: 'assistant', content: 'hello' },
  model: 'm',
  finishReason: 'stop',
} as const;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('createHttpAssistantTransport', () => {
  it('POSTs the request with the bearer token and unwraps the result', async () => {
    const fetch = vi.fn((_url: RequestInfo | URL, _init?: RequestInit) =>
      Promise.resolve(jsonResponse({ ok: true, response })),
    );
    const transport = createHttpAssistantTransport({
      url: 'https://studio.example.com/api/assistant',
      token: 'shared',
      fetch: fetch as typeof globalThis.fetch,
    });
    await expect(transport.complete(request)).resolves.toEqual(response);
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe('https://studio.example.com/api/assistant');
    expect(init?.method).toBe('POST');
    expect(init?.credentials).toBe('omit');
    expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer shared');
    expect(JSON.parse(init?.body as string)).toEqual(request);
  });

  it('rejects with the server error code (not-configured, rate-limited, …)', async () => {
    const fetch = () =>
      Promise.resolve(
        jsonResponse({ ok: false, code: 'not-configured', message: 'Set OPENROUTER_API_KEY' }, 503),
      );
    const transport = createHttpAssistantTransport({ url: 'https://x/api/assistant', fetch });
    await expect(transport.complete(request)).rejects.toMatchObject({
      name: 'AssistantError',
      code: 'not-configured',
      message: 'Set OPENROUTER_API_KEY',
    });
  });

  it('maps fetch failures to network and non-JSON replies to provider-error', async () => {
    const failing = createHttpAssistantTransport({
      url: 'https://x/api/assistant',
      fetch: () => Promise.reject(new TypeError('Failed to fetch')),
    });
    await expect(failing.complete(request)).rejects.toMatchObject({ code: 'network' });
    const html = createHttpAssistantTransport({
      url: 'https://x/api/assistant',
      fetch: () => Promise.resolve(new Response('<html>', { status: 502 })),
    });
    await expect(html.complete(request)).rejects.toMatchObject({ code: 'provider-error' });
  });

  it('forwards aborts from a minimal signal to fetch', async () => {
    let seen: AbortSignal | undefined;
    const fetch = (_url: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        seen = init?.signal ?? undefined;
        seen?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
      });
    const listeners: (() => void)[] = [];
    const signal = {
      aborted: false,
      addEventListener: (_type: 'abort', listener: () => void) => listeners.push(listener),
      removeEventListener: () => {},
    };
    const transport = createHttpAssistantTransport({ url: 'https://x/api/assistant', fetch });
    const pending = transport.complete(request, signal);
    signal.aborted = true;
    listeners.forEach((listener) => listener());
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(seen?.aborted).toBe(true);
  });
});

describe('createResultAssistantTransport', () => {
  it('unwraps results from the wrapped call', async () => {
    const transport = createResultAssistantTransport(() => Promise.resolve({ ok: true, response }));
    expect(transport.label).toBe('OpenRouter via Studio server');
    await expect(transport.complete(request)).resolves.toEqual(response);
  });

  it('maps thrown errors to network and failure results to their code', async () => {
    await expect(
      createResultAssistantTransport(() => Promise.reject(new Error('boom'))).complete(request),
    ).rejects.toMatchObject({ code: 'network' });
    await expect(
      createResultAssistantTransport(() =>
        Promise.resolve({ ok: false, code: 'rate-limited', message: 'slow down' }),
      ).complete(request),
    ).rejects.toMatchObject({ code: 'rate-limited', message: 'slow down' });
  });

  it('stops waiting when aborted', async () => {
    const controller = new AbortController();
    const transport = createResultAssistantTransport(() => new Promise(() => {}));
    const pending = transport.complete(request, controller.signal);
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });
});
