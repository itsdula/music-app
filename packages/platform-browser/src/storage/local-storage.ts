/**
 * `KeyValueStore` over `window.localStorage` for the browser hosts (Next.js, Vite). The
 * whole namespace is read once into memory, so reads never touch storage; writes go
 * through synchronously. Storage failures never reach the caller: when localStorage is
 * missing or blocked, or a write hits the quota, the in-memory value still applies for
 * this page and one warning is logged.
 */
import type { Logger } from '@studio/platform-contracts';
import { createMemoryKeyValueStore, type KeyValueStore } from '@studio/project-storage';

export const DEFAULT_PREFERENCES_PREFIX = 'studio.pref.';

/** The parts of the DOM `Storage` interface the adapter uses. */
export type KeyValueStorageArea = Pick<
  Storage,
  'length' | 'key' | 'getItem' | 'setItem' | 'removeItem'
>;

/** Source of cross-tab `storage` events (normally `window`). */
export interface StorageEventSource {
  addEventListener(type: 'storage', listener: (event: StorageEvent) => void): void;
  removeEventListener(type: 'storage', listener: (event: StorageEvent) => void): void;
}

export interface LocalStorageKeyValueStoreOptions {
  /** Namespace inside the origin's storage; keys are stored as `prefix + key`. */
  readonly prefix?: string;
  /** Defaults to `window.localStorage` when it is accessible, else memory only. */
  readonly storage?: KeyValueStorageArea;
  /** Defaults to `window`; changes made in other tabs of the same origin arrive here. */
  readonly events?: StorageEventSource;
  /** Receives one warning the first time persisting fails. */
  readonly logger?: Pick<Logger, 'warn'>;
}

export interface LocalStorageKeyValueStore extends KeyValueStore {
  /** False when localStorage was unavailable and values live in memory only. */
  readonly persistent: boolean;
  /** Stops listening for cross-tab changes. */
  dispose(): void;
}

function defaultStorage(): KeyValueStorageArea | undefined {
  try {
    // Reading the property itself throws (SecurityError) when storage is blocked.
    return globalThis.localStorage ?? undefined;
  } catch {
    return undefined;
  }
}

function defaultEvents(): StorageEventSource | undefined {
  return typeof window === 'undefined' ? undefined : window;
}

/** Every `prefix`-ed entry of `storage`, with the prefix removed. Throws if storage does. */
function readNamespace(storage: KeyValueStorageArea, prefix: string): Map<string, string> {
  const entries = new Map<string, string>();
  for (let i = 0; i < storage.length; i++) {
    const name = storage.key(i);
    if (name === null || !name.startsWith(prefix)) continue;
    const value = storage.getItem(name);
    if (value !== null) entries.set(name.slice(prefix.length), value);
  }
  return entries;
}

/** Where `usePersistentToggle` stored UI toggles before preferences got their own namespace. */
export const LEGACY_UI_PREFIX = 'studio.ui.';

/**
 * Moves legacy `studio.ui.<key>` entries to `<prefix>ui.<key>` (keeping any value already
 * there) and removes the old keys. Throws if storage does.
 */
function migrateLegacyUiKeys(storage: KeyValueStorageArea, prefix: string): void {
  const legacy: string[] = [];
  for (let i = 0; i < storage.length; i++) {
    const name = storage.key(i);
    if (name !== null && name.startsWith(LEGACY_UI_PREFIX)) legacy.push(name);
  }
  for (const name of legacy) {
    const target = `${prefix}ui.${name.slice(LEGACY_UI_PREFIX.length)}`;
    const value = storage.getItem(name);
    if (value !== null && storage.getItem(target) === null) storage.setItem(target, value);
    storage.removeItem(name);
  }
}

export function createLocalStorageKeyValueStore(
  options: LocalStorageKeyValueStoreOptions = {},
): LocalStorageKeyValueStore {
  const prefix = options.prefix ?? DEFAULT_PREFERENCES_PREFIX;
  const logger = options.logger ?? {
    warn: (message, data) => console.warn(`[studio] ${message}`, data),
  };
  let storage = options.storage ?? defaultStorage();
  let initial = new Map<string, string>();
  if (storage) {
    try {
      if (prefix === DEFAULT_PREFERENCES_PREFIX) {
        try {
          migrateLegacyUiKeys(storage, prefix);
        } catch {
          // Best effort (quota): the old values stay where they were.
        }
      }
      initial = readNamespace(storage, prefix);
    } catch (error) {
      logger.warn('Preferences: localStorage is unavailable; using memory only', error);
      storage = undefined;
    }
  }

  let warned = false;
  const persist = (key: string, value: string | undefined) => {
    if (!storage) return;
    try {
      if (value === undefined) storage.removeItem(prefix + key);
      else storage.setItem(prefix + key, value);
    } catch (error) {
      // Quota exceeded or storage revoked: the in-memory value still applies.
      if (warned) return;
      warned = true;
      logger.warn('Preferences: could not save to localStorage; changes last until reload', error);
    }
  };

  const store = createMemoryKeyValueStore({ initial, persist });

  // Another tab of this origin changed storage (same-tab writes do not fire `storage`).
  const onStorage = (event: StorageEvent) => {
    if (!storage || (event.storageArea !== null && event.storageArea !== storage)) return;
    if (event.key === null) {
      // `clear()` (or an unknown bulk change): resynchronise the whole namespace.
      let current: Map<string, string>;
      try {
        current = readNamespace(storage, prefix);
      } catch {
        return;
      }
      for (const key of store.keys()) if (!current.has(key)) store.receive(key, undefined);
      for (const [key, value] of current) store.receive(key, value);
      return;
    }
    if (!event.key.startsWith(prefix)) return;
    store.receive(event.key.slice(prefix.length), event.newValue ?? undefined);
  };
  const events = storage ? (options.events ?? defaultEvents()) : undefined;
  events?.addEventListener('storage', onStorage);

  return {
    get: (key) => store.get(key),
    set: (key, value) => store.set(key, value),
    delete: (key) => store.delete(key),
    keys: (keyPrefix) => store.keys(keyPrefix),
    subscribe: (listener) => store.subscribe(listener),
    flush: () => store.flush(),
    persistent: storage !== undefined,
    dispose() {
      events?.removeEventListener('storage', onStorage);
    },
  };
}
