/**
 * Timeline index: flattens a track's clips into playable events with fast window
 * queries for the scheduler.
 *
 * - MIDI clips → note events via the domain's `expandMidiClipNotes` (clip offset, loop
 *   and clip-bound truncation semantics are defined there), sorted by
 *   (startTick, pitch, noteId, clipId).
 * - Audio clips → one event per contiguous source read (per loop iteration) via the
 *   domain's `audioClipSegments`, carrying everything needed to start a source mid-way
 *   (source frame, clip-relative offset for fades, clip gain).
 * - Muted clips are excluded. Audio clips whose asset metadata is unknown are skipped
 *   and listed in `missingAssets`.
 *
 * Audio tick positions depend on the tempo (audio has a fixed duration), so the index
 * must be rebuilt for every track when the tempo changes.
 */
import {
  audioClipSegments,
  expandMidiClipNotes,
  framesToTicks,
  type AssetId,
  type AssetRef,
  type AudioClip,
  type Clip,
  type ClipId,
  type MidiClip,
  type NoteId,
  type Project,
  type TrackId,
} from '@studio/domain';
import { IntervalTree, lowerBoundBy } from './interval-tree';
import { decibelsToGain } from './mix';

export interface TimelineNoteEvent {
  readonly clipId: ClipId;
  readonly noteId: NoteId;
  /** 0..127 */
  readonly pitch: number;
  /** 1..127 */
  readonly velocity: number;
  /** Absolute timeline ticks [startTick, endTick). */
  readonly startTick: number;
  readonly endTick: number;
}

export interface TimelineAudioEvent {
  /** Stable identity of this segment: `${clipId}#${segmentIndex}`. */
  readonly key: string;
  readonly clipId: ClipId;
  readonly assetId: AssetId;
  /** Absolute timeline ticks (fractional) [startTick, endTick). */
  readonly startTick: number;
  readonly endTick: number;
  /** Interval accessors used by the interval tree (equal to start/endTick). */
  readonly start: number;
  readonly end: number;
  /** First source frame of this segment and its length, at `sampleRate`. */
  readonly sourceStartFrame: number;
  readonly frames: number;
  /** Asset sample rate (Hz). */
  readonly sampleRate: number;
  /** Clip-relative frame at which this segment starts (for clip-edge fades). */
  readonly clipOffsetFrames: number;
  readonly clipLengthFrames: number;
  /** Linear clip gain. */
  readonly gain: number;
  readonly fadeInFrames: number;
  readonly fadeOutFrames: number;
}

/**
 * Per-track immutable event index.
 * Queries: O(log n + k). Build: O(n log n) for n events.
 */
export class TrackTimeline {
  readonly trackId: TrackId;
  /** Sorted by (startTick, pitch, noteId, clipId). */
  readonly notes: readonly TimelineNoteEvent[];
  private readonly audioTree: IntervalTree<TimelineAudioEvent>;
  readonly missingAssets: readonly AssetId[];

  constructor(
    trackId: TrackId,
    notes: readonly TimelineNoteEvent[],
    audio: readonly TimelineAudioEvent[],
    missingAssets: readonly AssetId[] = [],
  ) {
    this.trackId = trackId;
    this.notes = [...notes].sort(compareNoteEvents);
    this.audioTree = new IntervalTree(audio);
    this.missingAssets = missingAssets;
  }

  /** Audio events sorted by (startTick, endTick). */
  get audio(): readonly TimelineAudioEvent[] {
    return this.audioTree.items;
  }

  /** Notes with startTick in [a, b), in sort order. O(log n + k). */
  notesStartingIn(a: number, b: number): TimelineNoteEvent[] {
    if (!(b > a)) return [];
    const from = lowerBoundBy(this.notes, a, (n) => n.startTick);
    const to = lowerBoundBy(this.notes, b, (n) => n.startTick);
    return this.notes.slice(from, to);
  }

  /** Audio events with startTick in [a, b), in start order. O(log n + k). */
  audioStartingIn(a: number, b: number): TimelineAudioEvent[] {
    return this.audioTree.startingIn(a, b);
  }

  /** Audio events overlapping [a, b) (start < b and end > a). O(log n + k). */
  audioOverlapping(a: number, b: number): TimelineAudioEvent[] {
    return this.audioTree.overlapping(a, b);
  }
}

function compareNoteEvents(a: TimelineNoteEvent, b: TimelineNoteEvent): number {
  return (
    a.startTick - b.startTick ||
    a.pitch - b.pitch ||
    (a.noteId < b.noteId ? -1 : a.noteId > b.noteId ? 1 : 0) ||
    (a.clipId < b.clipId ? -1 : a.clipId > b.clipId ? 1 : 0)
  );
}

/** Note events of one MIDI clip (empty when muted). O(n · loop iterations). */
export function midiClipEvents(clip: MidiClip): TimelineNoteEvent[] {
  if (clip.muted) return [];
  return expandMidiClipNotes(clip).map((e) => ({
    clipId: clip.id,
    noteId: e.note.id,
    pitch: e.note.pitch,
    velocity: e.note.velocity,
    startTick: e.startTick,
    endTick: e.endTick,
  }));
}

/**
 * Audio events of one audio clip at `bpm` (empty when muted or the asset is unknown).
 * O(loop iterations).
 */
export function audioClipEvents(
  clip: AudioClip,
  asset: Pick<AssetRef, 'sampleRate' | 'frames'> | undefined,
  bpm: number,
): TimelineAudioEvent[] {
  if (clip.muted || !asset) return [];
  const loop = clip.loopLengthFrames;
  const gain = decibelsToGain(clip.gainDb);
  return audioClipSegments(clip, asset, bpm).map((segment, index) => {
    const startTick = segment.timelineStartTick;
    const endTick = startTick + framesToTicks(segment.frames, asset.sampleRate, bpm);
    return {
      key: `${clip.id}#${index}`,
      clipId: clip.id,
      assetId: clip.assetId,
      startTick,
      endTick,
      start: startTick,
      end: endTick,
      sourceStartFrame: segment.sourceStartFrame,
      frames: segment.frames,
      sampleRate: asset.sampleRate,
      clipOffsetFrames: loop !== undefined && loop > 0 ? index * loop : 0,
      clipLengthFrames: clip.lengthFrames,
      gain,
      fadeInFrames: Math.max(0, clip.fadeInFrames),
      fadeOutFrames: Math.max(0, clip.fadeOutFrames),
    };
  });
}

/**
 * Builds the index for one track from its clips.
 *
 * - `clips` may contain clips of other tracks; they are ignored.
 * - Ownership: events reference clip ids/notes but copy all numeric data.
 * - Complexity: O(E log E) for E expanded events.
 */
export function buildTrackTimeline(
  trackId: TrackId,
  clips: Iterable<Clip>,
  assets: Readonly<Record<AssetId, AssetRef>>,
  bpm: number,
): TrackTimeline {
  const notes: TimelineNoteEvent[] = [];
  const audio: TimelineAudioEvent[] = [];
  const missing = new Set<AssetId>();
  for (const clip of clips) {
    if (clip.trackId !== trackId) continue;
    if (clip.kind === 'midi') {
      for (const event of midiClipEvents(clip)) notes.push(event);
    } else {
      const asset = assets[clip.assetId];
      if (!asset) {
        if (!clip.muted) missing.add(clip.assetId);
        continue;
      }
      for (const event of audioClipEvents(clip, asset, bpm)) audio.push(event);
    }
  }
  return new TrackTimeline(trackId, notes, audio, [...missing].sort());
}

/**
 * Builds a timeline for every track of a project (tracks without clips get an empty
 * timeline). Complexity: O(C + E log E).
 */
export function buildTimelineIndex(project: Project): Map<TrackId, TrackTimeline> {
  const byTrack = new Map<TrackId, Clip[]>();
  for (const id of project.trackOrder) byTrack.set(id, []);
  for (const id of Object.keys(project.tracks) as TrackId[]) {
    if (!byTrack.has(id)) byTrack.set(id, []);
  }
  for (const clip of Object.values(project.clips)) byTrack.get(clip.trackId)?.push(clip);
  const index = new Map<TrackId, TrackTimeline>();
  for (const [trackId, clips] of byTrack) {
    index.set(trackId, buildTrackTimeline(trackId, clips, project.assets, project.bpm));
  }
  return index;
}
