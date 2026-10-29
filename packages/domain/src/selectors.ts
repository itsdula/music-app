/**
 * Pure read-side helpers over the project model, shared by commands, engines and UI.
 */
import type { ClipId, TrackId } from './ids';
import type { AssetRef, AudioClip, Clip, MidiClip, MidiNote, Project, Track } from './model';
import { framesToTicks, ticksToFrames, type Frames, type Ticks } from './time';

export function orderedTracks(project: Project): Track[] {
  const result: Track[] = [];
  for (const id of project.trackOrder) {
    const track = project.tracks[id];
    if (track) result.push(track);
  }
  return result;
}

export function clipsOnTrack(project: Project, trackId: TrackId): Clip[] {
  return Object.values(project.clips)
    .filter((c) => c.trackId === trackId)
    .sort((a, b) => a.startTick - b.startTick || (a.id < b.id ? -1 : 1));
}

/** Timeline length of an audio clip in (fractional) ticks at the project tempo. */
export function audioClipLengthTicks(
  clip: AudioClip,
  asset: AssetRef | undefined,
  bpm: number,
): number {
  const sampleRate = asset?.sampleRate ?? 48_000;
  return framesToTicks(clip.lengthFrames, sampleRate, bpm);
}

export function clipLengthTicks(clip: Clip, project: Pick<Project, 'assets' | 'bpm'>): number {
  return clip.kind === 'midi'
    ? clip.lengthTicks
    : audioClipLengthTicks(clip, project.assets[clip.assetId], project.bpm);
}

export function clipEndTick(clip: Clip, project: Pick<Project, 'assets' | 'bpm'>): number {
  return clip.startTick + clipLengthTicks(clip, project);
}

/** End of the last clip (0 for an empty project). */
export function arrangementEndTick(project: Project): number {
  let end = 0;
  for (const clip of Object.values(project.clips)) end = Math.max(end, clipEndTick(clip, project));
  return end;
}

export function anyTrackSoloed(project: Project): boolean {
  return Object.values(project.tracks).some((t) => t.mixer.solo);
}

/** Whether a track is audible after mute/solo resolution. */
export function isTrackAudible(track: Track, soloActive: boolean): boolean {
  if (track.mixer.mute) return false;
  return soloActive ? track.mixer.solo : true;
}

export function clipKindForTrack(track: Track): Clip['kind'] {
  return track.kind === 'instrument' ? 'midi' : 'audio';
}

export function getClip(project: Project, id: ClipId): Clip | undefined {
  return project.clips[id];
}

// ---------------------------------------------------------------------------
// Clip content expansion (non-destructive offsets and loops)
// ---------------------------------------------------------------------------

export interface ExpandedNote {
  readonly note: MidiNote;
  /** Absolute timeline ticks after applying clip position, offset, loop and clip bounds. */
  readonly startTick: Ticks;
  readonly endTick: Ticks;
  /** Loop iteration index (0 for non-looping clips). */
  readonly iteration: number;
}

/**
 * Expands a MIDI clip into absolute timeline notes.
 *
 * Content time c maps to timeline time `clip.startTick + (c - contentOffsetTicks)`
 * (+ loop iterations). Notes are clipped to the visible clip window; notes that start
 * before the window are dropped (a DAW convention: no retriggering mid-note), notes that
 * extend past the window are shortened. Output is sorted by (startTick, pitch, id).
 * Complexity: O(n · iterations).
 */
export function expandMidiClipNotes(clip: MidiClip): ExpandedNote[] {
  const windowStart = clip.contentOffsetTicks;
  const windowEnd = clip.contentOffsetTicks + clip.lengthTicks;
  const result: ExpandedNote[] = [];
  const loopLength = clip.loopLengthTicks;

  const emit = (note: MidiNote, contentStart: Ticks, iteration: number, limit: Ticks) => {
    if (contentStart < windowStart || contentStart >= windowEnd) return;
    const contentEnd = Math.min(contentStart + note.durationTicks, windowEnd, limit);
    if (contentEnd <= contentStart) return;
    const delta = clip.startTick - windowStart;
    result.push({ note, startTick: contentStart + delta, endTick: contentEnd + delta, iteration });
  };

  if (loopLength === undefined || loopLength <= 0) {
    for (const note of clip.notes) emit(note, note.startTick, 0, Number.POSITIVE_INFINITY);
  } else {
    const firstIteration = Math.floor(windowStart / loopLength);
    const lastIteration = Math.floor((windowEnd - 1) / loopLength);
    for (let i = firstIteration; i <= lastIteration; i++) {
      const base = i * loopLength;
      for (const note of clip.notes) {
        if (note.startTick >= loopLength) continue;
        // Within a loop iteration a note is cut at the loop boundary.
        emit(note, base + note.startTick, i, base + loopLength);
      }
    }
  }
  result.sort(
    (a, b) =>
      a.startTick - b.startTick ||
      a.note.pitch - b.note.pitch ||
      (a.note.id < b.note.id ? -1 : a.note.id > b.note.id ? 1 : 0),
  );
  return result;
}

export interface AudioPlaybackSegment {
  /** Absolute timeline tick where this segment starts sounding. */
  readonly timelineStartTick: number;
  /** Source position and length in source frames. */
  readonly sourceStartFrame: Frames;
  readonly frames: Frames;
}

/**
 * Splits an audio clip into contiguous source reads (one per loop iteration).
 * Timeline positions are fractional ticks at the given tempo.
 */
export function audioClipSegments(
  clip: AudioClip,
  asset: Pick<AssetRef, 'sampleRate' | 'frames'>,
  bpm: number,
): AudioPlaybackSegment[] {
  const segments: AudioPlaybackSegment[] = [];
  const loop = clip.loopLengthFrames;
  if (loop === undefined || loop <= 0) {
    const frames = Math.max(0, Math.min(clip.lengthFrames, asset.frames - clip.sourceStartFrame));
    if (frames > 0) {
      segments.push({
        timelineStartTick: clip.startTick,
        sourceStartFrame: clip.sourceStartFrame,
        frames,
      });
    }
    return segments;
  }
  const available = Math.max(0, asset.frames - clip.sourceStartFrame);
  let consumed = 0;
  while (consumed < clip.lengthFrames) {
    const iterationFrames = Math.min(loop, clip.lengthFrames - consumed);
    const frames = Math.min(iterationFrames, available);
    if (frames > 0) {
      segments.push({
        timelineStartTick: clip.startTick + framesToTicks(consumed, asset.sampleRate, bpm),
        sourceStartFrame: clip.sourceStartFrame,
        frames,
      });
    }
    consumed += iterationFrames;
  }
  return segments;
}

/** Source frame of an audio clip at a timeline tick (may be outside the clip). */
export function audioClipFrameAtTick(
  clip: AudioClip,
  asset: Pick<AssetRef, 'sampleRate'>,
  bpm: number,
  tick: number,
): Frames {
  return clip.sourceStartFrame + ticksToFrames(tick - clip.startTick, asset.sampleRate, bpm);
}
