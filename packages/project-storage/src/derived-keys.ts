/**
 * Derived-cache key convention: `<kind>:<contentHash>:<algorithmVersion>:<paramsHash>`.
 *
 * Every input that affects a derived value is part of its key, so a changed input
 * simply misses the cache (no explicit invalidation) and stale entries can be swept
 * by prefix (`<kind>:` for an algorithm family, `<kind>:<contentHash>:` for one asset).
 */

export interface DerivedCacheKeyParts {
  /** Value family, e.g. `peaks`, `pitch`, `vocal-render`. */
  readonly kind: string;
  /** SHA-256 of the source bytes (`AssetRef.contentHash`). */
  readonly contentHash: string;
  /** Bumped whenever the producing algorithm's output changes. */
  readonly algorithmVersion: string;
  /** Hash of the canonical parameters (use `'-'` when there are none). */
  readonly paramsHash: string;
}

const SEGMENT = /^[A-Za-z0-9_.+-]{1,128}$/;

function checkSegment(name: string, value: string): string {
  if (!SEGMENT.test(value)) {
    throw new RangeError(
      `derived cache key ${name} must match ${String(SEGMENT)} (got "${value}")`,
    );
  }
  return value;
}

export function derivedCacheKey(parts: DerivedCacheKeyParts): string {
  return [
    checkSegment('kind', parts.kind),
    checkSegment('contentHash', parts.contentHash),
    checkSegment('algorithmVersion', parts.algorithmVersion),
    checkSegment('paramsHash', parts.paramsHash),
  ].join(':');
}

/** Prefix for `deleteByPrefix`: all entries of a kind, optionally narrowed to one source. */
export function derivedCachePrefix(kind: string, contentHash?: string): string {
  const head = `${checkSegment('kind', kind)}:`;
  return contentHash === undefined ? head : `${head}${checkSegment('contentHash', contentHash)}:`;
}

export function parseDerivedCacheKey(key: string): DerivedCacheKeyParts | undefined {
  const parts = key.split(':');
  if (parts.length !== 4 || !parts.every((p) => SEGMENT.test(p))) return undefined;
  const [kind, contentHash, algorithmVersion, paramsHash] = parts as [
    string,
    string,
    string,
    string,
  ];
  return { kind, contentHash, algorithmVersion, paramsHash };
}
