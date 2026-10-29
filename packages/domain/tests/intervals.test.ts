import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  SortedIntervalIndex,
  intervalContains,
  intervalsOverlap,
  lowerBound,
  upperBound,
  type Interval,
} from '../src';

interface Item extends Interval {
  readonly id: number;
}

const intervalArb = fc
  .tuple(fc.integer({ min: -1000, max: 1000 }), fc.integer({ min: 0, max: 300 }))
  .map(([start, length]) => ({ start, end: start + length }));

const itemsArb = fc
  .array(intervalArb, { maxLength: 80 })
  .map((ivs) => ivs.map((iv, id): Item => ({ ...iv, id })));

const ids = (items: readonly Item[]) => items.map((i) => i.id).sort((a, b) => a - b);

describe('interval predicates', () => {
  it('treats intervals as half-open', () => {
    expect(intervalsOverlap({ start: 0, end: 10 }, { start: 10, end: 20 })).toBe(false);
    expect(intervalsOverlap({ start: 0, end: 10 }, { start: 9, end: 20 })).toBe(true);
    expect(intervalsOverlap({ start: 5, end: 6 }, { start: 0, end: 10 })).toBe(true);
    expect(intervalContains({ start: 0, end: 10 }, 0)).toBe(true);
    expect(intervalContains({ start: 0, end: 10 }, 10)).toBe(false);
    expect(intervalContains({ start: 0, end: 10 }, -1)).toBe(false);
  });
});

describe('binary search bounds', () => {
  it('match a linear scan', () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: -50, max: 50 })).map((a) => a.sort((x, y) => x - y)),
        fc.integer({ min: -60, max: 60 }),
        (sorted, value) => {
          const key = (n: number) => n;
          const lower = sorted.findIndex((n) => n >= value);
          const upper = sorted.findIndex((n) => n > value);
          expect(lowerBound(sorted, value, key)).toBe(lower < 0 ? sorted.length : lower);
          expect(upperBound(sorted, value, key)).toBe(upper < 0 ? sorted.length : upper);
        },
      ),
    );
  });
});

describe('SortedIntervalIndex', () => {
  it('answers window queries in start order', () => {
    const items: Item[] = [
      { id: 0, start: 50, end: 60 },
      { id: 1, start: 0, end: 100 },
      { id: 2, start: 10, end: 20 },
      { id: 3, start: 100, end: 110 },
    ];
    const index = new SortedIntervalIndex(items, (i) => i);
    expect(index.size).toBe(4);
    expect(index.all().map((i) => i.id)).toEqual([1, 2, 0, 3]);
    expect(index.query(15, 55).map((i) => i.id)).toEqual([1, 2, 0]);
    expect(index.query(100, 101).map((i) => i.id)).toEqual([3]);
    expect(index.query(200, 300)).toEqual([]);
    expect(index.at(10).map((i) => i.id)).toEqual([1, 2]);
    expect(index.at(20).map((i) => i.id)).toEqual([1]);
    expect(index.intervalOf(items[0]!)).toEqual({ id: 0, start: 50, end: 60 });
  });

  it('handles an empty index', () => {
    const index = new SortedIntervalIndex<Item>([], (i) => i);
    expect(index.size).toBe(0);
    expect(index.query(-Infinity, Infinity)).toEqual([]);
  });

  it('query matches brute force', () => {
    fc.assert(
      fc.property(itemsArb, intervalArb, (items, window) => {
        const index = new SortedIntervalIndex(items, (i) => i);
        const expected = items.filter((i) => intervalsOverlap(i, window));
        const result = index.query(window.start, window.end);
        expect(ids(result)).toEqual(ids(expected));
        for (let k = 1; k < result.length; k++) {
          expect(result[k]!.start).toBeGreaterThanOrEqual(result[k - 1]!.start);
        }
      }),
    );
  });

  it('at matches brute force containment', () => {
    fc.assert(
      fc.property(itemsArb, fc.integer({ min: -1100, max: 1400 }), (items, point) => {
        const index = new SortedIntervalIndex(items, (i) => i);
        expect(ids(index.at(point))).toEqual(ids(items.filter((i) => intervalContains(i, point))));
      }),
    );
  });
});
