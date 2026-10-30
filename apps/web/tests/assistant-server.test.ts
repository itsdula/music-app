import type { FetchLike, FetchLikeInit } from '@studio/assistant-core';
import { describe, expect, it } from 'vitest';
import { createRateLimiter } from '../lib/assistant/rate-limit';
import {
  clientKeyFromHeaders,
  createAssistantServer,
  DEFAULT_RATE_LIMIT_PER_MINUTE,
  type AssistantEnv,
} from '../lib/assistant/server';

const KEY = 'sk-or-v1-test-key-123456';
const request = { messages: [{ role: 'user', content: 'Add a bass track' }], tools: [] };
const ctx = { clientKey: 'ip:1.2.3.4' };

function fakeFetch(reply: { status: number; json: unknown } = okReply()) {
  const calls: { url: string; init: FetchLikeInit }[] = [];
  const fetch: FetchLike = (url, init) => {
    calls.push({ url, init });
    return Promise.resolve({
      ok: reply.status < 300,
      status: reply.status,
      text: () => Promise.resolve(JSON.stringify(reply.json)),
    });
  };
  return { fetch, calls };
}

function okReply() {
  return {
    status: 200,
    json: {
      model: 'anthropic/claude-haiku-4.5',
      choices: [{ message: { role: 'assistant', content: 'Done' }, finish_reason: 'stop' }],
    },
  };
}

describe('createAssistantServer', () => {
  it('returns not-configured without OPENROUTER_API_KEY and never calls the provider', async () => {
    const { fetch, calls } = fakeFetch();
    for (const env of [{}, { OPENROUTER_API_KEY: '   ' }] as AssistantEnv[]) {
      const result = await createAssistantServer({ env, fetch }).complete(request, ctx);
      expect(result).toMatchObject({ ok: false, code: 'not-configured' });
      expect(!result.ok && result.message).toContain('OPENROUTER_API_KEY');
    }
    expect(calls).toHaveLength(0);
  });

  it('calls OpenRouter with the server key, default model and referer', async () => {
    const { fetch, calls } = fakeFetch();
    const server = createAssistantServer({
      env: { OPENROUTER_API_KEY: KEY, STUDIO_PUBLIC_URL: 'https://studio.example.com' },
      fetch,
    });
    const result = await server.complete(request, ctx);
    expect(result).toEqual({
      ok: true,
      response: {
        message: { role: 'assistant', content: 'Done' },
        model: 'anthropic/claude-haiku-4.5',
        finishReason: 'stop',
      },
    });
    expect(calls[0]!.url).toBe('https://openrouter.ai/api/v1/chat/completions');
    expect(calls[0]!.init.headers.Authorization).toBe(`Bearer ${KEY}`);
    expect(calls[0]!.init.headers['HTTP-Referer']).toBe('https://studio.example.com');
    expect(JSON.parse(calls[0]!.init.body)).toMatchObject({ model: 'anthropic/claude-haiku-4.5' });
  });

  it('honours OPENROUTER_MODEL and only allow-listed client model choices', async () => {
    const { fetch, calls } = fakeFetch();
    const server = createAssistantServer({
      env: {
        OPENROUTER_API_KEY: KEY,
        OPENROUTER_MODEL: 'openai/gpt-4.1-mini',
        OPENROUTER_ALLOWED_MODELS: 'google/gemini-2.5-flash, x/y',
      },
      fetch,
    });
    await server.complete({ ...request, model: 'expensive/model' }, ctx);
    await server.complete({ ...request, model: 'google/gemini-2.5-flash' }, ctx);
    const models = calls.map((call) => (JSON.parse(call.init.body) as { model: string }).model);
    expect(models).toEqual(['openai/gpt-4.1-mini', 'google/gemini-2.5-flash']);
  });

  it('rejects invalid input with bad-request before calling the provider', async () => {
    const { fetch, calls } = fakeFetch();
    const server = createAssistantServer({ env: { OPENROUTER_API_KEY: KEY }, fetch });
    const result = await server.complete({ messages: 'nope' }, ctx);
    expect(result).toMatchObject({ ok: false, code: 'bad-request' });
    expect(calls).toHaveLength(0);
  });

  it('returns provider errors as results without the key', async () => {
    const { fetch } = fakeFetch({
      status: 401,
      json: { error: { message: `No auth credentials found for ${KEY}` } },
    });
    const result = await createAssistantServer({
      env: { OPENROUTER_API_KEY: KEY },
      fetch,
    }).complete(request, ctx);
    expect(result).toMatchObject({ ok: false, code: 'unauthorized' });
    expect(JSON.stringify(result)).not.toContain(KEY);
  });

  it('rate limits per client per minute', async () => {
    let now = 0;
    const { fetch } = fakeFetch();
    const server = createAssistantServer({
      env: { OPENROUTER_API_KEY: KEY, STUDIO_ASSISTANT_RATE_LIMIT: '2' },
      fetch,
      now: () => now,
    });
    expect((await server.complete(request, ctx)).ok).toBe(true);
    expect((await server.complete(request, ctx)).ok).toBe(true);
    expect(await server.complete(request, ctx)).toMatchObject({ ok: false, code: 'rate-limited' });
    expect((await server.complete(request, { clientKey: 'ip:5.6.7.8' })).ok).toBe(true);
    now = 60_000;
    expect((await server.complete(request, ctx)).ok).toBe(true);
  });
});

describe('createRateLimiter', () => {
  it('uses the default limit and bounds the number of tracked keys', () => {
    expect(DEFAULT_RATE_LIMIT_PER_MINUTE).toBe(30);
    const limiter = createRateLimiter({ limit: 1, windowMs: 1000, maxKeys: 2, now: () => 0 });
    expect(limiter.take('a')).toBe(true);
    expect(limiter.take('b')).toBe(true);
    expect(limiter.take('c')).toBe(true); // evicts the oldest key
    expect(limiter.take('a')).toBe(true);
    expect(limiter.take('a')).toBe(false);
  });

  it('is disabled with a limit of 0', () => {
    const limiter = createRateLimiter({ limit: 0, windowMs: 1000 });
    for (let i = 0; i < 100; i += 1) expect(limiter.take('a')).toBe(true);
  });
});

describe('clientKeyFromHeaders', () => {
  it('prefers platform-set headers and falls back to the first forwarded hop', () => {
    expect(clientKeyFromHeaders(new Headers({ 'x-vercel-forwarded-for': '9.9.9.9' }))).toBe(
      'ip:9.9.9.9',
    );
    expect(clientKeyFromHeaders(new Headers({ 'x-forwarded-for': '1.1.1.1, 10.0.0.1' }))).toBe(
      'ip:1.1.1.1',
    );
    expect(clientKeyFromHeaders(new Headers())).toBe('ip:unknown');
  });
});
