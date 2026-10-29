import fc from 'fast-check';
import { PPQ } from '@studio/domain';
import { describe, expect, it } from 'vitest';
import {
  activeLoop,
  createTransportClock,
  loopIteration,
  rebaseClock,
  tickAtTime,
  ticksPerSecond,
  timeAtUnwrappedTick,
  unwrappedTickAtTime,
  wrapTick,
} from '../src';

const loop = { enabled: true, startTick: 3840, endTick: 7680 }; // bars 2–3 at 4/4

describe('transport clock', () => {
  it('anchors tick to engine time linearly: tick = anchorTick + (t − anchorTime)·bpm·PPQ/60', () => {
    const clock = createTransportClock(10, 960, 120, null);
    expect(ticksPerSecond(120)).toBe(1920);
    expect(tickAtTime(clock, 10)).toBe(960);
    expect(tickAtTime(clock, 10.5)).toBe(960 + 960);
    expect(tickAtTime(clock, 12)).toBe(960 + 3840);
    // Before the anchor it extrapolates backwards (used for latency-compensated takes).
    expect(tickAtTime(clock, 9.75)).toBe(960 - 480);
    expect(timeAtUnwrappedTick(clock, 960 + 1920)).toBe(11);
  });

  it('wraps at the loop end into [loopStart, loopEnd)', () => {
    const clock = createTransportClock(0, 3840, 120, loop); // 2 s per loop pass (3840 ticks)
    expect(clock.loop).toEqual({ startTick: 3840, endTick: 7680 });
    expect(tickAtTime(clock, 1.999)).toBeCloseTo(7678.08, 6);
    expect(tickAtTime(clock, 2)).toBe(3840);
    expect(tickAtTime(clock, 2.5)).toBe(3840 + 960);
    expect(tickAtTime(clock, 6.25)).toBe(3840 + 480);
    expect(loopIteration(unwrappedTickAtTime(clock, 6.25), clock.loop)).toBe(3);
    expect(loopIteration(100, null)).toBe(0);
  });

  it('plays into the loop from before its start', () => {
    const clock = createTransportClock(0, 0, 120, loop);
    expect(tickAtTime(clock, 1)).toBe(1920);
    expect(tickAtTime(clock, 4)).toBe(3840); // reached the loop end at 4 s → wrapped
    expect(tickAtTime(clock, 5)).toBe(5760);
  });

  it('ignores the loop when disabled, degenerate, or anchored at/after its end', () => {
    expect(activeLoop({ ...loop, enabled: false }, 0)).toBeNull();
    expect(activeLoop({ enabled: true, startTick: 100, endTick: 100 }, 0)).toBeNull();
    expect(activeLoop(loop, 7680)).toBeNull();
    expect(activeLoop(loop, 9000)).toBeNull();
    expect(activeLoop(null, 0)).toBeNull();
    const past = createTransportClock(0, 9000, 120, loop);
    expect(tickAtTime(past, 10)).toBe(9000 + 19200);
  });

  it('wrapTick matches a reference modulo for random inputs (property)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 100_000 }),
        fc.integer({ min: 1, max: 20_000 }),
        fc.integer({ min: 0, max: 1_000_000 }),
        (start, length, u) => {
          const bounds = { startTick: start, endTick: start + length };
          const wrapped = wrapTick(u, bounds);
          if (u < bounds.endTick) expect(wrapped).toBe(u);
          else {
            expect(wrapped).toBeGreaterThanOrEqual(start);
            expect(wrapped).toBeLessThan(start + length);
            expect((u - wrapped) % length).toBe(0);
          }
        },
      ),
    );
  });

  it('rebases continuously for tempo and loop changes', () => {
    const clock = createTransportClock(0, 0, 120, loop);
    const faster = rebaseClock(clock, 1, { bpm: 240 });
    expect(faster.anchorTick).toBe(1920);
    expect(faster.anchorTime).toBe(1);
    expect(tickAtTime(faster, 1.5)).toBe(1920 + 1920);
    expect(faster.loop).toEqual(clock.loop);
    const unlooped = rebaseClock(clock, 5, { loop: null });
    expect(unlooped.anchorTick).toBe(5760);
    expect(unlooped.loop).toBeNull();
    const kept = rebaseClock(createTransportClock(0, 0, 60, null), 2);
    expect(kept.loop).toBeNull();
    expect(kept.anchorTick).toBe(2 * PPQ);
  });

  it('rejects non-positive tempo', () => {
    expect(() => createTransportClock(0, 0, 0, null)).toThrow(/bpm/);
  });
});
