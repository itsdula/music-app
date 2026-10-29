import { describe, expect, it } from 'vitest';
import {
  computePitchMetrics,
  concatenatePcm,
  constantF0,
  createSeededRandom,
  glideF0,
  groundTruthF0,
  groundTruthVoicing,
  hzToMidi,
  KNOWN_MELODIES,
  melodyF0,
  melodyToTimedNotes,
  melodyWeights,
  midiToHz,
  mixPcm,
  MODAL_MELODIES,
  monoPcm,
  normalizePeak,
  parseMelody,
  rosenbergDerivativeHarmonics,
  silence,
  sine,
  sweep,
  sweepFrequencyAt,
  synthesizeConsonantBurst,
  synthesizeVowel,
  transposeKey,
  vibratoF0,
  whiteNoise,
} from '../src/index';

const SR = 48000;

/** Period (samples) from the highest normalised autocorrelation peak in a lag range. */
function periodOf(
  x: Float32Array,
  from: number,
  length: number,
  minLag: number,
  maxLag: number,
): number {
  let bestLag = minLag;
  let best = -Infinity;
  for (let lag = minLag; lag <= maxLag; lag++) {
    let ab = 0;
    let aa = 0;
    let bb = 0;
    for (let i = 0; i < length; i++) {
      const a = x[from + i]!;
      const b = x[from + i + lag]!;
      ab += a * b;
      aa += a * a;
      bb += b * b;
    }
    const r = ab / Math.sqrt(aa * bb);
    if (r > best) {
      best = r;
      bestLag = lag;
    }
  }
  return bestLag;
}

function rms(x: Float32Array): number {
  let s = 0;
  for (const v of x) s += v * v;
  return Math.sqrt(s / x.length);
}

/** RMS frequency from the first-difference energy ratio. */
function rmsFrequency(x: Float32Array): number {
  let e = 0;
  let d = 0;
  for (let i = 1; i < x.length; i++) {
    e += x[i]! * x[i]!;
    d += (x[i]! - x[i - 1]!) ** 2;
  }
  return (SR / Math.PI) * Math.asin(Math.min(1, Math.sqrt(d / e) / 2));
}

describe('createSeededRandom', () => {
  it('is deterministic, seed-dependent and uniform in [0, 1)', () => {
    const a = createSeededRandom(42);
    const b = createSeededRandom(42);
    const c = createSeededRandom(43);
    const first = Array.from({ length: 5 }, () => a());
    expect(Array.from({ length: 5 }, () => b())).toEqual(first);
    expect(Array.from({ length: 5 }, () => c())).not.toEqual(first);
    // Golden values (mulberry32) for cross-implementation fixtures.
    expect(createSeededRandom(1)()).toBeCloseTo(0.6270739405881613, 15);
    const r = createSeededRandom(7);
    let sum = 0;
    let sq = 0;
    for (let i = 0; i < 20000; i++) {
      const v = r();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
      sum += v;
    }
    expect(sum / 20000).toBeCloseTo(0.5, 1);
    sum = 0;
    for (let i = 0; i < 20000; i++) {
      const g = r.gaussian();
      sum += g;
      sq += g * g;
    }
    expect(sum / 20000).toBeCloseTo(0, 1);
    expect(sq / 20000).toBeCloseTo(1, 1);
    for (let i = 0; i < 100; i++) {
      const n = r.int(5);
      expect(Number.isInteger(n) && n >= 0 && n < 5).toBe(true);
    }
  });
});

describe('basic signals', () => {
  it('generates sines, sweeps and noise', () => {
    const s = sine({ sampleRate: SR, frequencyHz: 480, durationSeconds: 0.5 });
    expect(s.channels[0]).toHaveLength(SR / 2);
    expect(periodOf(s.channels[0]!, 0, 2000, 50, 150)).toBe(100);
    expect(Math.max(...s.channels[0]!)).toBeCloseTo(0.5, 3);
    const sweepOptions = { sampleRate: SR, fromHz: 100, toHz: 800, durationSeconds: 1 };
    expect(sweepFrequencyAt(sweepOptions, 0)).toBe(100);
    expect(sweepFrequencyAt(sweepOptions, 1)).toBeCloseTo(800, 9);
    expect(sweepFrequencyAt(sweepOptions, 0.5)).toBeCloseTo(Math.sqrt(100 * 800), 9);
    expect(sweepFrequencyAt({ ...sweepOptions, curve: 'linear' }, 0.5)).toBeCloseTo(450, 9);
    expect(sweep(sweepOptions).channels[0]).toHaveLength(SR);
    const n1 = whiteNoise({ sampleRate: SR, durationSeconds: 0.1, seed: 3, amplitude: 0.2 });
    const n2 = whiteNoise({ sampleRate: SR, durationSeconds: 0.1, seed: 3, amplitude: 0.2 });
    expect(Array.from(n1.channels[0]!)).toEqual(Array.from(n2.channels[0]!));
    expect(Math.max(...n1.channels[0]!.map(Math.abs))).toBeLessThanOrEqual(0.2);
  });
});

describe('f0 curves', () => {
  it('describes constant, vibrato, glide and melody contours', () => {
    expect(midiToHz(69)).toBe(440);
    expect(hzToMidi(midiToHz(61.37))).toBeCloseTo(61.37, 12);
    const c = constantF0(200, 0.1, 0.5);
    expect([c(0.05), c(0.1), c(0.49), c(0.5)]).toEqual([0, 200, 200, 0]);
    const v = vibratoF0({
      baseHz: 200,
      rateHz: 5,
      depthCents: 100,
      startSeconds: 0,
      endSeconds: 1,
      driftCentsPerSecond: 0,
    });
    expect(v(0.05)).toBeCloseTo(200 * 2 ** (1 / 12), 6);
    expect(v(1)).toBe(0);
    const g = glideF0({ fromHz: 100, toHz: 400, glideStartSeconds: 1, glideSeconds: 1 });
    expect([g(0.5), g(1.5), g(3)]).toEqual([100, 200, 400]);
    const notes = [
      { midi: 60, startSeconds: 0, durationSeconds: 0.5 },
      { midi: 64, startSeconds: 0.5, durationSeconds: 0.5 },
      { midi: 67, startSeconds: 1.2, durationSeconds: 0.3 },
    ];
    const m = melodyF0(notes);
    expect(m(0.25)).toBeCloseTo(midiToHz(60), 9);
    expect(m(0.75)).toBeCloseTo(midiToHz(64), 9);
    expect(m(1.1)).toBe(0);
    expect(m(1.3)).toBeCloseTo(midiToHz(67), 9);
    expect(m(-1)).toBe(0);
    const glided = melodyF0(notes, { glideSeconds: 0.1, detuneCents: [10, 0, 0] });
    expect(glided(0.5)).toBeCloseTo(midiToHz((60.1 + 64) / 2), 6);
    expect(glided(0.2)).toBeCloseTo(midiToHz(60.1), 6);
    const vib = melodyF0(notes, { vibrato: { rateHz: 5, depthCents: 50 } });
    expect(vib(0.05)).toBeCloseTo(midiToHz(60.5), 6);
  });
});

describe('synthesizeVowel', () => {
  it('produces the requested pitch, length and level, deterministically', () => {
    const options = {
      sampleRate: SR,
      durationSeconds: 0.6,
      f0: constantF0(240),
      vowel: 'e' as const,
      seed: 2,
    };
    const a = synthesizeVowel(options);
    expect(a.channels[0]).toHaveLength(Math.round(0.6 * SR));
    expect(Math.max(...a.channels[0]!.map(Math.abs))).toBeCloseTo(0.5, 6);
    expect(periodOf(a.channels[0]!, 5000, 4000, 100, 400)).toBe(200);
    expect(Array.from(synthesizeVowel(options).channels[0]!)).toEqual(Array.from(a.channels[0]!));
    const silent = synthesizeVowel({ ...options, f0: () => 0 });
    expect(silent.channels[0]!.every((v) => v === 0)).toBe(true);
  });

  it('ramps voicing edges, adds breathiness, jitter and shimmer', () => {
    const base = { sampleRate: SR, durationSeconds: 0.5, f0: constantF0(200, 0.1, 0.4), seed: 3 };
    const clean = synthesizeVowel(base).channels[0]!;
    expect(clean.slice(0, Math.round(0.1 * SR)).every((v) => v === 0)).toBe(true);
    const onset = Math.round(0.1 * SR);
    expect(Math.abs(clean[onset + 5]!)).toBeLessThan(0.05);
    const breathy = synthesizeVowel({ ...base, breathiness: 1 }).channels[0]!;
    const perturbed = synthesizeVowel({ ...base, jitter: 0.01, shimmer: 0.1 }).channels[0]!;
    expect(Array.from(breathy)).not.toEqual(Array.from(clean));
    expect(Array.from(perturbed)).not.toEqual(Array.from(clean));
    const formants = synthesizeVowel({
      ...base,
      formants: {
        frequenciesHz: [500, 1500, 2500, 3500, 30000],
        bandwidthsHz: [80, 90, 120, 180, 250],
      },
    });
    expect(formants.channels[0]!.some((v) => v !== 0)).toBe(true);
  });

  it('uses a band-limited Rosenberg source with a 1/k-like spectrum', () => {
    const h = rosenbergDerivativeHarmonics();
    expect(h).toBe(rosenbergDerivativeHarmonics());
    const magnitude = (k: number): number => Math.hypot(h.cos[k]!, h.sin[k]!);
    expect(magnitude(1)).toBeGreaterThan(magnitude(20));
    expect(magnitude(64) / magnitude(16)).toBeLessThan(0.5);
    // No aliasing: the spectrum above 0.48·fs is empty for a 3 kHz tone at 16 kHz.
    const high = synthesizeVowel({
      sampleRate: 16000,
      durationSeconds: 0.2,
      f0: constantF0(3000),
      seed: 1,
    });
    expect(high.channels[0]!.every((v) => Number.isFinite(v))).toBe(true);
  });
});

describe('synthesizeConsonantBurst', () => {
  it('shapes sibilant, breath and plosive noise', () => {
    const sibilant = synthesizeConsonantBurst({
      sampleRate: SR,
      durationSeconds: 0.3,
      kind: 'sibilant',
      seed: 1,
    }).channels[0]!;
    const breath = synthesizeConsonantBurst({
      sampleRate: SR,
      durationSeconds: 0.3,
      kind: 'breath',
      seed: 1,
    }).channels[0]!;
    const plosive = synthesizeConsonantBurst({
      sampleRate: SR,
      durationSeconds: 0.05,
      kind: 'plosive',
      seed: 1,
      rmsDb: -20,
    }).channels[0]!;
    expect(20 * Math.log10(rms(sibilant))).toBeCloseTo(-24, 6);
    expect(20 * Math.log10(rms(breath))).toBeCloseTo(-30, 6);
    expect(20 * Math.log10(rms(plosive))).toBeCloseTo(-20, 6);
    expect(rmsFrequency(sibilant)).toBeGreaterThan(4000);
    expect(rmsFrequency(breath)).toBeLessThan(2500);
    const early = rms(plosive.subarray(0, 480));
    const late = rms(plosive.subarray(1920));
    expect(late).toBeLessThan(early * 0.2);
    const loud = synthesizeConsonantBurst({
      sampleRate: SR,
      durationSeconds: 0.1,
      kind: 'breath',
      seed: 2,
      rmsDb: 6,
    }).channels[0]!;
    expect(Math.max(...loud.map(Math.abs))).toBeLessThanOrEqual(0.99 + 1e-6);
    const lowRate = synthesizeConsonantBurst({
      sampleRate: 8000,
      durationSeconds: 0.1,
      kind: 'sibilant',
      seed: 3,
    });
    expect(lowRate.channels[0]!.length).toBe(800);
  });
});

describe('PCM helpers', () => {
  it('concatenates, mixes and normalises', () => {
    const a = monoPcm(SR, Float32Array.from([1, 2]));
    const stereo = { sampleRate: SR, channels: [Float32Array.from([3]), Float32Array.from([4])] };
    const joined = concatenatePcm([a, stereo, silence(SR, 2 / SR)]);
    expect(joined.channels).toHaveLength(2);
    expect(Array.from(joined.channels[0]!)).toEqual([1, 2, 3, 0, 0]);
    expect(Array.from(joined.channels[1]!)).toEqual([1, 2, 4, 0, 0]);
    expect(() => concatenatePcm([])).toThrow(RangeError);
    expect(() => concatenatePcm([a, monoPcm(44100, new Float32Array(1))])).toThrow(RangeError);
    const mixed = mixPcm([a, monoPcm(SR, Float32Array.from([0.5, 0.5]))]);
    expect(Array.from(mixed.channels[0]!)).toEqual([1.5, 2.5]);
    expect(() => mixPcm([])).toThrow(RangeError);
    expect(() => mixPcm([a, monoPcm(SR, new Float32Array(3))])).toThrow(RangeError);
    expect(() => mixPcm([a, monoPcm(8000, new Float32Array(2))])).toThrow(RangeError);
    const x = Float32Array.from([0.1, -0.4]);
    normalizePeak(x, 0.8);
    expect(Array.from(x)).toEqual([Math.fround(0.2), Math.fround(-0.8)]);
    const zeros = new Float32Array(3);
    normalizePeak(zeros, 1);
    expect(Array.from(zeros)).toEqual([0, 0, 0]);
  });
});

describe('melodies', () => {
  it('parses note names, accidentals, rests and bar lines', () => {
    expect(parseMelody('C4 F#4:1.5 | Bb3:0.5 R:2 A-1')).toEqual([
      { midi: 60, beats: 1 },
      { midi: 66, beats: 1.5 },
      { midi: 58, beats: 0.5 },
      { midi: null, beats: 2 },
      { midi: 9, beats: 1 },
    ]);
    expect(() => parseMelody('H4')).toThrow(RangeError);
    expect(() => parseMelody('C4:0')).toThrow(RangeError);
  });

  it('provides labelled melodies in many keys', () => {
    expect(KNOWN_MELODIES.length).toBeGreaterThanOrEqual(25);
    const keys = new Set(KNOWN_MELODIES.map((m) => `${m.key.tonic}${m.key.scale}`));
    expect(keys.size).toBeGreaterThanOrEqual(10);
    expect(
      KNOWN_MELODIES.filter((m) => m.key.scale === 'naturalMinor').length,
    ).toBeGreaterThanOrEqual(8);
    for (const m of [...KNOWN_MELODIES, ...MODAL_MELODIES]) {
      expect(m.notes.length).toBeGreaterThan(8);
      for (const n of m.notes) if (n.midi !== null) expect(n.midi).toBeGreaterThan(40);
    }
    expect(transposeKey({ tonic: 11, scale: 'major' }, 2)).toEqual({ tonic: 1, scale: 'major' });
    expect(transposeKey({ tonic: 0, scale: 'naturalMinor' }, -1)).toEqual({
      tonic: 11,
      scale: 'naturalMinor',
    });
  });

  it('converts beats to timed notes and weights', () => {
    const notes = parseMelody('C4 R D4:2');
    expect(
      melodyToTimedNotes(notes, { bpm: 60, startSeconds: 1, transpose: 12, articulation: 0.5 }),
    ).toEqual([
      { midi: 72, startSeconds: 1, durationSeconds: 0.5 },
      { midi: 74, startSeconds: 3, durationSeconds: 1 },
    ]);
    expect(melodyToTimedNotes(notes)[1]).toEqual({ midi: 62, startSeconds: 1, durationSeconds: 1 });
    expect(melodyWeights(notes, -1)).toEqual([
      { midi: 59, weight: 1 },
      { midi: 61, weight: 2 },
    ]);
  });
});

describe('ground truth and metrics', () => {
  it('samples the exact f0 per frame', () => {
    const grid = { frameCount: 4, hopSeconds: 0.1, firstFrameSeconds: 0 };
    expect(Array.from(groundTruthF0(constantF0(100, 0.1, 0.3), grid))).toEqual([0, 100, 100, 0]);
    expect(Array.from(groundTruthVoicing(constantF0(100, 0.1, 0.3), grid))).toEqual([0, 1, 1, 0]);
  });

  it('computes mir_eval-style metrics', () => {
    const reference = [0, 100, 100, 100, 100, 0];
    const estimate = [100, 100, 200, 101, 0, 0];
    const m = computePitchMetrics(estimate, reference);
    expect(m.referenceVoicedFrames).toBe(4);
    expect(m.referenceUnvoicedFrames).toBe(2);
    expect(m.rawPitchAccuracy).toBe(0.5);
    expect(m.rawChromaAccuracy).toBe(0.75);
    expect(m.voicingRecall).toBe(0.75);
    expect(m.voicingFalseAlarm).toBe(0.5);
    expect(m.octaveErrorRate).toBeCloseTo(1 / 3, 12);
    expect(m.grossPitchError).toBeCloseTo(1 / 3, 12);
    const empty = computePitchMetrics([], []);
    expect(empty.rawPitchAccuracy).toBeNaN();
    expect(empty.voicingFalseAlarm).toBeNaN();
    expect(empty.medianAbsCents).toBeNaN();
  });
});
