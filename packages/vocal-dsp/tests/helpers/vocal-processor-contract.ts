import { describe, expect, it } from 'vitest';
import {
  analyzeVocal,
  DEFAULT_VOCAL_ANALYSIS_PARAMS,
  renderPitchCorrection,
  VocalJobCancelledError,
  type AbortSignalLike,
  type VocalProcessor,
} from '../../src/index';
import * as fx from '../../../test-fixtures/src/index';
import { bytesEqual, copyPcm, editDoc } from './docs';

/** Minimal AbortController equivalent built on the structural `AbortSignalLike`. */
export function createAbortHandle(): { signal: AbortSignalLike; abort(): void } {
  const listeners = new Set<() => void>();
  const signal = {
    aborted: false,
    addEventListener: (_type: 'abort', listener: () => void) => listeners.add(listener),
    removeEventListener: (_type: 'abort', listener: () => void) => listeners.delete(listener),
  };
  return {
    signal,
    abort: () => {
      if (signal.aborted) return;
      signal.aborted = true;
      for (const listener of [...listeners]) listener();
    },
  };
}

const SR = 48000;

function fixture(): fx.FixturePcm {
  const notes = [
    { midi: 55.3, startSeconds: 0.1, durationSeconds: 0.45 },
    { midi: 57.8, startSeconds: 0.6, durationSeconds: 0.45 },
  ];
  return fx.concatenatePcm([
    fx.synthesizeConsonantBurst({
      sampleRate: SR,
      durationSeconds: 0.1,
      kind: 'sibilant',
      seed: 2,
    }),
    fx.synthesizeVowel({ sampleRate: SR, durationSeconds: 1.2, f0: fx.melodyF0(notes), seed: 3 }),
  ]);
}

/**
 * Behaviour every `VocalProcessor` implementation must show (inline, Web Worker,
 * future Rust/WASM). Inputs are copied before each call because implementations may
 * take ownership of (transfer) the PCM buffers they receive.
 */
export function runVocalProcessorContract(
  name: string,
  createProcessor: () => VocalProcessor,
): void {
  describe(`VocalProcessor contract: ${name}`, () => {
    const source = fixture();
    const reference = analyzeVocal(source);
    const doc = editDoc(reference, { correction: { amount: 1, retuneSpeedMs: 10 } });

    it('declares TD-PSOLA capabilities without time-stretching', () => {
      const processor = createProcessor();
      expect(processor.capabilities).toEqual({
        algorithm: 'td-psola',
        formantPreservation: true,
        formantShift: true,
        timeStretch: false,
      });
      processor.dispose();
    });

    it('analyses exactly like analyzeVocal and reports progress', async () => {
      const processor = createProcessor();
      const progress: number[] = [];
      const analysis = await processor.analyze(copyPcm(source), DEFAULT_VOCAL_ANALYSIS_PARAMS, {
        onProgress: (f) => progress.push(f),
      });
      expect(bytesEqual(analysis.pitchTrack.f0Hz, reference.pitchTrack.f0Hz)).toBe(true);
      expect(analysis.segments).toEqual(reference.segments);
      expect(analysis.nonPitched).toEqual(reference.nonPitched);
      expect(analysis.keyCandidates).toEqual(reference.keyCandidates);
      expect(analysis.algorithmVersion).toBe(reference.algorithmVersion);
      expect(progress.length).toBeGreaterThan(0);
      expect(progress.every((f) => f >= 0 && f <= 1)).toBe(true);
      expect(progress[progress.length - 1]).toBe(1);
      processor.dispose();
    });

    it('renders exactly like renderPitchCorrection (same length, same samples)', async () => {
      const processor = createProcessor();
      const expected = renderPitchCorrection(source, reference, doc, 'preview');
      const rendered = await processor.render({
        source: copyPcm(source),
        analysis: reference,
        edits: doc,
        quality: 'preview',
      });
      expect(rendered.sampleRate).toBe(SR);
      expect(rendered.channels).toHaveLength(1);
      expect(rendered.channels[0]!.length).toBe(source.channels[0]!.length);
      expect(bytesEqual(rendered.channels[0]!, expected.channels[0]!)).toBe(true);
      // The caller's analysis is never consumed by a render.
      expect(reference.pitchTrack.f0Hz.byteLength).toBeGreaterThan(0);
      processor.dispose();
    });

    it('rejects an already-aborted job with VocalJobCancelledError', async () => {
      const processor = createProcessor();
      const handle = createAbortHandle();
      handle.abort();
      await expect(
        processor.analyze(copyPcm(source), DEFAULT_VOCAL_ANALYSIS_PARAMS, {
          signal: handle.signal,
        }),
      ).rejects.toBeInstanceOf(VocalJobCancelledError);
      processor.dispose();
    });

    it('cancels a running job and keeps serving later jobs', async () => {
      const processor = createProcessor();
      const handle = createAbortHandle();
      const cancelled = processor.analyze(copyPcm(source), DEFAULT_VOCAL_ANALYSIS_PARAMS, {
        signal: handle.signal,
        onProgress: () => handle.abort(),
      });
      await expect(cancelled).rejects.toBeInstanceOf(VocalJobCancelledError);
      const next = await processor.analyze(copyPcm(source), DEFAULT_VOCAL_ANALYSIS_PARAMS);
      expect(next.segments).toEqual(reference.segments);
      processor.dispose();
    });

    it('runs concurrent jobs and resolves each with its own result', async () => {
      const processor = createProcessor();
      const [a, b] = await Promise.all([
        processor.analyze(copyPcm(source), DEFAULT_VOCAL_ANALYSIS_PARAMS),
        processor.render({
          source: copyPcm(source),
          analysis: reference,
          edits: doc,
          quality: 'final',
        }),
      ]);
      expect(a.segments).toEqual(reference.segments);
      expect(b.channels[0]!.length).toBe(source.channels[0]!.length);
      processor.dispose();
    });

    it('rejects invalid input with a non-cancellation error', async () => {
      const processor = createProcessor();
      const result = processor.analyze(
        { sampleRate: 1000, channels: [new Float32Array(100)] },
        DEFAULT_VOCAL_ANALYSIS_PARAMS,
      );
      await expect(result).rejects.toThrow(/invalid PCM/);
      await expect(result).rejects.not.toBeInstanceOf(VocalJobCancelledError);
      processor.dispose();
    });

    it('rejects new jobs after dispose()', async () => {
      const processor = createProcessor();
      processor.dispose();
      await expect(
        processor.analyze(copyPcm(source), DEFAULT_VOCAL_ANALYSIS_PARAMS),
      ).rejects.toThrow(/disposed/);
    });
  });
}
