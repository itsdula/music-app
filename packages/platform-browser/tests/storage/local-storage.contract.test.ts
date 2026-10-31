/**
 * localStorage preferences adapter over an in-memory `Storage` fake (Node): the shared
 * KeyValueStore contract plus adapter behaviour (namespacing, hydration, quota and blocked
 * storage, cross-tab `storage` events). `local-storage.jsdom.contract.test.ts` repeats the
 * contract against jsdom's real `window.localStorage`.
 */
import { InvalidRecordError } from '@studio/project-storage';
import { describe, expect, it, vi } from 'vitest';
import { runKeyValueStoreContract } from '../../../project-storage/tests/repository-contracts';
import {
  createLocalStorageKeyValueStore,
  DEFAULT_PREFERENCES_PREFIX,
  type KeyValueStorageArea,
  type StorageEventSource,
} from '../../src/storage';

/** Map-backed `Storage` with an optional quota (in UTF-16 units, like browsers). */
class FakeStorage implements KeyValueStorageArea {
  readonly items = new Map<string, string>();
  constructor(private readonly quota = Infinity) {}

  get length(): number {
    return this.items.size;
  }
  key(index: number): string | null {
    return [...this.items.keys()][index] ?? null;
  }
  getItem(key: string): string | null {
    return this.items.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    let used = key.length + value.length;
    for (const [k, v] of this.items) if (k !== key) used += k.length + v.length;
    if (used > this.quota) throw new DOMException('quota', 'QuotaExceededError');
    this.items.set(key, value);
  }
  removeItem(key: string): void {
    this.items.delete(key);
  }
  clear(): void {
    this.items.clear();
  }
}

/** Collects `storage` listeners so tests can play another tab. */
class FakeEventSource implements StorageEventSource {
  readonly listeners = new Set<(event: StorageEvent) => void>();
  addEventListener(_type: 'storage', listener: (event: StorageEvent) => void): void {
    this.listeners.add(listener);
  }
  removeEventListener(_type: 'storage', listener: (event: StorageEvent) => void): void {
    this.listeners.delete(listener);
  }
  /** What another tab's write looks like here: storage already changed, then the event. */
  emit(event: { key: string | null; newValue?: string | null; storageArea?: unknown }): void {
    const full = { newValue: null, storageArea: null, ...event } as unknown as StorageEvent;
    for (const listener of this.listeners) listener(full);
  }
}

function otherTabWrite(
  storage: FakeStorage,
  events: FakeEventSource,
  key: string,
  value: string | undefined,
) {
  const name = DEFAULT_PREFERENCES_PREFIX + key;
  if (value === undefined) storage.removeItem(name);
  else storage.setItem(name, value);
  events.emit({ key: name, newValue: value ?? null, storageArea: storage });
}

runKeyValueStoreContract('localStorage (fake Storage)', () => {
  const storage = new FakeStorage();
  const events = new FakeEventSource();
  const store = createLocalStorageKeyValueStore({ storage, events });
  return {
    store,
    reopen: () => createLocalStorageKeyValueStore({ storage, events }),
    externalChange: (key, value) => otherTabWrite(storage, events, key, value),
    dispose: () => store.dispose(),
  };
});

const silent = () => ({ warn: vi.fn() });

describe('createLocalStorageKeyValueStore', () => {
  it('stores values under the prefix and leaves other keys alone', () => {
    const storage = new FakeStorage();
    storage.setItem('unrelated', 'x');
    storage.setItem('studio.other.pianoRoll', '1');
    const store = createLocalStorageKeyValueStore({ storage, events: new FakeEventSource() });
    store.set('theme.config', 'dark');
    expect(storage.getItem('studio.pref.theme.config')).toBe('dark');
    expect(store.keys()).toEqual(['theme.config']);
    store.delete('theme.config');
    expect([...storage.items.keys()]).toEqual(['unrelated', 'studio.other.pianoRoll']);
  });

  it('hydrates its namespace once and serves reads from memory', () => {
    const storage = new FakeStorage();
    storage.setItem('studio.pref.ui.a', '1');
    storage.setItem('studio.pref.layout.panels', '{"bottom":240}');
    storage.setItem('other.ui.a', 'ignored');
    const getItem = vi.spyOn(storage, 'getItem');
    const store = createLocalStorageKeyValueStore({ storage, events: new FakeEventSource() });
    const callsAfterHydration = getItem.mock.calls.length;
    expect(store.keys()).toEqual(['layout.panels', 'ui.a']);
    expect(store.get('ui.a')).toBe('1');
    expect(store.get('layout.panels')).toBe('{"bottom":240}');
    expect(getItem.mock.calls.length).toBe(callsAfterHydration);
  });

  it('skips stored entries that are not valid preferences', () => {
    const storage = new FakeStorage();
    storage.setItem('studio.pref.bad key', '1');
    storage.setItem('studio.pref.too.big', 'x'.repeat(64 * 1024 + 1));
    storage.setItem('studio.pref.good', 'ok');
    const store = createLocalStorageKeyValueStore({ storage, events: new FakeEventSource() });
    expect(store.keys()).toEqual(['good']);
  });

  it('honours a custom prefix', () => {
    const storage = new FakeStorage();
    const store = createLocalStorageKeyValueStore({
      storage,
      prefix: 'test.',
      events: new FakeEventSource(),
    });
    store.set('a', '1');
    expect(storage.getItem('test.a')).toBe('1');
  });

  it('keeps the in-memory value and warns once when a write exceeds the quota', () => {
    const storage = new FakeStorage(64);
    const logger = silent();
    const store = createLocalStorageKeyValueStore({
      storage,
      events: new FakeEventSource(),
      logger,
    });
    store.set('a', 'x'.repeat(100));
    store.set('b', 'y'.repeat(100));
    expect(store.get('a')).toBe('x'.repeat(100));
    expect(store.get('b')).toBe('y'.repeat(100));
    expect(storage.length).toBe(0);
    expect(logger.warn).toHaveBeenCalledTimes(1);
    store.set('c', 'ok');
    expect(storage.getItem('studio.pref.c')).toBe('ok');
  });

  it('falls back to memory when storage is blocked', () => {
    const blocked = new FakeStorage();
    Object.defineProperty(blocked, 'length', {
      get() {
        throw new DOMException('denied', 'SecurityError');
      },
    });
    const logger = silent();
    const events = new FakeEventSource();
    const store = createLocalStorageKeyValueStore({ storage: blocked, events, logger });
    expect(store.persistent).toBe(false);
    expect(logger.warn).toHaveBeenCalledTimes(1);
    store.set('ui.a', '1');
    expect(store.get('ui.a')).toBe('1');
    expect(blocked.items.size).toBe(0);
    expect(events.listeners.size).toBe(0);
  });

  it('falls back to memory when there is no localStorage at all', () => {
    // Node has no `localStorage` global; the default lookup must not throw.
    const store = createLocalStorageKeyValueStore({ logger: silent() });
    expect(store.persistent).toBe(false);
    store.set('ui.a', '1');
    expect(store.get('ui.a')).toBe('1');
    store.dispose();
  });

  it('falls back to memory when reading the localStorage global throws', () => {
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get() {
        throw new DOMException('denied', 'SecurityError');
      },
    });
    try {
      const store = createLocalStorageKeyValueStore({ logger: silent() });
      expect(store.persistent).toBe(false);
    } finally {
      Reflect.deleteProperty(globalThis, 'localStorage');
    }
  });

  it('follows other tabs, including clear(), and ignores foreign keys and areas', () => {
    const storage = new FakeStorage();
    const events = new FakeEventSource();
    const store = createLocalStorageKeyValueStore({ storage, events });
    const seen: Array<[string, string | undefined]> = [];
    store.subscribe((key, value) => seen.push([key, value]));
    store.set('ui.a', '1');
    store.set('ui.b', '2');
    seen.length = 0;

    otherTabWrite(storage, events, 'ui.a', '10');
    events.emit({ key: 'unrelated', newValue: 'x', storageArea: storage });
    events.emit({ key: 'studio.pref.ui.a', newValue: 'session', storageArea: new FakeStorage() });
    expect(store.get('ui.a')).toBe('10');

    storage.clear();
    storage.setItem('studio.pref.ui.c', '3');
    events.emit({ key: null, storageArea: storage });
    expect(store.keys()).toEqual(['ui.c']);
    expect(seen).toEqual([
      ['ui.a', '10'],
      ['ui.a', undefined],
      ['ui.b', undefined],
      ['ui.c', '3'],
    ]);
  });

  it('stops following other tabs after dispose()', () => {
    const storage = new FakeStorage();
    const events = new FakeEventSource();
    const store = createLocalStorageKeyValueStore({ storage, events });
    store.dispose();
    expect(events.listeners.size).toBe(0);
  });

  it('rejects invalid keys before touching storage', () => {
    const storage = new FakeStorage();
    const setItem = vi.spyOn(storage, 'setItem');
    const store = createLocalStorageKeyValueStore({ storage, events: new FakeEventSource() });
    expect(() => store.set('../escape', '1')).toThrow(InvalidRecordError);
    expect(setItem).not.toHaveBeenCalled();
  });

  it('migrates legacy studio.ui.* toggles into the preferences namespace', () => {
    const storage = new FakeStorage();
    storage.setItem('studio.ui.a', 'true');
    storage.setItem('studio.ui.b', 'false');
    storage.setItem(`${DEFAULT_PREFERENCES_PREFIX}ui.b`, 'true');
    const store = createLocalStorageKeyValueStore({ storage, events: new FakeEventSource() });
    expect(store.get('ui.a')).toBe('true');
    expect(store.get('ui.b')).toBe('true');
    expect([...storage.items.keys()].some((k) => k.startsWith('studio.ui.'))).toBe(false);
  });
});
