/**
 * `KeyValueStore` over an asynchronous host bridge, e.g. the Electron preload API backed by
 * a JSON file in the main process. The bridge is loaded once; after that reads come from
 * the in-memory snapshot and writes update it immediately, then reach the bridge one call
 * at a time in order. Writes to a key that is still waiting are coalesced into the latest
 * value. Generic on purpose: nothing here knows about Electron.
 */
import type { Logger } from '@studio/platform-contracts';
import { createMemoryKeyValueStore, type KeyValueStore } from '@studio/project-storage';

export interface KeyValueBridge {
  /** Every stored entry. */
  load(): Promise<Record<string, string>>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
}

export interface BridgedKeyValueStoreOptions {
  /** Receives a warning when loading fails and the first time a write fails. */
  readonly logger?: Pick<Logger, 'warn'>;
}

/** Loads the bridge's entries; a failed or malformed load starts empty instead of failing. */
async function loadEntries(
  bridge: KeyValueBridge,
  logger: Pick<Logger, 'warn'>,
): Promise<Array<[string, string]>> {
  try {
    const loaded: unknown = await bridge.load();
    if (typeof loaded !== 'object' || loaded === null || Array.isArray(loaded)) {
      throw new TypeError('load() did not return an object');
    }
    return Object.entries(loaded).filter((entry): entry is [string, string] => {
      return typeof entry[1] === 'string';
    });
  } catch (error) {
    logger.warn('Preferences: could not load stored preferences; starting empty', error);
    return [];
  }
}

export async function createBridgedKeyValueStore(
  bridge: KeyValueBridge,
  options: BridgedKeyValueStoreOptions = {},
): Promise<KeyValueStore> {
  const logger = options.logger ?? {
    warn: (message, data) => console.warn(`[studio] ${message}`, data),
  };
  /** Changes not yet handed to the bridge, in first-change order; `undefined` = delete. */
  const pending = new Map<string, string | undefined>();
  let draining: Promise<void> | undefined;
  let warned = false;

  const drain = async () => {
    // Let a synchronous burst of writes collect (and coalesce) before the first call.
    await Promise.resolve();
    for (;;) {
      const next = pending.entries().next();
      if (next.done) {
        // Cleared synchronously with the empty check, so a later write starts a new drain.
        draining = undefined;
        return;
      }
      const [key, value] = next.value;
      pending.delete(key);
      try {
        if (value === undefined) await bridge.delete(key);
        else await bridge.set(key, value);
      } catch (error) {
        // The snapshot keeps the value for this session.
        if (!warned) {
          warned = true;
          logger.warn(`Preferences: could not save "${key}"; changes may not persist`, error);
        }
      }
    }
  };

  const store = createMemoryKeyValueStore({
    initial: await loadEntries(bridge, logger),
    persist(key, value) {
      pending.set(key, value);
      draining ??= drain();
    },
    flush: () => draining ?? Promise.resolve(),
  });

  return {
    get: (key) => store.get(key),
    set: (key, value) => store.set(key, value),
    delete: (key) => store.delete(key),
    keys: (prefix) => store.keys(prefix),
    subscribe: (listener) => store.subscribe(listener),
    flush: () => store.flush(),
  };
}
