import { asVocalNoteId, type VocalNoteSegment } from '@studio/domain';
import { describe, expect, it, vi } from 'vitest';
import {
  analyzeNoteExpression,
  analyzeVocal,
  classifyNonPitched,
  DEFAULT_VOCAL_ANALYSIS_PARAMS,
  mergeSegments,
  peltChangePoints,
  segmentNotes,
  splitSegment,
  trackPitch,
  type PitchTrack,
} from '../src/index';
import * as fx from '../../test-fixtures/src/index';

// Fixture synthesis + analysis is slow under coverage instrumentation.
vi.setConfig({ testTimeout: 120_000 });

const SR = 48000;
const params = DEFAULT_VOCAL_ANALYSIS_PARAMS;

function trackOf(curve: fx.F0Curve, duration: number, vowel: fx.VowelId = 'a'): PitchTrack {
  const pcm = fx.synthesizeVowel({
    sampleRate: SR,
    durationSeconds: duration,
    f0: curve,
    vowel,
    seed: 21,
  });
  return trackPitch(pcm.channels[0]!, SR, params);
}

/** Reference notes with legato repeats of the same pitch merged (they are unsplittable by pitch). */
function distinctNotes(notes: readonly fx.TimedNote[]): fx.TimedNote[] {
  const out: fx.TimedNote[] = [];
  for (const n of notes) {
    const last = out[out.length - 1];
    if (
      last !== undefined &&
      last.midi === n.midi &&
      Math.abs(last.startSeconds + last.durationSeconds - n.startSeconds) < 1e-3
    ) {
      out[out.length - 1] = { ...last, durationSeconds: last.durationSeconds + n.durationSeconds };
    } else out.push(n);
  }
  return out;
}

/** Note-level F-measure: onset within 50 ms and pitch within 50 cents (mir_eval style). */
function noteScores(segments: readonly VocalNoteSegment[], reference: readonly fx.TimedNote[]) {
  const used = new Set<number>();
  let matched = 0;
  for (const note of reference) {
    const index = segments.findIndex(
      (s, i) =>
        !used.has(i) &&
        Math.abs(s.startSeconds - note.startSeconds) <= 0.05 &&
        Math.abs(s.detectedMidi - note.midi) <= 0.5,
    );
    if (index >= 0) {
      used.add(index);
      matched++;
    }
  }
  const precision = segments.length > 0 ? matched / segments.length : 0;
  const recall = reference.length > 0 ? matched / reference.length : 0;
  return {
    precision,
    recall,
    f: precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0,
  };
}

describe('peltChangePoints', () => {
  /** Exhaustive optimal partitioning for comparison. */
  function bruteForce(
    values: Float64Array,
    sigma: number,
    penalty: number,
    minLength: number,
  ): number[] {
    const n = values.length;
    const cost = (a: number, b: number): number => {
      let sum = 0;
      for (let i = a; i < b; i++) sum += values[i]!;
      const mean = sum / (b - a);
      let sq = 0;
      for (let i = a; i < b; i++) sq += (values[i]! - mean) ** 2;
      return sq / (sigma * sigma);
    };
    const best = new Array<number>(n + 1).fill(Infinity);
    const last = new Array<number>(n + 1).fill(0);
    best[0] = -penalty;
    for (let t = minLength; t <= n; t++) {
      for (let tau = 0; tau <= t - minLength; tau++) {
        if (best[tau] === Infinity) continue;
        const value = best[tau]! + cost(tau, t) + penalty;
        if (value < best[t]!) {
          best[t] = value;
          last[t] = tau;
        }
      }
    }
    const points: number[] = [];
    let t = n;
    while (t > 0) {
      if (last[t]! > 0) points.push(last[t]!);
      t = last[t]!;
    }
    return points.reverse();
  }

  it('finds the optimal partition (equals exhaustive search)', () => {
    const random = fx.createSeededRandom(17);
    for (let trial = 0; trial < 25; trial++) {
      const n = 40 + random.int(80);
      const values = new Float64Array(n);
      let level = 0;
      for (let i = 0; i < n; i++) {
        if (random() < 0.06) level += (random() - 0.5) * 400;
        values[i] = level + random.gaussian() * 30;
      }
      const minLength = 2 + random.int(8);
      expect(peltChangePoints(values, 40, 10, minLength)).toEqual(
        bruteForce(values, 40, 10, minLength),
      );
    }
  });

  it('returns no change for short or constant input', () => {
    expect(peltChangePoints(new Float64Array(5), 40, 10, 4)).toEqual([]);
    expect(peltChangePoints(new Float64Array(100).fill(6000), 40, 10, 12)).toEqual([]);
  });
});

describe('segmentNotes', () => {
  const twinkle = fx.KNOWN_MELODIES[0]!.notes.slice(0, 21);
  const cases: [string, fx.TimedNote[], fx.MelodyF0Options][] = [
    [
      'legato 100 bpm',
      fx.melodyToTimedNotes(twinkle, { bpm: 100, startSeconds: 0.2, transpose: -12 }),
      {},
    ],
    [
      'staccato 120 bpm',
      fx.melodyToTimedNotes(twinkle, {
        bpm: 120,
        startSeconds: 0.2,
        transpose: -12,
        articulation: 0.7,
      }),
      {},
    ],
    [
      'fast 200 bpm (150 ms notes)',
      fx.melodyToTimedNotes(twinkle, { bpm: 200, startSeconds: 0.2, transpose: -12 }),
      {},
    ],
    [
      'vibrato ±60c 5.5 Hz',
      fx.melodyToTimedNotes(twinkle, { bpm: 100, startSeconds: 0.2, transpose: -12 }),
      { vibrato: { rateHz: 5.5, depthCents: 60 } },
    ],
    [
      '80 ms portamento',
      fx.melodyToTimedNotes(twinkle, { bpm: 100, startSeconds: 0.2, transpose: -12 }),
      { glideSeconds: 0.08 },
    ],
  ];
  for (const [name, notes, options] of cases) {
    it(`segments a melody: ${name}`, () => {
      const end =
        notes[notes.length - 1]!.startSeconds + notes[notes.length - 1]!.durationSeconds + 0.3;
      const track = trackOf(fx.melodyF0(notes, options), end);
      const segments = segmentNotes(track, params);
      const reference = distinctNotes(notes);
      const scores = noteScores(segments, reference);
      console.log(
        `${name.padEnd(28)} ref ${reference.length} seg ${segments.length} P ${(100 * scores.precision).toFixed(1)} R ${(100 * scores.recall).toFixed(1)} F ${(100 * scores.f).toFixed(1)}`,
      );
      expect(scores.f).toBeGreaterThanOrEqual(0.95);
    });
  }

  it('keeps one note for vibrato, drift and detuned sustained notes and measures centres', () => {
    const vibrato = segmentNotes(
      trackOf(
        fx.vibratoF0({
          baseHz: 220,
          rateHz: 5.5,
          depthCents: 70,
          startSeconds: 0.2,
          endSeconds: 2.2,
        }),
        2.5,
      ),
      params,
    );
    expect(vibrato).toHaveLength(1);
    expect(vibrato[0]!.detectedMidi).toBeCloseTo(fx.hzToMidi(220), 1);
    const drift = segmentNotes(
      trackOf(
        fx.vibratoF0({
          baseHz: 220,
          rateHz: 6,
          depthCents: 40,
          startSeconds: 0.2,
          endSeconds: 2.2,
          driftCentsPerSecond: -30,
        }),
        2.5,
      ),
      params,
    );
    expect(drift).toHaveLength(1);
    expect(drift[0]!.driftCents).toBeLessThan(-40);
    const detuned = segmentNotes(trackOf(fx.constantF0(fx.midiToHz(57.27), 0.2, 1.2), 1.4), params);
    expect(detuned).toHaveLength(1);
    expect(Math.abs(detuned[0]!.detectedMidi - 57.27) * 100).toBeLessThan(2);
  });

  it('treats a portamento between two notes as a transition', () => {
    const track = trackOf(
      fx.glideF0({
        fromHz: 150,
        toHz: 300,
        glideStartSeconds: 0.8,
        glideSeconds: 0.25,
        holdStartSeconds: 0.2,
        endSeconds: 1.8,
      }),
      2,
    );
    const segments = segmentNotes(track, params);
    expect(segments).toHaveLength(2);
    expect(segments[0]!.endSeconds).toBeLessThanOrEqual(0.9);
    expect(segments[1]!.startSeconds).toBeGreaterThanOrEqual(0.95);
    expect(segments[0]!.detectedMidi).toBeCloseTo(fx.hzToMidi(150), 1);
    expect(segments[1]!.detectedMidi).toBeCloseTo(fx.hzToMidi(300), 1);
  });

  it('keeps a phrase that is only a glide as one note', () => {
    const track = trackOf(
      fx.glideF0({
        fromHz: 200,
        toHz: 260,
        glideStartSeconds: 0.2,
        glideSeconds: 0.25,
        holdStartSeconds: 0.2,
        endSeconds: 0.45,
      }),
      0.6,
    );
    const segments = segmentNotes(track, params);
    expect(segments).toHaveLength(1);
  });

  it('produces deterministic ids, sorted non-overlapping segments and valid fields', () => {
    const notes = fx.melodyToTimedNotes(twinkle.slice(0, 8), {
      bpm: 120,
      startSeconds: 0.2,
      articulation: 0.8,
    });
    const track = trackOf(fx.melodyF0(notes), 4.5);
    const a = segmentNotes(track, params);
    const b = segmentNotes(track, params);
    expect(a).toEqual(b);
    a.forEach((s, i) => {
      expect(s.id).toMatch(new RegExp(`^vn_${i}_\\d+$`));
      expect(s.endSeconds).toBeGreaterThan(s.startSeconds);
      expect(s.confidence).toBeGreaterThan(0.5);
      expect(s.confidence).toBeLessThanOrEqual(1);
      if (i > 0) expect(s.startSeconds).toBeGreaterThanOrEqual(a[i - 1]!.endSeconds);
    });
  });

  it('drops notes shorter than minNoteSeconds', () => {
    const track = trackOf(fx.constantF0(220, 0.2, 0.24), 0.5);
    expect(segmentNotes(track, params)).toHaveLength(0);
    expect(segmentNotes(track, { ...params, minNoteSeconds: 0.02 }).length).toBeLessThanOrEqual(1);
  });
});

describe('analyzeNoteExpression', () => {
  it('measures vibrato rate and depth', () => {
    for (const [rate, depth] of [
      [5.5, 60],
      [6.5, 30],
      [4.5, 100],
    ] as const) {
      const track = trackOf(
        fx.vibratoF0({
          baseHz: 196,
          rateHz: rate,
          depthCents: depth,
          startSeconds: 0.1,
          endSeconds: 2.1,
        }),
        2.2,
      );
      const e = analyzeNoteExpression(track, { startSeconds: 0.1, endSeconds: 2.1 });
      console.log(
        `vibrato ${rate} Hz ±${depth}c → ${e.vibratoRateHz.toFixed(2)} Hz ±${e.vibratoDepthCents.toFixed(1)}c (EV ${e.vibratoExplainedVariance.toFixed(2)})`,
      );
      expect(e.vibratoRateHz).toBeCloseTo(rate, 0);
      expect(Math.abs(e.vibratoRateHz - rate)).toBeLessThanOrEqual(0.15);
      // YIN's 38 ms span attenuates the measured extent slightly (≈ 5–15 %).
      expect(e.vibratoDepthCents).toBeGreaterThan(depth * 0.8);
      expect(e.vibratoDepthCents).toBeLessThan(depth * 1.1);
      // Median over a non-integer number of cycles: within 10 cents.
      expect(Math.abs(e.centreMidi - fx.hzToMidi(196))).toBeLessThan(0.1);
    }
  });

  it('measures drift and reports no vibrato on steady or short notes', () => {
    const track = trackOf(
      fx.vibratoF0({
        baseHz: 220,
        rateHz: 5,
        depthCents: 0,
        startSeconds: 0.1,
        endSeconds: 1.1,
        driftCentsPerSecond: 80,
      }),
      1.2,
    );
    const e = analyzeNoteExpression(track, { startSeconds: 0.1, endSeconds: 1.1 });
    expect(e.vibratoRateHz).toBe(0);
    expect(e.vibratoDepthCents).toBe(0);
    expect(e.driftCentsPerSecond).toBeCloseTo(80, -1);
    expect(e.driftCents).toBeCloseTo(80, -1);
    expect(e.residualCents).toBeLessThan(5);
    const short = analyzeNoteExpression(trackOf(fx.constantF0(300, 0.1, 0.25), 0.4), {
      startSeconds: 0.1,
      endSeconds: 0.25,
    });
    expect(short.vibratoRateHz).toBe(0);
    expect(short.voicedFrames).toBeGreaterThan(20);
    const empty = analyzeNoteExpression(track, { startSeconds: 1.15, endSeconds: 1.2 });
    expect(empty.centreMidi).toBeNaN();
    expect(empty.voicedFrames).toBe(0);
  });
});

describe('classifyNonPitched', () => {
  it('labels silence, sibilant, breath and plosive regions', () => {
    const pcm = fx.concatenatePcm([
      fx.silence(SR, 0.2),
      fx.synthesizeConsonantBurst({
        sampleRate: SR,
        durationSeconds: 0.15,
        kind: 'sibilant',
        seed: 1,
      }),
      fx.synthesizeVowel({ sampleRate: SR, durationSeconds: 0.6, f0: fx.constantF0(196), seed: 2 }),
      fx.silence(SR, 0.1),
      fx.synthesizeConsonantBurst({
        sampleRate: SR,
        durationSeconds: 0.3,
        kind: 'breath',
        seed: 3,
      }),
      fx.silence(SR, 0.1),
      fx.synthesizeConsonantBurst({
        sampleRate: SR,
        durationSeconds: 0.03,
        kind: 'plosive',
        seed: 4,
      }),
      fx.synthesizeVowel({
        sampleRate: SR,
        durationSeconds: 0.6,
        f0: fx.constantF0(220),
        vowel: 'e',
        seed: 5,
      }),
      fx.silence(SR, 0.2),
    ]);
    const mono = pcm.channels[0]!;
    const track = trackPitch(mono, SR, params);
    const regions = classifyNonPitched(mono, SR, track, params);
    const kindAt = (t: number): string =>
      regions.find((r) => t >= r.startSeconds && t < r.endSeconds)?.kind ?? 'pitched';
    expect(kindAt(0.1)).toBe('silence');
    expect(kindAt(0.27)).toBe('sibilant');
    expect(kindAt(0.6)).toBe('pitched');
    expect(kindAt(1.0)).toBe('silence');
    expect(kindAt(1.2)).toBe('breath');
    expect(kindAt(1.39)).toBe('silence');
    expect(kindAt(1.46)).toBe('unvoiced');
    expect(kindAt(1.8)).toBe('pitched');
    expect(kindAt(2.2)).toBe('silence');
    // Regions are sorted, non-overlapping and within the signal.
    regions.forEach((r, i) => {
      expect(r.endSeconds).toBeGreaterThan(r.startSeconds);
      expect(r.startSeconds).toBeGreaterThanOrEqual(i > 0 ? regions[i - 1]!.endSeconds - 1e-9 : 0);
      expect(r.endSeconds).toBeLessThanOrEqual(mono.length / SR + 1e-9);
    });
  });
});

describe('splitSegment / mergeSegments', () => {
  const notes = [
    { midi: 57, startSeconds: 0.2, durationSeconds: 0.5 },
    { midi: 60, startSeconds: 0.7, durationSeconds: 0.5 },
  ];
  const track = trackOf(fx.melodyF0(notes), 1.4);
  const ids = [asVocalNoteId('vn_a'), asVocalNoteId('vn_b')] as const;

  it('re-estimates both halves of a split', () => {
    const whole = mergeSegments(
      track,
      {
        id: ids[0],
        startSeconds: 0.2,
        endSeconds: 0.7,
        detectedMidi: 57,
        confidence: 1,
        vibratoDepthCents: 0,
        vibratoRateHz: 0,
        driftCents: 0,
      },
      {
        id: ids[1],
        startSeconds: 0.7,
        endSeconds: 1.2,
        detectedMidi: 60,
        confidence: 1,
        vibratoDepthCents: 0,
        vibratoRateHz: 0,
        driftCents: 0,
      },
      asVocalNoteId('vn_m'),
    );
    expect(whole.id).toBe('vn_m');
    expect(whole.startSeconds).toBe(0.2);
    expect(whole.endSeconds).toBe(1.2);
    const [left, right] = splitSegment(track, whole, 0.7, ids);
    expect(left.id).toBe('vn_a');
    expect(right.id).toBe('vn_b');
    expect(left.endSeconds).toBe(0.7);
    expect(right.startSeconds).toBe(0.7);
    expect(left.detectedMidi).toBeCloseTo(57, 1);
    expect(right.detectedMidi).toBeCloseTo(60, 1);
    expect(left.confidence).toBeGreaterThan(0.8);
    // Merge order does not matter.
    expect(mergeSegments(track, right, left, asVocalNoteId('vn_m'))).toEqual(
      mergeSegments(track, left, right, asVocalNoteId('vn_m')),
    );
  });

  it('validates split arguments and handles unvoiced halves', () => {
    const segment: VocalNoteSegment = {
      id: ids[0],
      startSeconds: 0.05,
      endSeconds: 0.5,
      detectedMidi: 57,
      confidence: 1,
      vibratoDepthCents: 0,
      vibratoRateHz: 0,
      driftCents: 0,
    };
    expect(() => splitSegment(track, segment, 0.05, ids)).toThrow(RangeError);
    expect(() => splitSegment(track, segment, 0.6, ids)).toThrow(RangeError);
    expect(() => splitSegment(track, segment, 0.3, [ids[0], ids[0]])).toThrow(RangeError);
    const [silent, voiced] = splitSegment(track, segment, 0.15, ids);
    expect(silent.confidence).toBe(0);
    expect(silent.detectedMidi).toBe(57);
    expect(voiced.confidence).toBeGreaterThan(0.5);
  });
});

describe('analyzeVocal note pipeline', () => {
  it('produces segments with expression and key candidates', () => {
    const melody = fx.KNOWN_MELODIES.find((m) => m.name === 'Korobeiniki')!;
    const notes = fx.melodyToTimedNotes(melody.notes, {
      bpm: 120,
      startSeconds: 0.2,
      transpose: -12,
      articulation: 0.9,
    });
    const end =
      notes[notes.length - 1]!.startSeconds + notes[notes.length - 1]!.durationSeconds + 0.3;
    const pcm = fx.synthesizeVowel({
      sampleRate: SR,
      durationSeconds: end,
      f0: fx.melodyF0(notes, { vibrato: { rateHz: 5.5, depthCents: 35 } }),
      seed: 4,
    });
    const analysis = analyzeVocal(pcm);
    const scores = noteScores(analysis.segments, notes);
    expect(scores.f).toBeGreaterThanOrEqual(0.95);
    expect(analysis.keyCandidates[0]!.key).toEqual({ tonic: 9, scale: 'naturalMinor' });
    expect(analysis.segments.some((s) => s.vibratoRateHz > 0)).toBe(true);
  });
});
