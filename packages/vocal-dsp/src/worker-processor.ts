import { type PcmAudio } from '@studio/audio-dsp';
import { VOCAL_PROCESSOR_CAPABILITIES, VocalProcessorDisposedError } from './processor';
import {
  VocalJobCancelledError,
  type AbortSignalLike,
  type VocalAnalysis,
  type VocalJobOptions,
  type VocalProcessor,
} from './types';
import {
  isVocalWorkerResponse,
  transferablesOf,
  type VocalWorkerRequest,
  type VocalWorkerResponse,
} from './worker-protocol';

/** Structural subset of a DOM `Worker` (portable packages have no DOM typings). */
export interface VocalWorkerLike {
  postMessage(message: unknown, transfer?: ArrayBuffer[]): void;
  onmessage: ((event: { data: unknown }) => void) | null;
  terminate(): void;
}

export interface WorkerVocalProcessorOptions {
  /**
   * When true (default) the PCM of every request is *transferred* to the worker: the
   * caller's channel buffers are detached once the job is dispatched and must not be
   * reused. Pass false to have the processor copy the PCM first (costs one copy).
   */
  readonly transferInputs?: boolean;
}

/** Error re-created on the main thread from a worker 'error' response. */
export class VocalWorkerError extends Error {
  constructor(name: string, message: string) {
    super(message);
    this.name = name;
  }
}

interface Job {
  readonly id: number;
  readonly build: () => { message: VocalWorkerRequest; transfer: ArrayBuffer[] };
  readonly resolve: (value: unknown) => void;
  readonly reject: (error: unknown) => void;
  readonly onProgress: ((fraction: number) => void) | undefined;
  readonly signal: AbortSignalLike | undefined;
  abortListener: (() => void) | undefined;
}

function copyPcm(pcm: PcmAudio): PcmAudio {
  return { sampleRate: pcm.sampleRate, channels: pcm.channels.map((c) => c.slice()) };
}

/**
 * `VocalProcessor` backed by a worker running `handleVocalWorkerRequest`.
 *
 * - Jobs run one at a time in submission order; queued jobs keep their buffers until
 *   dispatched (so cancelling a queued job never detaches anything).
 * - Cancelling the running job terminates the worker; the next job lazily spawns a new
 *   one via `createWorker`. Messages from a terminated worker, and responses whose job
 *   id is not the running job, are ignored (stale results).
 * - Results arrive with their buffers transferred from the worker (the processor owns
 *   them; nothing is retained after resolving).
 */
export function createWorkerVocalProcessor(
  createWorker: () => VocalWorkerLike,
  options: WorkerVocalProcessorOptions = {},
): VocalProcessor {
  const transferInputs = options.transferInputs ?? true;
  let worker: VocalWorkerLike | null = null;
  let active: Job | null = null;
  const queue: Job[] = [];
  let nextId = 1;
  let disposed = false;

  const detachAbort = (job: Job): void => {
    if (job.abortListener !== undefined)
      job.signal?.removeEventListener('abort', job.abortListener);
    job.abortListener = undefined;
  };

  const settle = (job: Job, outcome: { value: unknown } | { error: unknown }): void => {
    detachAbort(job);
    if ('value' in outcome) job.resolve(outcome.value);
    else job.reject(outcome.error);
  };

  const killWorker = (): void => {
    if (worker === null) return;
    worker.onmessage = null;
    worker.terminate();
    worker = null;
  };

  const onMessage = (from: VocalWorkerLike, data: unknown): void => {
    if (from !== worker || active === null || !isVocalWorkerResponse(data)) return;
    const response: VocalWorkerResponse = data;
    const job = active;
    if (response.jobId !== job.id) return;
    switch (response.type) {
      case 'progress':
        job.onProgress?.(response.fraction);
        return;
      case 'result':
        active = null;
        settle(job, { value: response.kind === 'analysis' ? response.analysis : response.audio });
        break;
      case 'error':
        active = null;
        settle(job, { error: new VocalWorkerError(response.name, response.message) });
        break;
      case 'cancelled':
        active = null;
        settle(job, { error: new VocalJobCancelledError() });
        break;
    }
    pump();
  };

  const pump = (): void => {
    if (active !== null || disposed) return;
    const job = queue.shift();
    if (job === undefined) return;
    if (worker === null) {
      const created = createWorker();
      created.onmessage = (event) => onMessage(created, event.data);
      worker = created;
    }
    active = job;
    let built: { message: VocalWorkerRequest; transfer: ArrayBuffer[] };
    try {
      built = job.build();
      worker.postMessage(built.message, built.transfer);
    } catch (error) {
      active = null;
      settle(job, { error });
      pump();
    }
  };

  const cancel = (job: Job): void => {
    const index = queue.indexOf(job);
    if (index >= 0) {
      queue.splice(index, 1);
      settle(job, { error: new VocalJobCancelledError() });
      return;
    }
    if (active === job) {
      active = null;
      killWorker();
      settle(job, { error: new VocalJobCancelledError() });
      pump();
    }
  };

  const submit = <T>(
    build: (id: number) => { message: VocalWorkerRequest; transfer: ArrayBuffer[] },
    jobOptions: VocalJobOptions | undefined,
  ): Promise<T> => {
    if (disposed) return Promise.reject(new VocalProcessorDisposedError());
    if (jobOptions?.signal?.aborted === true) return Promise.reject(new VocalJobCancelledError());
    return new Promise<T>((resolve, reject) => {
      const id = nextId++;
      const job: Job = {
        id,
        build: () => build(id),
        resolve: resolve as (value: unknown) => void,
        reject,
        onProgress: jobOptions?.onProgress,
        signal: jobOptions?.signal,
        abortListener: undefined,
      };
      if (job.signal !== undefined) {
        job.abortListener = () => cancel(job);
        job.signal.addEventListener('abort', job.abortListener, { once: true });
      }
      queue.push(job);
      pump();
    });
  };

  const prepare = (pcm: PcmAudio): PcmAudio => (transferInputs ? pcm : copyPcm(pcm));

  return {
    capabilities: VOCAL_PROCESSOR_CAPABILITIES,
    analyze: (source, params, jobOptions) =>
      submit<VocalAnalysis>((jobId) => {
        const pcm = prepare(source);
        return {
          message: { type: 'analyze', jobId, source: pcm, params },
          transfer: transferablesOf(pcm.channels),
        };
      }, jobOptions),
    render: (request, jobOptions) =>
      submit<PcmAudio>((jobId) => {
        const pcm = prepare(request.source);
        return {
          message: { type: 'render', jobId, request: { ...request, source: pcm } },
          transfer: transferablesOf(pcm.channels),
        };
      }, jobOptions),
    dispose: () => {
      if (disposed) return;
      disposed = true;
      killWorker();
      const pending = active === null ? queue.splice(0) : [active, ...queue.splice(0)];
      active = null;
      for (const job of pending) settle(job, { error: new VocalProcessorDisposedError() });
    },
  };
}
