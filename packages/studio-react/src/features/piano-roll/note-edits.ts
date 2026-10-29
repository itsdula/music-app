/**
 * Pure note-gesture math for the piano roll. Each function maps a gesture delta measured
 * from the gesture start to absolute `NotePatch`es, so a drag is applied with
 * `transaction.applyFromStart([...])` and never accumulates rounding error.
 */
import type { NotePatch } from '@studio/commands';
import { snapTick, type MidiClip, type MidiNote, type NoteId } from '@studio/domain';
import { MAX_PITCH, MIN_PITCH } from './geometry';

export interface SnapOptions {
  /** Grid step in ticks; 0 disables snapping. */
  readonly gridTicks: number;
}

function pickNotes(clip: MidiClip, ids: ReadonlySet<NoteId>): MidiNote[] {
  return clip.notes.filter((n) => ids.has(n.id));
}

/**
 * Moves notes by a time/pitch delta. The anchor note (the one under the pointer) snaps to
 * the grid; the others keep their offsets. Pitch and start are clamped as a group so the
 * chord shape never distorts at the boundaries.
 */
export function moveNotes(
  clip: MidiClip,
  ids: ReadonlySet<NoteId>,
  anchorId: NoteId,
  rawDeltaTicks: number,
  deltaPitch: number,
  snap: SnapOptions,
): NotePatch[] {
  const notes = pickNotes(clip, ids);
  const anchor = notes.find((n) => n.id === anchorId) ?? notes[0];
  if (!anchor) return [];
  let deltaTicks = Math.round(rawDeltaTicks);
  if (snap.gridTicks > 0) deltaTicks = snapTick(anchor.startTick + rawDeltaTicks, snap.gridTicks) - anchor.startTick;
  const minStart = Math.min(...notes.map((n) => n.startTick));
  if (minStart + deltaTicks < 0) deltaTicks = -minStart;
  const minPitch = Math.min(...notes.map((n) => n.pitch));
  const maxPitch = Math.max(...notes.map((n) => n.pitch));
  const dp = Math.min(MAX_PITCH - maxPitch, Math.max(MIN_PITCH - minPitch, Math.round(deltaPitch)));
  if (deltaTicks === 0 && dp === 0) return [];
  return notes.map((n) => ({ id: n.id, startTick: n.startTick + deltaTicks, pitch: n.pitch + dp }));
}

/** Resizes note ends; the anchor's end snaps, others change by the same amount (min length 1 tick or 1 grid step). */
export function resizeNoteEnds(
  clip: MidiClip,
  ids: ReadonlySet<NoteId>,
  anchorId: NoteId,
  rawDeltaTicks: number,
  snap: SnapOptions,
): NotePatch[] {
  const notes = pickNotes(clip, ids);
  const anchor = notes.find((n) => n.id === anchorId) ?? notes[0];
  if (!anchor) return [];
  const anchorEnd = anchor.startTick + anchor.durationTicks;
  let delta = Math.round(rawDeltaTicks);
  if (snap.gridTicks > 0) delta = snapTick(anchorEnd + rawDeltaTicks, snap.gridTicks) - anchorEnd;
  const minLength = snap.gridTicks > 0 ? Math.min(snap.gridTicks, Math.min(...notes.map((n) => n.durationTicks))) : 1;
  return notes.map((n) => ({ id: n.id, durationTicks: Math.max(minLength, n.durationTicks + delta) }));
}

/** Moves note starts while keeping ends fixed. */
export function resizeNoteStarts(
  clip: MidiClip,
  ids: ReadonlySet<NoteId>,
  anchorId: NoteId,
  rawDeltaTicks: number,
  snap: SnapOptions,
): NotePatch[] {
  const notes = pickNotes(clip, ids);
  const anchor = notes.find((n) => n.id === anchorId) ?? notes[0];
  if (!anchor) return [];
  let delta = Math.round(rawDeltaTicks);
  if (snap.gridTicks > 0) delta = snapTick(anchor.startTick + rawDeltaTicks, snap.gridTicks) - anchor.startTick;
  return notes.map((n) => {
    const end = n.startTick + n.durationTicks;
    const start = Math.min(end - 1, Math.max(0, n.startTick + delta));
    return { id: n.id, startTick: start, durationTicks: end - start };
  });
}

/** Sets velocities relative to their starting values (vertical drag in the velocity lane). */
export function scaleVelocities(clip: MidiClip, ids: ReadonlySet<NoteId>, deltaVelocity: number): NotePatch[] {
  return pickNotes(clip, ids).map((n) => ({
    id: n.id,
    velocity: Math.min(127, Math.max(1, Math.round(n.velocity + deltaVelocity))),
  }));
}

/** Nudges notes with the keyboard (arrow keys). */
export function nudgeNotes(clip: MidiClip, ids: ReadonlySet<NoteId>, deltaTicks: number, deltaPitch: number): NotePatch[] {
  const notes = pickNotes(clip, ids);
  if (notes.length === 0) return [];
  const minStart = Math.min(...notes.map((n) => n.startTick));
  const dt = Math.max(-minStart, deltaTicks);
  const minPitch = Math.min(...notes.map((n) => n.pitch));
  const maxPitch = Math.max(...notes.map((n) => n.pitch));
  const dp = Math.min(MAX_PITCH - maxPitch, Math.max(MIN_PITCH - minPitch, deltaPitch));
  if (dt === 0 && dp === 0) return [];
  return notes.map((n) => ({ id: n.id, startTick: n.startTick + dt, pitch: n.pitch + dp }));
}
