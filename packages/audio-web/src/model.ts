/**
 * The engine's own copy of the audio-relevant project state, kept current by applying
 * `AudioGraphChange`s (the engine never receives the full next project after load).
 */
import type { AudioGraphChange } from '@studio/audio-contracts';
import type {
  AssetId,
  AssetRef,
  Clip,
  ClipId,
  LoopRegion,
  MasterBus,
  MetronomeSettings,
  Project,
  TimeSignature,
  Track,
  TrackId,
} from '@studio/domain';
import { buildTrackTimeline, type TrackTimeline } from '@studio/engine-core';

/** The audio-relevant subset of a project (a `Project` satisfies it). */
export type EngineModelState = Pick<
  Project,
  'bpm' | 'meter' | 'loop' | 'metronome' | 'trackOrder' | 'tracks' | 'clips' | 'master' | 'assets'
>;

export class EngineModel {
  bpm: number;
  meter: TimeSignature;
  loop: LoopRegion;
  metronome: MetronomeSettings;
  trackOrder: readonly TrackId[];
  readonly tracks = new Map<TrackId, Track>();
  readonly clips = new Map<ClipId, Clip>();
  master: MasterBus;
  readonly assets = new Map<AssetId, AssetRef>();
  private readonly timelines = new Map<TrackId, TrackTimeline>();
  private readonly dirty = new Set<TrackId>();

  constructor(project: EngineModelState) {
    this.bpm = project.bpm;
    this.meter = project.meter;
    this.loop = project.loop;
    this.metronome = project.metronome;
    this.trackOrder = project.trackOrder;
    this.master = project.master;
    for (const [id, track] of Object.entries(project.tracks) as [TrackId, Track][])
      this.tracks.set(id, track);
    for (const [id, clip] of Object.entries(project.clips) as [ClipId, Clip][])
      this.clips.set(id, clip);
    for (const [id, asset] of Object.entries(project.assets) as [AssetId, AssetRef][])
      this.assets.set(id, asset);
    for (const id of this.tracks.keys()) this.dirty.add(id);
  }

  /** Independent copy (entities are immutable and shared; maps and timelines are not). */
  clone(): EngineModel {
    return new EngineModel({
      bpm: this.bpm,
      meter: this.meter,
      loop: this.loop,
      metronome: this.metronome,
      trackOrder: this.trackOrder,
      tracks: Object.fromEntries(this.tracks) as Record<TrackId, Track>,
      clips: Object.fromEntries(this.clips) as Record<ClipId, Clip>,
      master: this.master,
      assets: Object.fromEntries(this.assets) as Record<AssetId, AssetRef>,
    });
  }

  /** Tracks in mixer order (trackOrder first, then any others). */
  orderedTracks(): Track[] {
    const seen = new Set<TrackId>();
    const result: Track[] = [];
    for (const id of this.trackOrder) {
      const track = this.tracks.get(id);
      if (track && !seen.has(id)) {
        seen.add(id);
        result.push(track);
      }
    }
    for (const [id, track] of this.tracks) if (!seen.has(id)) result.push(track);
    return result;
  }

  /** Asset ids referenced by clips and samplers. */
  referencedAssets(): Set<AssetId> {
    const ids = new Set<AssetId>();
    for (const clip of this.clips.values()) if (clip.kind === 'audio') ids.add(clip.assetId);
    for (const track of this.tracks.values()) {
      const sample =
        track.instrument?.kind === 'sampler' ? track.instrument.sampleAssetId : undefined;
      if (sample) ids.add(sample);
    }
    return ids;
  }

  /** Current timeline of a track (rebuilt lazily after changes). */
  timeline(trackId: TrackId): TrackTimeline | undefined {
    if (!this.tracks.has(trackId)) return undefined;
    if (this.dirty.has(trackId) || !this.timelines.has(trackId)) {
      const clips: Clip[] = [];
      for (const clip of this.clips.values()) if (clip.trackId === trackId) clips.push(clip);
      const assets = Object.fromEntries(this.assets) as Record<AssetId, AssetRef>;
      this.timelines.set(trackId, buildTrackTimeline(trackId, clips, assets, this.bpm));
      this.dirty.delete(trackId);
    }
    return this.timelines.get(trackId);
  }

  markDirty(trackId: TrackId): void {
    this.dirty.add(trackId);
  }

  markAllDirty(): void {
    for (const id of this.tracks.keys()) this.dirty.add(id);
  }

  /**
   * Applies one change to the mirror and returns the tracks whose timelines changed.
   * Graph updates are the caller's job.
   */
  apply(change: AudioGraphChange): Set<TrackId> {
    const touched = new Set<TrackId>();
    switch (change.type) {
      case 'tempo':
        this.bpm = change.bpm;
        this.markAllDirty();
        for (const id of this.tracks.keys()) touched.add(id);
        break;
      case 'meter':
        this.meter = change.meter;
        break;
      case 'loop':
        this.loop = change.loop;
        break;
      case 'metronome':
        this.metronome = change.metronome;
        break;
      case 'track.add':
      case 'track.update':
        this.tracks.set(change.track.id, change.track);
        if (!this.trackOrder.includes(change.track.id))
          this.trackOrder = [...this.trackOrder, change.track.id];
        this.markDirty(change.track.id);
        break;
      case 'track.remove':
        this.tracks.delete(change.trackId);
        this.timelines.delete(change.trackId);
        this.dirty.delete(change.trackId);
        this.trackOrder = this.trackOrder.filter((id) => id !== change.trackId);
        break;
      case 'track.order':
        this.trackOrder = change.trackOrder;
        break;
      case 'clip.add':
        this.clips.set(change.clip.id, change.clip);
        touched.add(change.clip.trackId);
        break;
      case 'clip.update':
        this.clips.set(change.clip.id, change.clip);
        touched.add(change.clip.trackId);
        touched.add(change.previous.trackId);
        break;
      case 'clip.remove':
        this.clips.delete(change.clipId);
        touched.add(change.trackId);
        break;
      case 'master.update':
        this.master = change.master;
        break;
      case 'asset.add':
        this.assets.set(change.asset.id, change.asset);
        for (const clip of this.clips.values()) {
          if (clip.kind === 'audio' && clip.assetId === change.asset.id) touched.add(clip.trackId);
        }
        break;
      case 'asset.remove':
        this.assets.delete(change.assetId);
        for (const clip of this.clips.values()) {
          if (clip.kind === 'audio' && clip.assetId === change.assetId) touched.add(clip.trackId);
        }
        break;
    }
    for (const id of touched) this.markDirty(id);
    return touched;
  }
}
