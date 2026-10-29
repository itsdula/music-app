/**
 * Scheduler heartbeat: calls `onTick` every `intervalMs` while running.
 *
 * Preferred: a dedicated Worker built from the inline CLOCK_WORKER_SOURCE bundle (Blob
 * URL), whose timers keep firing in background tabs. Fallback (no Worker support, or the
 * Blob worker is blocked by CSP): main-thread setInterval. Either way the heartbeat only
 * *wakes* the scheduler; what gets scheduled is computed from AudioContext time.
 */
import type { EngineLogger } from '@studio/audio-contracts';
import { CLOCK_WORKER_SOURCE } from '../generated/inline-bundles';
import { describeError } from '../errors';

export type HeartbeatMode = 'worker' | 'interval';

export class Heartbeat {
  private worker: Worker | null = null;
  private workerUrl: string | null = null;
  private interval: ReturnType<typeof setInterval> | undefined;
  private running = false;

  constructor(
    private readonly intervalMs: number,
    private readonly onTick: () => void,
    logger: EngineLogger,
    preferWorker = true,
  ) {
    if (preferWorker && typeof Worker !== 'undefined' && typeof Blob !== 'undefined') {
      try {
        this.workerUrl = URL.createObjectURL(
          new Blob([CLOCK_WORKER_SOURCE], { type: 'text/javascript' }),
        );
        this.worker = new Worker(this.workerUrl);
        this.worker.onmessage = () => this.onTick();
        this.worker.onerror = (event) => {
          logger.warn('scheduler worker failed; falling back to setInterval', {
            message: event.message,
          });
          this.worker?.terminate();
          this.worker = null;
          if (this.running) this.startInterval();
        };
      } catch (error) {
        logger.warn('scheduler worker unavailable; using setInterval', {
          error: describeError(error),
        });
        this.worker = null;
      }
    }
  }

  /** Current timer source (switches to 'interval' if the worker errors). */
  get mode(): HeartbeatMode {
    return this.worker ? 'worker' : 'interval';
  }

  private startInterval(): void {
    if (this.interval === undefined) this.interval = setInterval(this.onTick, this.intervalMs);
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    if (this.worker) this.worker.postMessage({ type: 'start', intervalMs: this.intervalMs });
    else this.startInterval();
  }

  stop(): void {
    this.running = false;
    this.worker?.postMessage({ type: 'stop' });
    if (this.interval !== undefined) clearInterval(this.interval);
    this.interval = undefined;
  }

  get isRunning(): boolean {
    return this.running;
  }

  dispose(): void {
    this.stop();
    if (this.worker) {
      this.worker.onmessage = null;
      this.worker.onerror = null;
      this.worker.terminate();
      this.worker = null;
    }
    // Kept until now: some engines resolve Blob URLs lazily while the worker loads.
    if (this.workerUrl) URL.revokeObjectURL(this.workerUrl);
    this.workerUrl = null;
  }
}
