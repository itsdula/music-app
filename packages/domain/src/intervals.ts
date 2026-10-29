/**
 * Half-open interval helpers [start, end) used for clip overlap, viewport culling and
 * hit testing.
 *
 * Data-structure choice: per-track clip counts are small (tens to low hundreds), so a
 * start-sorted array plus the maximum interval length gives O(log n + k) window queries
 * without the constant-factor and maintenance cost of an interval tree. Re-evaluate if
 * profiling shows a hotspot (see docs/architecture.md, DS&A table).
 */

export interface Interval {
  readonly start: number;
  readonly end: number;
}

export function intervalsOverlap(a: Interval, b: Interval): boolean {
  return a.start < b.end && b.start < a.end;
}

export function intervalContains(interval: Interval, point: number): boolean {
  return point >= interval.start && point < interval.end;
}

/** Index of the first element whose key is >= value (binary search). */
export function lowerBound<T>(
  items: readonly T[],
  value: number,
  key: (item: T) => number,
): number {
  let lo = 0;
  let hi = items.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (key(items[mid]!) < value) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Index of the first element whose key is > value (binary search). */
export function upperBound<T>(
  items: readonly T[],
  value: number,
  key: (item: T) => number,
): number {
  let lo = 0;
  let hi = items.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (key(items[mid]!) <= value) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * Immutable, start-sorted interval index supporting window queries.
 * Build O(n log n); query O(log n + k + m) where m counts long intervals skipped.
 */
export class SortedIntervalIndex<T> {
  private readonly items: readonly T[];
  private readonly starts: Float64Array;
  private readonly ends: Float64Array;
  private readonly maxLength: number;

  constructor(
    items: readonly T[],
    private readonly range: (item: T) => Interval,
  ) {
    const decorated = items.map((item) => ({ item, iv: range(item) }));
    decorated.sort((a, b) => a.iv.start - b.iv.start);
    this.items = decorated.map((d) => d.item);
    this.starts = Float64Array.from(decorated, (d) => d.iv.start);
    this.ends = Float64Array.from(decorated, (d) => d.iv.end);
    this.maxLength = decorated.reduce((m, d) => Math.max(m, d.iv.end - d.iv.start), 0);
  }

  get size(): number {
    return this.items.length;
  }

  /** Items overlapping [start, end), in start order. */
  query(start: number, end: number): T[] {
    const result: T[] = [];
    let lo = 0;
    let hi = this.starts.length;
    const from = start - this.maxLength;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (this.starts[mid]! < from) lo = mid + 1;
      else hi = mid;
    }
    for (let i = lo; i < this.starts.length && this.starts[i]! < end; i++) {
      if (this.ends[i]! > start) result.push(this.items[i]!);
    }
    return result;
  }

  /** Items containing `point`. */
  at(point: number): T[] {
    return this.query(point, point + Number.EPSILON * Math.max(1, Math.abs(point)));
  }

  all(): readonly T[] {
    return this.items;
  }

  intervalOf(item: T): Interval {
    return this.range(item);
  }
}
