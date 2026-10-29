import { describe, expect, it, vi } from 'vitest';
import {
  analyzeVocal,
  DEFAULT_VOCAL_ANALYSIS_PARAMS,
  handleVocalWorkerRequest,
  isVocalWorkerRequest,
  isVocalWorkerResponse,
  type VocalWorkerRequest,
  type VocalWorkerResponse,
} from '../src/index';
import { PROGRESS_MESSAGE_STEP, transferablesOf } from '../src/worker-protocol';
import * as fx from '../../test-fixtures/src/index';
import { editDoc } from './helpers/docs';

// Fixture synthesis + analysis is slow under coverage instrumentation.
vi.setConfig({ testTimeout: 120_000 });

const SR = 48000;
const pcm = fx.synthesizeVowel({
  sampleRate: SR,
  durationSeconds: 3,
  f0: fx.constantF0(180, 0.1, 2.9),
  seed: 1,
});

function collect(request: unknown): {
  responses: VocalWorkerResponse[];
  transfers: ArrayBuffer[][];
} {
  const responses: VocalWorkerResponse[] = [];
  const transfers: ArrayBuffer[][] = [];
  handleVocalWorkerRequest(request as VocalWorkerRequest, (response, transfer) => {
    responses.push(response);
    transfers.push(transfer ?? []);
  });
  return { responses, transfers };
}

describe('handleVocalWorkerRequest', () => {
  it('runs an analysis with throttled progress and transfers the pitch-track buffers', () => {
    const { responses, transfers } = collect({
      type: 'analyze',
      jobId: 7,
      source: pcm,
      params: DEFAULT_VOCAL_ANALYSIS_PARAMS,
    });
    const progress = responses.filter((r) => r.type === 'progress');
    expect(progress.length).toBeGreaterThan(5);
    for (let i = 1; i < progress.length; i++) {
      const delta =
        (progress[i] as { fraction: number }).fraction -
        (progress[i - 1] as { fraction: number }).fraction;
      expect(delta).toBeGreaterThanOrEqual(PROGRESS_MESSAGE_STEP - 1e-12);
    }
    const result = responses[responses.length - 1]!;
    expect(result.type).toBe('result');
    expect(result.jobId).toBe(7);
    if (result.type !== 'result' || result.kind !== 'analysis')
      throw new Error('expected analysis');
    const track = result.analysis.pitchTrack;
    expect(transfers[transfers.length - 1]).toEqual([
      track.f0Hz.buffer,
      track.voicedProbability.buffer,
      track.rmsDb.buffer,
    ]);
    expect(result.analysis.segments).toEqual(analyzeVocal(pcm).segments);
  });

  it('renders and transfers the output channels', () => {
    const analysis = analyzeVocal(pcm);
    const edits = editDoc(analysis, { edits: { [analysis.segments[0]!.id]: { targetMidi: 55 } } });
    const { responses, transfers } = collect({
      type: 'render',
      jobId: 3,
      request: { source: pcm, analysis, edits, quality: 'preview' },
    });
    const result = responses[responses.length - 1]!;
    if (result.type !== 'result' || result.kind !== 'render') throw new Error('expected render');
    expect(result.audio.channels[0]!.length).toBe(pcm.channels[0]!.length);
    expect(transfers[transfers.length - 1]).toEqual([result.audio.channels[0]!.buffer]);
  });

  it('acknowledges cancel requests and reports errors', () => {
    expect(collect({ type: 'cancel', jobId: 4 }).responses).toEqual([
      { type: 'cancelled', jobId: 4 },
    ]);
    const failed = collect({
      type: 'analyze',
      jobId: 5,
      source: { sampleRate: 1000, channels: [new Float32Array(4)] },
      params: DEFAULT_VOCAL_ANALYSIS_PARAMS,
    });
    expect(failed.responses).toEqual([
      {
        type: 'error',
        jobId: 5,
        name: 'RangeError',
        message: 'invalid PCM: invalid sample rate 1000',
      },
    ]);
    expect(collect({ type: 'bogus', jobId: 6 }).responses).toEqual([
      { type: 'error', jobId: 6, name: 'TypeError', message: 'malformed vocal worker request' },
    ]);
    expect(collect('nonsense').responses[0]).toMatchObject({ type: 'error', jobId: -1 });
  });
});

describe('protocol guards', () => {
  const analysis = analyzeVocal(fx.silence(SR, 0.2));
  const edits = editDoc(analysis);
  it('validates requests', () => {
    expect(isVocalWorkerRequest({ type: 'analyze', jobId: 1, source: pcm, params: {} })).toBe(true);
    expect(
      isVocalWorkerRequest({
        type: 'render',
        jobId: 1,
        request: { source: pcm, analysis, edits, quality: 'final' },
      }),
    ).toBe(true);
    expect(
      isVocalWorkerRequest({
        type: 'render',
        jobId: 1,
        request: { source: pcm, analysis, edits, quality: 'draft' },
      }),
    ).toBe(false);
    expect(isVocalWorkerRequest({ type: 'cancel', jobId: 1 })).toBe(true);
    expect(isVocalWorkerRequest({ type: 'analyze', jobId: '1', source: pcm, params: {} })).toBe(
      false,
    );
    expect(
      isVocalWorkerRequest({
        type: 'analyze',
        jobId: 1,
        source: { sampleRate: SR, channels: [[1, 2]] },
        params: {},
      }),
    ).toBe(false);
    expect(isVocalWorkerRequest(null)).toBe(false);
  });

  it('validates responses', () => {
    expect(isVocalWorkerResponse({ type: 'progress', jobId: 1, fraction: 0.5 })).toBe(true);
    expect(isVocalWorkerResponse({ type: 'result', jobId: 1, kind: 'analysis', analysis })).toBe(
      true,
    );
    expect(isVocalWorkerResponse({ type: 'result', jobId: 1, kind: 'render', audio: pcm })).toBe(
      true,
    );
    expect(isVocalWorkerResponse({ type: 'result', jobId: 1, kind: 'render', audio: {} })).toBe(
      false,
    );
    expect(isVocalWorkerResponse({ type: 'error', jobId: 1, name: 'E', message: 'm' })).toBe(true);
    expect(isVocalWorkerResponse({ type: 'error', jobId: 1, message: 'm' })).toBe(false);
    expect(isVocalWorkerResponse({ type: 'cancelled', jobId: 1 })).toBe(true);
    expect(isVocalWorkerResponse({ type: 'other', jobId: 1 })).toBe(false);
    expect(isVocalWorkerResponse(undefined)).toBe(false);
  });

  it('lists distinct, non-empty transferable buffers', () => {
    const shared = new Float32Array(8);
    const a = shared.subarray(0, 4);
    const b = shared.subarray(4);
    expect(transferablesOf([a, b])).toEqual([shared.buffer]);
    expect(transferablesOf([new Float32Array(0)])).toEqual([]);
  });
});
