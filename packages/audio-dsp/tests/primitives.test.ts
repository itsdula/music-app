import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  applyBiquad,
  biquadCoefficients,
  createSeededRandom,
  dbToGain,
  deriveSeed,
  dominantFrequency,
  fftInPlace,
  gainToDb,
  magnitudeSpectrum,
  nextPowerOfTwo,
  onePoleCoefficient,
  peakAmplitude,
  rmsLevel,
  rmsOfSamples,
  type PcmAudio,
} from '../src';

describe('level conversions', () => {
  it('converts dB and gain both ways', () => {
    expect(dbToGain(0)).toBe(1);
    expect(dbToGain(-6)).toBeCloseTo(0.501187, 6);
    expect(dbToGain(20)).toBeCloseTo(10, 12);
    expect(dbToGain(Number.NEGATIVE_INFINITY)).toBe(0);
    expect(gainToDb(1)).toBe(0);
    expect(gainToDb(-0.5)).toBeCloseTo(-6.0206, 4);
    expect(gainToDb(0)).toBe(Number.NEGATIVE_INFINITY);
    fc.assert(
      fc.property(fc.double({ min: -120, max: 40, noNaN: true }), (db) => {
        expect(gainToDb(dbToGain(db))).toBeCloseTo(db, 9);
      }),
    );
  });

  it('measures peak and RMS', () => {
    const pcm: PcmAudio = {
      sampleRate: 8000,
      channels: [Float32Array.from([0.5, -1, 0]), Float32Array.from([0, 0, 0.25])],
    };
    expect(peakAmplitude(pcm)).toBe(1);
    expect(rmsLevel(pcm)).toBeCloseTo(Math.sqrt((0.25 + 1 + 0.0625) / 6), 9);
    expect(rmsLevel(pcm, 1, 2)).toBeCloseTo(Math.sqrt(1 / 2), 9);
    expect(rmsLevel(pcm, 5, 9)).toBe(0);
    expect(rmsLevel({ sampleRate: 8000, channels: [] })).toBe(0);
    expect(peakAmplitude({ sampleRate: 8000, channels: [new Float32Array(0)] })).toBe(0);
    expect(rmsOfSamples([3, 4], 0)).toBeCloseTo(Math.sqrt(12.5), 9);
    expect(rmsOfSamples([3, 4], 2)).toBe(0);
    // Full-scale sine: RMS = 1/√2.
    const sine = Float32Array.from({ length: 48000 }, (_, i) =>
      Math.sin((2 * Math.PI * 100 * i) / 48000),
    );
    expect(rmsOfSamples(sine)).toBeCloseTo(Math.SQRT1_2, 4);
  });
});

describe('seeded random', () => {
  it('is deterministic, uniform in [0,1) and seed-sensitive', () => {
    const a = createSeededRandom(123);
    const b = createSeededRandom(123);
    const c = createSeededRandom(124);
    const seqA = Array.from({ length: 1000 }, () => a());
    expect(Array.from({ length: 1000 }, () => b())).toEqual(seqA);
    expect(Array.from({ length: 1000 }, () => c())).not.toEqual(seqA);
    expect(Math.min(...seqA)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...seqA)).toBeLessThan(1);
    const mean = seqA.reduce((s, v) => s + v, 0) / seqA.length;
    expect(mean).toBeGreaterThan(0.45);
    expect(mean).toBeLessThan(0.55);
    // Golden values guard against accidental algorithm changes (Rust port fixture).
    const g = createSeededRandom(1);
    expect([g(), g(), g()].map((v) => Math.round(v * 1e9))).toEqual(goldenMulberry(1, 3));
  });

  it('derives distinct, deterministic stream seeds', () => {
    expect(deriveSeed(1, 0)).toBe(deriveSeed(1, 0));
    expect(new Set([0, 1, 2, 3].map((s) => deriveSeed(1, s))).size).toBe(4);
    expect(deriveSeed(1, 0)).not.toBe(deriveSeed(2, 0));
  });
});

/** Reference mulberry32 written independently with BigInt arithmetic. */
function goldenMulberry(seed: number, count: number): number[] {
  const mask = 0xffffffffn;
  let state = BigInt(seed >>> 0);
  const imul = (a: bigint, b: bigint) => (a * b) & mask;
  const out: number[] = [];
  for (let i = 0; i < count; i++) {
    state = (state + 0x6d2b79f5n) & mask;
    let t = state;
    t = imul(t ^ (t >> 15n), t | 1n);
    t = (t ^ ((t + imul(t ^ (t >> 7n), t | 61n)) & mask)) & mask;
    out.push(Math.round((Number((t ^ (t >> 14n)) & mask) / 4294967296) * 1e9));
  }
  return out;
}

describe('FFT', () => {
  it('matches a naive DFT', () => {
    const n = 64;
    const random = createSeededRandom(5);
    const input = Array.from({ length: n }, () => random() * 2 - 1);
    const re = Float64Array.from(input);
    const im = new Float64Array(n);
    fftInPlace(re, im);
    for (let k = 0; k < n; k++) {
      let r = 0;
      let i = 0;
      for (let t = 0; t < n; t++) {
        r += input[t]! * Math.cos((-2 * Math.PI * k * t) / n);
        i += input[t]! * Math.sin((-2 * Math.PI * k * t) / n);
      }
      expect(re[k]).toBeCloseTo(r, 9);
      expect(im[k]).toBeCloseTo(i, 9);
    }
    expect(() => fftInPlace(new Float64Array(3), new Float64Array(3))).toThrow(/power of two/);
    expect(nextPowerOfTwo(1)).toBe(1);
    expect(nextPowerOfTwo(1000)).toBe(1024);
  });

  it('finds the dominant frequency of a sinusoid to well under 1%', () => {
    for (const f of [55, 440, 1234.5, 9000]) {
      const sr = 48000;
      const s = Float32Array.from(
        { length: 8192 },
        (_, i) => 0.5 * Math.sin((2 * Math.PI * f * i) / sr),
      );
      expect(Math.abs(dominantFrequency(s, sr) - f) / f).toBeLessThan(0.002);
    }
    expect(dominantFrequency(new Float32Array(1024), 48000)).toBe(0);
    expect(magnitudeSpectrum([1])).toHaveLength(2);
  });
});

describe('filter kernels', () => {
  function toneGain(
    kind: 'lowpass' | 'highpass' | 'bandpass',
    freq: number,
    cutoff: number,
  ): number {
    const sr = 48000;
    const s = Float32Array.from({ length: 9600 }, (_, i) =>
      Math.sin((2 * Math.PI * freq * i) / sr),
    );
    applyBiquad(s, biquadCoefficients(kind, sr, cutoff, Math.SQRT1_2));
    return rmsOfSamples(s, 4800) / Math.SQRT1_2;
  }

  it('lowpass/highpass/bandpass attenuate as expected', () => {
    expect(toneGain('lowpass', 100, 1000)).toBeGreaterThan(0.95);
    expect(toneGain('lowpass', 10000, 1000)).toBeLessThan(0.02);
    expect(toneGain('highpass', 100, 1000)).toBeLessThan(0.02);
    expect(toneGain('highpass', 10000, 1000)).toBeGreaterThan(0.95);
    expect(toneGain('bandpass', 1000, 1000)).toBeGreaterThan(0.95);
    expect(toneGain('bandpass', 100, 1000)).toBeLessThan(0.2);
    expect(onePoleCoefficient(48000, 1e9)).toBeGreaterThan(0);
    expect(onePoleCoefficient(48000, 100)).toBeCloseTo(Math.exp((-2 * Math.PI * 100) / 48000), 12);
  });
});
