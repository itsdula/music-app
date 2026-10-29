/**
 * A portable subset of the HTML structured-clone algorithm, used by the in-memory
 * repositories so they have the same copy-on-write semantics as IndexedDB: values
 * are copied on write and on read, typed arrays are supported, and values that
 * IndexedDB cannot store (functions, symbols) are rejected.
 */

export class DataCloneError extends Error {
  override readonly name = 'DataCloneError';
}

type TypedArray =
  | Int8Array
  | Uint8Array
  | Uint8ClampedArray
  | Int16Array
  | Uint16Array
  | Int32Array
  | Uint32Array
  | Float32Array
  | Float64Array
  | BigInt64Array
  | BigUint64Array;

function cloneView(view: ArrayBufferView, seen: Map<object, unknown>): unknown {
  const buffer = cloneBuffer(view.buffer as ArrayBuffer, seen);
  if (view instanceof DataView) return new DataView(buffer, view.byteOffset, view.byteLength);
  const typed = view as TypedArray;
  const Ctor = typed.constructor as new (
    buffer: ArrayBuffer,
    byteOffset: number,
    length: number,
  ) => TypedArray;
  return new Ctor(buffer, typed.byteOffset, typed.length);
}

function cloneBuffer(buffer: ArrayBuffer, seen: Map<object, unknown>): ArrayBuffer {
  const existing = seen.get(buffer);
  if (existing) return existing as ArrayBuffer;
  const copy = buffer.slice(0);
  seen.set(buffer, copy);
  return copy;
}

function cloneInner(value: unknown, seen: Map<object, unknown>): unknown {
  if (typeof value === 'function' || typeof value === 'symbol') {
    throw new DataCloneError(`${typeof value} values cannot be stored`);
  }
  if (typeof value !== 'object' || value === null) return value;

  const existing = seen.get(value);
  if (existing !== undefined) return existing;

  if (value instanceof ArrayBuffer) return cloneBuffer(value, seen);
  if (ArrayBuffer.isView(value)) {
    const copy = cloneView(value, seen);
    seen.set(value, copy);
    return copy;
  }
  if (value instanceof Date) return new Date(value.getTime());
  if (value instanceof Map) {
    const copy = new Map<unknown, unknown>();
    seen.set(value, copy);
    for (const [k, v] of value) copy.set(cloneInner(k, seen), cloneInner(v, seen));
    return copy;
  }
  if (value instanceof Set) {
    const copy = new Set<unknown>();
    seen.set(value, copy);
    for (const v of value) copy.add(cloneInner(v, seen));
    return copy;
  }
  if (Array.isArray(value)) {
    const copy: unknown[] = [];
    seen.set(value, copy);
    for (const item of value) copy.push(cloneInner(item, seen));
    return copy;
  }
  // Plain objects and class instances: own enumerable string keys, prototype dropped
  // (as structured clone does).
  const copy: Record<string, unknown> = {};
  seen.set(value, copy);
  for (const key of Object.keys(value)) {
    Object.defineProperty(copy, key, {
      value: cloneInner((value as Record<string, unknown>)[key], seen),
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }
  return copy;
}

export function cloneStructured<T>(value: T): T {
  return cloneInner(value, new Map()) as T;
}
