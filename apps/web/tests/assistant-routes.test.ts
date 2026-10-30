import type { AssistantResult } from '@studio/assistant-core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { handleAssistantOptions, handleAssistantPost } from '../lib/assistant/http';
import type { AssistantServer } from '../lib/assistant/server';

vi.mock('next/headers', () => ({
  headers: () => Promise.resolve(new Headers({ 'x-real-ip': '203.0.113.7' })),
}));

const URL_ = 'https://studio.example.com/api/assistant';
const body = { messages: [{ role: 'user', content: 'hi' }], tools: [] };
const ok: AssistantResult = {
  ok: true,
  response: { message: { role: 'assistant', content: 'hey' }, model: 'm', finishReason: 'stop' },
};

function post(headers: Record<string, string> = {}, payload: string = JSON.stringify(body)) {
  return new Request(URL_, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: payload,
  });
}

function stubServer(result: AssistantResult = ok) {
  const complete = vi.fn<AssistantServer['complete']>(() => Promise.resolve(result));
  return { server: { complete }, complete };
}

describe('handleAssistantPost', () => {
  it('serves the Electron origin with CORS headers', async () => {
    const { server, complete } = stubServer();
    const response = await handleAssistantPost(post({ Origin: 'studio://app' }), server, {});
    expect(response.status).toBe(200);
    expect(response.headers.get('access-control-allow-origin')).toBe('studio://app');
    expect(response.headers.get('vary')).toBe('Origin');
    expect(await response.json()).toEqual(ok);
    expect(complete).toHaveBeenCalledWith(body, { clientKey: 'ip:unknown' });
  });

  it('allows same-origin, configured and requests without an Origin header', async () => {
    const { server } = stubServer();
    const env = { STUDIO_ASSISTANT_ALLOWED_ORIGINS: 'http://localhost:3001, https://a.test' };
    for (const origin of [
      'https://studio.example.com',
      'http://localhost:3001',
      'https://a.test',
    ]) {
      const response = await handleAssistantPost(post({ Origin: origin }), server, env);
      expect(response.status).toBe(200);
      expect(response.headers.get('access-control-allow-origin')).toBe(origin);
    }
    const noOrigin = await handleAssistantPost(post(), server, env);
    expect(noOrigin.status).toBe(200);
    expect(noOrigin.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('rejects other origins without calling the service', async () => {
    const { server, complete } = stubServer();
    const response = await handleAssistantPost(post({ Origin: 'https://evil.test' }), server, {});
    expect(response.status).toBe(401);
    expect(response.headers.get('access-control-allow-origin')).toBeNull();
    expect(await response.json()).toMatchObject({ ok: false, code: 'unauthorized' });
    expect(complete).not.toHaveBeenCalled();
  });

  it('requires the bearer token when STUDIO_ASSISTANT_TOKEN is set', async () => {
    const { server, complete } = stubServer();
    const env = { STUDIO_ASSISTANT_TOKEN: 'secret-token' };
    for (const auth of [undefined, 'Bearer wrong', 'secret-token', 'Bearer secret-tokenx']) {
      const response = await handleAssistantPost(
        post(auth ? { Authorization: auth } : {}),
        server,
        env,
      );
      expect(response.status).toBe(401);
      expect(await response.json()).toMatchObject({ code: 'unauthorized' });
    }
    expect(complete).not.toHaveBeenCalled();
    const good = await handleAssistantPost(
      post({ Authorization: 'Bearer secret-token' }),
      server,
      env,
    );
    expect(good.status).toBe(200);
  });

  it('rejects non-JSON and oversized bodies', async () => {
    const { server } = stubServer();
    const bad = await handleAssistantPost(post({}, '{nope'), server, {});
    expect(bad.status).toBe(400);
    expect(await bad.json()).toMatchObject({ code: 'bad-request' });
    const big = await handleAssistantPost(post({}, 'x'.repeat(1_000_001)), server, {});
    expect(big.status).toBe(400);
  });

  it('maps failure codes to HTTP statuses', async () => {
    const cases: [AssistantResult, number][] = [
      [{ ok: false, code: 'not-configured', message: 'm' }, 503],
      [{ ok: false, code: 'rate-limited', message: 'm' }, 429],
      [{ ok: false, code: 'bad-request', message: 'm' }, 400],
      [{ ok: false, code: 'provider-error', message: 'm' }, 502],
    ];
    for (const [result, status] of cases) {
      const response = await handleAssistantPost(post(), stubServer(result).server, {});
      expect(response.status).toBe(status);
      expect(await response.json()).toEqual(result);
    }
  });
});

describe('handleAssistantOptions', () => {
  it('answers preflight for allowed origins only', () => {
    const allowed = handleAssistantOptions(
      new Request(URL_, { method: 'OPTIONS', headers: { Origin: 'studio://app' } }),
      {},
    );
    expect(allowed.status).toBe(204);
    expect(allowed.headers.get('access-control-allow-origin')).toBe('studio://app');
    expect(allowed.headers.get('access-control-allow-headers')).toContain('Authorization');
    expect(allowed.headers.get('access-control-allow-methods')).toContain('POST');
    const denied = handleAssistantOptions(
      new Request(URL_, { method: 'OPTIONS', headers: { Origin: 'https://evil.test' } }),
      {},
    );
    expect(denied.status).toBe(403);
  });
});

describe('route and server action without OPENROUTER_API_KEY', () => {
  const fetchSpy = vi.fn(() => Promise.reject(new Error('the provider must not be called')));

  beforeEach(() => {
    vi.stubEnv('OPENROUTER_API_KEY', '');
    vi.stubGlobal('fetch', fetchSpy);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('POST /api/assistant returns 503 not-configured', async () => {
    const { POST } = await import('../app/api/assistant/route');
    const response = await POST(post({ Origin: 'studio://app' }));
    expect(response.status).toBe(503);
    const result = (await response.json()) as AssistantResult;
    expect(result).toMatchObject({ ok: false, code: 'not-configured' });
    expect(!result.ok && result.message).toContain('OPENROUTER_API_KEY');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('completeAssistant returns not-configured', async () => {
    const { completeAssistant } = await import('../app/actions/assistant');
    await expect(completeAssistant(body as never)).resolves.toMatchObject({
      ok: false,
      code: 'not-configured',
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('completeAssistant calls OpenRouter through the global fetch once a key is set', async () => {
    vi.stubEnv('OPENROUTER_API_KEY', 'sk-or-v1-from-env');
    fetchSpy.mockImplementationOnce(
      () =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              model: 'anthropic/claude-haiku-4.5',
              choices: [{ message: { content: 'hi' }, finish_reason: 'stop' }],
            }),
            { status: 200 },
          ),
        ) as never,
    );
    const { completeAssistant } = await import('../app/actions/assistant');
    const result = await completeAssistant(body as never);
    expect(result).toMatchObject({ ok: true, response: { message: { content: 'hi' } } });
    expect(fetchSpy).toHaveBeenCalledWith(
      'https://openrouter.ai/api/v1/chat/completions',
      expect.objectContaining({ method: 'POST' }),
    );
  });
});
