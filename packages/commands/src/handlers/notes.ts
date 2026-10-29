import {
  compareNotes,
  quantizeTick,
  sortNotes,
  type MidiClip,
  type MidiNote,
  type NoteId,
  type Project,
} from '@studio/domain';
import type { CommandOf, NotePatch } from '../types';
import { clamp, fail, mergeChanged, requireFinite, requireInt, requireUniqueIds } from '../util';
import { clampVelocity, mergeSorted, normalizeNote } from '../validate';
import { requireMidiClip, withClip } from './clips';

function withNotes(project: Project, clip: MidiClip, notes: readonly MidiNote[]): Project {
  return notes === clip.notes ? project : withClip(project, { ...clip, notes });
}

function isSorted(notes: readonly MidiNote[]): boolean {
  for (let i = 1; i < notes.length; i++)
    if (compareNotes(notes[i - 1]!, notes[i]!) > 0) return false;
  return true;
}

/**
 * Applies `transform` to the notes whose ids are listed (all must exist), keeping
 * untouched notes by reference and re-sorting only when the order actually changed.
 */
function mapNotes(
  clip: MidiClip,
  ids: ReadonlySet<string>,
  transform: (note: MidiNote) => MidiNote,
): readonly MidiNote[] {
  let found = 0;
  let changed = false;
  const next = clip.notes.map((note) => {
    if (!ids.has(note.id)) return note;
    found++;
    const updated = transform(note);
    if (updated !== note) changed = true;
    return updated;
  });
  if (found !== ids.size) {
    const present = new Set(clip.notes.map((n) => n.id));
    const missing = [...ids].find((id) => !present.has(id as NoteId));
    fail('not-found', `note ${String(missing)} not found in clip ${clip.id}`);
  }
  if (!changed) return clip.notes;
  return isSorted(next) ? next : sortNotes(next);
}

export function addNotes(project: Project, command: CommandOf<'notes.add'>): Project {
  const clip = requireMidiClip(project, command.clipId, command.type);
  if (command.notes.length === 0) return project;
  requireUniqueIds(
    command.notes.map((n) => n.id),
    'note',
  );
  const existing = new Set<string>(clip.notes.map((n) => n.id));
  for (const note of command.notes) {
    if (existing.has(note.id)) fail('invalid-argument', `note ${note.id} already exists`);
  }
  const added = sortNotes(command.notes.map(normalizeNote));
  return withNotes(project, clip, mergeSorted(clip.notes, added, compareNotes));
}

export function removeNotes(project: Project, command: CommandOf<'notes.remove'>): Project {
  const clip = requireMidiClip(project, command.clipId, command.type);
  if (command.noteIds.length === 0) return project;
  const ids = new Set<string>(command.noteIds);
  const notes = clip.notes.filter((n) => !ids.has(n.id));
  if (clip.notes.length - notes.length !== ids.size) {
    const present = new Set<string>(clip.notes.map((n) => n.id));
    const missing = [...ids].find((id) => !present.has(id));
    fail('not-found', `note ${String(missing)} not found in clip ${clip.id}`);
  }
  return withNotes(project, clip, notes);
}

function normalizeNotePatch(patch: NotePatch): Partial<MidiNote> {
  const result: { -readonly [K in keyof MidiNote]?: MidiNote[K] } = {};
  if (patch.startTick !== undefined) {
    result.startTick = Math.max(0, requireInt(patch.startTick, 'note startTick'));
  }
  if (patch.durationTicks !== undefined) {
    result.durationTicks = Math.max(1, requireInt(patch.durationTicks, 'note durationTicks'));
  }
  if (patch.pitch !== undefined) result.pitch = clamp(requireInt(patch.pitch, 'pitch'), 0, 127);
  if (patch.velocity !== undefined) result.velocity = clampVelocity(patch.velocity);
  return result;
}

/** Absolute per-note patches (start >= 0, duration >= 1, pitch 0..127, velocity 1..127). */
export function updateNotes(project: Project, command: CommandOf<'notes.update'>): Project {
  const clip = requireMidiClip(project, command.clipId, command.type);
  if (command.patches.length === 0) return project;
  const patches = new Map<string, Partial<MidiNote>>();
  for (const patch of command.patches) {
    if (patches.has(patch.id)) fail('invalid-argument', `duplicate patch for note ${patch.id}`);
    patches.set(patch.id, normalizeNotePatch(patch));
  }
  const ids = new Set(patches.keys());
  return withNotes(
    project,
    clip,
    mapNotes(clip, ids, (note) => mergeChanged(note, patches.get(note.id)!)),
  );
}

export function quantizeNotes(project: Project, command: CommandOf<'notes.quantize'>): Project {
  const clip = requireMidiClip(project, command.clipId, command.type);
  const { options } = command;
  requireFinite(options.gridTicks, 'gridTicks');
  requireFinite(options.strength, 'strength');
  if (options.swing !== undefined) requireFinite(options.swing, 'swing');
  if (command.noteIds.length === 0) return project;
  const ids = new Set<string>(command.noteIds);
  return withNotes(
    project,
    clip,
    mapNotes(clip, ids, (note) => {
      const startTick = Math.max(0, quantizeTick(note.startTick, options));
      let durationTicks = note.durationTicks;
      if (options.quantizeEnds === true) {
        const endTick = quantizeTick(note.startTick + note.durationTicks, options);
        durationTicks = endTick - startTick;
        // A note whose end collapsed onto its start keeps one grid step (QuantizeOptions doc).
        if (durationTicks < 1) durationTicks = Math.max(1, Math.round(options.gridTicks));
      }
      return mergeChanged(note, { startTick, durationTicks });
    }),
  );
}
