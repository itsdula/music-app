/**
 * Piano-roll coordinate system. Horizontal positions use the shared TimeAxis on the
 * *timeline* (absolute ticks), so the piano roll and arrangement agree exactly. Note
 * content ticks are converted through the clip window.
 */
import type { MidiClip, MidiNote } from '@studio/domain';
import type { TimeAxis } from '../../canvas/time-axis';

export const MIN_PITCH = 0;
export const MAX_PITCH = 127;
export const KEYBOARD_WIDTH = 56;
export const RULER_HEIGHT = 24;
export const VELOCITY_LANE_HEIGHT = 64;
export const EDGE_HIT_PX = 6;

export interface PitchAxis {
  /** Pitch whose row top sits at y = 0 (fractional for smooth scrolling). */
  readonly topPitch: number;
  readonly rowHeight: number;
}

/** Top y of the row for `pitch`. */
export function pitchToY(pitch: number, axis: PitchAxis): number {
  return (axis.topPitch - pitch) * axis.rowHeight;
}

/** Pitch of the row containing `y`. */
export function yToPitch(y: number, axis: PitchAxis): number {
  return Math.ceil(axis.topPitch - y / axis.rowHeight - 1e-9);
}

export function clampPitch(pitch: number): number {
  return Math.min(MAX_PITCH, Math.max(MIN_PITCH, Math.round(pitch)));
}

export function clampTopPitch(topPitch: number, viewHeight: number, rowHeight: number): number {
  const visibleRows = viewHeight / rowHeight;
  return Math.min(MAX_PITCH + 1, Math.max(MIN_PITCH + visibleRows - 1, topPitch));
}

/** Timeline tick of a content tick for a (non-looping view of a) clip. */
export function contentToTimeline(
  clip: Pick<MidiClip, 'startTick' | 'contentOffsetTicks'>,
  contentTick: number,
): number {
  return clip.startTick + contentTick - clip.contentOffsetTicks;
}

export function timelineToContent(
  clip: Pick<MidiClip, 'startTick' | 'contentOffsetTicks'>,
  timelineTick: number,
): number {
  return timelineTick - clip.startTick + clip.contentOffsetTicks;
}

/** Editable content window of the clip (the loop region when looping, otherwise the visible window). */
export function editableContentRange(clip: MidiClip): {
  readonly start: number;
  readonly end: number;
} {
  if (clip.loopLengthTicks !== undefined && clip.loopLengthTicks > 0)
    return { start: 0, end: clip.loopLengthTicks };
  return { start: clip.contentOffsetTicks, end: clip.contentOffsetTicks + clip.lengthTicks };
}

export interface NoteRect {
  readonly note: MidiNote;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export function noteRect(
  note: MidiNote,
  clip: MidiClip,
  time: TimeAxis,
  pitch: PitchAxis,
): NoteRect {
  const x = time.tickToX(contentToTimeline(clip, note.startTick));
  const w = Math.max(2, time.span(note.durationTicks));
  const y = pitchToY(note.pitch, pitch);
  return { note, x, y, w, h: pitch.rowHeight };
}

export function isBlackKey(pitch: number): boolean {
  const pc = ((pitch % 12) + 12) % 12;
  return pc === 1 || pc === 3 || pc === 6 || pc === 8 || pc === 10;
}
