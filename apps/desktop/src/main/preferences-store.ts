/**
 * Main-process store behind `studioHost.preferences`: string entries held in memory and
 * saved to one JSON file (`<userData>/preferences.json`).
 *
 * - Loaded synchronously once at startup. A missing file means no preferences; an unreadable
 *   one is moved aside to `<file>.corrupt` and the store starts empty; invalid entries are
 *   skipped. Every case is reported through `onWarning`.
 * - Writes are debounced, then atomic: a temporary file is written and fsynced, then renamed
 *   over the old one, so a crash leaves either the old or the new file. `flush()` writes
 *   pending changes immediately; main calls it on `before-quit` and `will-quit`.
 * - Limits: keys and values are validated like the IPC arguments, and all keys plus values
 *   together stay within 1 MiB.
 *
 * Writes are synchronous on purpose: the file is small and written rarely, and a single
 * code path keeps quit-time flushing and ordering trivial. Pure apart from node:fs and
 * node:path, with the file path injected, so tests run it against a temporary directory.
 */
import {
  closeSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeSync,
} from 'node:fs';
import { dirname } from 'node:path';
import { MAX_PREFERENCES_TOTAL_BYTES } from '../shared/host-api';
import { utf8ByteLength, validatePreferenceKey, validatePreferenceValue } from './validation';

export const PREFERENCES_FILE_VERSION = 1;
/** Files beyond this size are not parsed (1 MiB of entries plus generous JSON escaping). */
const MAX_PREFERENCES_FILE_BYTES = 8 * MAX_PREFERENCES_TOTAL_BYTES;

export interface PreferencesStoreOptions {
  /** Absolute path of the JSON file, e.g. `<userData>/preferences.json`. */
  readonly filePath: string;
  /** Quiet period after the last change before the file is written, in ms. */
  readonly debounceMs?: number;
  /** Load and write problems. Defaults to `console.warn`. */
  readonly onWarning?: (message: string, error?: unknown) => void;
}

export interface PreferencesStore {
  /** A copy of every entry. */
  entries(): Record<string, string>;
  /** Throws when the key or value is invalid or the total would exceed 1 MiB. */
  set(key: string, value: string): void;
  /** Throws for an invalid key; a no-op when the key is absent. */
  delete(key: string): void;
  /** Writes pending changes now (cancelling the debounce); a no-op without any. Never throws. */
  flush(): void;
}

const entryBytes = (key: string, value: string) => utf8ByteLength(key) + utf8ByteLength(value);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNotFound(error: unknown): boolean {
  return isRecord(error) && error.code === 'ENOENT';
}

/** Reads and validates the file; never throws. */
function loadEntries(
  filePath: string,
  warn: (message: string, error?: unknown) => void,
): Map<string, string> {
  const entries = new Map<string, string>();
  let parsed: unknown;
  try {
    if (statSync(filePath).size > MAX_PREFERENCES_FILE_BYTES) throw new Error('file is too large');
    parsed = JSON.parse(readFileSync(filePath, 'utf8'));
    if (
      !isRecord(parsed) ||
      parsed.version !== PREFERENCES_FILE_VERSION ||
      !isRecord(parsed.entries)
    ) {
      throw new Error(`not a version ${PREFERENCES_FILE_VERSION} preferences file`);
    }
  } catch (error) {
    if (isNotFound(error)) return entries;
    warn(`preferences: ${filePath} is unreadable; moved aside to .corrupt, starting empty`, error);
    try {
      renameSync(filePath, `${filePath}.corrupt`);
    } catch {
      // Best effort: the next write replaces the file anyway.
    }
    return entries;
  }

  let total = 0;
  let skipped = 0;
  for (const [key, value] of Object.entries(parsed.entries)) {
    const valid = validatePreferenceKey(key).ok && validatePreferenceValue(value).ok;
    const size = valid ? entryBytes(key, value as string) : 0;
    if (!valid || total + size > MAX_PREFERENCES_TOTAL_BYTES) {
      skipped++;
      continue;
    }
    entries.set(key, value as string);
    total += size;
  }
  if (skipped > 0) warn(`preferences: skipped ${skipped} invalid entries in ${filePath}`);
  return entries;
}

/** Stable, human-readable file contents: sorted keys, 2-space indent, trailing newline. */
export function serializePreferences(entries: ReadonlyMap<string, string>): string {
  const sorted = Object.fromEntries([...entries].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
  return `${JSON.stringify({ version: PREFERENCES_FILE_VERSION, entries: sorted }, null, 2)}\n`;
}

/** Writes `data` to `filePath` through a fsynced temporary file and a rename. */
function writeAtomically(filePath: string, data: string): void {
  const tempPath = `${filePath}.tmp`;
  mkdirSync(dirname(filePath), { recursive: true });
  try {
    const fd = openSync(tempPath, 'w', 0o600);
    try {
      writeSync(fd, data);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(tempPath, filePath);
  } catch (error) {
    rmSync(tempPath, { force: true });
    throw error;
  }
}

export function createPreferencesStore(options: PreferencesStoreOptions): PreferencesStore {
  const { filePath } = options;
  const debounceMs = options.debounceMs ?? 250;
  const warn = options.onWarning ?? ((message, error) => console.warn(message, error ?? ''));
  const entries = loadEntries(filePath, warn);
  let total = 0;
  for (const [key, value] of entries) total += entryBytes(key, value);
  let dirty = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const cancelTimer = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  };

  const flush = () => {
    cancelTimer();
    if (!dirty) return;
    try {
      writeAtomically(filePath, serializePreferences(entries));
      dirty = false;
    } catch (error) {
      // Stays dirty: the next change or flush (at the latest on quit) tries again.
      warn(`preferences: could not write ${filePath}`, error);
    }
  };

  const changed = () => {
    dirty = true;
    cancelTimer();
    timer = setTimeout(flush, debounceMs);
  };

  return {
    entries: () => Object.fromEntries(entries),
    set(key, value) {
      const validKey = validatePreferenceKey(key);
      if (!validKey.ok) throw new Error(validKey.error);
      const validValue = validatePreferenceValue(value);
      if (!validValue.ok) throw new Error(validValue.error);
      if (entries.get(key) === value) return;
      const previous = entries.get(key);
      const next =
        total - (previous === undefined ? 0 : entryBytes(key, previous)) + entryBytes(key, value);
      if (next > MAX_PREFERENCES_TOTAL_BYTES) {
        throw new Error('preferences would exceed the 1 MiB total limit');
      }
      entries.set(key, value);
      total = next;
      changed();
    },
    delete(key) {
      const validKey = validatePreferenceKey(key);
      if (!validKey.ok) throw new Error(validKey.error);
      const previous = entries.get(key);
      if (previous === undefined) return;
      entries.delete(key);
      total -= entryBytes(key, previous);
      changed();
    },
    flush,
  };
}
