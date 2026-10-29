/**
 * Static centered interval tree over half-open intervals [start, end).
 *
 * Chosen over a start-sorted array with a max-length bound (domain's
 * `SortedIntervalIndex`, O(log n + k + m)) because audio segments can be long (a
 * multi-minute clip next to many short ones) and the scheduler issues overlap queries
 * every few tens of milliseconds; the tree guarantees O(log n + k) regardless of the
 * length distribution.
 *
 * Query decomposition: intervals overlapping [a, b) = intervals containing a (stabbing
 * query on the tree) ∪ intervals starting in (a, b) (binary search on the start-sorted
 * array). The two sets are disjoint, so no de-duplication is needed.
 */

export interface IntervalItem {
  readonly start: number;
  readonly end: number;
}

interface TreeNode<T extends IntervalItem> {
  readonly center: number;
  /** Intervals containing `center`, ascending by start. */
  readonly byStart: readonly T[];
  /** The same intervals, descending by end. */
  readonly byEnd: readonly T[];
  readonly left: TreeNode<T> | null;
  readonly right: TreeNode<T> | null;
}

/** Index of the first element with `key(item) >= value`. O(log n). */
export function lowerBoundBy<T>(
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

/** Index of the first element with `key(item) > value`. O(log n). */
export function upperBoundBy<T>(
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
 * Immutable interval index.
 *
 * - Build: O(n log n). Memory: O(n).
 * - `containing(p)`: O(log n + k). `overlapping(a, b)`: O(log n + k).
 *   `startingIn(a, b)`: O(log n + k).
 * - Empty intervals (end ≤ start) are dropped at build time (they contain no point).
 * - Results preserve start order for `startingIn`; `overlapping` returns the containing
 *   set (tree order) followed by the starting set (start order).
 * - Ownership: holds references to the given items; never mutates them.
 */
export class IntervalTree<T extends IntervalItem> {
  private readonly root: TreeNode<T> | null;
  /** All non-empty items sorted by (start, end). */
  readonly items: readonly T[];

  constructor(items: readonly T[]) {
    const valid = items.filter((item) => item.end > item.start);
    valid.sort((a, b) => a.start - b.start || a.end - b.end);
    this.items = valid;
    this.root = buildNode(valid);
  }

  get size(): number {
    return this.items.length;
  }

  /** Items with start ≤ point < end. */
  containing(point: number): T[] {
    const out: T[] = [];
    let node = this.root;
    while (node) {
      if (point < node.center) {
        for (const item of node.byStart) {
          if (item.start > point) break;
          out.push(item);
        }
        node = node.left;
      } else {
        for (const item of node.byEnd) {
          if (item.end <= point) break;
          out.push(item);
        }
        node = node.right;
      }
    }
    return out;
  }

  /** Items with a ≤ start < b, in start order. */
  startingIn(a: number, b: number): T[] {
    if (!(b > a)) return [];
    const from = lowerBoundBy(this.items, a, (i) => i.start);
    const to = lowerBoundBy(this.items, b, (i) => i.start);
    return this.items.slice(from, to);
  }

  /** Items with start < b and end > a. */
  overlapping(a: number, b: number): T[] {
    if (!(b > a)) return [];
    const out = this.containing(a);
    const from = upperBoundBy(this.items, a, (i) => i.start);
    const to = lowerBoundBy(this.items, b, (i) => i.start);
    for (let i = from; i < to; i++) out.push(this.items[i]!);
    return out;
  }
}

function buildNode<T extends IntervalItem>(items: readonly T[]): TreeNode<T> | null {
  if (items.length === 0) return null;
  // `items` is start-sorted. The median interval's start is contained by that interval,
  // so every node stores at least one interval (no infinite recursion), and each child
  // receives at most half of the items from one side: depth O(log n).
  const center = items[items.length >>> 1]!.start;
  const left: T[] = [];
  const right: T[] = [];
  const here: T[] = [];
  for (const item of items) {
    if (item.end <= center) left.push(item);
    else if (item.start > center) right.push(item);
    else here.push(item);
  }
  return {
    center,
    byStart: here.slice().sort((a, b) => a.start - b.start),
    byEnd: here.slice().sort((a, b) => b.end - a.end),
    left: buildNode(left),
    right: buildNode(right),
  };
}
