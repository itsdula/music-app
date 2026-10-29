import type { MidiClip, MidiNote, NoteId } from '@studio/domain';
import type { TimeAxis } from '../../canvas/time-axis';
import { EDGE_HIT_PX, noteRect, type PitchAxis } from './geometry';

export type NoteHitRegion = 'body' | 'start-edge' | 'end-edge';

export interface NoteHit {
  readonly note: MidiNote;
  readonly region: NoteHitRegion;
}

/**
 * Finds the top-most note under a point. Later notes in sort order are drawn on top, so we
 * scan backwards. O(n) over the clip's notes, which is fine for interactive sizes (≤ 10k);
 * callers may pre-filter to the visible range.
 */
export function hitTestNote(
  clip: MidiClip,
  time: TimeAxis,
  pitch: PitchAxis,
  x: number,
  y: number,
): NoteHit | null {
  for (let i = clip.notes.length - 1; i >= 0; i--) {
    const note = clip.notes[i]!;
    const r = noteRect(note, clip, time, pitch);
    if (y < r.y || y >= r.y + r.h || x < r.x || x >= r.x + r.w) continue;
    const edge = Math.min(EDGE_HIT_PX, r.w / 3);
    if (x >= r.x + r.w - edge) return { note, region: 'end-edge' };
    if (x < r.x + edge && r.w > 12) return { note, region: 'start-edge' };
    return { note, region: 'body' };
  }
  return null;
}

/** Notes whose rectangles intersect a marquee rectangle (any overlap). */
export function notesInRect(
  clip: MidiClip,
  time: TimeAxis,
  pitch: PitchAxis,
  rect: { readonly x0: number; readonly y0: number; readonly x1: number; readonly y1: number },
): NoteId[] {
  const left = Math.min(rect.x0, rect.x1);
  const right = Math.max(rect.x0, rect.x1);
  const top = Math.min(rect.y0, rect.y1);
  const bottom = Math.max(rect.y0, rect.y1);
  const ids: NoteId[] = [];
  for (const note of clip.notes) {
    const r = noteRect(note, clip, time, pitch);
    if (r.x < right && r.x + r.w > left && r.y < bottom && r.y + r.h > top) ids.push(note.id);
  }
  return ids;
}
