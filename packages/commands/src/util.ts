/**
 * Small pure helpers shared by the command handlers: error construction, numeric
 * validation, and structural-sharing updates for records and arrays.
 *
 * Every "update" helper returns its input unchanged (same reference) when the update
 * would not change anything, which is what lets `applyCommand` return the original
 * project for no-op commands.
 */
import { CommandError, type CommandErrorCode } from './types';

export function fail(code: CommandErrorCode, message: string): never {
  throw new CommandError(code, message);
}

// ---------------------------------------------------------------------------
// Numbers
// ---------------------------------------------------------------------------

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function requireFinite(value: number, what: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    fail('invalid-argument', `${what} must be a finite number (got ${String(value)})`);
  }
  return value;
}

/** Clamps a finite number into [min, max]; non-finite input is an invalid argument. */
export function clampFinite(value: number, min: number, max: number, what: string): number {
  return clamp(requireFinite(value, what), min, max);
}

export function requireInt(value: number, what: string, min?: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    fail('invalid-argument', `${what} must be an integer (got ${String(value)})`);
  }
  if (min !== undefined && value < min) fail('invalid-argument', `${what} must be >= ${min}`);
  return value;
}

/** Integer required (invalid-argument otherwise), then clamped into [min, max]. */
export function clampInt(value: number, min: number, max: number, what: string): number {
  return clamp(requireInt(value, what), min, max);
}

// ---------------------------------------------------------------------------
// Equality
// ---------------------------------------------------------------------------

/**
 * Structural equality for plain JSON-like data. Object keys whose value is `undefined`
 * are treated as absent, matching how optional model fields behave after serialization.
 */
export function deepEqual(a: unknown, b: unknown): boolean {
  // `===` treats -0 and 0 as equal (they serialize identically); NaN equals NaN.
  if (a === b || (Number.isNaN(a) && Number.isNaN(b))) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!deepEqual(a[i], b[i])) return false;
    return true;
  }
  const ra = a as Record<string, unknown>;
  const rb = b as Record<string, unknown>;
  const ka = Object.keys(ra).filter((k) => ra[k] !== undefined);
  const kb = Object.keys(rb).filter((k) => rb[k] !== undefined);
  if (ka.length !== kb.length) return false;
  for (const key of ka) {
    if (!Object.hasOwn(rb, key) || !deepEqual(ra[key], rb[key])) return false;
  }
  return true;
}

/**
 * Shallow merge that preserves identity: returns `base` when every defined patch value
 * deep-equals the current value; otherwise a new object where unchanged fields keep
 * their original references. `undefined` patch values are ignored.
 */
export function mergeChanged<T extends object>(base: T, patch: Partial<T>): T {
  let result: T | undefined;
  for (const key of Object.keys(patch) as (keyof T)[]) {
    const value = patch[key];
    if (value === undefined || deepEqual(base[key], value)) continue;
    result ??= { ...base };
    result[key] = value as T[keyof T];
  }
  return result ?? base;
}

/** Returns `previous` when `next` is structurally equal, so callers keep identity. */
export function keepIfEqual<T>(previous: T, next: T): T {
  return deepEqual(previous, next) ? previous : next;
}

// ---------------------------------------------------------------------------
// Records (ID-keyed maps)
// ---------------------------------------------------------------------------

/** Own-property lookup (never resolves inherited keys such as `__proto__` or `toString`). */
export function getOwn<K extends string, V>(record: Readonly<Record<K, V>>, key: K): V | undefined {
  return Object.hasOwn(record, key) ? record[key] : undefined;
}

export function hasOwn<K extends string>(record: Readonly<Record<K, unknown>>, key: K): boolean {
  return Object.hasOwn(record, key);
}

/** Sets one entry, returning the same record when the value is already identical. */
export function setEntry<K extends string, V>(
  record: Readonly<Record<K, V>>,
  key: K,
  value: V,
): Readonly<Record<K, V>> {
  if (Object.hasOwn(record, key) && record[key] === value) return record;
  const next = { ...record } as Record<K, V>;
  Object.defineProperty(next, key, { value, enumerable: true, writable: true, configurable: true });
  return next;
}

/** Sets several entries at once (one copy). */
export function setEntries<K extends string, V>(
  record: Readonly<Record<K, V>>,
  entries: readonly (readonly [K, V])[],
): Readonly<Record<K, V>> {
  let next: Record<K, V> | undefined;
  for (const [key, value] of entries) {
    if (!next && Object.hasOwn(record, key) && record[key] === value) continue;
    next ??= { ...record } as Record<K, V>;
    Object.defineProperty(next, key, {
      value,
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }
  return next ?? record;
}

/** Removes entries, returning the same record when none of the keys are present. */
export function omitEntries<K extends string, V>(
  record: Readonly<Record<K, V>>,
  keys: ReadonlySet<string>,
): Readonly<Record<K, V>> {
  let any = false;
  for (const key of keys) {
    if (Object.hasOwn(record, key)) {
      any = true;
      break;
    }
  }
  if (!any) return record;
  const next = {} as Record<K, V>;
  for (const key of Object.keys(record) as K[]) {
    if (keys.has(key)) continue;
    Object.defineProperty(next, key, {
      value: record[key],
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }
  return next;
}

// ---------------------------------------------------------------------------
// Arrays
// ---------------------------------------------------------------------------

export function replaceAt<T>(items: readonly T[], index: number, value: T): readonly T[] {
  if (items[index] === value) return items;
  const next = items.slice();
  next[index] = value;
  return next;
}

export function insertAt<T>(items: readonly T[], index: number, value: T): T[] {
  const next = items.slice();
  next.splice(index, 0, value);
  return next;
}

/** Moves the element at `from` so that it ends up at index `to`. */
export function moveItem<T>(items: readonly T[], from: number, to: number): readonly T[] {
  if (from === to) return items;
  const next = items.slice();
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item as T);
  return next;
}

/** Validates an optional insertion/move index: integer, clamped to [0, max]. */
export function clampIndex(index: number | undefined, max: number, what: string): number {
  if (index === undefined) return max;
  return clamp(requireInt(index, what), 0, max);
}

/** Throws `invalid-argument` if the list contains the same id twice. */
export function requireUniqueIds(ids: Iterable<string>, what: string): Set<string> {
  const seen = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) fail('invalid-argument', `duplicate ${what} id ${id}`);
    seen.add(id);
  }
  return seen;
}
