import { asVocalNoteId, type VocalNoteSegment } from '@studio/domain';
import { describe, expect, it } from 'vitest';
import {
  autoTargetMidi,
  computePitchRatioCurve,
  computeTargetPitchCurve,
  pitchTrackMidi,
  type PitchTrack,
} from '../src/index';
import { editDoc } from './helpers/docs';

const HOP = 0.005;
const midiToHz = (m: number): number => 440 * Math.pow(2, (m - 69) / 12);

/** Builds a pitch track from a function of time returning fractional MIDI or null (unvoiced). */
function syntheticTrack(seconds: number, pitch: (t: number) => number | null): PitchTrack {
  const frameCount = Math.round(seconds / HOP);
  const f0Hz = new Float32Array(frameCount);
  const voicedProbability = new Float32Array(frameCount);
  const rmsDb = new Float32Array(frameCount).fill(-20);
  for (let i = 0; i < frameCount; i++) {
    const m = pitch(i * HOP);
    if (m !== null) {
      f0Hz[i] = midiToHz(m);
      voicedProbability[i] = 1;
    }
  }
  return {
    sampleRate: 48000,
    hopSeconds: HOP,
    firstFrameSeconds: 0,
    frameCount,
    f0Hz,
    voicedProbability,
    rmsDb,
  };
}

function segment(
  id: string,
  start: number,
  end: number,
  midi: number,
  driftCents = 0,
): VocalNoteSegment {
  return {
    id: asVocalNoteId(id),
    startSeconds: start,
    endSeconds: end,
    detectedMidi: midi,
    confidence: 1,
    vibratoDepthCents: 0,
    vibratoRateHz: 0,
    driftCents,
  };
}

const analysisOf = (segments: VocalNoteSegment[]) => ({
  segments,
  algorithmVersion: 'test',
  keyCandidates: [],
});

const frame = (t: number): number => Math.round(t / HOP);

/** Two legato notes (57.3 then 60.4) between silences. */
const legato = syntheticTrack(2, (t) =>
  t >= 0.2 && t < 0.8 ? 57.3 : t >= 0.8 && t < 1.4 ? 60.4 : null,
);
const legatoSegments = [segment('a', 0.2, 0.8, 57.3), segment('b', 0.8, 1.4, 60.4)];

describe('computeTargetPitchCurve', () => {
  it('is NaN everywhere when the document is disabled', () => {
    const target = computeTargetPitchCurve(
      legato,
      legatoSegments,
      editDoc(analysisOf(legatoSegments), { enabled: false }),
    );
    expect(target.every((v) => Number.isNaN(v))).toBe(true);
    expect(computePitchRatioCurve(legato, target).every((v) => v === 1)).toBe(true);
  });

  it('is the identity with default settings (amount 0, no edits) and leaves unvoiced frames NaN', () => {
    const doc = editDoc(analysisOf(legatoSegments));
    const target = computeTargetPitchCurve(legato, legatoSegments, doc);
    const midi = pitchTrackMidi(legato);
    for (let i = 0; i < legato.frameCount; i++) {
      if (Number.isNaN(midi[i]!)) expect(target[i]).toBeNaN();
      else expect(Math.abs(target[i]! - midi[i]!)).toBeLessThan(1e-5);
    }
    expect(computePitchRatioCurve(legato, target).every((v) => v === 1)).toBe(true);
  });

  it('snaps automatically by `amount` (chromatic and in key)', () => {
    const chromatic = computeTargetPitchCurve(
      legato,
      legatoSegments,
      editDoc(analysisOf(legatoSegments), { correction: { amount: 1, retuneSpeedMs: 0 } }),
    );
    expect(chromatic[frame(0.5)]).toBeCloseTo(57, 4);
    expect(chromatic[frame(1.2)]).toBeCloseTo(60, 4);
    const half = computeTargetPitchCurve(
      legato,
      legatoSegments,
      editDoc(analysisOf(legatoSegments), { correction: { amount: 0.5, retuneSpeedMs: 0 } }),
    );
    expect(half[frame(0.5)]).toBeCloseTo(57.15, 4);
    // A minor (A=9): 57.3 → 57 (A3), 60.4 → 60 (C4); E major (E=4): 60.4 → 61 (C#4).
    const inKey = computeTargetPitchCurve(
      legato,
      legatoSegments,
      editDoc(analysisOf(legatoSegments), {
        correction: { amount: 1, retuneSpeedMs: 0, key: { tonic: 4, scale: 'major' } },
      }),
    );
    expect(inKey[frame(1.2)]).toBeCloseTo(61, 4);
    expect(
      autoTargetMidi(
        61.3,
        editDoc(analysisOf([]), { correction: { key: { tonic: 0, scale: 'major' } } }),
      ),
    ).toBe(62);
    expect(autoTargetMidi(61.3, editDoc(analysisOf([])))).toBe(61);
  });

  it('applies manual targets fully regardless of amount, and bypass leaves a note untouched', () => {
    const doc = editDoc(analysisOf(legatoSegments), {
      edits: { a: { targetMidi: 59 }, b: { bypass: true } },
      correction: { amount: 0 },
    });
    const target = computeTargetPitchCurve(legato, legatoSegments, doc);
    expect(target[frame(0.5)]).toBeCloseTo(59, 4);
    for (let i = frame(0.8); i < frame(1.4); i++) expect(target[i]).toBeNaN();
    const ratio = computePitchRatioCurve(legato, target);
    expect(ratio[frame(0.5)]).toBeCloseTo(Math.pow(2, 1.7 / 12), 4);
    expect(ratio[frame(1.0)]).toBe(1);
  });

  it('ramps automatic correction in over retuneSpeedMs after silence', () => {
    const doc = editDoc(analysisOf(legatoSegments), {
      correction: { amount: 1, retuneSpeedMs: 100 },
    });
    const target = computeTargetPitchCurve(legato, legatoSegments, doc);
    const offset = (t: number): number => target[frame(t)]! - 57.3;
    expect(offset(0.2)).toBeGreaterThan(-0.01); // starts almost uncorrected
    expect(offset(0.25)).toBeCloseTo(-0.15, 1); // halfway through the raised-cosine ramp
    expect(offset(0.31)).toBeCloseTo(-0.3, 4); // fully corrected after 100 ms
  });

  it('glides between legato notes over max(transitionMs, retune) and snaps manual notes after silence', () => {
    const doc = editDoc(analysisOf(legatoSegments), {
      edits: { a: { targetMidi: 57 }, b: { targetMidi: 62, transitionMs: 200 } },
      correction: { retuneSpeedMs: 0 },
    });
    const target = computeTargetPitchCurve(legato, legatoSegments, doc);
    expect(target[frame(0.2)]).toBeCloseTo(57, 4); // manual after silence: immediate
    const offset = (t: number): number => target[frame(t)]! - 60.4;
    expect(offset(0.8)).toBeLessThan(0); // still near note A's offset (−0.3)
    expect(offset(0.9)).toBeCloseTo((-0.3 + 1.6) / 2, 1);
    expect(offset(1.01)).toBeCloseTo(1.6, 4);
  });

  it('interpolates offsets across a voiced transition between notes and releases afterwards', () => {
    // 57 → (unsegmented 0.1 s glide) → 60, then a voiced unsegmented tail.
    const track = syntheticTrack(2, (t) => {
      if (t >= 0.2 && t < 0.7) return 57.2;
      if (t >= 0.7 && t < 0.8) return 57.2 + (t - 0.7) * 30;
      if (t >= 0.8 && t < 1.4) return 60.2;
      if (t >= 1.4 && t < 1.6) return 60.2;
      return null;
    });
    const segments = [segment('a', 0.2, 0.7, 57.2), segment('b', 0.8, 1.4, 60.2)];
    const target = computeTargetPitchCurve(
      track,
      segments,
      editDoc(analysisOf(segments), { correction: { amount: 1, retuneSpeedMs: 0 } }),
    );
    const midi = pitchTrackMidi(track);
    const offset = (t: number): number => target[frame(t)]! - midi[frame(t)]!;
    expect(offset(0.5)).toBeCloseTo(-0.2, 4);
    expect(offset(0.75)).toBeCloseTo(-0.2, 4); // both ends −0.2 → interpolation keeps −0.2
    expect(offset(1.2)).toBeCloseTo(-0.2, 4);
    expect(offset(1.42)).toBeLessThan(-0.05); // releasing
    expect(target[frame(1.5)]).toBeNaN(); // released and untouched
  });

  it('scales within-note modulation and removes drift', () => {
    // 6 Hz vibrato ±50 c around 57 with +60 c linear drift over 1 s.
    const track = syntheticTrack(1.4, (t) =>
      t >= 0.2 && t < 1.2
        ? 57 + 0.5 * Math.sin(2 * Math.PI * 6 * (t - 0.2)) + 0.6 * (t - 0.7)
        : null,
    );
    const segments = [segment('v', 0.2, 1.2, 57, 60)];
    const spread = (doc: ReturnType<typeof editDoc>): { range: number; slope: number } => {
      const target = computeTargetPitchCurve(track, segments, doc);
      let min = Infinity;
      let max = -Infinity;
      for (let i = frame(0.45); i < frame(0.95); i++) {
        min = Math.min(min, target[i]!);
        max = Math.max(max, target[i]!);
      }
      // Means over whole vibrato cycles (1/6 s) cancel the vibrato.
      const meanOver = (t0: number): number => {
        let sum = 0;
        let n = 0;
        for (let i = frame(t0); i < frame(t0 + 1 / 6); i++) {
          sum += target[i]!;
          n++;
        }
        return sum / n;
      };
      const slope = (meanOver(0.95) - meanOver(0.3)) / 0.65;
      return { range: max - min, slope };
    };
    const original = spread(editDoc(analysisOf(segments)));
    const flat = spread(
      editDoc(analysisOf(segments), { edits: { v: { modulationScale: 0, driftCorrection: 1 } } }),
    );
    const doubled = spread(editDoc(analysisOf(segments), { edits: { v: { modulationScale: 2 } } }));
    const driftless = spread(
      editDoc(analysisOf(segments), { edits: { v: { driftCorrection: 1 } } }),
    );
    expect(original.range).toBeGreaterThan(0.9);
    expect(flat.range).toBeLessThan(0.05);
    expect(Math.abs(flat.slope)).toBeLessThan(0.05);
    expect(doubled.range).toBeGreaterThan(1.8 * original.range - 0.3);
    expect(Math.abs(driftless.slope)).toBeLessThan(0.05);
    expect(Math.abs(original.slope - 0.6)).toBeLessThan(0.05);
  });

  it('flattens slow wander by amount × (1 − humanize) and keeps vibrato', () => {
    // 1 Hz wander ±30 c plus 6 Hz vibrato ±20 c.
    const track = syntheticTrack(2.4, (t) =>
      t >= 0.2 && t < 2.2
        ? 57 + 0.3 * Math.sin(2 * Math.PI * (t - 0.2)) + 0.2 * Math.sin(2 * Math.PI * 6 * (t - 0.2))
        : null,
    );
    const segments = [segment('w', 0.2, 2.2, 57)];
    const wander = (humanize: number): number => {
      const target = computeTargetPitchCurve(
        track,
        segments,
        editDoc(analysisOf(segments), { correction: { amount: 1, humanize, retuneSpeedMs: 0 } }),
      );
      // 1 Hz component via correlation with the wander sinusoid over two full cycles.
      let acc = 0;
      let n = 0;
      for (let i = frame(0.2); i < frame(2.2); i++) {
        acc += (target[i]! - 57) * Math.sin(2 * Math.PI * (i * HOP - 0.2));
        n++;
      }
      return (2 * acc) / n;
    };
    expect(wander(1)).toBeCloseTo(0.3, 1);
    expect(Math.abs(wander(0))).toBeLessThan(0.08);
    expect(wander(0.5)).toBeCloseTo(0.15, 1);
  });

  it('is independent of segment order', () => {
    const doc = editDoc(analysisOf(legatoSegments), { correction: { amount: 1 } });
    const a = computeTargetPitchCurve(legato, legatoSegments, doc);
    const b = computeTargetPitchCurve(legato, [...legatoSegments].reverse(), doc);
    expect(Array.from(b)).toEqual(Array.from(a));
  });
});

describe('computePitchRatioCurve', () => {
  it('clamps to [0.5, 2] and is exactly 1 where unprocessed', () => {
    const target = new Float32Array(legato.frameCount).fill(Number.NaN);
    target[frame(0.5)] = 57.3 + 15;
    target[frame(0.6)] = 57.3 - 15;
    target[frame(0.7)] = 57.3 + 1e-6;
    target[frame(0.1)] = 60; // unvoiced frame: ignored
    const ratio = computePitchRatioCurve(legato, target);
    expect(ratio[frame(0.5)]).toBe(2);
    expect(ratio[frame(0.6)]).toBe(0.5);
    expect(ratio[frame(0.7)]).toBe(1);
    expect(ratio[frame(0.1)]).toBe(1);
    expect(ratio[frame(0.4)]).toBe(1);
  });
});
