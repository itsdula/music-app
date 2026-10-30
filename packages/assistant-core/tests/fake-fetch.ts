import type { FetchLike, FetchLikeInit } from '../src';

export interface RecordedCall {
  readonly url: string;
  readonly init: FetchLikeInit;
  readonly body: Record<string, unknown>;
}

export type FakeReply =
  | { readonly status: number; readonly json?: unknown; readonly text?: string }
  | { readonly throws: unknown };

/** A scripted `fetch` that records requests and replays canned responses in order. */
export function fakeFetch(...replies: FakeReply[]): FetchLike & { calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const queue = [...replies];
  const fn = (url: string, init: FetchLikeInit) => {
    calls.push({ url, init, body: JSON.parse(init.body) as Record<string, unknown> });
    const reply = queue.shift() ?? { status: 500, text: 'no reply scripted' };
    if ('throws' in reply) return Promise.reject(reply.throws as Error);
    const text = reply.text ?? JSON.stringify(reply.json);
    return Promise.resolve({
      ok: reply.status >= 200 && reply.status < 300,
      status: reply.status,
      text: () => Promise.resolve(text),
    });
  };
  return Object.assign(fn, { calls });
}

export function completion(message: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  return {
    id: 'gen-1',
    model: 'provider/model-x',
    choices: [{ index: 0, message: { role: 'assistant', ...message }, finish_reason: 'stop' }],
    ...extra,
  };
}
