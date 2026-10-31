import { describe, expect, it } from 'vitest';
import { LogHub, MAX_CLIENT_BACKLOG_BYTES, sseFrame, type SseSink } from '../src/log-hub';
import type { LogRecordInput } from '../src/shared/types';

const input = (body: string): LogRecordInput => ({
  service: 'studio-next',
  timeMs: 1,
  severityNumber: 9,
  severityText: 'INFO',
  body,
  attributes: {},
});

class Sink implements SseSink {
  readonly chunks: string[] = [];
  write(chunk: string) {
    this.chunks.push(chunk);
  }
  events(): string[] {
    return this.chunks.flatMap((c) =>
      c.startsWith('event: ') ? [c.split('\n')[0]!.slice(7)] : [],
    );
  }
}

describe('LogHub', () => {
  it('keeps a bounded ring buffer with monotonic ids', () => {
    const hub = new LogHub(3);
    for (const body of ['a', 'b', 'c', 'd', 'e']) hub.publish(input(body));
    expect(hub.records().map((r) => [r.id, r.body])).toEqual([
      [3, 'c'],
      [4, 'd'],
      [5, 'e'],
    ]);
  });

  it('replays statuses then the buffer to a new client, then streams', () => {
    const hub = new LogHub(2);
    hub.setStatus({ id: 'next', label: 'Next.js', state: 'running', sinceMs: 1 });
    hub.publish(input('old'));
    hub.publish(input('a'));
    hub.publish(input('b'));
    const sink = new Sink();
    const remove = hub.addClient(sink);
    expect(sink.chunks[0]).toBe('retry: 1000\n\n');
    expect(sink.events()).toEqual(['status', 'log', 'log', 'ready']);
    expect(sink.chunks[2]).toBe(sseFrame('log', hub.records()[0]));
    hub.publish(input('c'));
    hub.ping();
    expect(sink.events().at(-1)).toBe('log');
    expect(sink.chunks.at(-1)).toBe(': ping\n\n');
    remove();
    hub.publish(input('d'));
    expect(sink.chunks.at(-1)).toBe(': ping\n\n');
    expect(hub.clientCount()).toBe(0);
  });

  it('broadcasts clear and status changes', () => {
    const hub = new LogHub();
    const sink = new Sink();
    hub.addClient(sink);
    hub.publish(input('a'));
    hub.clear();
    hub.setStatus({ id: 'x', label: 'X', state: 'starting', sinceMs: 1 });
    hub.removeStatus('x');
    hub.removeStatus('x');
    expect(hub.records()).toHaveLength(0);
    expect(sink.events().slice(-4)).toEqual(['log', 'clear', 'status', 'status-remove']);
    expect(hub.allStatuses()).toEqual([]);
  });

  it('drops a stalled client whose backlog passes the limit', () => {
    const hub = new LogHub();
    let destroyed = false;
    const stalled: SseSink = {
      write: () => false,
      writableLength: MAX_CLIENT_BACKLOG_BYTES + 1,
      destroy: () => {
        destroyed = true;
      },
    };
    const healthy = new Sink();
    hub.addClient(stalled);
    hub.addClient(healthy);
    hub.publish(input('x'));
    expect(destroyed).toBe(true);
    expect(hub.clientCount()).toBe(1);
  });
});
