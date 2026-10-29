import { describe, expect, it } from 'vitest';
import {
  AssistantError,
  captureAssistantResult,
  DEFAULT_ASSISTANT_LIMITS,
  safeProviderMessage,
  toAssistantFailure,
  unwrapAssistantResult,
  validateAssistantRequest,
} from '../src';

const user = (content: string) => ({ role: 'user', content });
const tool = (name: string) => ({
  name,
  description: 'd',
  parameters: { type: 'object', properties: {} },
});

function message(input: unknown, limits = DEFAULT_ASSISTANT_LIMITS): string {
  const result = validateAssistantRequest(input, limits);
  if (result.ok) throw new Error('expected a validation failure');
  expect(result.code).toBe('bad-request');
  return result.message;
}

describe('validateAssistantRequest', () => {
  it('accepts a valid request and returns a clean copy without unknown fields', () => {
    const result = validateAssistantRequest({
      messages: [
        { role: 'system', content: 's', extra: 1 },
        user('hi'),
        {
          role: 'assistant',
          content: '',
          toolCalls: [{ id: 'a', name: 'play', arguments: '{}', x: 1 }],
        },
        { role: 'tool', toolCallId: 'a', content: 'ok' },
        { role: 'assistant', content: 'done', toolCalls: [] },
      ],
      tools: [{ ...tool('play'), secret: true }],
      model: '  vendor/model  ',
      apiKey: 'should be dropped',
    });
    expect(result).toEqual({
      ok: true,
      request: {
        messages: [
          { role: 'system', content: 's' },
          { role: 'user', content: 'hi' },
          {
            role: 'assistant',
            content: '',
            toolCalls: [{ id: 'a', name: 'play', arguments: '{}' }],
          },
          { role: 'tool', toolCallId: 'a', content: 'ok' },
          { role: 'assistant', content: 'done' },
        ],
        tools: [tool('play')],
        model: 'vendor/model',
      },
    });
  });

  it('treats missing tools as none', () => {
    const result = validateAssistantRequest({ messages: [user('hi')] });
    expect(result.ok && result.request.tools).toEqual([]);
  });

  it('rejects malformed structures', () => {
    expect(message(null)).toMatch(/object/);
    expect(message({ messages: 'x' })).toMatch(/messages must be an array/);
    expect(message({ messages: [] })).toMatch(/empty/);
    expect(message({ messages: [{ role: 'admin', content: 'x' }] })).toMatch(/role/);
    expect(message({ messages: [{ role: 'user', content: 1 }] })).toMatch(/content/);
    expect(message({ messages: [{ role: 'tool', content: 'x' }] })).toMatch(/toolCallId/);
    expect(
      message({
        messages: [
          {
            role: 'assistant',
            content: '',
            toolCalls: [{ id: 'a', name: 'bad name', arguments: '{}' }],
          },
        ],
      }),
    ).toMatch(/tool name/);
    expect(message({ messages: [user('x')], tools: [tool('a b')] })).toMatch(/tool name/);
    expect(message({ messages: [user('x')], tools: [{ ...tool('a'), parameters: 'x' }] })).toMatch(
      /JSON Schema/,
    );
    expect(message({ messages: [user('x')], tools: [tool('a'), tool('a')] })).toMatch(/Duplicate/);
    expect(message({ messages: [user('x')], model: 7 })).toMatch(/model/);
    expect(message({ messages: [user('x')], model: 'm'.repeat(201) })).toMatch(/too long/);
  });

  it('enforces the message, tool and character limits', () => {
    const limits = { ...DEFAULT_ASSISTANT_LIMITS, maxMessages: 2, maxTools: 1, maxTotalChars: 50 };
    expect(message({ messages: [user('a'), user('b'), user('c')] }, limits)).toMatch(
      /Too many messages/,
    );
    expect(message({ messages: [user('a')], tools: [tool('a'), tool('b')] }, limits)).toMatch(
      /Too many tools/,
    );
    expect(message({ messages: [user('x'.repeat(51))] }, limits)).toMatch(/too long/);
    // Tool definitions and tool-call arguments count towards the character budget.
    expect(
      message(
        { messages: [user('x')], tools: [{ ...tool('a'), description: 'd'.repeat(60) }] },
        limits,
      ),
    ).toMatch(/too long/);
    expect(
      message(
        {
          messages: [
            {
              role: 'assistant',
              content: '',
              toolCalls: [{ id: 'a', name: 'p', arguments: 'x'.repeat(60) }],
            },
          ],
        },
        limits,
      ),
    ).toMatch(/too long/);
  });

  it('rejects non-serialisable schemas without throwing', () => {
    const cyclic: Record<string, unknown> = { type: 'object' };
    cyclic.self = cyclic;
    expect(
      message({ messages: [user('x')], tools: [{ ...tool('a'), parameters: cyclic }] }),
    ).toMatch(/serialisable/);
  });
});

describe('results', () => {
  const response = {
    message: { role: 'assistant' as const, content: 'hi' },
    model: 'm',
    finishReason: 'stop' as const,
  };

  it('captures responses and errors as serialisable results', async () => {
    await expect(captureAssistantResult(() => Promise.resolve(response))).resolves.toEqual({
      ok: true,
      response,
    });
    await expect(
      captureAssistantResult(() => Promise.reject(new AssistantError('rate-limited', 'slow down'))),
    ).resolves.toEqual({ ok: false, code: 'rate-limited', message: 'slow down' });
    // Unknown errors never leak their message.
    expect(toAssistantFailure(new Error(`db password hunter2`))).toEqual({
      ok: false,
      code: 'provider-error',
      message: 'The assistant request failed.',
    });
  });

  it('unwraps valid results and throws AssistantError otherwise', () => {
    expect(unwrapAssistantResult({ ok: true, response })).toEqual(response);
    expect(() =>
      unwrapAssistantResult({ ok: false, code: 'not-configured', message: 'set it' }),
    ).toThrow(
      expect.objectContaining({
        name: 'AssistantError',
        code: 'not-configured',
        message: 'set it',
      }),
    );
    for (const bad of [
      null,
      'x',
      { ok: true },
      { ok: false, code: 'weird' },
      { ok: true, response: { ...response, finishReason: 'nah' } },
    ]) {
      expect(() => unwrapAssistantResult(bad)).toThrow(
        expect.objectContaining({ code: 'provider-error' }),
      );
    }
  });

  it('safeProviderMessage redacts secrets, strips control characters and truncates', () => {
    expect(safeProviderMessage('key abcd1234 leaked', ['abcd1234'])).toBe('key [redacted] leaked');
    expect(safeProviderMessage('a\u0000b\nc')).toBe('a b c');
    expect(safeProviderMessage(42)).toBe('');
    expect(safeProviderMessage('x'.repeat(400))).toHaveLength(301);
  });
});
