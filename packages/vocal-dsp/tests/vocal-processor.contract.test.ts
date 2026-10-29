import { describe, expect, it, vi } from 'vitest';
import {
  analyzeVocal,
  createInlineVocalProcessor,
  createWorkerVocalProcessor,
  DEFAULT_VOCAL_ANALYSIS_PARAMS,
  VocalJobCancelledError,
  VocalProcessorDisposedError,
  VocalWorkerError,
  type VocalWorkerLike,
} from '../src/index';
import * as fx from '@studio/test-fixtures';
import { copyPcm, editDoc } from './helpers/docs';
import { fakeWorkerFactory, FakeVocalWorker } from './helpers/fake-worker';
import { createAbortHandle, runVocalProcessorContract } from './helpers/vocal-processor-contract';

// Fixture synthesis + analysis is slow under coverage instrumentation.
vi.setConfig({ testTimeout: 120_000 });

/** Re-exported so other packages (e.g. a real Web Worker adapter) can run the same suite. */
export { runVocalProcessorContract };

runVocalProcessorContract('inline', () => createInlineVocalProcessor());
runVocalProcessorContract('worker (fake in-process worker)', () =>
  createWorkerVocalProcessor(() => new FakeVocalWorker()),
);
runVocalProcessorContract('worker without input transfer', () =>
  createWorkerVocalProcessor(() => new FakeVocalWorker(), { transferInputs: false }),
);

const SR = 48000;
const source = fx.synthesizeVowel({
  sampleRate: SR,
  durationSeconds: 0.8,
  f0: fx.constantF0(200, 0.1, 0.7),
  seed: 5,
});
const params = DEFAULT_VOCAL_ANALYSIS_PARAMS;

describe('createWorkerVocalProcessor specifics', () => {
  it('transfers request PCM to the worker (caller buffers are detached) unless disabled', async () => {
    const transferring = createWorkerVocalProcessor(() => new FakeVocalWorker());
    const owned = copyPcm(source);
    const pending = transferring.analyze(owned, params);
    expect(owned.channels[0]!.byteLength).toBe(0); // dispatched immediately → transferred
    const analysis = await pending;
    expect(analysis.pitchTrack.f0Hz.byteLength).toBeGreaterThan(0);
    transferring.dispose();

    const copying = createWorkerVocalProcessor(() => new FakeVocalWorker(), {
      transferInputs: false,
    });
    const kept = copyPcm(source);
    await copying.analyze(kept, params);
    expect(kept.channels[0]!.length).toBe(source.channels[0]!.length);
    copying.dispose();
  });

  it('does not detach the buffers of a queued job that is cancelled', async () => {
    const processor = createWorkerVocalProcessor(() => new FakeVocalWorker());
    const handle = createAbortHandle();
    const first = processor.analyze(copyPcm(source), params);
    const queuedPcm = copyPcm(source);
    const queued = processor.analyze(queuedPcm, params, { signal: handle.signal });
    handle.abort();
    await expect(queued).rejects.toBeInstanceOf(VocalJobCancelledError);
    expect(queuedPcm.channels[0]!.length).toBe(source.channels[0]!.length);
    await expect(first).resolves.toBeDefined();
    processor.dispose();
  });

  it('terminates on cancellation, respawns lazily and ignores stale results', async () => {
    const factory = fakeWorkerFactory({
      ignoreTerminate: true,
      captureHandlerAtPost: true,
      startDelayMs: 5,
    });
    const processor = createWorkerVocalProcessor(factory.create);
    const handle = createAbortHandle();
    const first = processor.analyze(copyPcm(source), params, { signal: handle.signal });
    expect(factory.created).toHaveLength(1);
    handle.abort();
    await expect(first).rejects.toBeInstanceOf(VocalJobCancelledError);
    expect(factory.created[0]!.terminated).toBe(true);
    // The old worker keeps running and will post a (stale) result for job 1 to the old
    // handler; the next job must get its own result from a fresh worker.
    const quiet = fx.silence(SR, 0.5);
    const second = await processor.analyze(copyPcm(quiet), params);
    expect(factory.created).toHaveLength(2);
    expect(second.segments).toEqual([]);
    expect(second.durationSeconds).toBeCloseTo(0.5, 9);
    processor.dispose();
  });

  it('ignores responses for other job ids and malformed messages', async () => {
    const processor = createWorkerVocalProcessor(
      () =>
        new FakeVocalWorker({
          rewrite: (data) => [
            { junk: true },
            { ...(data as Record<string, unknown>), jobId: 999 },
            { type: 'progress', jobId: 1, fraction: 'x' },
            data,
          ],
        }),
    );
    const analysis = await processor.analyze(copyPcm(source), params);
    expect(analysis.segments).toEqual(analyzeVocal(source).segments);
    processor.dispose();
  });

  it('maps worker error and cancelled responses to rejections', async () => {
    const failing = createWorkerVocalProcessor(() => new FakeVocalWorker());
    const error = await failing
      .render({
        source: { sampleRate: 1000, channels: [new Float32Array(10)] },
        analysis: analyzeVocal(source),
        edits: editDoc(analyzeVocal(source)),
        quality: 'final',
      })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(VocalWorkerError);
    expect((error as Error).name).toBe('RangeError');
    failing.dispose();

    const cancelling = createWorkerVocalProcessor(
      () =>
        new FakeVocalWorker({
          rewrite: (data) => [{ type: 'cancelled', jobId: (data as { jobId: number }).jobId }],
        }),
    );
    await expect(cancelling.analyze(copyPcm(source), params)).rejects.toBeInstanceOf(
      VocalJobCancelledError,
    );
    cancelling.dispose();
  });

  it('rejects a job whose message cannot be posted and continues with the next', async () => {
    let calls = 0;
    const flaky: () => VocalWorkerLike = () => {
      const worker = new FakeVocalWorker();
      const post = worker.postMessage.bind(worker);
      worker.postMessage = (message, transfer) => {
        if (calls++ === 0) throw new Error('DataCloneError');
        post(message, transfer);
      };
      return worker;
    };
    const processor = createWorkerVocalProcessor(flaky);
    const first = processor.analyze(copyPcm(source), params);
    const second = processor.analyze(copyPcm(source), params);
    await expect(first).rejects.toThrow('DataCloneError');
    await expect(second).resolves.toBeDefined();
    processor.dispose();
  });

  it('dispose() terminates the worker and rejects pending jobs', async () => {
    const factory = fakeWorkerFactory({ startDelayMs: 20 });
    const processor = createWorkerVocalProcessor(factory.create);
    const running = processor.analyze(copyPcm(source), params);
    const queued = processor.analyze(copyPcm(source), params);
    processor.dispose();
    processor.dispose();
    await expect(running).rejects.toBeInstanceOf(VocalProcessorDisposedError);
    await expect(queued).rejects.toBeInstanceOf(VocalProcessorDisposedError);
    expect(factory.created[0]!.terminated).toBe(true);
  });

  it('cleans up abort listeners once a job settles', async () => {
    const processor = createWorkerVocalProcessor(() => new FakeVocalWorker());
    const removed: string[] = [];
    const handle = createAbortHandle();
    const signal = {
      ...handle.signal,
      get aborted() {
        return handle.signal.aborted;
      },
      removeEventListener: (type: 'abort', listener: () => void) => {
        removed.push(type);
        handle.signal.removeEventListener(type, listener);
      },
    };
    await processor.analyze(copyPcm(source), params, { signal });
    expect(removed).toEqual(['abort']);
    handle.abort(); // late abort is harmless
    processor.dispose();
  });
});
