import fc from 'fast-check';
import { asTrackId, createInstrumentConfig } from '@studio/domain';
import { describe, expect, it } from 'vitest';
import {
  DRUM_KIT_TAIL_SECONDS,
  VOICE_STOP_MARGIN_SECONDS,
  decibelsToGain,
  effectTailSeconds,
  equalPowerPanGains,
  estimateTailSeconds,
  faderGain,
  instrumentTailSeconds,
  isSoloActive,
  metronomeClicksInRange,
  mixerPanGains,
  resolveTrackGates,
  trackGateGain,
  trackTailSeconds,
} from '../src';
import { effect, synthTrack, track } from './fixtures';

describe('mute / solo', () => {
  const a = track('trk_a');
  const mutedB = track('trk_b', 'audio', { mixer: { gainDb: 0, pan: 0, mute: true, solo: false } });
  const soloC = track('trk_c', 'audio', { mixer: { gainDb: 0, pan: 0, mute: false, solo: true } });
  const mutedSoloD = track('trk_d', 'audio', {
    mixer: { gainDb: 0, pan: 0, mute: true, solo: true },
  });

  it('without solo only mute silences', () => {
    expect(isSoloActive([a, mutedB])).toBe(false);
    expect([...resolveTrackGates([a, mutedB]).values()]).toEqual([1, 0]);
  });

  it('with solo only soloed, unmuted tracks pass; mute wins over solo', () => {
    const gates = resolveTrackGates([a, mutedB, soloC, mutedSoloD]);
    expect(gates.get(asTrackId('trk_a'))).toBe(0);
    expect(gates.get(asTrackId('trk_b'))).toBe(0);
    expect(gates.get(asTrackId('trk_c'))).toBe(1);
    expect(gates.get(asTrackId('trk_d'))).toBe(0);
    expect(trackGateGain(a, false)).toBe(1);
  });
});

describe('gain and pan laws', () => {
  it('fader treats ≤ −60 dB as silence', () => {
    expect(faderGain(0)).toBe(1);
    expect(faderGain(-60)).toBe(0);
    expect(faderGain(-59)).toBeCloseTo(decibelsToGain(-59), 12);
    expect(faderGain(6)).toBeCloseTo(1.995262, 5);
    expect(decibelsToGain(Number.NEGATIVE_INFINITY)).toBe(0);
  });

  it('equal-power law keeps constant power; mixer law is unity at centre', () => {
    fc.assert(
      fc.property(fc.double({ min: -1, max: 1, noNaN: true }), (pan) => {
        const g = equalPowerPanGains(pan);
        expect(g.left ** 2 + g.right ** 2).toBeCloseTo(1, 12);
      }),
    );
    expect(equalPowerPanGains(0).left).toBeCloseTo(Math.SQRT1_2, 12);
    expect(mixerPanGains(0)).toEqual({
      left: expect.closeTo(1, 12) as number,
      right: expect.closeTo(1, 12) as number,
    });
    expect(mixerPanGains(-1).left).toBeCloseTo(Math.SQRT2, 12);
    expect(mixerPanGains(-1).right).toBeCloseTo(0, 12);
    expect(mixerPanGains(5).right).toBeCloseTo(Math.SQRT2, 12);
    expect(equalPowerPanGains(Number.NaN)).toEqual(equalPowerPanGains(0));
  });
});

describe('tail estimation', () => {
  it('computes per-effect tails', () => {
    expect(
      effectTailSeconds(effect('fx_r', 'reverb', { decaySeconds: 3, preDelayMs: 50 })),
    ).toBeCloseTo(3.05, 12);
    // 0.5 feedback: ceil(ln 0.001 / ln 0.5) = 10 echoes.
    expect(effectTailSeconds(effect('fx_d', 'delay', { timeMs: 200, feedback: 0.5 }))).toBeCloseTo(
      2,
      12,
    );
    expect(effectTailSeconds(effect('fx_d', 'delay', { timeMs: 200, feedback: 0 }))).toBeCloseTo(
      0.2,
      12,
    );
    expect(effectTailSeconds(effect('fx_c', 'compressor'))).toBeGreaterThan(0);
    expect(effectTailSeconds(effect('fx_g', 'gain'))).toBe(0);
    expect(effectTailSeconds(effect('fx_r', 'reverb', {}, true))).toBe(0);
  });

  it('computes instrument tails', () => {
    expect(instrumentTailSeconds(undefined)).toBe(0);
    expect(
      instrumentTailSeconds({ ...createInstrumentConfig('synth'), params: { release: 1.5 } }),
    ).toBeCloseTo(1.5 + VOICE_STOP_MARGIN_SECONDS, 12);
    expect(
      instrumentTailSeconds({ ...createInstrumentConfig('drums'), params: { decayScale: 1.2 } }),
    ).toBeCloseTo(1.2 * DRUM_KIT_TAIL_SECONDS, 12);
    expect(
      instrumentTailSeconds({ ...createInstrumentConfig('drums'), params: { decayScale: 4 } }),
    ).toBe(8);
    const sampler = createInstrumentConfig('sampler');
    expect(instrumentTailSeconds(sampler, { sampleSeconds: 9 })).toBeCloseTo(
      0.2 + VOICE_STOP_MARGIN_SECONDS,
      12,
    );
    expect(
      instrumentTailSeconds(
        { ...sampler, params: { ...sampler.params, oneShot: 1 } },
        { sampleSeconds: 9 },
      ),
    ).toBe(9);
  });

  it('sums serial chains, takes the longest audible track, adds master, and caps', () => {
    const reverbTrack = synthTrack('trk_a', { release: 0.5 });
    const withFx = {
      ...reverbTrack,
      effects: [
        effect('fx_1', 'reverb', { decaySeconds: 2, preDelayMs: 0 }),
        effect('fx_2', 'delay', { timeMs: 100, feedback: 0 }),
      ],
    };
    expect(trackTailSeconds(withFx)).toBeCloseTo(0.5 + VOICE_STOP_MARGIN_SECONDS + 2 + 0.1, 12);
    const dry = synthTrack('trk_b', { release: 0.1 });
    const master = {
      gainDb: 0,
      effects: [effect('fx_m', 'reverb', { decaySeconds: 1, preDelayMs: 0 })],
    };
    expect(estimateTailSeconds({ tracks: [withFx, dry], master })).toBeCloseTo(2.62 + 1, 12);
    // Muting the long track leaves the short one.
    const muted = { ...withFx, mixer: { ...withFx.mixer, mute: true } };
    expect(estimateTailSeconds({ tracks: [muted, dry], master })).toBeCloseTo(0.12 + 1, 12);
    const huge = {
      ...withFx,
      effects: [
        effect('fx_1', 'reverb', { decaySeconds: 10 }),
        effect('fx_2', 'reverb', { decaySeconds: 10 }),
      ],
    };
    expect(estimateTailSeconds({ tracks: [huge], master })).toBe(12);
    expect(estimateTailSeconds({ tracks: [huge], master }, { maxSeconds: 5 })).toBe(5);
    expect(estimateTailSeconds({ tracks: [], master: { gainDb: 0, effects: [] } })).toBe(0);
  });
});

describe('metronome clicks', () => {
  it('clicks on beats with accents on bar starts (4/4 and 6/8)', () => {
    expect(metronomeClicksInRange(0, 3840 + 1, { numerator: 4, denominator: 4 })).toEqual([
      { tick: 0, accent: true },
      { tick: 960, accent: false },
      { tick: 1920, accent: false },
      { tick: 2880, accent: false },
      { tick: 3840, accent: true },
    ]);
    const sixEight = metronomeClicksInRange(2000, 3000, { numerator: 6, denominator: 8 });
    expect(sixEight.map((c) => c.tick)).toEqual([2400, 2880]);
    expect(sixEight.map((c) => c.accent)).toEqual([false, true]); // bar = 2880 ticks
  });

  it('is half-open and supports negative (count-in) ticks', () => {
    expect(metronomeClicksInRange(960, 960, { numerator: 4, denominator: 4 })).toEqual([]);
    expect(metronomeClicksInRange(0, 960, { numerator: 4, denominator: 4 })).toEqual([
      { tick: 0, accent: true },
    ]);
    expect(metronomeClicksInRange(-3840, -2000, { numerator: 4, denominator: 4 })).toEqual([
      { tick: -3840, accent: true },
      { tick: -2880, accent: false },
    ]);
  });
});
