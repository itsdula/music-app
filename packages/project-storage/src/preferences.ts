/**
 * Preferences port: a small key/value store for UI preferences (theme, keymap overrides,
 * panel layout, toggles) that must be readable before first paint. Reads are synchronous
 * from an in-memory snapshot; writes update the snapshot at once and are persisted behind
 * it (write-through). Implementations: memory (this module, also the building block of the
 * host adapters), localStorage and bridged (@studio/platform-browser; the bridge is the
 * Electron preload over a JSON file in `userData`).
 *
 * Structured, async settings (MIDI mappings, tutorial progress) stay on `SettingsRepository`.
 */
import { InvalidRecordError } from './errors';

export type KeyValueListener = (key: string, value: string | undefined) => void;

export interface KeyValueStore {
  /** The current value, or `undefined`. Never does I/O. */
  get(key: string): string | undefined;
  /**
   * Stores `value`. Readers and subscribers see it immediately; persistence follows. Throws
   * {@link InvalidRecordError} for a key or value outside {@link PREFERENCE_LIMITS}.
   */
  set(key: string, value: string): void;
  /** Removes `key` (a no-op when absent). */
  delete(key: string): void;
  /** Stored keys in ascending order, optionally only those starting with `prefix`. */
  keys(prefix?: string): string[];
  /**
   * Called synchronously after every change, local or from elsewhere (another tab or
   * process); `value` is `undefined` for a delete. Unchanged writes do not notify.
   */
  subscribe(listener: KeyValueListener): () => void;
  /** Resolves once every earlier write is persisted or has failed (and was logged). */
  flush(): Promise<void>;
}

/**
 * Keys are short dotted names (`ui.pianoRoll.velocityLane.editor`, `theme.config`):
 * 1-128 characters of `A-Z a-z 0-9 _ . -`, starting with a letter or digit.
 */
export const PREFERENCE_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/;

export const PREFERENCE_LIMITS = {
  /** Longest key, in characters (also enforced by {@link PREFERENCE_KEY_PATTERN}). */
  maxKeyLength: 128,
  /** Largest single value, in UTF-8 bytes. */
  maxValueBytes: 64 * 1024,
  /** Largest total of all keys plus values a host has to keep, in UTF-8 bytes. */
  maxTotalBytes: 1024 * 1024,
} as const;

/** UTF-8 encoded length of `value` without allocating (lone surrogates count as U+FFFD). */
export function utf8ByteLength(value: string): number {
  let bytes = 0;
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff && i + 1 < value.length) {
      const next = value.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4;
        i++;
      } else bytes += 3;
    } else bytes += 3;
  }
  return bytes;
}

/** Why `key` is not a valid preference key, or `null` when it is. */
export function preferenceKeyError(key: unknown): string | null {
  if (typeof key !== 'string') return 'preference key must be a string';
  if (!PREFERENCE_KEY_PATTERN.test(key)) {
    const shown = JSON.stringify(key.slice(0, 40));
    const max = PREFERENCE_LIMITS.maxKeyLength;
    return `invalid preference key ${shown}: use 1-${max} characters of A-Z a-z 0-9 _ . -`;
  }
  return null;
}

/** Why `value` cannot be stored, or `null` when it can. */
export function preferenceValueError(value: unknown): string | null {
  if (typeof value !== 'string') return 'preference value must be a string';
  // Every UTF-16 unit encodes to 1-3 UTF-8 bytes: skip the exact count when it cannot matter.
  if (
    value.length > PREFERENCE_LIMITS.maxValueBytes ||
    utf8ByteLength(value) > PREFERENCE_LIMITS.maxValueBytes
  ) {
    return `preference value exceeds ${PREFERENCE_LIMITS.maxValueBytes / 1024} KiB`;
  }
  return null;
}

/** Throws {@link InvalidRecordError} unless `key` is a valid preference key. */
export function assertValidPreferenceKey(key: string): void {
  const error = preferenceKeyError(key);
  if (error) throw new InvalidRecordError(error);
}

/** Throws {@link InvalidRecordError} unless `key` and `value` can be stored. */
export function assertValidPreference(key: string, value: string): void {
  const error = preferenceKeyError(key) ?? preferenceValueError(value);
  if (error) throw new InvalidRecordError(error);
}

export interface MemoryKeyValueStoreOptions {
  /** Initial entries, e.g. hydrated from a host store. Invalid entries are skipped. */
  readonly initial?: Iterable<readonly [string, string]> | Readonly<Record<string, string>>;
  /** Persistence hook, called after each local change (`undefined` value = delete). */
  readonly persist?: (key: string, value: string | undefined) => void;
  /** Awaited by `flush()`; defaults to an already resolved promise. */
  readonly flush?: () => Promise<void>;
}

export interface MemoryKeyValueStore extends KeyValueStore {
  /**
   * Applies a change made elsewhere (another tab or process): updates the snapshot and
   * notifies subscribers without calling `persist`. Invalid keys are ignored; an invalid
   * value removes the key, as if it had been skipped on load.
   */
  receive(key: string, value: string | undefined): void;
}

function initialEntries(
  initial: MemoryKeyValueStoreOptions['initial'],
): Iterable<readonly [unknown, unknown]> {
  if (!initial) return [];
  if (Symbol.iterator in initial) return initial as Iterable<readonly [string, string]>;
  return Object.entries(initial);
}

/**
 * The reference `KeyValueStore`: an in-memory snapshot with listeners and validation. Host
 * adapters wrap it and add persistence through `persist`/`flush` and `receive`.
 */
export function createMemoryKeyValueStore(
  options: MemoryKeyValueStoreOptions = {},
): MemoryKeyValueStore {
  const values = new Map<string, string>();
  const listeners = new Set<KeyValueListener>();
  for (const [key, value] of initialEntries(options.initial)) {
    if (preferenceKeyError(key) === null && preferenceValueError(value) === null) {
      values.set(key as string, value as string);
    }
  }

  const notify = (key: string, value: string | undefined) => {
    for (const listener of [...listeners]) listener(key, value);
  };
  /** Applies a change; returns false when it changes nothing. */
  const apply = (key: string, value: string | undefined): boolean => {
    if (values.get(key) === value) return false;
    if (value === undefined) values.delete(key);
    else values.set(key, value);
    return true;
  };

  return {
    get: (key) => values.get(key),
    set(key, value) {
      assertValidPreference(key, value);
      if (!apply(key, value)) return;
      options.persist?.(key, value);
      notify(key, value);
    },
    delete(key) {
      assertValidPreferenceKey(key);
      if (!apply(key, undefined)) return;
      options.persist?.(key, undefined);
      notify(key, undefined);
    },
    keys: (prefix = '') => [...values.keys()].filter((key) => key.startsWith(prefix)).sort(),
    subscribe(listener) {
      // A wrapper per subscription, so subscribing the same function twice needs two unsubscribes.
      const entry: KeyValueListener = (key, value) => listener(key, value);
      listeners.add(entry);
      return () => {
        listeners.delete(entry);
      };
    },
    flush: () => options.flush?.() ?? Promise.resolve(),
    receive(key, value) {
      if (preferenceKeyError(key) !== null) return;
      const next = value === undefined || preferenceValueError(value) !== null ? undefined : value;
      if (apply(key, next)) notify(key, next);
    },
  };
}
