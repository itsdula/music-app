import { PPQ, ticksPerBar } from '@studio/domain';
import { describe, expect, it } from 'vitest';
import { computeGridLines } from '../src/canvas/ruler';
import { MAX_PX_PER_TICK, MIN_PX_PER_TICK, TimeAxis } from '../src/canvas/time-axis';

describe('TimeAxis', () => {
  it('converts ticks and pixels symmetrically', () => {
    const axis = new TimeAxis(0.1, 960);
    expect(axis.tickToX(960)).toBe(0);
    expect(axis.tickToX(1960)).toBeCloseTo(100);
    expect(axis.xToTick(axis.tickToX(12345))).toBeCloseTo(12345);
  });

  it('zooms around an anchor without moving it', () => {
    const axis = new TimeAxis(0.05, 0);
    const anchorX = 300;
    const tickUnderAnchor = axis.xToTick(anchorX);
    const zoomed = axis.zoomAt(2, anchorX);
    expect(zoomed.pxPerTick).toBeCloseTo(0.1);
    expect(zoomed.xToTick(anchorX)).toBeCloseTo(tickUnderAnchor);
  });

  it('clamps zoom and scroll', () => {
    expect(new TimeAxis(100, 0).pxPerTick).toBe(MAX_PX_PER_TICK);
    expect(new TimeAxis(0, 0).pxPerTick).toBe(MIN_PX_PER_TICK);
    expect(new TimeAxis(0.1, -50).scrollTick).toBe(0);
  });

  it('reveals a tick outside the viewport', () => {
    const axis = new TimeAxis(0.1, 0);
    const revealed = axis.reveal(20000, 1000, 50);
    const x = revealed.tickToX(20000);
    expect(x).toBeGreaterThanOrEqual(0);
    expect(x).toBeLessThanOrEqual(1000);
    expect(axis.reveal(500, 1000)).toBe(axis);
  });
});

describe('computeGridLines', () => {
  const meter = { numerator: 4, denominator: 4 } as const;

  it('emits bar lines with 1-based bar numbers', () => {
    const axis = TimeAxis.fromPxPerBeat(40);
    const lines = computeGridLines(axis, 800, meter);
    const bars = lines.filter((l) => l.level === 'bar');
    expect(bars[0]).toMatchObject({ tick: 0, bar: 1 });
    expect(bars[1]).toMatchObject({ tick: ticksPerBar(meter), bar: 2 });
  });

  it('keeps line spacing above the minimum at every zoom level', () => {
    for (const pxPerBeat of [1, 4, 16, 64, 256, 1024]) {
      const axis = TimeAxis.fromPxPerBeat(pxPerBeat);
      const lines = computeGridLines(axis, 1200, meter, 10);
      for (let i = 1; i < lines.length; i++) {
        expect(lines[i]!.x - lines[i - 1]!.x).toBeGreaterThanOrEqual(9.999);
      }
    }
  });

  it('shows subdivisions when zoomed in', () => {
    const axis = TimeAxis.fromPxPerBeat(400);
    const lines = computeGridLines(axis, 1000, meter, 10);
    expect(lines.some((l) => l.level === 'sub')).toBe(true);
    expect(lines.every((l) => Number.isInteger(l.tick))).toBe(true);
    expect(lines.some((l) => l.tick === PPQ / 4)).toBe(true);
  });

  it('handles compound meters', () => {
    const six8 = { numerator: 6, denominator: 8 } as const;
    const axis = TimeAxis.fromPxPerBeat(120);
    const lines = computeGridLines(axis, 1000, six8, 10);
    expect(
      lines
        .filter((l) => l.level === 'bar')
        .map((l) => l.tick)
        .slice(0, 2),
    ).toEqual([0, ticksPerBar(six8)]);
  });
});
