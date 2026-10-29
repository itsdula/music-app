import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  MAX_BPM,
  MIN_BPM,
  PPQ,
  barsBeatsToTicks,
  clampBpm,
  formatBarsBeats,
  formatSeconds,
  framesToSeconds,
  framesToTicks,
  isValidTimeSignature,
  secondsPerTick,
  secondsToFrames,
  secondsToTicks,
  ticksPerBar,
  ticksPerBeat,
  ticksToBarsBeats,
  ticksToFrames,
  ticksToSeconds,
  type TimeSignature,
  type TimeSignatureDenominator,
} from '../src';

const bpmArb = fc.double({ min: MIN_BPM, max: MAX_BPM, noNaN: true });
const sampleRateArb = fc.constantFrom(22_050, 44_100, 48_000, 88_200, 96_000);
const denominatorArb = fc.constantFrom<TimeSignatureDenominator>(1, 2, 4, 8, 16, 32);
const meterArb = fc.record({
  numerator: fc.integer({ min: 1, max: 32 }),
  denominator: denominatorArb,
});

describe('beats and bars', () => {
  it('computes ticks per beat and bar from the meter', () => {
    expect(ticksPerBeat({ numerator: 4, denominator: 4 })).toBe(PPQ);
    expect(ticksPerBeat({ numerator: 6, denominator: 8 })).toBe(PPQ / 2);
    expect(ticksPerBar({ numerator: 4, denominator: 4 })).toBe(PPQ * 4);
    expect(ticksPerBar({ numerator: 6, denominator: 8 })).toBe(PPQ * 3);
    expect(ticksPerBar({ numerator: 7, denominator: 16 })).toBe((PPQ / 4) * 7);
  });

  it('yields integer beat/bar lengths for every valid meter', () => {
    fc.assert(
      fc.property(meterArb, (meter) => {
        expect(Number.isInteger(ticksPerBeat(meter))).toBe(true);
        expect(Number.isInteger(ticksPerBar(meter))).toBe(true);
      }),
    );
  });
});

describe('tick/second/frame conversions', () => {
  it('converts known values at 120 BPM', () => {
    expect(ticksToSeconds(PPQ, 120)).toBe(0.5);
    expect(secondsToTicks(0.5, 120)).toBe(PPQ);
    expect(secondsPerTick(120)).toBeCloseTo(0.5 / PPQ, 15);
    expect(ticksToFrames(PPQ, 48_000, 120)).toBe(24_000);
    expect(framesToTicks(24_000, 48_000, 120)).toBe(PPQ);
    expect(secondsToFrames(1.5, 44_100)).toBe(66_150);
    expect(framesToSeconds(44_100, 44_100)).toBe(1);
  });

  it('round-trips ticks -> seconds -> ticks', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 50_000_000 }), bpmArb, (ticks, bpm) => {
        const back = secondsToTicks(ticksToSeconds(ticks, bpm), bpm);
        expect(Math.abs(back - ticks)).toBeLessThanOrEqual(1e-9 * Math.max(1, ticks));
        expect(Math.round(back)).toBe(ticks);
      }),
    );
  });

  it('round-trips integer frames -> seconds -> frames exactly', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 1_000_000_000 }), sampleRateArb, (frames, rate) => {
        expect(secondsToFrames(framesToSeconds(frames, rate), rate)).toBe(frames);
      }),
    );
  });

  it('round-trips ticks -> frames -> ticks within half a frame', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 10_000_000 }),
        sampleRateArb,
        bpmArb,
        (ticks, rate, bpm) => {
          const frames = ticksToFrames(ticks, rate, bpm);
          expect(Number.isInteger(frames)).toBe(true);
          const halfFrameInTicks = framesToTicks(0.5, rate, bpm);
          expect(Math.abs(framesToTicks(frames, rate, bpm) - ticks)).toBeLessThanOrEqual(
            halfFrameInTicks + 1e-6,
          );
        },
      ),
    );
  });

  it('frames -> ticks -> frames is exact after rounding', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 100_000_000 }),
        sampleRateArb,
        bpmArb,
        (f, rate, bpm) => {
          expect(ticksToFrames(framesToTicks(f, rate, bpm), rate, bpm)).toBe(f);
        },
      ),
    );
  });
});

describe('bars/beats positions', () => {
  const fourFour: TimeSignature = { numerator: 4, denominator: 4 };

  it('splits ticks into 1-based bars and beats', () => {
    expect(ticksToBarsBeats(0, fourFour)).toEqual({ bar: 1, beat: 1, tick: 0 });
    expect(ticksToBarsBeats(PPQ * 5 + 10, fourFour)).toEqual({ bar: 2, beat: 2, tick: 10 });
    expect(ticksToBarsBeats(PPQ * 3 + 5, { numerator: 6, denominator: 8 })).toEqual({
      bar: 2,
      beat: 1,
      tick: 5,
    });
  });

  it('clamps negative and floors fractional positions', () => {
    expect(ticksToBarsBeats(-100, fourFour)).toEqual({ bar: 1, beat: 1, tick: 0 });
    expect(ticksToBarsBeats(10.9, fourFour)).toEqual({ bar: 1, beat: 1, tick: 10 });
  });

  it('round-trips with barsBeatsToTicks for every meter', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 10_000_000 }), meterArb, (ticks, meter) => {
        expect(barsBeatsToTicks(ticksToBarsBeats(ticks, meter), meter)).toBe(ticks);
      }),
    );
  });

  it('formats bar.beat.sixteenth', () => {
    expect(formatBarsBeats(0, fourFour)).toBe('1.1.1');
    expect(formatBarsBeats(PPQ * 4 + PPQ + PPQ / 4, fourFour)).toBe('2.2.2');
    expect(formatBarsBeats(PPQ * 4 * 2 + PPQ * 3 + (PPQ / 4) * 3, fourFour)).toBe('3.4.4');
    expect(formatBarsBeats(PPQ / 2 + PPQ / 4, { numerator: 6, denominator: 8 })).toBe('1.2.2');
  });
});

describe('formatSeconds', () => {
  it('formats m:ss.mmm', () => {
    expect(formatSeconds(0)).toBe('0:00.000');
    expect(formatSeconds(61.5)).toBe('1:01.500');
    expect(formatSeconds(600.25)).toBe('10:00.250');
    expect(formatSeconds(59.9999)).toBe('0:59.999');
  });

  it('does not lose a millisecond to binary floating point', () => {
    expect(formatSeconds(1.001)).toBe('0:01.001');
    expect(formatSeconds(61.005)).toBe('1:01.005');
    expect(formatSeconds(0.3)).toBe('0:00.300');
  });

  it('clamps negative values to zero', () => {
    expect(formatSeconds(-3)).toBe('0:00.000');
  });

  it('matches integer-millisecond input exactly', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 100_000_000 }), (ms) => {
        const m = Math.floor(ms / 60_000);
        const s = Math.floor((ms % 60_000) / 1000);
        const expected = `${m}:${String(s).padStart(2, '0')}.${String(ms % 1000).padStart(3, '0')}`;
        expect(formatSeconds(ms / 1000)).toBe(expected);
      }),
    );
  });
});

describe('tempo and meter validation', () => {
  it('clamps BPM', () => {
    expect(clampBpm(5)).toBe(MIN_BPM);
    expect(clampBpm(1000)).toBe(MAX_BPM);
    expect(clampBpm(128.5)).toBe(128.5);
  });

  it('validates time signatures', () => {
    expect(isValidTimeSignature({ numerator: 4, denominator: 4 })).toBe(true);
    expect(isValidTimeSignature({ numerator: 32, denominator: 32 })).toBe(true);
    expect(isValidTimeSignature({ numerator: 0, denominator: 4 })).toBe(false);
    expect(isValidTimeSignature({ numerator: 33, denominator: 4 })).toBe(false);
    expect(isValidTimeSignature({ numerator: 3.5, denominator: 4 })).toBe(false);
    expect(isValidTimeSignature({ numerator: 4, denominator: 3 as TimeSignatureDenominator })).toBe(
      false,
    );
  });
});
