import { describe, expect, it } from 'vitest';
import { analyzeVocal, renderPitchCorrection } from '../src/index';
import * as fx from '@studio/test-fixtures';
import { editDoc } from './helpers/docs';

/**
 * Long-form performance benchmark (60 s, 48 kHz mono). Opt-in: `VOCAL_BENCH=1`.
 * Results are recorded in docs/vocal-dsp.md.
 */
const enabled =
  (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env
    ?.VOCAL_BENCH === '1';

describe.skipIf(!enabled)('vocal-dsp benchmark (VOCAL_BENCH=1)', () => {
  const SR = 48000;
  const SECONDS = 60;

  function longTake(): { pcm: fx.FixturePcm; notes: fx.TimedNote[] } {
    const notes: fx.TimedNote[] = [];
    let t = 0.3;
    let index = 0;
    while (t < SECONDS - 3) {
      const melody = fx.KNOWN_MELODIES[index++ % fx.KNOWN_MELODIES.length]!;
      for (const n of fx.melodyToTimedNotes(melody.notes, {
        bpm: 110,
        startSeconds: t,
        transpose: -12,
        articulation: 0.92,
      })) {
        if (n.startSeconds + n.durationSeconds < SECONDS - 0.5) notes.push(n);
      }
      t = notes[notes.length - 1]!.startSeconds + 1.5;
    }
    const pcm = fx.synthesizeVowel({
      sampleRate: SR,
      durationSeconds: SECONDS,
      f0: fx.melodyF0(notes, {
        vibrato: { rateHz: 5.5, depthCents: 40 },
        detuneCents: notes.map((_, i) => ((i * 37) % 50) - 25),
      }),
      breathiness: 0.2,
      seed: 1,
    });
    return { pcm, notes };
  }

  it('analyses ≤ 0.15× and renders ≤ 0.1× real time', () => {
    const { pcm, notes } = longTake();
    analyzeVocal(
      fx.synthesizeVowel({ sampleRate: SR, durationSeconds: 2, f0: fx.constantF0(200), seed: 2 }),
    ); // warm-up
    const timings: number[] = [];
    let analysis = analyzeVocal(pcm);
    for (let run = 0; run < 3; run++) {
      const start = performance.now();
      analysis = analyzeVocal(pcm);
      timings.push(performance.now() - start);
    }
    const analyseMs = Math.min(...timings);
    const doc = editDoc(analysis, { correction: { amount: 1, retuneSpeedMs: 20, key: null } });
    const render = (quality: 'preview' | 'final'): number => {
      const runs: number[] = [];
      for (let run = 0; run < 3; run++) {
        const start = performance.now();
        renderPitchCorrection(pcm, analysis, doc, quality);
        runs.push(performance.now() - start);
      }
      return Math.min(...runs);
    };
    const previewMs = render('preview');
    const finalMs = render('final');
    console.log(
      `60 s @ 48 kHz (${notes.length} notes, ${analysis.segments.length} segments): analysis ${analyseMs.toFixed(0)} ms ` +
        `(${(analyseMs / 1000 / SECONDS).toFixed(3)}× RT), render preview ${previewMs.toFixed(0)} ms ` +
        `(${(previewMs / 1000 / SECONDS).toFixed(3)}× RT), final ${finalMs.toFixed(0)} ms (${(finalMs / 1000 / SECONDS).toFixed(3)}× RT)`,
    );
    expect(analyseMs / 1000 / SECONDS).toBeLessThanOrEqual(0.15);
    expect(finalMs / 1000 / SECONDS).toBeLessThanOrEqual(0.1);
    expect(previewMs / 1000 / SECONDS).toBeLessThanOrEqual(0.1);
  }, 300_000);
});
