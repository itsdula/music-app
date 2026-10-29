import { describe, expect, it } from 'vitest';
import {
  DRUM_VOICE_KINDS,
  applyBiquad,
  biquadCoefficients,
  GM_DRUM_MAP,
  HAT_CHOKE_NOTES,
  dominantFrequency,
  drumKindForNote,
  generateReverbImpulse,
  makeDistortionCurve,
  rmsOfSamples,
  synthesizeDrumVoice,
  synthesizeMetronomeClick,
  type DrumVoiceKind,
} from '../src';

const SR = 48000;

function rms(samples: Float32Array): number {
  return rmsOfSamples(samples);
}

/** Fraction of signal energy above `hz` (two cascaded RBJ highpass stages). */
function energyAbove(samples: Float32Array, sampleRate: number, hz: number): number {
  const filtered = samples.slice();
  const c = biquadCoefficients('highpass', sampleRate, hz, Math.SQRT1_2);
  applyBiquad(filtered, c);
  applyBiquad(filtered, c);
  const total = samples.reduce((s, v) => s + v * v, 0);
  return filtered.reduce((s, v) => s + v * v, 0) / total;
}

describe('drum synthesis', () => {
  it.each(DRUM_VOICE_KINDS.map((k) => [k]))(
    '%s is deterministic, non-silent, bounded and ends at zero',
    (kind) => {
      const a = synthesizeDrumVoice(kind, SR, { seed: 9 });
      const b = synthesizeDrumVoice(kind, SR, { seed: 9 });
      expect(a).toEqual(b);
      expect(rms(a)).toBeGreaterThan(0.005);
      let peak = 0;
      for (const v of a) peak = Math.max(peak, Math.abs(v));
      expect(peak).toBeGreaterThan(0.5);
      expect(peak).toBeLessThanOrEqual(0.951);
      expect(a[a.length - 1]).toBe(0);
      expect(a.every(Number.isFinite)).toBe(true);
    },
  );

  it('noise-based voices change with the seed', () => {
    const a = synthesizeDrumVoice('snare', SR, { seed: 1 });
    const b = synthesizeDrumVoice('snare', SR, { seed: 2 });
    expect(a).not.toEqual(b);
  });

  it('decayScale changes the length; tune shifts the pitch; tone changes brightness', () => {
    const short = synthesizeDrumVoice('kick', SR, { decayScale: 0.5 });
    const long = synthesizeDrumVoice('kick', SR, { decayScale: 2 });
    expect(long.length).toBeGreaterThan(short.length * 3);

    const low = synthesizeDrumVoice('lowTom', SR, { tuneSemitones: -12 });
    const high = synthesizeDrumVoice('lowTom', SR, { tuneSemitones: 12 });
    const tail = (s: Float32Array) => s.subarray(Math.floor(0.15 * SR), Math.floor(0.4 * SR));
    const fLow = dominantFrequency(tail(low), SR, 30, 1000);
    const fHigh = dominantFrequency(tail(high), SR, 30, 1000);
    expect(fHigh / fLow).toBeGreaterThan(3.6);
    expect(fHigh / fLow).toBeLessThan(4.4);

    const dark = synthesizeDrumVoice('snare', SR, { tone: 0, seed: 4 });
    const bright = synthesizeDrumVoice('snare', SR, { tone: 1, seed: 4 });
    expect(energyAbove(bright, SR, 2000)).toBeGreaterThan(energyAbove(dark, SR, 2000) * 1.3);
  });

  it('works at 44.1 kHz and clamps out-of-range params', () => {
    const v = synthesizeDrumVoice('crash', 44100, { decayScale: 100, tone: 5, tuneSemitones: 99 });
    expect(v.length).toBeLessThanOrEqual(8 * 44100 + 1);
    expect(rms(v)).toBeGreaterThan(0);
    expect(() => synthesizeDrumVoice('gong' as DrumVoiceKind, SR)).toThrow(/unknown kind/);
  });

  it('maps General MIDI notes as documented', () => {
    const expected: Record<number, DrumVoiceKind> = {
      36: 'kick',
      37: 'rim',
      38: 'snare',
      40: 'snare',
      39: 'clap',
      41: 'lowTom',
      43: 'lowTom',
      45: 'midTom',
      47: 'midTom',
      48: 'highTom',
      50: 'highTom',
      42: 'closedHat',
      44: 'closedHat',
      46: 'openHat',
      49: 'crash',
      57: 'crash',
      56: 'cowbell',
    };
    for (const [note, kind] of Object.entries(expected))
      expect(GM_DRUM_MAP[Number(note)]).toBe(kind);
    expect(drumKindForNote(60)).toBeUndefined();
    expect(HAT_CHOKE_NOTES).toEqual([42, 44, 46]);
  });
});

describe('reverb impulse', () => {
  it('is deterministic, stereo, decorrelated and unit-energy per channel', () => {
    const a = generateReverbImpulse(SR, 1.5, 6000, 11);
    const b = generateReverbImpulse(SR, 1.5, 6000, 11);
    expect(a).toEqual(b);
    expect(a.channels).toHaveLength(2);
    expect(a.channels[0]!.length).toBe(Math.ceil(1.5 * SR));
    for (const ch of a.channels) {
      const energy = ch.reduce((s, v) => s + v * v, 0);
      expect(energy).toBeCloseTo(1, 4);
      expect(ch[ch.length - 1]).toBe(0);
    }
    let corr = 0;
    for (let i = 0; i < a.channels[0]!.length; i++) corr += a.channels[0]![i]! * a.channels[1]![i]!;
    expect(Math.abs(corr)).toBeLessThan(0.2);
    expect(generateReverbImpulse(SR, 1.5, 6000, 12)).not.toEqual(a);
  });

  it('decays by about 60 dB over the decay time and damping darkens the tail', () => {
    const ir = generateReverbImpulse(SR, 2, 12000, 5).channels[0]!;
    const early = rmsOfSamples(ir, 0, 0.1 * SR);
    const late = rmsOfSamples(ir, 1.8 * SR, 1.9 * SR);
    const dropDb = 20 * Math.log10(early / late);
    expect(dropDb).toBeGreaterThan(45);
    expect(dropDb).toBeLessThan(65);

    const bright = generateReverbImpulse(SR, 1, 16000, 5).channels[0]!;
    const dark = generateReverbImpulse(SR, 1, 1500, 5).channels[0]!;
    expect(energyAbove(dark, SR, 4000)).toBeLessThan(energyAbove(bright, SR, 4000) * 0.5);
  });

  it('handles tiny decay values', () => {
    const ir = generateReverbImpulse(8000, 0, 1000, 1);
    expect(ir.channels[0]!.length).toBeGreaterThanOrEqual(1);
  });
});

describe('shaping and clicks', () => {
  it('distortion curve is monotonic, odd-symmetric and maps ±1 to ±1', () => {
    for (const drive of [0, 0.3, 1]) {
      const curve = makeDistortionCurve(drive, 1025);
      expect(curve).toHaveLength(1025);
      expect(curve[0]).toBeCloseTo(-1, 6);
      expect(curve[1024]).toBeCloseTo(1, 6);
      expect(curve[512]).toBeCloseTo(0, 6);
      for (let i = 1; i < curve.length; i++)
        expect(curve[i]!).toBeGreaterThanOrEqual(curve[i - 1]!);
      for (let i = 0; i < 512; i++) expect(curve[i]!).toBeCloseTo(-curve[1024 - i]!, 6);
    }
    // More drive → more gain at small inputs (steeper slope at the centre).
    const soft = makeDistortionCurve(0, 1025);
    const hard = makeDistortionCurve(1, 1025);
    expect(hard[600]!).toBeGreaterThan(soft[600]!);
    expect(makeDistortionCurve(Number.NaN, 1)).toHaveLength(2);
  });

  it('metronome clicks differ in pitch and level and are silent at the end', () => {
    const accent = synthesizeMetronomeClick(SR, true);
    const normal = synthesizeMetronomeClick(SR, false);
    expect(accent.length).toBe(Math.ceil(0.06 * SR));
    expect(accent[accent.length - 1]).toBeCloseTo(0, 6);
    expect(dominantFrequency(accent, SR)).toBeCloseTo(1760, -1);
    expect(dominantFrequency(normal, SR)).toBeCloseTo(1320, -1);
    expect(rms(accent)).toBeGreaterThan(rms(normal));
  });
});
