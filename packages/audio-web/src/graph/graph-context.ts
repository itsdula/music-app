/**
 * Everything graph-building code needs, identical for the realtime AudioContext and
 * offline renders — the single construction path that guarantees a bounce sounds like
 * playback.
 */
import type { EngineLogger } from '@studio/audio-contracts';
import type { AssetBufferStore } from '../assets';

export interface GraphContext {
  readonly ctx: BaseAudioContext;
  /** True for the realtime AudioContext; false for OfflineAudioContext renders. */
  readonly realtime: boolean;
  readonly logger: EngineLogger;
  readonly assets: AssetBufferStore;
  /** True when the studio worklet module is loaded in `ctx` (meters, recorder). */
  readonly workletReady: boolean;
  /**
   * Debounced work keyed by `owner`: realtime contexts run `fn` after `ms` (restarting
   * the timer on every call); offline contexts run it synchronously (graphs are built
   * before rendering starts, so there is nothing to debounce).
   */
  defer(owner: object, ms: number, fn: () => void): void;
  /** Cancels pending deferred work of `owner`. */
  cancelDeferred(owner: object): void;
}

export interface DisposableGraphContext extends GraphContext {
  /** Cancels all pending deferred work. */
  dispose(): void;
}

export function createGraphContext(options: {
  readonly ctx: BaseAudioContext;
  readonly realtime: boolean;
  readonly logger: EngineLogger;
  readonly assets: AssetBufferStore;
  readonly workletReady: boolean;
}): DisposableGraphContext {
  const timers = new Map<object, ReturnType<typeof setTimeout>>();
  return {
    ...options,
    defer(owner, ms, fn) {
      if (!options.realtime) {
        fn();
        return;
      }
      const existing = timers.get(owner);
      if (existing !== undefined) clearTimeout(existing);
      timers.set(
        owner,
        setTimeout(() => {
          timers.delete(owner);
          fn();
        }, ms),
      );
    },
    cancelDeferred(owner) {
      const existing = timers.get(owner);
      if (existing !== undefined) clearTimeout(existing);
      timers.delete(owner);
    },
    dispose() {
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
    },
  };
}
