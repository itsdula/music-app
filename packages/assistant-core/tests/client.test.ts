import { describe, expect, it } from 'vitest';
import {
  type AssistantError,
  createAssistantClient,
  createOpenAiCompatibleClient,
  createOpenRouterClient,
  DEFAULT_OPENROUTER_MODEL,
  isAssistantError,
  type AssistantRequest,
} from '../src';
import { completion, fakeFetch } from './fake-fetch';

const KEY = 'sk-or-v1-secretsecretsecret';

const request: AssistantRequest = {
  messages: [
    { role: 'system', content: 'You are Studio.' },
    { role: 'user', content: 'Add a drum track' },
    {
      role: 'assistant',
      content: '',
      toolCalls: [{ id: 'call_1', name: 'add_track', arguments: '{"kind":"drums"}' }],
    },
    { role: 'tool', toolCallId: 'call_1', content: '{"trackId":"t1"}' },
  ],
  tools: [
    {
      name: 'add_track',
      description: 'Adds a track',
      parameters: {
        type: 'object',
        properties: { kind: { type: 'string', enum: ['drums', 'synth'] } },
        required: ['kind'],
      },
    },
  ],
};

async function rejection(promise: Promise<unknown>): Promise<AssistantError> {
  try {
    await promise;
  } catch (error) {
    if (isAssistantError(error)) return error;
    throw error;
  }
  throw new Error('expected a rejection');
}

describe('OpenAI-compatible request mapping', () => {
  it('posts chat-completions JSON with tools as type:function and tool messages', async () => {
    const fetch = fakeFetch({ status: 200, json: completion({ content: 'Done.' }) });
    const client = createOpenAiCompatibleClient({
      fetch,
      baseUrl: 'https://example.test/v1/',
      apiKey: KEY,
      defaultModel: 'm/default',
      limits: { maxOutputTokens: 1000 },
    });
    await client.complete(request);

    expect(fetch.calls).toHaveLength(1);
    const [call] = fetch.calls;
    expect(call!.url).toBe('https://example.test/v1/chat/completions');
    expect(call!.init.method).toBe('POST');
    expect(call!.init.headers.Authorization).toBe(`Bearer ${KEY}`);
    expect(call!.init.headers['Content-Type']).toBe('application/json');
    expect(call!.body).toEqual({
      model: 'm/default',
      max_tokens: 1000,
      stream: false,
      tool_choice: 'auto',
      messages: [
        { role: 'system', content: 'You are Studio.' },
        { role: 'user', content: 'Add a drum track' },
        {
          role: 'assistant',
          content: null,
          tool_calls: [
            {
              id: 'call_1',
              type: 'function',
              function: { name: 'add_track', arguments: '{"kind":"drums"}' },
            },
          ],
        },
        { role: 'tool', tool_call_id: 'call_1', content: '{"trackId":"t1"}' },
      ],
      tools: [
        {
          type: 'function',
          function: {
            name: 'add_track',
            description: 'Adds a track',
            parameters: request.tools[0]!.parameters,
          },
        },
      ],
    });
  });

  it('omits tools and tool_choice when there are no tools, and the key when none is set', async () => {
    const fetch = fakeFetch({ status: 200, json: completion({ content: 'Hi' }) });
    const client = createOpenAiCompatibleClient({
      fetch,
      baseUrl: 'http://localhost:11434/v1',
      defaultModel: 'llama3.1',
    });
    await client.complete({ messages: [{ role: 'user', content: 'hi' }], tools: [] });
    const [call] = fetch.calls;
    expect(call!.body).not.toHaveProperty('tools');
    expect(call!.body).not.toHaveProperty('tool_choice');
    expect(call!.init.headers).not.toHaveProperty('Authorization');
  });

  it('uses the default model unless the requested one is allowed', async () => {
    const fetch = fakeFetch(
      { status: 200, json: completion({ content: 'a' }) },
      { status: 200, json: completion({ content: 'b' }) },
    );
    const client = createOpenAiCompatibleClient({
      fetch,
      baseUrl: 'https://x.test/v1',
      defaultModel: 'cheap',
      allowedModels: ['better'],
    });
    await client.complete({ ...request, model: 'expensive' });
    await client.complete({ ...request, model: 'better' });
    expect(fetch.calls.map((c) => c.body.model)).toEqual(['cheap', 'better']);
  });

  it('passes the abort signal through', async () => {
    const fetch = fakeFetch({ status: 200, json: completion({ content: 'a' }) });
    const client = createOpenAiCompatibleClient({
      fetch,
      baseUrl: 'https://x/v1',
      defaultModel: 'm',
    });
    const signal = { aborted: false, addEventListener() {}, removeEventListener() {} };
    await client.complete(request, signal);
    expect(fetch.calls[0]!.init.signal).toBe(signal);
  });
});

describe('OpenAI-compatible response mapping', () => {
  it('maps text replies', async () => {
    const fetch = fakeFetch({ status: 200, json: completion({ content: 'Added.' }) });
    const client = createOpenAiCompatibleClient({
      fetch,
      baseUrl: 'https://x/v1',
      defaultModel: 'm',
    });
    await expect(client.complete(request)).resolves.toEqual({
      message: { role: 'assistant', content: 'Added.' },
      model: 'provider/model-x',
      finishReason: 'stop',
    });
  });

  it('maps tool_calls to toolCalls and finishReason tool_calls', async () => {
    const fetch = fakeFetch({
      status: 200,
      json: {
        model: 'm',
        choices: [
          {
            message: {
              role: 'assistant',
              content: null,
              tool_calls: [
                { id: 'c1', type: 'function', function: { name: 'play', arguments: '{}' } },
                // Some servers return parsed objects and omit ids.
                { type: 'function', function: { name: 'set_tempo', arguments: { bpm: 120 } } },
              ],
            },
            finish_reason: 'tool_calls',
          },
        ],
      },
    });
    const client = createOpenAiCompatibleClient({
      fetch,
      baseUrl: 'https://x/v1',
      defaultModel: 'm',
    });
    const response = await client.complete(request);
    expect(response.finishReason).toBe('tool_calls');
    expect(response.message).toEqual({
      role: 'assistant',
      content: '',
      toolCalls: [
        { id: 'c1', name: 'play', arguments: '{}' },
        { id: 'call_1', name: 'set_tempo', arguments: '{"bpm":120}' },
      ],
    });
  });

  it('maps finish reasons and content parts', async () => {
    const fetch = fakeFetch(
      {
        status: 200,
        json: {
          choices: [
            {
              message: {
                content: [
                  { type: 'text', text: 'Hel' },
                  { type: 'text', text: 'lo' },
                ],
              },
              finish_reason: 'length',
            },
          ],
        },
      },
      {
        status: 200,
        json: { choices: [{ message: { content: 'x' }, finish_reason: 'content_filter' }] },
      },
    );
    const client = createOpenAiCompatibleClient({
      fetch,
      baseUrl: 'https://x/v1',
      defaultModel: 'fallback',
    });
    const first = await client.complete(request);
    expect(first).toEqual({
      message: { role: 'assistant', content: 'Hello' },
      model: 'fallback',
      finishReason: 'length',
    });
    expect((await client.complete(request)).finishReason).toBe('other');
  });
});

describe('error normalisation', () => {
  const cases: [number, string][] = [
    [401, 'unauthorized'],
    [403, 'unauthorized'],
    [429, 'rate-limited'],
    [400, 'bad-request'],
    [404, 'bad-request'],
    [402, 'provider-error'],
    [500, 'provider-error'],
    [503, 'provider-error'],
  ];
  it.each(cases)('maps HTTP %i to %s', async (status, code) => {
    const fetch = fakeFetch({ status, json: { error: { message: 'nope', code: status } } });
    const client = createOpenAiCompatibleClient({
      fetch,
      baseUrl: 'https://x/v1',
      apiKey: KEY,
      defaultModel: 'm',
    });
    const error = await rejection(client.complete(request));
    expect(error.code).toBe(code);
    expect(error.status).toBe(status);
    expect(error.message).toContain('nope');
  });

  it('never echoes the key or bearer tokens from provider messages', async () => {
    const fetch = fakeFetch({
      status: 401,
      json: {
        error: { message: `Invalid key ${KEY}; header was Bearer ${KEY}; also sk-abcdefghijkl` },
      },
    });
    const client = createOpenAiCompatibleClient({
      fetch,
      baseUrl: 'https://x/v1',
      apiKey: KEY,
      defaultModel: 'm',
    });
    const error = await rejection(client.complete(request));
    expect(error.message).not.toContain(KEY);
    expect(error.message).not.toContain('sk-abcdefghijkl');
    expect(error.message).toContain('[redacted]');
  });

  it('maps an HTTP 200 error envelope (OpenRouter upstream failure)', async () => {
    const fetch = fakeFetch({
      status: 200,
      json: { error: { message: 'upstream down', code: 502 } },
    });
    const client = createOpenAiCompatibleClient({
      fetch,
      baseUrl: 'https://x/v1',
      defaultModel: 'm',
    });
    const error = await rejection(client.complete(request));
    expect(error.code).toBe('provider-error');
  });

  it('maps invalid JSON and missing choices to provider-error', async () => {
    const fetch = fakeFetch(
      { status: 200, text: '<html>' },
      { status: 200, json: { choices: [] } },
    );
    const client = createOpenAiCompatibleClient({
      fetch,
      baseUrl: 'https://x/v1',
      defaultModel: 'm',
    });
    expect((await rejection(client.complete(request))).code).toBe('provider-error');
    expect((await rejection(client.complete(request))).code).toBe('provider-error');
  });

  it('maps fetch failures to network and rethrows aborts unchanged', async () => {
    const abort = Object.assign(new Error('aborted'), { name: 'AbortError' });
    const fetch = fakeFetch({ throws: new TypeError('fetch failed') }, { throws: abort });
    const client = createOpenAiCompatibleClient({
      fetch,
      baseUrl: 'https://x/v1',
      apiKey: KEY,
      defaultModel: 'm',
    });
    const error = await rejection(client.complete(request));
    expect(error.code).toBe('network');
    expect(error.message).not.toContain(KEY);
    await expect(client.complete(request)).rejects.toBe(abort);
  });

  it('rejects requests that fail the guards before calling the provider', async () => {
    const fetch = fakeFetch();
    const client = createOpenAiCompatibleClient({
      fetch,
      baseUrl: 'https://x/v1',
      defaultModel: 'm',
      limits: { maxMessages: 2 },
    });
    const error = await rejection(client.complete(request));
    expect(error.code).toBe('bad-request');
    expect(fetch.calls).toHaveLength(0);
  });
});

describe('presets', () => {
  it('OpenRouter: base URL, default model and attribution headers', async () => {
    const fetch = fakeFetch({ status: 200, json: completion({ content: 'ok' }) });
    const client = createOpenRouterClient({
      fetch,
      apiKey: KEY,
      referer: 'https://studio.example.com',
      title: 'Studio — DAW',
    });
    expect(client.label).toBe('OpenRouter');
    await client.complete(request);
    const [call] = fetch.calls;
    expect(call!.url).toBe('https://openrouter.ai/api/v1/chat/completions');
    expect(call!.body.model).toBe(DEFAULT_OPENROUTER_MODEL);
    expect(call!.init.headers['HTTP-Referer']).toBe('https://studio.example.com');
    expect(call!.init.headers['X-Title']).toBe('Studio  DAW');
  });

  it('OpenRouter: drops an invalid referer', async () => {
    const fetch = fakeFetch({ status: 200, json: completion({ content: 'ok' }) });
    await createOpenRouterClient({ fetch, apiKey: KEY, referer: 'javascript:alert(1)' }).complete(
      request,
    );
    expect(fetch.calls[0]!.init.headers).not.toHaveProperty('HTTP-Referer');
  });

  it('createAssistantClient builds local OpenAI-compatible clients and checks configs', async () => {
    const fetch = fakeFetch({ status: 200, json: completion({ content: 'ok' }) });
    const local = createAssistantClient({ provider: 'openai-compatible', model: 'qwen2.5' }, fetch);
    await local.complete(request);
    expect(fetch.calls[0]!.url).toBe('http://localhost:11434/v1/chat/completions');
    expect(fetch.calls[0]!.body.model).toBe('qwen2.5');
    expect(() => createAssistantClient({ provider: 'openrouter' }, fetch)).toThrow(/API key/);
    expect(() => createAssistantClient({ provider: 'openai-compatible' }, fetch)).toThrow(/model/);
  });
});
