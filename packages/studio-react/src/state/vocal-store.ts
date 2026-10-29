import type { AssetId } from '@studio/domain';
import { createStore, type StoreApi } from 'zustand/vanilla';

export interface VocalAssetState {
  readonly phase: 'idle' | 'analyzing' | 'ready' | 'error';
  readonly progress: number;
  readonly error: string | null;
  /** True while a preview render for the current edits is in flight. */
  readonly rendering: boolean;
  /** Incremented when a new analysis object is available (typed arrays live in the controller). */
  readonly analysisVersion: number;
}

export interface VocalStoreState {
  readonly assets: Readonly<Record<AssetId, VocalAssetState>>;
}

export type VocalStore = StoreApi<VocalStoreState>;

export const IDLE_VOCAL_STATE: VocalAssetState = {
  phase: 'idle',
  progress: 0,
  error: null,
  rendering: false,
  analysisVersion: 0,
};

export function createVocalStore(): VocalStore {
  return createStore<VocalStoreState>()(() => ({ assets: {} }));
}
