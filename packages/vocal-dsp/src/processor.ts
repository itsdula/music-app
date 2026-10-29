import { analyzeVocalSteps } from './analyze';
import { runStepsAsync } from './internal/steps';
import { renderPitchCorrectionSteps } from './render/psola';
import {
  VocalJobCancelledError,
  type VocalJobOptions,
  type VocalProcessor,
  type VocalProcessorCapabilities,
} from './types';

/** What the built-in TD-PSOLA engine can do (time-stretching is deferred). */
export const VOCAL_PROCESSOR_CAPABILITIES: VocalProcessorCapabilities = {
  algorithm: 'td-psola',
  formantPreservation: true,
  formantShift: true,
  timeStretch: false,
};

/** Error raised by a processor after `dispose()`. */
export class VocalProcessorDisposedError extends Error {
  constructor() {
    super('Vocal processor has been disposed');
    this.name = 'VocalProcessorDisposedError';
  }
}

/**
 * In-process processor: runs the same stage generators as `analyzeVocal` /
 * `renderPitchCorrection`, yielding to the event loop between chunks so that an
 * AbortSignal can cancel the job (rejects with `VocalJobCancelledError`) and progress
 * is reported. Intended for tests, Node tools and hosts without Workers; in the
 * browser use `createWorkerVocalProcessor` to keep the UI thread free.
 */
export function createInlineVocalProcessor(): VocalProcessor {
  let disposed = false;
  const run = async <T>(
    steps: () => Generator<number, T, void>,
    options: VocalJobOptions | undefined,
  ): Promise<T> => {
    if (disposed) throw new VocalProcessorDisposedError();
    if (options?.signal?.aborted === true) throw new VocalJobCancelledError();
    return runStepsAsync(steps(), {
      ...(options?.signal !== undefined ? { signal: options.signal } : {}),
      ...(options?.onProgress !== undefined ? { onProgress: options.onProgress } : {}),
    });
  };
  return {
    capabilities: VOCAL_PROCESSOR_CAPABILITIES,
    analyze: (source, params, options) => run(() => analyzeVocalSteps(source, params), options),
    render: (request, options) =>
      run(
        () =>
          renderPitchCorrectionSteps(
            request.source,
            request.analysis,
            request.edits,
            request.quality,
          ),
        options,
      ),
    dispose: () => {
      disposed = true;
    },
  };
}
