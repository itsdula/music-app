/**
 * Bridged preferences adapter (the Electron renderer's store) over an in-memory fake
 * bridge: the shared KeyValueStore contract plus write ordering, coalescing, flush and
 * failure handling.
 */
import { describe, expect, it, vi } from 'vitest';
import { runKeyValueStoreContract } from '../../../project-storage/tests/repository-contracts';
import { createBridgedKeyValueStore, type KeyValueBridge } from '../../src/storage';

type Call = ['set', string, string] | ['delete', string];

/** A host bridge over a plain object, recording calls; `gate` holds writes until released. */
class FakeBridge implements KeyValueBridge {
  readonly entries: Record<string, string> = {};
  readonly calls: Call[] = [];
  inFlight = 0;
  maxInFlight = 0;
  failKeys = new Set<string>();
  private gate: Promise<void> | undefined;
  private release: (() => void) | undefined;

  load(): Promise<Record<string, string>> {
    return Promise.resolve({ ...this.entries });
  }
  set(key: string, value: string): Promise<void> {
    return this.write(['set', key, value], () => {
      this.entries[key] = value;
    });
  }
  delete(key: string): Promise<void> {
    return this.write(['delete', key], () => {
      delete this.entries[key];
    });
  }

  hold(): void {
    this.gate = new Promise((resolve) => (this.release = resolve));
  }
  open(): void {
    this.release?.();
    this.gate = undefined;
  }

  private async write(call: Call, apply: () => void): Promise<void> {
    this.calls.push(call);
    this.inFlight++;
    this.maxInFlight = Math.max(this.maxInFlight, this.inFlight);
    try {
      await this.gate;
      await Promise.resolve();
      if (this.failKeys.has(call[1])) throw new Error(`disk says no: ${call[1]}`);
      apply();
    } finally {
      this.inFlight--;
    }
  }
}

runKeyValueStoreContract('bridged (fake bridge)', async () => {
  const bridge = new FakeBridge();
  return {
    store: await createBridgedKeyValueStore(bridge),
    reopen: () => createBridgedKeyValueStore(bridge),
  };
});

const silent = () => ({ warn: vi.fn() });

describe('createBridgedKeyValueStore', () => {
  it('hydrates from load() and keeps reads synchronous', async () => {
    const bridge = new FakeBridge();
    Object.assign(bridge.entries, { 'theme.config': 'dark', 'ui.a': '1' });
    const store = await createBridgedKeyValueStore(bridge);
    expect(store.keys()).toEqual(['theme.config', 'ui.a']);
    store.set('ui.a', '0');
    expect(store.get('ui.a')).toBe('0');
    expect(bridge.entries['ui.a']).toBe('1');
    await store.flush();
    expect(bridge.entries['ui.a']).toBe('0');
  });

  it('skips loaded entries that are not valid preferences', async () => {
    const bridge = new FakeBridge();
    vi.spyOn(bridge, 'load').mockResolvedValue({
      good: 'ok',
      'bad key': 'x',
      number: 42 as unknown as string,
    });
    const store = await createBridgedKeyValueStore(bridge);
    expect(store.keys()).toEqual(['good']);
  });

  it.each([
    ['rejects', () => Promise.reject(new Error('ipc down'))],
    ['returns null', () => Promise.resolve(null as unknown as Record<string, string>)],
    ['returns an array', () => Promise.resolve([] as unknown as Record<string, string>)],
  ])('starts empty and warns when load() %s', async (_label, load) => {
    const bridge = new FakeBridge();
    vi.spyOn(bridge, 'load').mockImplementation(load);
    const logger = silent();
    const store = await createBridgedKeyValueStore(bridge, { logger });
    expect(store.keys()).toEqual([]);
    expect(logger.warn).toHaveBeenCalledTimes(1);
    store.set('ui.a', '1');
    await store.flush();
    expect(bridge.entries).toEqual({ 'ui.a': '1' });
  });

  it('sends writes one at a time, in order', async () => {
    const bridge = new FakeBridge();
    const store = await createBridgedKeyValueStore(bridge);
    store.set('a', '1');
    store.set('b', '2');
    store.delete('a');
    store.set('c', '3');
    await store.flush();
    expect(bridge.maxInFlight).toBe(1);
    // `a` was set and deleted before the first call: coalesced into one delete.
    expect(bridge.calls).toEqual([
      ['delete', 'a'],
      ['set', 'b', '2'],
      ['set', 'c', '3'],
    ]);
    expect(bridge.entries).toEqual({ b: '2', c: '3' });
  });

  it('coalesces rapid writes to the same key while a write is in flight', async () => {
    const bridge = new FakeBridge();
    const store = await createBridgedKeyValueStore(bridge);
    bridge.hold();
    store.set('layout.width', '100');
    await vi.waitFor(() => expect(bridge.inFlight).toBe(1));
    for (let width = 101; width <= 150; width++) store.set('layout.width', String(width));
    expect(store.get('layout.width')).toBe('150');
    bridge.open();
    await store.flush();
    expect(bridge.calls).toEqual([
      ['set', 'layout.width', '100'],
      ['set', 'layout.width', '150'],
    ]);
    expect(bridge.entries['layout.width']).toBe('150');
  });

  it('flush() waits for writes queued while flushing', async () => {
    const bridge = new FakeBridge();
    const store = await createBridgedKeyValueStore(bridge);
    store.set('a', '1');
    const flushed = store.flush();
    store.set('b', '2');
    await flushed;
    expect(bridge.entries).toEqual({ a: '1', b: '2' });
    // A write after the queue drained starts a new drain.
    store.set('c', '3');
    await store.flush();
    expect(bridge.entries).toEqual({ a: '1', b: '2', c: '3' });
  });

  it('keeps the value in memory and warns once when the bridge rejects writes', async () => {
    const bridge = new FakeBridge();
    bridge.failKeys.add('a').add('b');
    const logger = silent();
    const store = await createBridgedKeyValueStore(bridge, { logger });
    store.set('a', '1');
    store.set('b', '2');
    store.set('c', '3');
    await expect(store.flush()).resolves.toBeUndefined();
    expect(store.get('a')).toBe('1');
    expect(bridge.entries).toEqual({ c: '3' });
    expect(logger.warn).toHaveBeenCalledTimes(1);
  });

  it('never calls the bridge for invalid input', async () => {
    const bridge = new FakeBridge();
    const store = await createBridgedKeyValueStore(bridge);
    expect(() => store.set('not valid', '1')).toThrow();
    expect(() => store.set('ok', 'x'.repeat(64 * 1024 + 1))).toThrow();
    await store.flush();
    expect(bridge.calls).toEqual([]);
  });
});
