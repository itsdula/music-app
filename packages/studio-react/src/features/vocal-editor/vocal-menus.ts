/**
 * Context menu for the vocal pitch editor. Mirrors the keyboard commands (see keys.ts) and
 * acts on the vocal-note selection through `VocalActions` (each one undo entry).
 */
import type { VocalNoteId } from '@studio/domain';
import { SEPARATOR, type MenuEntryInput } from '../../components/context-menu';
import type { VocalActions } from './actions';
import { adjacentPair, hasManualTarget, noteEditOf } from './model';

export interface VocalMenuContext {
  /** Note under the pointer (null for empty space). */
  readonly noteId: VocalNoteId | null;
  /** Source position under the pointer in seconds (split candidate). */
  readonly pointerSeconds: number | null;
}

export function vocalMenu(actions: VocalActions, ctx: VocalMenuContext): MenuEntryInput[] {
  const doc = actions.doc();
  if (!doc) return [];
  if (ctx.noteId && !actions.selection().has(ctx.noteId)) actions.select([ctx.noteId]);
  const ids = [...actions.selection()];
  const hasNotes = doc.segments.length > 0;
  const selectAll: MenuEntryInput = {
    id: 'vocal-select-all',
    label: 'Select all notes',
    shortcut: 'Mod+A',
    disabled: !hasNotes,
    onSelect: () => actions.selectAll(),
  };
  if (ids.length === 0)
    return [
      selectAll,
      {
        id: 'vocal-split-here',
        label: 'Split note here',
        shortcut: 'S',
        disabled: ctx.pointerSeconds === null,
        onSelect: () => actions.split([ctx.pointerSeconds]),
      },
    ];
  const edits = ids.map((id) => noteEditOf(doc, id));
  const withTarget = ids.filter((_, i) => hasManualTarget(edits[i]!));
  const allBypassed = edits.every((e) => e.bypass);
  const multi = ids.length > 1;
  return [
    multi && { kind: 'label', label: `${ids.length} notes selected` },
    {
      id: 'vocal-up',
      label: 'Up a semitone',
      shortcut: '↑',
      onSelect: () => actions.nudge(1, false),
    },
    {
      id: 'vocal-down',
      label: 'Down a semitone',
      shortcut: '↓',
      onSelect: () => actions.nudge(-1, false),
    },
    {
      id: 'vocal-up-fine',
      label: 'Up 10 cents',
      shortcut: 'Shift+↑',
      onSelect: () => actions.nudge(1, true),
    },
    {
      id: 'vocal-down-fine',
      label: 'Down 10 cents',
      shortcut: 'Shift+↓',
      onSelect: () => actions.nudge(-1, true),
    },
    SEPARATOR,
    {
      id: 'vocal-split',
      label: 'Split note',
      shortcut: 'S',
      onSelect: () => actions.split([ctx.pointerSeconds]),
    },
    {
      id: 'vocal-merge',
      label: 'Merge with neighbour',
      shortcut: 'M',
      disabled: adjacentPair(doc.segments, new Set(ids)) === null,
      onSelect: () => actions.merge(),
    },
    {
      id: 'vocal-bypass',
      label: 'Bypass correction',
      checked: allBypassed,
      onSelect: () =>
        actions.patchSelected(
          { bypass: !allBypassed },
          allBypassed ? 'Enable Correction' : 'Bypass Correction',
        ),
    },
    SEPARATOR,
    {
      id: 'vocal-clear-target',
      label: 'Clear manual pitch',
      disabled: withTarget.length === 0,
      onSelect: () => actions.clearTargets(withTarget),
    },
    {
      id: 'vocal-reset',
      label: 'Reset to automatic',
      shortcut: 'Del',
      onSelect: () => actions.resetSelected(),
    },
    SEPARATOR,
    selectAll,
    {
      id: 'vocal-deselect',
      label: 'Deselect',
      shortcut: 'Esc',
      onSelect: () => actions.clearSelection(),
    },
  ];
}
