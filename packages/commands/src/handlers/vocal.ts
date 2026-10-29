import {
  DEFAULT_VOCAL_NOTE_EDIT,
  type AssetId,
  type Project,
  type VocalEditDoc,
  type VocalNoteEdit,
  type VocalNoteId,
} from '@studio/domain';
import type { CommandOf } from '../types';
import {
  fail,
  getOwn,
  hasOwn,
  keepIfEqual,
  mergeChanged,
  omitEntries,
  requireUniqueIds,
  setEntries,
  setEntry,
} from '../util';
import {
  applyCorrectionPatch,
  applyNoteEditPatch,
  compareSegments,
  mergeSorted,
  normalizeSegment,
  normalizeVocalDoc,
} from '../validate';

function requireDoc(project: Project, assetId: AssetId): VocalEditDoc {
  const doc = getOwn(project.vocalEdits, assetId);
  if (!doc) fail('not-found', `no vocal edits for asset ${assetId}`);
  return doc;
}

function withDoc(project: Project, doc: VocalEditDoc): Project {
  const vocalEdits = setEntry(project.vocalEdits, doc.assetId, doc);
  return vocalEdits === project.vocalEdits ? project : { ...project, vocalEdits };
}

function withNoteEdits(
  project: Project,
  doc: VocalEditDoc,
  noteEdits: VocalEditDoc['noteEdits'],
): Project {
  return noteEdits === doc.noteEdits ? project : withDoc(project, { ...doc, noteEdits });
}

/** Every id must name a segment of the doc. */
function requireSegmentIds(doc: VocalEditDoc, ids: readonly VocalNoteId[]): void {
  const present = new Set<string>(doc.segments.map((s) => s.id));
  for (const id of ids) {
    if (!present.has(id)) fail('not-found', `vocal note ${id} not found`);
  }
}

export function setDoc(project: Project, command: CommandOf<'vocal.setDoc'>): Project {
  const { doc } = command;
  if (!hasOwn(project.assets, doc.assetId)) fail('not-found', `asset ${doc.assetId} not found`);
  const normalized = normalizeVocalDoc(doc);
  const existing = getOwn(project.vocalEdits, doc.assetId);
  return withDoc(project, existing ? keepIfEqual(existing, normalized) : normalized);
}

export function removeDoc(project: Project, command: CommandOf<'vocal.removeDoc'>): Project {
  requireDoc(project, command.assetId);
  return {
    ...project,
    vocalEdits: omitEntries(project.vocalEdits, new Set([command.assetId])),
  };
}

export function setCorrection(
  project: Project,
  command: CommandOf<'vocal.setCorrection'>,
): Project {
  const doc = requireDoc(project, command.assetId);
  const correction = applyCorrectionPatch(doc.correction, command.correction);
  return correction === doc.correction ? project : withDoc(project, { ...doc, correction });
}

export function setNoteEdits(project: Project, command: CommandOf<'vocal.setNoteEdits'>): Project {
  const doc = requireDoc(project, command.assetId);
  const entries = Object.entries(command.edits) as [VocalNoteId, Partial<VocalNoteEdit>][];
  requireSegmentIds(
    doc,
    entries.map(([id]) => id),
  );
  const updates: (readonly [VocalNoteId, VocalNoteEdit])[] = [];
  for (const [id, patch] of entries) {
    const current = getOwn(doc.noteEdits, id);
    const next = applyNoteEditPatch(current ?? DEFAULT_VOCAL_NOTE_EDIT, patch);
    if (next !== current) updates.push([id, next]);
  }
  return withNoteEdits(project, doc, setEntries(doc.noteEdits, updates));
}

export function clearTargets(project: Project, command: CommandOf<'vocal.clearTargets'>): Project {
  const doc = requireDoc(project, command.assetId);
  requireSegmentIds(doc, command.noteIds);
  const updates: (readonly [VocalNoteId, VocalNoteEdit])[] = [];
  for (const id of new Set(command.noteIds)) {
    const edit = getOwn(doc.noteEdits, id);
    if (edit?.targetMidi === undefined) continue;
    const { targetMidi: _cleared, ...rest } = edit;
    updates.push([id, rest]);
  }
  return withNoteEdits(project, doc, setEntries(doc.noteEdits, updates));
}

export function resetNotes(project: Project, command: CommandOf<'vocal.resetNotes'>): Project {
  const doc = requireDoc(project, command.assetId);
  requireSegmentIds(doc, command.noteIds);
  return withNoteEdits(project, doc, omitEntries(doc.noteEdits, new Set(command.noteIds)));
}

/** Split/merge: removes segments (and their edits), adds new ones, keeps segments sorted. */
export function replaceSegments(
  project: Project,
  command: CommandOf<'vocal.replaceSegments'>,
): Project {
  const doc = requireDoc(project, command.assetId);
  requireSegmentIds(doc, command.removeIds);
  if (command.removeIds.length === 0 && command.add.length === 0) return project;
  const removed = new Set<string>(command.removeIds);
  const remaining = doc.segments.filter((s) => !removed.has(s.id));
  const added = command.add.map(normalizeSegment);
  requireUniqueIds([...remaining.map((s) => s.id), ...added.map((s) => s.id)], 'vocal note');
  added.sort(compareSegments);
  return withDoc(
    project,
    mergeChanged(doc, {
      segments: mergeSorted(remaining, added, compareSegments),
      noteEdits: omitEntries(doc.noteEdits, removed),
    }),
  );
}

export function setEnabled(project: Project, command: CommandOf<'vocal.setEnabled'>): Project {
  const doc = requireDoc(project, command.assetId);
  return withDoc(project, mergeChanged(doc, { enabled: command.enabled === true }));
}
