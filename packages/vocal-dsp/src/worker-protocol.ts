import { type PcmAudio } from '@studio/audio-dsp';
import { analyzeVocal } from './analyze';
import { renderPitchCorrection } from './render/psola';
import { type VocalAnalysis, type VocalAnalysisParams, type VocalRenderRequest } from './types';

/**
 * Message protocol between `createWorkerVocalProcessor` (main thread) and a worker
 * host that forwards every incoming message to `handleVocalWorkerRequest`.
 *
 * Ownership: typed-array buffers listed in a message's transfer list move to the
 * receiver and are detached for the sender. The processor transfers request PCM to the
 * worker (see `createWorkerVocalProcessor` for the opt-out) and the handler transfers
 * results (pitch-track arrays, rendered PCM) back. Analyses sent with a render request
 * are copied, never transferred, because callers usually keep them for later renders.
 */
export const VOCAL_WORKER_PROTOCOL_VERSION = 1;

export type VocalWorkerRequest =
  | {
      readonly type: 'analyze';
      readonly jobId: number;
      readonly source: PcmAudio;
      readonly params: VocalAnalysisParams;
    }
  | { readonly type: 'render'; readonly jobId: number; readonly request: VocalRenderRequest }
  /** Acknowledged with 'cancelled'. Jobs run synchronously, so hosts cancel a running job
   * by terminating the worker; the message lets non-terminating hosts reconcile. */
  | { readonly type: 'cancel'; readonly jobId: number };

export type VocalWorkerResponse =
  | { readonly type: 'progress'; readonly jobId: number; readonly fraction: number }
  | {
      readonly type: 'result';
      readonly jobId: number;
      readonly kind: 'analysis';
      readonly analysis: VocalAnalysis;
    }
  | {
      readonly type: 'result';
      readonly jobId: number;
      readonly kind: 'render';
      readonly audio: PcmAudio;
    }
  | {
      readonly type: 'error';
      readonly jobId: number;
      readonly name: string;
      readonly message: string;
    }
  | { readonly type: 'cancelled'; readonly jobId: number };

export type VocalWorkerPost = (response: VocalWorkerResponse, transfer?: ArrayBuffer[]) => void;

/** Minimum progress increase between two 'progress' messages. */
export const PROGRESS_MESSAGE_STEP = 0.01;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isPcm(value: unknown): value is PcmAudio {
  return (
    isRecord(value) &&
    typeof value.sampleRate === 'number' &&
    Array.isArray(value.channels) &&
    value.channels.every((c) => c instanceof Float32Array)
  );
}

/** Runtime check for messages arriving from `postMessage` (structured clones are untyped). */
export function isVocalWorkerRequest(value: unknown): value is VocalWorkerRequest {
  if (!isRecord(value) || typeof value.jobId !== 'number') return false;
  switch (value.type) {
    case 'analyze':
      return isPcm(value.source) && isRecord(value.params);
    case 'render':
      return (
        isRecord(value.request) &&
        isPcm(value.request.source) &&
        isRecord(value.request.analysis) &&
        isRecord(value.request.edits) &&
        (value.request.quality === 'preview' || value.request.quality === 'final')
      );
    case 'cancel':
      return true;
    default:
      return false;
  }
}

/** Runtime check for messages arriving at the processor. */
export function isVocalWorkerResponse(value: unknown): value is VocalWorkerResponse {
  if (!isRecord(value) || typeof value.jobId !== 'number') return false;
  switch (value.type) {
    case 'progress':
      return typeof value.fraction === 'number';
    case 'result':
      return (
        (value.kind === 'analysis' && isRecord(value.analysis)) ||
        (value.kind === 'render' && isPcm(value.audio))
      );
    case 'error':
      return typeof value.message === 'string' && typeof value.name === 'string';
    case 'cancelled':
      return true;
    default:
      return false;
  }
}

/** Distinct ArrayBuffers behind a set of typed arrays (SharedArrayBuffers are skipped). */
export function transferablesOf(arrays: readonly ArrayBufferView[]): ArrayBuffer[] {
  const buffers = new Set<ArrayBuffer>();
  for (const array of arrays) {
    if (array.buffer instanceof ArrayBuffer && array.buffer.byteLength > 0)
      buffers.add(array.buffer);
  }
  return [...buffers];
}

function errorResponse(jobId: number, error: unknown): VocalWorkerResponse {
  if (error instanceof Error)
    return { type: 'error', jobId, name: error.name, message: error.message };
  return { type: 'error', jobId, name: 'Error', message: String(error) };
}

/**
 * Pure request handler for any worker host:
 *
 * ```ts
 * self.onmessage = (e) => handleVocalWorkerRequest(e.data, (r, t) => self.postMessage(r, t ?? []));
 * ```
 *
 * Runs the job synchronously, posting throttled 'progress' messages and finally one
 * 'result' (buffers transferred) or 'error'. Malformed messages produce an 'error'
 * (jobId −1 when no id can be read).
 */
export function handleVocalWorkerRequest(request: VocalWorkerRequest, post: VocalWorkerPost): void {
  const raw: unknown = request;
  if (!isVocalWorkerRequest(raw)) {
    const jobId = isRecord(raw) && typeof raw.jobId === 'number' ? raw.jobId : -1;
    post({ type: 'error', jobId, name: 'TypeError', message: 'malformed vocal worker request' });
    return;
  }
  const { jobId } = request;
  if (request.type === 'cancel') {
    post({ type: 'cancelled', jobId });
    return;
  }
  let lastPosted = 0;
  const onProgress = (fraction: number): void => {
    if (fraction >= 1 || fraction - lastPosted >= PROGRESS_MESSAGE_STEP) {
      lastPosted = fraction;
      post({ type: 'progress', jobId, fraction });
    }
  };
  try {
    if (request.type === 'analyze') {
      const analysis = analyzeVocal(request.source, request.params, { onProgress });
      const track = analysis.pitchTrack;
      post(
        { type: 'result', jobId, kind: 'analysis', analysis },
        transferablesOf([track.f0Hz, track.voicedProbability, track.rmsDb]),
      );
    } else {
      const { source, analysis, edits, quality } = request.request;
      const audio = renderPitchCorrection(source, analysis, edits, quality, { onProgress });
      post({ type: 'result', jobId, kind: 'render', audio }, transferablesOf(audio.channels));
    }
  } catch (error) {
    post(errorResponse(jobId, error));
  }
}
