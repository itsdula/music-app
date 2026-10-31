/**
 * Validation of every value that crosses the IPC boundary from the (untrusted) renderer,
 * and file-name sanitising. Pure functions only; unit-tested in tests/validation.test.ts.
 */
import {
  MAX_ACCEPT_ENTRIES,
  MAX_FILE_BYTES,
  MAX_FILE_NAME_LENGTH,
  MAX_PREFERENCE_VALUE_BYTES,
  PREFERENCE_KEY_PATTERN,
} from '../shared/host-api';

export type Validated<T> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: string };

const ok = <T>(value: T): Validated<T> => ({ ok: true, value });
const fail = <T>(error: string): Validated<T> => ({ ok: false, error });

/** Lower-case extension (without dot) → MIME type. Also drives MIME → extension filters. */
export const MIME_BY_EXTENSION: Readonly<Record<string, string>> = {
  wav: 'audio/wav',
  wave: 'audio/wav',
  mp3: 'audio/mpeg',
  ogg: 'audio/ogg',
  oga: 'audio/ogg',
  opus: 'audio/ogg',
  flac: 'audio/flac',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  aif: 'audio/aiff',
  aiff: 'audio/aiff',
  webm: 'audio/webm',
  mid: 'audio/midi',
  midi: 'audio/midi',
  json: 'application/json',
  studio: 'application/x-studio-bundle',
  zip: 'application/zip',
};

const MIME_PATTERN = /^[a-z0-9][a-z0-9!#$&^_.+-]{0,63}\/[a-z0-9][a-z0-9!#$&^_.+-]{0,63}$/i;
const ACCEPT_MIME_PATTERN = /^[a-z0-9][a-z0-9.+-]{0,63}\/(\*|[a-z0-9][a-z0-9.+-]{0,63})$/i;
const ACCEPT_EXTENSION_PATTERN = /^\.[a-z0-9][a-z0-9_-]{0,15}$/i;
// eslint-disable-next-line no-control-regex -- matching control characters is the point
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;
// eslint-disable-next-line no-control-regex -- matching control characters is the point
const CONTROL_CHARS_GLOBAL = /[\u0000-\u001f\u007f]/g;
const RESERVED_CHARS_GLOBAL = /[<>:"|?*]/g;
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/i;

/** True if `name` contains a path separator or is a relative path component. */
export function hasPathSeparator(name: string): boolean {
  return name.includes('/') || name.includes('\\') || name === '.' || name === '..';
}

/** Lower-case extension without the dot, or `''`. */
export function extensionOf(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? '';
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : '';
}

export function mimeTypeForName(name: string): string {
  return MIME_BY_EXTENSION[extensionOf(name)] ?? 'application/octet-stream';
}

/**
 * Makes a single path component safe on Windows, macOS and Linux: no separators, control or
 * reserved characters, no leading/trailing dots or spaces, no device names, ≤ 255 chars
 * (keeping the extension). Never returns an empty string.
 */
export function sanitizeFileName(name: string, fallback = 'untitled'): string {
  let cleaned = name
    .normalize('NFC')
    .replace(CONTROL_CHARS_GLOBAL, '')
    .replace(/[\\/]/g, '_')
    .replace(RESERVED_CHARS_GLOBAL, '_')
    .replace(/\s+/g, ' ')
    .replace(/^[\s.]+|[\s.]+$/g, '');
  if (WINDOWS_RESERVED.test(cleaned)) cleaned = `_${cleaned}`;
  if (cleaned.length > MAX_FILE_NAME_LENGTH) {
    const ext = extensionOf(cleaned);
    const suffix = ext && ext.length < 32 ? `.${ext}` : '';
    cleaned =
      cleaned.slice(0, MAX_FILE_NAME_LENGTH - suffix.length).replace(/[\s.]+$/, '') + suffix;
  }
  return cleaned || fallback;
}

export interface SaveFileArgs {
  readonly bytes: Uint8Array;
  readonly suggestedName: string;
  readonly mimeType: string;
}

/** Validates the `[bytes, suggestedName, mimeType]` tuple of `studio-host:save-file`. */
export function validateSaveFileArgs(args: readonly unknown[]): Validated<SaveFileArgs> {
  if (args.length !== 3) return fail('saveFile expects exactly 3 arguments');
  const [bytes, suggestedName, mimeType] = args;
  if (!(bytes instanceof Uint8Array)) return fail('bytes must be a Uint8Array');
  if (bytes.byteLength > MAX_FILE_BYTES) return fail('bytes exceed the 2 GiB limit');
  if (typeof suggestedName !== 'string') return fail('suggestedName must be a string');
  if (suggestedName.length === 0 || suggestedName.length > MAX_FILE_NAME_LENGTH) {
    return fail(`suggestedName must be 1-${MAX_FILE_NAME_LENGTH} characters`);
  }
  if (hasPathSeparator(suggestedName)) return fail('suggestedName must not contain a path');
  if (CONTROL_CHARS.test(suggestedName)) return fail('suggestedName contains control characters');
  if (typeof mimeType !== 'string' || !MIME_PATTERN.test(mimeType)) {
    return fail('mimeType must be a type/subtype string');
  }
  return ok({ bytes, suggestedName: sanitizeFileName(suggestedName), mimeType });
}

export interface OpenFilesArgs {
  readonly accept: readonly string[];
  readonly multiple: boolean;
  /** Allowed lower-case extensions, or `null` when any file is acceptable. */
  readonly extensions: readonly string[] | null;
}

/**
 * Turns an `accept` list (MIME types, `type/*` wildcards, `.ext`) into allowed extensions.
 * Returns `null` (anything goes) for an empty list or `*\/*`.
 */
export function extensionsForAccept(accept: readonly string[]): string[] | null {
  if (accept.length === 0 || accept.includes('*/*')) return null;
  const result = new Set<string>();
  const knownExtensions = Object.keys(MIME_BY_EXTENSION);
  for (const raw of accept) {
    const entry = raw.toLowerCase();
    if (entry.startsWith('.')) {
      result.add(entry.slice(1));
    } else if (entry.endsWith('/*')) {
      const family = entry.slice(0, -1);
      for (const ext of knownExtensions) {
        if (MIME_BY_EXTENSION[ext]?.startsWith(family)) result.add(ext);
      }
    } else {
      for (const ext of knownExtensions) {
        if (MIME_BY_EXTENSION[ext] === entry) result.add(ext);
      }
    }
  }
  return [...result].sort();
}

/** Validates the `[accept, multiple]` tuple of `studio-host:open-files`. */
export function validateOpenFilesArgs(args: readonly unknown[]): Validated<OpenFilesArgs> {
  if (args.length !== 2) return fail('openFiles expects exactly 2 arguments');
  const [accept, multiple] = args;
  if (!Array.isArray(accept)) return fail('accept must be an array');
  if (accept.length > MAX_ACCEPT_ENTRIES) return fail('accept has too many entries');
  const entries: string[] = [];
  for (const entry of accept as unknown[]) {
    if (typeof entry !== 'string') return fail('accept entries must be strings');
    const valid =
      entry === '*/*' || ACCEPT_EXTENSION_PATTERN.test(entry) || ACCEPT_MIME_PATTERN.test(entry);
    if (!valid) return fail(`invalid accept entry: ${JSON.stringify(entry.slice(0, 40))}`);
    entries.push(entry);
  }
  if (typeof multiple !== 'boolean') return fail('multiple must be a boolean');
  const extensions = extensionsForAccept(entries);
  if (extensions !== null && extensions.length === 0) {
    return fail('accept does not match any supported file type');
  }
  return ok({ accept: entries, multiple, extensions });
}

/** True if a chosen path's extension is allowed by the validated accept list. */
export function isAcceptedFile(path: string, extensions: readonly string[] | null): boolean {
  if (extensions === null) return true;
  const ext = extensionOf(path);
  return ext !== '' && extensions.includes(ext);
}

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

/** A preference key: 1-128 characters of `A-Z a-z 0-9 _ . -`, starting alphanumeric. */
export function validatePreferenceKey(key: unknown): Validated<string> {
  if (typeof key !== 'string') return fail('key must be a string');
  if (!PREFERENCE_KEY_PATTERN.test(key)) {
    return fail(`invalid key ${JSON.stringify(key.slice(0, 40))}`);
  }
  return ok(key);
}

/** A preference value: a string of at most 64 KiB in UTF-8. */
export function validatePreferenceValue(value: unknown): Validated<string> {
  if (typeof value !== 'string') return fail('value must be a string');
  // Each UTF-16 unit is at least one UTF-8 byte: reject huge strings before counting.
  if (
    value.length > MAX_PREFERENCE_VALUE_BYTES ||
    utf8ByteLength(value) > MAX_PREFERENCE_VALUE_BYTES
  ) {
    return fail('value exceeds the 64 KiB limit');
  }
  return ok(value);
}

/** Validates the (empty) argument list of `studio-host:preferences-load`. */
export function validatePreferencesLoadArgs(args: readonly unknown[]): Validated<null> {
  return args.length === 0 ? ok(null) : fail('preferences.load expects no arguments');
}

export interface PreferenceSetArgs {
  readonly key: string;
  readonly value: string;
}

/** Validates the `[key, value]` tuple of `studio-host:preferences-set`. */
export function validatePreferenceSetArgs(args: readonly unknown[]): Validated<PreferenceSetArgs> {
  if (args.length !== 2) return fail('preferences.set expects exactly 2 arguments');
  const key = validatePreferenceKey(args[0]);
  if (!key.ok) return key;
  const value = validatePreferenceValue(args[1]);
  if (!value.ok) return value;
  return ok({ key: key.value, value: value.value });
}

/** Validates the `[key]` tuple of `studio-host:preferences-delete`. */
export function validatePreferenceDeleteArgs(args: readonly unknown[]): Validated<string> {
  if (args.length !== 1) return fail('preferences.delete expects exactly 1 argument');
  return validatePreferenceKey(args[0]);
}
