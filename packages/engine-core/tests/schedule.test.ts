import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  createTransportClock,
  planScheduleSegments,
  segmentTimeAtTick,
  unwrappedTickAtTime,
  wrapTick,
  type ScheduleSegment,
} from '../src';

const loop = { enabled: true, startTick: 1000, endTick: 2000 };

function ranges(segments: ScheduleSegment[]) {
  return segments.map((s) => [s.startTick, s.endTick, s.discontinuity]);
}

describe('planScheduleSegments', () => {
  it('returns one linear segment without a loop', () => {
    const clock = createTransportClock(0, 0, 120, null);
    const segments = planScheduleSegments(clock, 0, 500, { startIsDiscontinuity: true });
    expect(ranges(segments)).toEqual([[0, 500, true]]);
    expect(segments[0]!.boundaryTick).toBe(Number.POSITIVE_INFINITY);
    expect(segments[0]!.startTime).toBe(0);
    expect(segmentTimeAtTick(segments[0]!, 480)).toBeCloseTo(0.25, 12);
    expect(planScheduleSegments(clock, 500, 500)).toEqual([]);
  });

  it('a window ending exactly at the loop end does not wrap; the next one starts with a discontinuity', () => {
    const clock = createTransportClock(0, 0, 120, loop);
    const first = planScheduleSegments(clock, 1500, 2000);
    expect(ranges(first)).toEqual([[1500, 2000, false]]);
    expect(first[0]!.boundaryTick).toBe(2000);
    const second = planScheduleSegments(clock, 2000, 2300);
    expect(ranges(second)).toEqual([[1000, 1300, true]]);
    expect(second[0]!.iteration).toBe(1);
    expect(second[0]!.startUnwrapped).toBe(2000);
    // Engine time continues linearly across the wrap.
    expect(second[0]!.startTime).toBeCloseTo(2000 / 1920, 12);
  });

  it('splits a window crossing the loop end', () => {
    const clock = createTransportClock(0, 0, 120, loop);
    const segments = planScheduleSegments(clock, 1900, 2100);
    expect(ranges(segments)).toEqual([
      [1900, 2000, false],
      [1000, 1100, true],
    ]);
    expect(segments[1]!.startTime - segments[0]!.startTime).toBeCloseTo(100 / 1920, 12);
  });

  it('handles a loop shorter than the window (several passes in one window)', () => {
    const shortLoop = { enabled: true, startTick: 100, endTick: 150 };
    const clock = createTransportClock(0, 120, 120, shortLoop);
    const segments = planScheduleSegments(clock, 120, 320, { startIsDiscontinuity: true });
    expect(ranges(segments)).toEqual([
      [120, 150, true],
      [100, 150, true],
      [100, 150, true],
      [100, 150, true],
      [100, 120, true],
    ]);
    expect(segments.map((s) => s.iteration)).toEqual([0, 1, 2, 3, 4]);
    const totalTicks = segments.reduce((sum, s) => sum + s.endTick - s.startTick, 0);
    expect(totalTicks).toBe(200);
  });

  it('seek inside the loop keeps looping; seek after the loop end plays linearly', () => {
    const inside = createTransportClock(5, 1500, 120, loop);
    const u0 = unwrappedTickAtTime(inside, 5);
    expect(
      ranges(planScheduleSegments(inside, u0, u0 + 800, { startIsDiscontinuity: true })),
    ).toEqual([
      [1500, 2000, true],
      [1000, 1300, true],
    ]);
    const outside = createTransportClock(5, 2500, 120, loop);
    const segments = planScheduleSegments(outside, 2500, 3300, { startIsDiscontinuity: true });
    expect(ranges(segments)).toEqual([[2500, 3300, true]]);
    expect(segments[0]!.boundaryTick).toBe(Number.POSITIVE_INFINITY);
  });

  it('truncates at a linear render end and reports it as the boundary', () => {
    const clock = createTransportClock(0, 0, 120, null);
    const segments = planScheduleSegments(clock, 900, 1200, { endTick: 1000 });
    expect(ranges(segments)).toEqual([[900, 1000, false]]);
    expect(segments[0]!.boundaryTick).toBe(1000);
    expect(planScheduleSegments(clock, 1000, 1200, { endTick: 1000 })).toEqual([]);
  });

  it('consecutive windows tile the run exactly and segments never cross the loop end (property)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 5000 }),
        fc.integer({ min: 1, max: 3000 }),
        fc.integer({ min: 0, max: 8000 }),
        fc.array(fc.integer({ min: 1, max: 4000 }), { minLength: 1, maxLength: 12 }),
        fc.double({ min: 30, max: 300, noNaN: true }),
        (loopStart, loopLength, anchorTick, windowSizes, bpm) => {
          const region = { enabled: true, startTick: loopStart, endTick: loopStart + loopLength };
          const clock = createTransportClock(1, anchorTick, bpm, region);
          let u = anchorTick;
          let expectedNextStart = anchorTick;
          for (const size of windowSizes) {
            const segments = planScheduleSegments(clock, u, u + size, {
              startIsDiscontinuity: u === anchorTick,
            });
            let covered = 0;
            for (const s of segments) {
              expect(s.startUnwrapped).toBeCloseTo(expectedNextStart, 6);
              expect(s.endTick).toBeGreaterThan(s.startTick);
              expect(s.startTick).toBeCloseTo(wrapTick(s.startUnwrapped, clock.loop), 6);
              if (clock.loop) {
                expect(s.endTick).toBeLessThanOrEqual(clock.loop.endTick);
                if (s.startUnwrapped >= clock.loop.endTick)
                  expect(s.startTick).toBeGreaterThanOrEqual(clock.loop.startTick);
              }
              covered += s.endTick - s.startTick;
              expectedNextStart = s.startUnwrapped + (s.endTick - s.startTick);
              expect(s.startTime).toBeCloseTo(
                1 + (s.startUnwrapped - anchorTick) * s.secondsPerTick,
                9,
              );
            }
            expect(covered).toBeCloseTo(size, 6);
            u += size;
          }
        },
      ),
      { numRuns: 300 },
    );
  });
});
