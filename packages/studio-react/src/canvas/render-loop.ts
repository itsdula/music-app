/**
 * Single requestAnimationFrame loop for all frame-rate UI work (playhead, time readout,
 * meters, MIDI activity). Callbacks run outside React; they must be cheap and must not
 * set React state. The loop stops automatically when no callbacks are registered.
 */
export type FrameCallback = (timeMs: number) => void;

export interface FrameScheduler {
  request(callback: (timeMs: number) => void): number;
  cancel(handle: number): void;
}

const browserScheduler: FrameScheduler = {
  request: (cb) => requestAnimationFrame(cb),
  cancel: (handle) => cancelAnimationFrame(handle),
};

export class RenderLoop {
  private readonly callbacks = new Set<FrameCallback>();
  private handle: number | null = null;
  private disposed = false;

  constructor(private readonly scheduler: FrameScheduler = browserScheduler) {}

  add(callback: FrameCallback): () => void {
    this.callbacks.add(callback);
    this.ensureRunning();
    return () => {
      this.callbacks.delete(callback);
      if (this.callbacks.size === 0) this.stop();
    };
  }

  get size(): number {
    return this.callbacks.size;
  }

  dispose(): void {
    this.disposed = true;
    this.callbacks.clear();
    this.stop();
  }

  private ensureRunning(): void {
    if (this.handle !== null || this.disposed) return;
    this.handle = this.scheduler.request(this.tick);
  }

  private stop(): void {
    if (this.handle !== null) this.scheduler.cancel(this.handle);
    this.handle = null;
  }

  private readonly tick = (timeMs: number): void => {
    this.handle = null;
    for (const callback of this.callbacks) {
      try {
        callback(timeMs);
      } catch (error) {
        console.error('Render loop callback failed', error);
      }
    }
    if (this.callbacks.size > 0 && !this.disposed) this.handle = this.scheduler.request(this.tick);
  };
}
