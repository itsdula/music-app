/**
 * Note-level commands for the vocal editor, shared by the canvas, the notes table and the
 * inspector. Always reads the *current* document from history so handlers never act on a
 * stale render's data.
 */
import type { Command } from '@studio/commands';
import type { AssetId, VocalEditDoc, VocalNoteEdit, VocalNoteId } from '@studio/domain';
import { mergeSegments, splitSegment, type VocalAnalysis } from '@studio/vocal-dsp';
import type { StudioSession } from '../../session/studio-session';
import { selectVocalNotes } from '../../state/ui-store';
import {
  adjacentPair,
  chooseSplit,
  displayTargetMidi,
  hasManualTarget,
  noteEditOf,
  nudgeTargetMidi,
} from './model';

export interface VocalActions {
  doc(): VocalEditDoc | undefined;
  /** Selected ids that still exist in the document. */
  selection(): ReadonlySet<VocalNoteId>;
  select(ids: readonly VocalNoteId[], mode?: 'replace' | 'toggle'): void;
  selectAll(): void;
  clearSelection(): void;
  /** ±1 semitone (or ±10 cents when `fine`) on every selected note. */
  nudge(direction: 1 | -1, fine: boolean): boolean;
  /** Back to automatic correction and default per-note settings. */
  resetSelected(): boolean;
  clearTargets(ids: readonly VocalNoteId[]): boolean;
  /** Applies the same patch to every selected note (coalesced per gesture key). */
  patchSelected(patch: Partial<VocalNoteEdit>, label: string, coalesceKey?: string): boolean;
  split(candidatesSeconds: readonly (number | null)[]): boolean;
  merge(): boolean;
}

export function createVocalActions(
  session: StudioSession,
  assetId: AssetId,
  analysis: VocalAnalysis,
): VocalActions {
  const { history, uiStore } = session;
  const doc = () => history.present.vocalEdits[assetId];
  const selection = (): ReadonlySet<VocalNoteId> => {
    const current = doc();
    const ids = uiStore.getState().selection.vocalNoteIds;
    if (!current) return new Set();
    const present = new Set(current.segments.map((s) => s.id));
    return new Set([...ids].filter((id) => present.has(id)));
  };
  const select = (ids: readonly VocalNoteId[], mode: 'replace' | 'toggle' = 'replace') =>
    uiStore.setState((s) => selectVocalNotes(s, ids, mode));

  const run = (commands: readonly Command[], label: string, coalesceKey?: string): boolean => {
    if (commands.length === 0) return false;
    const options = coalesceKey === undefined ? { label } : { label, coalesceKey };
    const result =
      commands.length === 1
        ? history.execute(commands[0]!, options)
        : history.executeBatch(commands, options);
    return result.ok;
  };

  return {
    doc,
    selection,
    select,
    selectAll: () => select(doc()?.segments.map((s) => s.id) ?? []),
    clearSelection: () => select([]),
    nudge(direction, fine) {
      const current = doc();
      const ids = selection();
      if (!current || ids.size === 0) return false;
      const edits: Record<VocalNoteId, Partial<VocalNoteEdit>> = {};
      for (const segment of current.segments) {
        if (!ids.has(segment.id)) continue;
        edits[segment.id] = {
          targetMidi: nudgeTargetMidi(displayTargetMidi(segment, current), direction, fine),
        };
      }
      return run(
        [{ type: 'vocal.setNoteEdits', assetId, edits }],
        ids.size > 1 ? 'Nudge Vocal Notes' : 'Nudge Vocal Note',
        `vocal-nudge:${assetId}`,
      );
    },
    resetSelected() {
      const ids = [...selection()];
      if (ids.length === 0) return false;
      return run(
        [{ type: 'vocal.resetNotes', assetId, noteIds: ids }],
        ids.length > 1 ? 'Reset Vocal Notes' : 'Reset Vocal Note',
      );
    },
    clearTargets(ids) {
      const current = doc();
      if (!current) return false;
      const withTarget = ids.filter((id) => hasManualTarget(noteEditOf(current, id)));
      if (withTarget.length === 0) return false;
      return run(
        [{ type: 'vocal.clearTargets', assetId, noteIds: withTarget }],
        'Clear Note Target',
      );
    },
    patchSelected(patch, label, coalesceKey) {
      const ids = [...selection()];
      if (ids.length === 0) return false;
      const edits: Record<VocalNoteId, Partial<VocalNoteEdit>> = {};
      for (const id of ids) edits[id] = patch;
      return run([{ type: 'vocal.setNoteEdits', assetId, edits }], label, coalesceKey);
    },
    split(candidatesSeconds) {
      const current = doc();
      if (!current) return false;
      const choice = chooseSplit(current.segments, selection(), candidatesSeconds);
      if (!choice) return false;
      const ids = [session.ids.create('vocalNote'), session.ids.create('vocalNote')] as const;
      const [left, right] = splitSegment(
        analysis.pitchTrack,
        choice.segment,
        choice.atSeconds,
        ids,
      );
      const commands: Command[] = [
        {
          type: 'vocal.replaceSegments',
          assetId,
          removeIds: [choice.segment.id],
          add: [left, right],
        },
      ];
      const edit = current.noteEdits[choice.segment.id];
      if (edit)
        commands.push({
          type: 'vocal.setNoteEdits',
          assetId,
          edits: { [left.id]: edit, [right.id]: edit },
        });
      const ok = run(commands, 'Split Vocal Note');
      if (ok) select([left.id, right.id]);
      return ok;
    },
    merge() {
      const current = doc();
      if (!current) return false;
      const pair = adjacentPair(current.segments, selection());
      if (!pair) return false;
      const [a, b] = pair;
      const merged = mergeSegments(analysis.pitchTrack, a, b, session.ids.create('vocalNote'));
      const commands: Command[] = [
        { type: 'vocal.replaceSegments', assetId, removeIds: [a.id, b.id], add: [merged] },
      ];
      // Keep the first note's edits (e.g. its manual target) on the merged note.
      const edit = current.noteEdits[a.id] ?? current.noteEdits[b.id];
      if (edit)
        commands.push({ type: 'vocal.setNoteEdits', assetId, edits: { [merged.id]: edit } });
      const ok = run(commands, 'Merge Vocal Notes');
      if (ok) select([merged.id]);
      return ok;
    },
  };
}
