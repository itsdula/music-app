import { VocalJobCancelledError, type AbortSignalLike } from '../types';

/**
 * Long-running stages are written as generators that `yield` a progress fraction
 * (0..1) at chunk boundaries. The same code then runs synchronously (`runSteps`,
 * used by the exported stage functions) or cooperatively (`runStepsAsync`, used by the
 * inline processor, which yields to the event loop so an AbortSignal can fire).
 */
export type Steps<T> = Generator<number, T, void>;

export interface StageHooks {
  onProgress?(fraction: number): void;
  shouldCancel?(): boolean;
}

export function runSteps<T>(steps: Steps<T>, hooks?: StageHooks): T {
  for (;;) {
    if (hooks?.shouldCancel?.() === true) throw new VocalJobCancelledError();
    const next = steps.next();
    if (next.done === true) {
      hooks?.onProgress?.(1);
      return next.value;
    }
    hooks?.onProgress?.(next.value);
  }
}

/** Re-maps an inner generator's progress from [0, 1] into [from, to]. */
export function* scaleSteps<T>(inner: Steps<T>, from: number, to: number): Steps<T> {
  for (;;) {
    const next = inner.next();
    if (next.done === true) return next.value;
    yield from + (to - from) * next.value;
  }
}

interface TimerHost {
  setTimeout?: (callback: () => void, ms: number) => unknown;
}

/** Yields to the macrotask queue where a timer exists (browsers, Node, workers). */
export function yieldToEventLoop(): Promise<void> {
  const host = globalThis as TimerHost;
  if (typeof host.setTimeout === 'function') {
    const schedule = host.setTimeout;
    return new Promise((resolve) => {
      schedule(resolve, 0);
    });
  }
  return Promise.resolve();
}

export interface AsyncRunOptions {
  readonly signal?: AbortSignalLike;
  readonly onProgress?: (fraction: number) => void;
  /** Number of chunk boundaries between event-loop yields (default 4). */
  readonly yieldEvery?: number;
}

export async function runStepsAsync<T>(steps: Steps<T>, options: AsyncRunOptions = {}): Promise<T> {
  const yieldEvery = Math.max(1, options.yieldEvery ?? 4);
  let count = 0;
  for (;;) {
    if (options.signal?.aborted === true) throw new VocalJobCancelledError();
    const next = steps.next();
    if (next.done === true) {
      options.onProgress?.(1);
      return next.value;
    }
    options.onProgress?.(next.value);
    count++;
    if (count % yieldEvery === 0) await yieldToEventLoop();
  }
}
