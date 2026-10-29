/**
 * Incremental engine updates. Produced by the pure `diffProjects(prev, next)` in
 * @studio/engine-core by reference comparison of immutable project entities, then
 * applied by any AudioEngine backend. Payloads are complete entity DTOs (small JSON),
 * which keeps the protocol simple for IPC while avoiding full-project transfers.
 */
import type {
  Clip,
  ClipId,
  LoopRegion,
  MasterBus,
  MetronomeSettings,
  TimeSignature,
  Track,
  TrackId,
  AssetRef,
  AssetId,
} from '@studio/domain';

export type AudioGraphChange =
  | { readonly type: 'tempo'; readonly bpm: number }
  | { readonly type: 'meter'; readonly meter: TimeSignature }
  | { readonly type: 'loop'; readonly loop: LoopRegion }
  | { readonly type: 'metronome'; readonly metronome: MetronomeSettings }
  | { readonly type: 'track.add'; readonly track: Track }
  | { readonly type: 'track.update'; readonly track: Track; readonly previous: Track }
  | { readonly type: 'track.remove'; readonly trackId: TrackId }
  | { readonly type: 'track.order'; readonly trackOrder: readonly TrackId[] }
  | { readonly type: 'clip.add'; readonly clip: Clip }
  | { readonly type: 'clip.update'; readonly clip: Clip; readonly previous: Clip }
  | { readonly type: 'clip.remove'; readonly clipId: ClipId; readonly trackId: TrackId }
  | { readonly type: 'master.update'; readonly master: MasterBus; readonly previous: MasterBus }
  | { readonly type: 'asset.add'; readonly asset: AssetRef }
  | { readonly type: 'asset.remove'; readonly assetId: AssetId };

export type AudioGraphChangeType = AudioGraphChange['type'];
