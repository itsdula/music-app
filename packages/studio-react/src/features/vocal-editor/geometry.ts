/**
 * Vocal pitch editor coordinate system.
 *
 * Horizontal: the shared TimeAxis on *timeline* ticks, so the pitch editor lines up with
 * the arrangement. Analysis data lives in asset source time (seconds); a clip maps source
 * time to the timeline as `clip.startTick + secondsToTicks(s − sourceStart, bpm)`.
 * Vertical: the piano-roll PitchAxis (integer pitch p occupies the row whose top is
 * `pitchToY(p)`); fractional MIDI pitches are placed at row *centres*, so a note at
 * exactly 60.0 sits in the middle of the C4 row and 60.5 sits on the C4/C#4 boundary.
 */
import {
  secondsToTicks,
  ticksToSeconds,
  type VocalNoteId,
  type VocalNoteSegment,
} from '@studio/domain';
import type { TimeAxis } from '../../canvas/time-axis';
import type { PitchAxis } from '../piano-roll/geometry';

export const VOCAL_KEYBOARD_WIDTH = 48;
export const VOCAL_RULER_HEIGHT = 22;
/** Height of the non-pitched (breath/sibilant/silence) band strip at the bottom. */
export const NON_PITCHED_BAND_HEIGHT = 6;
/** Notes below this confidence are drawn muted with a dashed outline. */
export const LOW_CONFIDENCE = 0.5;

/** The subset of an AudioClip needed to place source time on the timeline. */
export interface ClipTimeMapping {
  readonly startTick: number;
  readonly sourceStartFrame: number;
  readonly lengthFrames: number;
  readonly sampleRate: number;
  readonly bpm: number;
}

/** Timeline tick of a source-time position (seconds within the asset). */
export function sourceSecondsToTick(seconds: number, map: ClipTimeMapping): number {
  return map.startTick + secondsToTicks(seconds - map.sourceStartFrame / map.sampleRate, map.bpm);
}

/** Source-time seconds at a timeline tick (inverse of `sourceSecondsToTick`). */
export function tickToSourceSeconds(tick: number, map: ClipTimeMapping): number {
  return ticksToSeconds(tick - map.startTick, map.bpm) + map.sourceStartFrame / map.sampleRate;
}

/** Source-time window the clip plays, in seconds. */
export function clipSourceWindow(map: ClipTimeMapping): {
  readonly start: number;
  readonly end: number;
} {
  const start = map.sourceStartFrame / map.sampleRate;
  return { start, end: start + map.lengthFrames / map.sampleRate };
}

/** Y of the centre line for a (fractional) MIDI pitch. */
export function midiToY(midi: number, axis: PitchAxis): number {
  return (axis.topPitch - midi) * axis.rowHeight + axis.rowHeight / 2;
}

/** Fractional MIDI pitch at a y coordinate (inverse of `midiToY`). */
export function yToMidi(y: number, axis: PitchAxis): number {
  return axis.topPitch - (y - axis.rowHeight / 2) / axis.rowHeight;
}

export interface VocalNoteRect {
  readonly id: VocalNoteId;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/** Rectangle of a note blob centred on `displayMidi` (usually the note's target pitch). */
export function vocalNoteRect(
  segment: VocalNoteSegment,
  displayMidi: number,
  time: TimeAxis,
  pitch: PitchAxis,
  map: ClipTimeMapping,
): VocalNoteRect {
  const x0 = time.tickToX(sourceSecondsToTick(segment.startSeconds, map));
  const x1 = time.tickToX(sourceSecondsToTick(segment.endSeconds, map));
  const h = Math.max(4, pitch.rowHeight - 2);
  return {
    id: segment.id,
    x: x0,
    y: midiToY(displayMidi, pitch) - h / 2,
    w: Math.max(2, x1 - x0),
    h,
  };
}

/** Topmost (last-drawn) note under a point, or null. */
export function hitTestVocalNote(
  rects: readonly VocalNoteRect[],
  x: number,
  y: number,
): VocalNoteRect | null {
  for (let i = rects.length - 1; i >= 0; i--) {
    const r = rects[i]!;
    if (x >= r.x && x <= r.x + r.w && y >= r.y - 1 && y <= r.y + r.h + 1) return r;
  }
  return null;
}

/** Ids of notes intersecting a marquee rectangle (any corner order). */
export function vocalNotesInRect(
  rects: readonly VocalNoteRect[],
  rect: { readonly x0: number; readonly y0: number; readonly x1: number; readonly y1: number },
): VocalNoteId[] {
  const left = Math.min(rect.x0, rect.x1);
  const right = Math.max(rect.x0, rect.x1);
  const top = Math.min(rect.y0, rect.y1);
  const bottom = Math.max(rect.y0, rect.y1);
  return rects
    .filter((r) => r.x <= right && r.x + r.w >= left && r.y <= bottom && r.y + r.h >= top)
    .map((r) => r.id);
}

/** Viewport that fits a source-time span horizontally and a pitch range vertically. */
export function fitVocalViewport(options: {
  readonly startTick: number;
  readonly endTick: number;
  readonly widthPx: number;
  readonly heightPx: number;
  readonly rowHeight: number;
  readonly minMidi: number | null;
  readonly maxMidi: number | null;
}): { readonly pxPerTick: number; readonly scrollTick: number; readonly topPitch: number } {
  const width = Math.max(120, options.widthPx);
  const span = Math.max(1, options.endTick - options.startTick);
  const pxPerTick = (width * 0.94) / span;
  const scrollTick = Math.max(0, options.startTick - (width * 0.03) / pxPerTick);
  const centre =
    options.minMidi !== null && options.maxMidi !== null
      ? (options.minMidi + options.maxMidi) / 2
      : 60;
  const visibleRows = Math.max(4, options.heightPx / options.rowHeight);
  const topPitch = Math.min(127, Math.max(visibleRows - 1, Math.round(centre + visibleRows / 2)));
  return { pxPerTick, scrollTick, topPitch };
}
