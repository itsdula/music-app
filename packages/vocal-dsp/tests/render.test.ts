import { describe, expect, it, vi } from 'vitest';
import {
  analyzeVocal,
  detectPitchMarks,
  DEFAULT_VOCAL_ANALYSIS_PARAMS,
  renderPitchCorrection,
  trackPitch,
  VocalJobCancelledError,
  type VocalAnalysis,
} from '../src/index';
import * as fx from '../../test-fixtures/src/index';
import { bytesEqual, centsErrors, editDoc, maxDifferenceDb, medianOf, rmsDb } from './helpers/docs';
import { lpcEnvelopePeaks, strongestPeakIn } from './helpers/spectral';

// Fixture synthesis + analysis is slow under coverage instrumentation.
vi.setConfig({ testTimeout: 120_000 });

const SR = 48000;
const SIBILANT_SECONDS = 0.2;
const VOWEL_SECONDS = 1.4;

/** Sibilant → steady vowel → breath, the "untouched regions" fixture. */
function vowelFixture(f0: number, vowel: fx.VowelId) {
  const pcm = fx.concatenatePcm([
    fx.synthesizeConsonantBurst({
      sampleRate: SR,
      durationSeconds: SIBILANT_SECONDS,
      kind: 'sibilant',
      seed: 3,
    }),
    fx.synthesizeVowel({
      sampleRate: SR,
      durationSeconds: VOWEL_SECONDS,
      f0: fx.constantF0(f0),
      vowel,
      seed: 4,
    }),
    fx.synthesizeConsonantBurst({ sampleRate: SR, durationSeconds: 0.2, kind: 'breath', seed: 5 }),
  ]);
  const analysis = analyzeVocal(pcm);
  return { pcm, analysis };
}

function shiftDoc(analysis: VocalAnalysis, semitones: number) {
  const note = analysis.segments[0]!;
  return editDoc(analysis, { edits: { [note.id]: { targetMidi: note.detectedMidi + semitones } } });
}

function naiveResample(x: Float32Array, ratio: number): Float32Array {
  const out = new Float32Array(x.length);
  for (let i = 0; i < x.length; i++) {
    const p = i * ratio;
    const j = Math.floor(p);
    const t = p - j;
    out[i] = j + 1 < x.length ? x[j]! * (1 - t) + x[j + 1]! * t : 0;
  }
  return out;
}

describe('renderPitchCorrection (TD-PSOLA) accuracy', () => {
  const cases: [number, number, fx.VowelId][] = [
    [2, 220, 'a'],
    [-3, 220, 'a'],
    [2, 131, 'e'],
    [-3, 175, 'o'],
  ];
  for (const [shift, f0, vowel] of cases) {
    for (const quality of ['preview', 'final'] as const) {
      it(`shifts a ${f0} Hz /${vowel}/ by ${shift > 0 ? '+' : ''}${shift} st (${quality})`, () => {
        const { pcm, analysis } = vowelFixture(f0, vowel);
        const out = renderPitchCorrection(pcm, analysis, shiftDoc(analysis, shift), quality);
        // Duration and layout preserved exactly.
        expect(out.sampleRate).toBe(SR);
        expect(out.channels).toHaveLength(1);
        expect(out.channels[0]!.length).toBe(pcm.channels[0]!.length);
        // Re-analysis: median error vs target on the steady part.
        const reanalysis = trackPitch(out.channels[0]!, SR, DEFAULT_VOCAL_ANALYSIS_PARAMS);
        const errors = centsErrors(
          reanalysis.f0Hz,
          reanalysis.hopSeconds,
          f0 * 2 ** (shift / 12),
          0.45,
          1.45,
        );
        const x = pcm.channels[0]!;
        const y = out.channels[0]!;
        const sibilantDb = maxDifferenceDb(x, y, 0, Math.round((SIBILANT_SECONDS - 0.02) * SR));
        const breathDb = maxDifferenceDb(
          x,
          y,
          Math.round((SIBILANT_SECONDS + VOWEL_SECONDS + 0.03) * SR),
        );
        const levelDb = rmsDb(y, 0.5 * SR, 1.3 * SR) - rmsDb(x, 0.5 * SR, 1.3 * SR);
        console.log(
          `${shift > 0 ? '+' : ''}${shift} st ${f0} Hz /${vowel}/ ${quality.padEnd(7)} median ${medianOf(errors).toFixed(2)} c ` +
            `p95 ${errors[Math.floor(errors.length * 0.95)]!.toFixed(2)} c, sibilant diff ${sibilantDb} dB, breath diff ${breathDb} dB, level ${levelDb.toFixed(2)} dB`,
        );
        expect(errors.length).toBeGreaterThan(150);
        expect(medianOf(errors)).toBeLessThanOrEqual(10);
        expect(sibilantDb).toBeLessThanOrEqual(-60);
        expect(breathDb).toBeLessThanOrEqual(-60);
        expect(Math.abs(levelDb)).toBeLessThanOrEqual(0.5);
      });
    }
  }

  it('handles octave shifts at the ratio limits', () => {
    for (const [shift, f0] of [
      [12, 150],
      [-12, 300],
    ] as const) {
      const { pcm, analysis } = vowelFixture(f0, 'a');
      const out = renderPitchCorrection(pcm, analysis, shiftDoc(analysis, shift), 'final');
      const reanalysis = trackPitch(out.channels[0]!, SR, DEFAULT_VOCAL_ANALYSIS_PARAMS);
      const errors = centsErrors(
        reanalysis.f0Hz,
        reanalysis.hopSeconds,
        f0 * 2 ** (shift / 12),
        0.45,
        1.45,
      );
      expect(medianOf(errors)).toBeLessThanOrEqual(10);
      expect(out.channels[0]!.every((v) => Number.isFinite(v))).toBe(true);
    }
  });
});

describe('formant preservation evidence', () => {
  it('keeps spectral-envelope peaks within 5 % (naive resampling moves them > 10 %)', () => {
    const pcm = fx.synthesizeVowel({
      sampleRate: SR,
      durationSeconds: 1.5,
      f0: fx.constantF0(120, 0.1, 1.4),
      vowel: 'e',
      seed: 2,
    });
    const analysis = analyzeVocal(pcm);
    const original = lpcEnvelopePeaks(pcm.channels[0]!, SR, 0.5, 0.5);
    const bands: [number, number][] = [
      [300, 900],
      [1400, 2600],
    ];
    for (const shift of [2, -3]) {
      const ratio = 2 ** (shift / 12);
      const out = renderPitchCorrection(pcm, analysis, shiftDoc(analysis, shift), 'final');
      const psola = lpcEnvelopePeaks(out.channels[0]!, SR, 0.5, 0.5);
      const naive = lpcEnvelopePeaks(
        naiveResample(pcm.channels[0]!, ratio),
        SR,
        0.5 / ratio,
        0.5 / ratio,
      );
      for (const [lo, hi] of bands) {
        const f = strongestPeakIn(original, lo, hi);
        const p = strongestPeakIn(psola, lo, hi);
        const n = strongestPeakIn(naive, lo * 0.75, hi * 1.3);
        const psolaMove = Math.abs(p - f) / f;
        const naiveMove = Math.abs(n - f) / f;
        console.log(
          `shift ${shift} st, envelope peak ${f.toFixed(0)} Hz: TD-PSOLA ${p.toFixed(0)} Hz (${(100 * psolaMove).toFixed(1)} %), naive ${n.toFixed(0)} Hz (${(100 * naiveMove).toFixed(1)} %)`,
        );
        expect(psolaMove).toBeLessThan(0.05);
        expect(naiveMove).toBeGreaterThan(0.1);
      }
    }
  });

  it('shifts formants on request and follows the pitch without preservation', () => {
    const pcm = fx.synthesizeVowel({
      sampleRate: SR,
      durationSeconds: 1.5,
      f0: fx.constantF0(120, 0.1, 1.4),
      vowel: 'e',
      seed: 2,
    });
    const analysis = analyzeVocal(pcm);
    const f2 = strongestPeakIn(lpcEnvelopePeaks(pcm.channels[0]!, SR, 0.5, 0.5), 1400, 2600);
    // +3 st formant shift, no pitch change.
    const shifted = renderPitchCorrection(
      pcm,
      analysis,
      editDoc(analysis, { correction: { formantShiftSemitones: 3 } }),
      'final',
    );
    const f2Shifted = strongestPeakIn(
      lpcEnvelopePeaks(shifted.channels[0]!, SR, 0.5, 0.5),
      1400,
      3000,
    );
    const pitch = trackPitch(shifted.channels[0]!, SR, DEFAULT_VOCAL_ANALYSIS_PARAMS);
    const errors = centsErrors(pitch.f0Hz, pitch.hopSeconds, 120, 0.45, 1.3);
    console.log(
      `formant shift +3 st: F2 ${f2.toFixed(0)} → ${f2Shifted.toFixed(0)} Hz (${((100 * (f2Shifted - f2)) / f2).toFixed(1)} %), pitch median error ${medianOf(errors).toFixed(2)} c`,
    );
    expect(f2Shifted / f2).toBeGreaterThan(1.12);
    expect(f2Shifted / f2).toBeLessThan(1.27);
    expect(medianOf(errors)).toBeLessThanOrEqual(10);
    // Preservation off: a +3 st pitch shift drags the envelope along (like resampling).
    const note = analysis.segments[0]!;
    const chipmunk = renderPitchCorrection(
      pcm,
      analysis,
      editDoc(analysis, {
        edits: { [note.id]: { targetMidi: note.detectedMidi + 3 } },
        correction: { formantPreservation: false },
      }),
      'final',
    );
    const f2Chipmunk = strongestPeakIn(
      lpcEnvelopePeaks(chipmunk.channels[0]!, SR, 0.5, 0.5),
      1400,
      3000,
    );
    expect(f2Chipmunk / f2).toBeGreaterThan(1.1);
  });
});

describe('renderPitchCorrection behaviour', () => {
  const { pcm, analysis } = vowelFixture(196, 'a');

  it('returns an identical copy when nothing is edited or the document is disabled', () => {
    for (const doc of [
      editDoc(analysis),
      shiftDoc(analysis, 0),
      { ...shiftDoc(analysis, 2), enabled: false },
    ]) {
      const out = renderPitchCorrection(pcm, analysis, doc, 'final');
      expect(out.channels[0]).not.toBe(pcm.channels[0]);
      expect(bytesEqual(out.channels[0]!, pcm.channels[0]!)).toBe(true);
    }
  });

  it('is deterministic (bit-identical renders)', () => {
    const doc = editDoc(analysis, {
      correction: { amount: 1, key: { tonic: 7, scale: 'major' } },
      edits: { [analysis.segments[0]!.id]: { modulationScale: 0.5 } },
    });
    for (const quality of ['preview', 'final'] as const) {
      const a = renderPitchCorrection(pcm, analysis, doc, quality);
      const b = renderPitchCorrection(pcm, analysis, doc, quality);
      expect(bytesEqual(a.channels[0]!, b.channels[0]!)).toBe(true);
    }
  });

  it('processes every channel with shared pitch marks', () => {
    const left = pcm.channels[0]!;
    const right = Float32Array.from(left, (v) => -0.5 * v);
    const stereo = { sampleRate: SR, channels: [left, right] };
    const out = renderPitchCorrection(stereo, analysis, shiftDoc(analysis, 2), 'final');
    expect(out.channels).toHaveLength(2);
    const mono = renderPitchCorrection(pcm, analysis, shiftDoc(analysis, 2), 'final').channels[0]!;
    // Same grains in both channels: the right channel is exactly −0.5 × the left.
    let maxError = 0;
    for (let i = 0; i < left.length; i++) {
      maxError = Math.max(maxError, Math.abs(out.channels[1]![i]! + 0.5 * out.channels[0]![i]!));
    }
    expect(maxError).toBeLessThan(1e-6);
    // Stereo analysis downmix (0.25·x) is scaled, the processing itself is unchanged.
    expect(maxDifferenceDb(out.channels[0]!, mono)).toBeLessThan(-100);
  });

  it('leaves bypassed notes bit-identical', () => {
    const notes = [
      { midi: 55.3, startSeconds: 0.1, durationSeconds: 0.5 },
      { midi: 58.2, startSeconds: 0.8, durationSeconds: 0.5 },
    ];
    const melody = fx.synthesizeVowel({
      sampleRate: SR,
      durationSeconds: 1.5,
      f0: fx.melodyF0(notes),
      seed: 6,
    });
    const a = analyzeVocal(melody);
    expect(a.segments).toHaveLength(2);
    const [first, second] = a.segments;
    const doc = editDoc(a, {
      correction: { amount: 1 },
      edits: { [second!.id]: { bypass: true } },
    });
    const out = renderPitchCorrection(melody, a, doc, 'final');
    const from = Math.round(second!.startSeconds * SR);
    expect(maxDifferenceDb(melody.channels[0]!, out.channels[0]!, from)).toBe(
      Number.NEGATIVE_INFINITY,
    );
    const firstMid = Math.round(((first!.startSeconds + first!.endSeconds) / 2) * SR);
    expect(
      maxDifferenceDb(melody.channels[0]!, out.channels[0]!, firstMid - 2000, firstMid + 2000),
    ).toBeGreaterThan(-20);
  });

  it('corrects a detuned melody to the nearest semitones (automatic mode)', () => {
    const detune = [35, -28, 22, -40, 18, -24];
    const notes = [57, 59, 60, 62, 64, 62].map((midi, i) => ({
      midi,
      startSeconds: 0.15 + i * 0.45,
      durationSeconds: 0.38,
    }));
    const melody = fx.synthesizeVowel({
      sampleRate: SR,
      durationSeconds: 3,
      f0: fx.melodyF0(notes, { detuneCents: detune, vibrato: { rateHz: 5.5, depthCents: 25 } }),
      seed: 8,
    });
    const before = analyzeVocal(melody);
    expect(before.segments).toHaveLength(6);
    const out = renderPitchCorrection(
      melody,
      before,
      editDoc(before, { correction: { amount: 1, retuneSpeedMs: 20 } }),
      'final',
    );
    const after = analyzeVocal(out);
    expect(after.segments).toHaveLength(6);
    after.segments.forEach((s, i) => {
      const residual = 100 * (s.detectedMidi - notes[i]!.midi);
      console.log(
        `note ${i}: detected ${(100 * (before.segments[i]!.detectedMidi - notes[i]!.midi)).toFixed(1)} c → corrected ${residual.toFixed(1)} c`,
      );
      expect(Math.abs(residual)).toBeLessThanOrEqual(10);
    });
  });

  it('reports progress, supports cancellation and validates input', () => {
    const progress: number[] = [];
    renderPitchCorrection(pcm, analysis, shiftDoc(analysis, 1), 'preview', {
      onProgress: (f) => progress.push(f),
    });
    expect(progress[progress.length - 1]).toBe(1);
    expect(progress.length).toBeGreaterThan(2);
    expect(() =>
      renderPitchCorrection(pcm, analysis, shiftDoc(analysis, 1), 'preview', {
        shouldCancel: () => progress.length > 0,
      }),
    ).toThrow(VocalJobCancelledError);
    expect(() =>
      renderPitchCorrection(
        { sampleRate: SR, channels: [] },
        analysis,
        shiftDoc(analysis, 1),
        'final',
      ),
    ).toThrow(RangeError);
  });
});

describe('detectPitchMarks', () => {
  it('places one mark per period inside voiced audio only', () => {
    const f0 = 210;
    const pcm = fx.concatenatePcm([
      fx.silence(SR, 0.2),
      fx.synthesizeVowel({ sampleRate: SR, durationSeconds: 0.8, f0: fx.constantF0(f0), seed: 9 }),
      fx.silence(SR, 0.2),
    ]);
    const mono = pcm.channels[0]!;
    const track = trackPitch(mono, SR, DEFAULT_VOCAL_ANALYSIS_PARAMS);
    const marks = detectPitchMarks(mono, SR, track);
    const period = SR / f0;
    expect(marks.length).toBeGreaterThan(0.75 * 0.8 * f0);
    for (let i = 1; i < marks.length; i++) {
      expect(marks[i]).toBeGreaterThan(marks[i - 1]!);
      expect(Math.abs(marks[i]! - marks[i - 1]! - period)).toBeLessThanOrEqual(2);
    }
    expect(marks[0]!).toBeGreaterThanOrEqual(0.19 * SR);
    expect(marks[marks.length - 1]!).toBeLessThanOrEqual(1.01 * SR);
    expect(Array.from(detectPitchMarks(mono, SR, track))).toEqual(Array.from(marks));
    const silentTrack = trackPitch(new Float32Array(SR / 2), SR, DEFAULT_VOCAL_ANALYSIS_PARAMS);
    expect(detectPitchMarks(new Float32Array(SR / 2), SR, silentTrack)).toHaveLength(0);
  });

  it('follows vibrato', () => {
    const curve = fx.vibratoF0({
      baseHz: 180,
      rateHz: 5.5,
      depthCents: 80,
      startSeconds: 0.1,
      endSeconds: 1.1,
    });
    const pcm = fx.synthesizeVowel({ sampleRate: SR, durationSeconds: 1.2, f0: curve, seed: 10 });
    const mono = pcm.channels[0]!;
    const marks = detectPitchMarks(mono, SR, trackPitch(mono, SR, DEFAULT_VOCAL_ANALYSIS_PARAMS));
    let worst = 0;
    for (let i = 1; i < marks.length; i++) {
      const mid = (marks[i]! + marks[i - 1]!) / 2 / SR;
      if (mid < 0.12 || mid > 1.08) continue;
      const expected = SR / curve(mid);
      worst = Math.max(worst, Math.abs(marks[i]! - marks[i - 1]! - expected) / expected);
    }
    expect(worst).toBeLessThan(0.05);
  });
});
