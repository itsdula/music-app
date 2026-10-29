/**
 * Low-frequency engine state for React (lifecycle, play state, recording status,
 * capabilities, errors). High-frequency position and meters are read directly from the
 * engine inside the render loop, never through this store.
 */
import type {
  AudioEngineCapabilities,
  EngineError,
  EngineLifecycleState,
  RecordingStatus,
  TransportPlayState,
} from '@studio/audio-contracts';
import { createStore, type StoreApi } from 'zustand/vanilla';

export interface EngineStoreState {
  readonly lifecycle: EngineLifecycleState;
  readonly playState: TransportPlayState;
  readonly recording: RecordingStatus;
  readonly capabilities: AudioEngineCapabilities | null;
  readonly lastError: EngineError | null;
  /** Tick where playback starts (cursor) when transport is stopped. */
  readonly cursorTick: number;
  readonly loadingAssets: number;
}

export type EngineStore = StoreApi<EngineStoreState>;

export function createEngineStore(): EngineStore {
  return createStore<EngineStoreState>()(() => ({
    lifecycle: 'uninitialized',
    playState: 'stopped',
    recording: { phase: 'idle' },
    capabilities: null,
    lastError: null,
    cursorTick: 0,
    loadingAssets: 0,
  }));
}
