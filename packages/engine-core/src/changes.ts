/**
 * Incremental engine updates produced by {@link diffProjects}.
 *
 * This union is a structural mirror of `AudioGraphChange` in `@studio/audio-contracts`.
 * engine-core's manifest currently depends only on `@studio/domain`, so the frozen
 * contract type cannot be imported here; `@studio/audio-web` (which depends on both)
 * contains a compile-time check that the two types are mutually assignable, so any
 * drift fails `typecheck`. Once `@studio/audio-contracts` is added to this package's
 * dependencies, replace this file with a re-export.
 */
import type {
  AssetId,
  AssetRef,
  Clip,
  ClipId,
  LoopRegion,
  MasterBus,
  MetronomeSettings,
  TimeSignature,
  Track,
  TrackId,
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
