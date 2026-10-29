import { describe, expect, it, vi } from 'vitest';
import {
  analyzeVocal,
  DEFAULT_VOCAL_ANALYSIS_PARAMS,
  renderPitchCorrection,
  VOCAL_ALGORITHM_VERSION,
  VocalJobCancelledError,
} from '../src/index';
import * as fx from '@studio/test-fixtures';
import { bytesEqual, editDoc } from './helpers/docs';

// Fixture synthesis + analysis is slow under coverage instrumentation.
vi.setConfig({ testTimeout: 120_000 });

const SR = 48000;

function phrase(seed = 1): fx.FixturePcm {
  const notes = fx.melodyToTimedNotes(fx.KNOWN_MELODIES[1]!.notes.slice(0, 10), {
    bpm: 130,
    startSeconds: 0.25,
    transpose: -12,
    articulation: 0.85,
  });
  return fx.concatenatePcm([
    fx.synthesizeConsonantBurst({ sampleRate: SR, durationSeconds: 0.12, kind: 'sibilant', seed }),
    fx.synthesizeVowel({
      sampleRate: SR,
      durationSeconds: 5,
      f0: fx.melodyF0(notes, { vibrato: { rateHz: 5.8, depthCents: 30 } }),
      breathiness: 0.15,
      seed,
    }),
    fx.synthesizeConsonantBurst({
      sampleRate: SR,
      durationSeconds: 0.25,
      kind: 'breath',
      seed: seed + 1,
    }),
  ]);
}

describe('analyzeVocal', () => {
  const pcm = phrase();
  const analysis = analyzeVocal(pcm);

  it('returns a complete, versioned analysis', () => {
    expect(analysis.algorithmVersion).toBe(VOCAL_ALGORITHM_VERSION);
    expect(analysis.params).toEqual(DEFAULT_VOCAL_ANALYSIS_PARAMS);
    expect(analysis.durationSeconds).toBeCloseTo(pcm.channels[0]!.length / SR, 12);
    expect(analysis.pitchTrack.frameCount).toBeGreaterThan(1000);
    expect(analysis.segments.length).toBeGreaterThanOrEqual(9);
    expect(analysis.keyCandidates[0]!.key).toEqual({ tonic: 2, scale: 'major' });
    expect(analysis.nonPitched.some((r) => r.kind === 'sibilant')).toBe(true);
    expect(analysis.nonPitched.some((r) => r.kind === 'breath')).toBe(true);
    for (let i = 1; i < analysis.segments.length; i++) {
      expect(analysis.segments[i]!.startSeconds).toBeGreaterThanOrEqual(
        analysis.segments[i - 1]!.endSeconds,
      );
    }
  });

  it('is deterministic (bit-identical analysis and render on repeated runs)', () => {
    const again = analyzeVocal(phrase());
    expect(bytesEqual(again.pitchTrack.f0Hz, analysis.pitchTrack.f0Hz)).toBe(true);
    expect(
      bytesEqual(again.pitchTrack.voicedProbability, analysis.pitchTrack.voicedProbability),
    ).toBe(true);
    expect(bytesEqual(again.pitchTrack.rmsDb, analysis.pitchTrack.rmsDb)).toBe(true);
    expect(again.segments).toEqual(analysis.segments);
    expect(again.nonPitched).toEqual(analysis.nonPitched);
    expect(again.keyCandidates).toEqual(analysis.keyCandidates);
    const doc = editDoc(analysis, {
      correction: { amount: 0.8, humanize: 0.3, key: { tonic: 2, scale: 'major' } },
    });
    const a = renderPitchCorrection(pcm, analysis, doc, 'final');
    const b = renderPitchCorrection(phrase(), again, doc, 'final');
    expect(bytesEqual(a.channels[0]!, b.channels[0]!)).toBe(true);
  });

  it('accepts partial parameters and downmixes multichannel input', () => {
    const custom = analyzeVocal(pcm, { minNoteSeconds: 0.1, hopSeconds: 0.01 });
    expect(custom.params.minNoteSeconds).toBe(0.1);
    expect(custom.pitchTrack.hopSeconds).toBeCloseTo(0.01, 12);
    const mono = pcm.channels[0]!;
    const stereo = { sampleRate: SR, channels: [mono, Float32Array.from(mono, (v) => 0.5 * v)] };
    const fromStereo = analyzeVocal(stereo);
    expect(fromStereo.segments.length).toBe(analysis.segments.length);
    fromStereo.segments.forEach((s, i) =>
      expect(s.detectedMidi).toBeCloseTo(analysis.segments[i]!.detectedMidi, 3),
    );
  });

  it('handles empty audio', () => {
    const empty = analyzeVocal({ sampleRate: SR, channels: [new Float32Array(0)] });
    expect(empty.pitchTrack.frameCount).toBe(0);
    expect(empty.segments).toEqual([]);
    expect(empty.keyCandidates).toEqual([]);
    expect(empty.durationSeconds).toBe(0);
  });

  it('rejects invalid PCM and parameters', () => {
    expect(() => analyzeVocal({ sampleRate: SR, channels: [] })).toThrow(RangeError);
    expect(() => analyzeVocal({ sampleRate: 1000, channels: [new Float32Array(10)] })).toThrow(
      RangeError,
    );
    expect(() =>
      analyzeVocal({ sampleRate: SR, channels: [new Float32Array(10), new Float32Array(11)] }),
    ).toThrow(RangeError);
    expect(() => analyzeVocal(pcm, { maxHz: 50 })).toThrow(RangeError);
  });

  it('reports monotonic progress and can be cancelled', () => {
    const progress: number[] = [];
    analyzeVocal(pcm, undefined, { onProgress: (f) => progress.push(f) });
    expect(progress[0]).toBeGreaterThan(0);
    expect(progress[progress.length - 1]).toBe(1);
    for (let i = 1; i < progress.length; i++)
      expect(progress[i]).toBeGreaterThanOrEqual(progress[i - 1]!);
    expect(() => analyzeVocal(pcm, undefined, { shouldCancel: () => progress.length > 0 })).toThrow(
      VocalJobCancelledError,
    );
  });
});
