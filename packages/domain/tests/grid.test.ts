import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  GRID_DIVISIONS,
  PPQ,
  gridDivisionTicks,
  quantizeTick,
  snapDelta,
  snapTick,
  type TimeSignature,
} from '../src';

const COMMON_METERS: TimeSignature[] = [
  { numerator: 4, denominator: 4 },
  { numerator: 3, denominator: 4 },
  { numerator: 2, denominator: 4 },
  { numerator: 6, denominator: 8 },
  { numerator: 7, denominator: 8 },
  { numerator: 12, denominator: 8 },
  { numerator: 5, denominator: 4 },
  { numerator: 2, denominator: 2 },
  { numerator: 9, denominator: 16 },
  { numerator: 3, denominator: 32 },
  { numerator: 1, denominator: 1 },
];

describe('gridDivisionTicks', () => {
  it('is a positive integer for every division and common meter', () => {
    for (const meter of COMMON_METERS) {
      for (const division of GRID_DIVISIONS) {
        const ticks = gridDivisionTicks(division, meter);
        expect(
          Number.isInteger(ticks),
          `${division} in ${meter.numerator}/${meter.denominator}`,
        ).toBe(true);
        expect(ticks).toBeGreaterThan(0);
      }
    }
  });

  it('computes straight, triplet and meter-relative values', () => {
    const fourFour: TimeSignature = { numerator: 4, denominator: 4 };
    expect(gridDivisionTicks('1/1', fourFour)).toBe(PPQ * 4);
    expect(gridDivisionTicks('1/4', fourFour)).toBe(PPQ);
    expect(gridDivisionTicks('1/16', fourFour)).toBe(PPQ / 4);
    expect(gridDivisionTicks('1/64', fourFour)).toBe(PPQ / 16);
    expect(gridDivisionTicks('1/8T', fourFour)).toBe(PPQ / 3);
    expect(gridDivisionTicks('1/32T', fourFour)).toBe(80);
    expect(gridDivisionTicks('bar', { numerator: 6, denominator: 8 })).toBe(PPQ * 3);
    expect(gridDivisionTicks('beat', { numerator: 6, denominator: 8 })).toBe(PPQ / 2);
  });

  it('makes three triplets equal two straight notes', () => {
    const meter: TimeSignature = { numerator: 4, denominator: 4 };
    for (const d of ['1/2', '1/4', '1/8', '1/16', '1/32'] as const) {
      expect(gridDivisionTicks(`${d}T`, meter) * 3).toBe(gridDivisionTicks(d, meter) * 2);
    }
  });
});

describe('snapTick', () => {
  it('rounds, floors and ceils to the grid', () => {
    expect(snapTick(250, 240)).toBe(240);
    expect(snapTick(360, 240)).toBe(480);
    expect(snapTick(470, 240, 'floor')).toBe(240);
    expect(snapTick(250, 240, 'ceil')).toBe(480);
    expect(snapTick(480, 240, 'ceil')).toBe(480);
  });

  it('only rounds to an integer when the grid is disabled', () => {
    expect(snapTick(12.6, 0)).toBe(13);
    expect(snapTick(12.4, -5)).toBe(12);
  });

  it('always lands on a grid line', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -1_000_000, max: 1_000_000 }),
        fc.integer({ min: 1, max: 4000 }),
        fc.constantFrom('round', 'floor', 'ceil' as const),
        (tick, grid, mode) => {
          const snapped = snapTick(tick, grid, mode);
          expect(Math.abs(snapped % grid)).toBe(0);
          expect(Math.abs(snapped - tick)).toBeLessThanOrEqual(grid);
          if (mode === 'floor') expect(snapped).toBeLessThanOrEqual(tick);
          if (mode === 'ceil') expect(snapped).toBeGreaterThanOrEqual(tick);
        },
      ),
    );
  });
});

describe('snapDelta', () => {
  it('places the dragged item start on the grid', () => {
    expect(snapDelta(100, 150, 240)).toBe(140);
    expect(snapDelta(0, -30, 240)).toBe(0);
  });

  it('property: start + delta is on the grid and close to the raw target', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 100_000 }),
        fc.integer({ min: -50_000, max: 50_000 }),
        fc.integer({ min: 1, max: 3840 }),
        (start, raw, grid) => {
          const delta = snapDelta(start, raw, grid);
          expect(Math.abs((start + delta) % grid)).toBe(0);
          expect(Math.abs(start + delta - (start + raw))).toBeLessThanOrEqual(grid / 2);
        },
      ),
    );
  });
});

describe('quantizeTick', () => {
  it('moves fully onto the grid at strength 1', () => {
    expect(quantizeTick(250, { gridTicks: 240, strength: 1 })).toBe(240);
    expect(quantizeTick(400, { gridTicks: 240, strength: 1 })).toBe(480);
  });

  it('moves part of the way at partial strength', () => {
    expect(quantizeTick(300, { gridTicks: 240, strength: 0.5 })).toBe(270);
    expect(quantizeTick(300, { gridTicks: 240, strength: 0.25 })).toBe(285);
  });

  it('caps strength above 1', () => {
    expect(quantizeTick(300, { gridTicks: 240, strength: 3 })).toBe(240);
  });

  it('leaves the tick alone for zero strength or disabled grid', () => {
    expect(quantizeTick(301, { gridTicks: 240, strength: 0 })).toBe(301);
    expect(quantizeTick(301, { gridTicks: 0, strength: 1 })).toBe(301);
  });

  it('applies swing to every second grid step only', () => {
    const options = { gridTicks: 240, strength: 1, swing: 0.5 };
    expect(quantizeTick(250, options)).toBe(300); // odd step 1 -> 240 + 60
    expect(quantizeTick(470, options)).toBe(480); // even step 2, no swing
    expect(quantizeTick(10, options)).toBe(0);
    expect(quantizeTick(710, options)).toBe(780); // odd step 3 -> 720 + 60
    expect(quantizeTick(250, { ...options, swing: 1 })).toBe(360);
  });

  it('combines swing and strength', () => {
    expect(quantizeTick(240, { gridTicks: 240, strength: 0.5, swing: 0.5 })).toBe(270);
  });

  it('property: full-strength straight quantization yields grid multiples', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 1_000_000 }),
        fc.constantFrom(...GRID_DIVISIONS),
        (tick, division) => {
          const grid = gridDivisionTicks(division, { numerator: 4, denominator: 4 });
          const q = quantizeTick(tick, { gridTicks: grid, strength: 1 });
          expect(q % grid).toBe(0);
          expect(Math.abs(q - tick)).toBeLessThanOrEqual(grid / 2);
        },
      ),
    );
  });

  it('property: partial strength never overshoots and returns integers', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 1_000_000 }),
        fc.integer({ min: 1, max: 3840 }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        (tick, grid, strength) => {
          const target = quantizeTick(tick, { gridTicks: grid, strength: 1 });
          const q = quantizeTick(tick, { gridTicks: grid, strength });
          expect(Number.isInteger(q)).toBe(true);
          expect(q).toBeGreaterThanOrEqual(Math.min(tick, target));
          expect(q).toBeLessThanOrEqual(Math.max(tick, target));
        },
      ),
    );
  });
});
