/**
 * Context-menu builders for the piano roll (notes, empty grid, velocity lane). Actions act on
 * the note selection and go through the EditController (one undo entry each).
 */
import { gridDivisionTicks, midiToNoteName, type MidiClip, type NoteId } from '@studio/domain';
import { ClipboardPaste, Copy, CopyPlus, Plus, Scissors, Trash2, Wand2 } from 'lucide-react';
import { SEPARATOR, type MenuEntryInput } from '../../components/context-menu';
import type { StudioSession } from '../../session/studio-session';
import { selectNotes } from '../../state/ui-store';

/** Velocity presets offered in menus (dynamic marking → MIDI velocity). */
export const VELOCITY_PRESETS: ReadonlyArray<{ readonly label: string; readonly value: number }> = [
  { label: 'pp (32)', value: 32 },
  { label: 'p (48)', value: 48 },
  { label: 'mp (64)', value: 64 },
  { label: 'mf (80)', value: 80 },
  { label: 'f (100)', value: 100 },
  { label: 'ff (127)', value: 127 },
];

function velocitySubmenu(
  session: StudioSession,
  clipId: MidiClip['id'],
  ids: readonly NoteId[],
): MenuEntryInput {
  return {
    kind: 'submenu',
    id: 'notes-velocity',
    label: 'Velocity',
    disabled: ids.length === 0,
    items: VELOCITY_PRESETS.map((preset) => ({
      id: `notes-velocity-${preset.value}`,
      label: preset.label,
      onSelect: () => session.edits.setNotesVelocity(clipId, ids, preset.value),
    })),
  };
}

/** Resolves which notes a right-click on `noteId` acts on, updating the selection. */
export function noteSelectionForContextClick(
  session: StudioSession,
  clip: MidiClip,
  noteId: NoteId,
): NoteId[] {
  const selected = session.uiStore.getState().selection.noteIds;
  if (!selected.has(noteId)) session.uiStore.setState((s) => selectNotes(s, [noteId]));
  const ids = session.uiStore.getState().selection.noteIds;
  return clip.notes.filter((n) => ids.has(n.id)).map((n) => n.id);
}

export interface NoteMenuContext {
  readonly noteIds: readonly NoteId[];
  readonly anchorId: NoteId;
  /** Content tick under the pointer (snapped), for "Paste here". */
  readonly atContentTick: number;
}

export function noteMenu(
  session: StudioSession,
  clip: MidiClip,
  ctx: NoteMenuContext,
): MenuEntryInput[] {
  const { edits, uiStore, history } = session;
  const ids = ctx.noteIds;
  const anchor = clip.notes.find((n) => n.id === ctx.anchorId);
  if (!anchor || ids.length === 0) return [];
  const multi = ids.length > 1;
  const gridTicks = gridDivisionTicks(uiStore.getState().grid, history.present.meter);
  const pitches = new Set(clip.notes.filter((n) => ids.includes(n.id)).map((n) => n.pitch));
  const samePitch = clip.notes.filter((n) => pitches.has(n.pitch)).map((n) => n.id);
  const pitchLabel =
    pitches.size === 1 ? `Select all ${midiToNoteName(anchor.pitch)} notes` : 'Select same pitches';
  return [
    multi && { kind: 'label', label: `${ids.length} notes selected` },
    {
      id: 'notes-cut',
      label: 'Cut',
      shortcut: 'Mod+X',
      icon: <Scissors />,
      onSelect: () => edits.cutNotes(clip.id, ids),
    },
    {
      id: 'notes-copy',
      label: 'Copy',
      shortcut: 'Mod+C',
      icon: <Copy />,
      onSelect: () => edits.copyNotes(clip.id, ids),
    },
    {
      id: 'notes-paste',
      label: 'Paste here',
      shortcut: 'Mod+V',
      icon: <ClipboardPaste />,
      disabled: !edits.hasNoteClipboard,
      onSelect: () => edits.pasteNotes(clip.id, ctx.atContentTick),
    },
    {
      id: 'notes-duplicate',
      label: 'Duplicate',
      shortcut: 'Mod+D',
      icon: <CopyPlus />,
      onSelect: () => edits.duplicateNotes(clip.id, ids),
    },
    {
      id: 'notes-delete',
      label: multi ? `Delete ${ids.length} notes` : 'Delete note',
      shortcut: 'Del',
      icon: <Trash2 />,
      danger: true,
      onSelect: () => edits.deleteNotes(clip.id, ids),
    },
    SEPARATOR,
    {
      id: 'notes-quantize',
      label: 'Quantize',
      shortcut: 'Q',
      icon: <Wand2 />,
      onSelect: () => edits.quantizeNotes(clip.id, ids, gridTicks),
    },
    {
      kind: 'submenu',
      id: 'notes-transpose',
      label: 'Transpose',
      items: [
        {
          id: 'notes-transpose-up',
          label: 'Up a semitone',
          shortcut: '↑',
          onSelect: () => edits.transposeNotes(clip.id, ids, 1),
        },
        {
          id: 'notes-transpose-down',
          label: 'Down a semitone',
          shortcut: '↓',
          onSelect: () => edits.transposeNotes(clip.id, ids, -1),
        },
        {
          id: 'notes-transpose-octave-up',
          label: 'Up an octave',
          shortcut: 'Shift+↑',
          onSelect: () => edits.transposeNotes(clip.id, ids, 12),
        },
        {
          id: 'notes-transpose-octave-down',
          label: 'Down an octave',
          shortcut: 'Shift+↓',
          onSelect: () => edits.transposeNotes(clip.id, ids, -12),
        },
      ],
    },
    velocitySubmenu(session, clip.id, ids),
    SEPARATOR,
    {
      id: 'notes-select-all',
      label: 'Select all',
      shortcut: 'Mod+A',
      onSelect: () =>
        uiStore.setState((s) =>
          selectNotes(
            s,
            clip.notes.map((n) => n.id),
          ),
        ),
    },
    {
      id: 'notes-select-pitch',
      label: pitchLabel,
      onSelect: () => uiStore.setState((s) => selectNotes(s, samePitch)),
    },
  ];
}

export interface GridMenuContext {
  /** Content tick under the pointer (snapped), or null outside the editable range. */
  readonly atContentTick: number | null;
  /** Adds a note at the right-click position (null when not possible there). */
  readonly addNote: (() => void) | null;
}

export function gridMenu(
  session: StudioSession,
  clip: MidiClip,
  ctx: GridMenuContext,
): MenuEntryInput[] {
  const { edits, uiStore, history } = session;
  const selected = uiStore.getState().selection.noteIds;
  const gridTicks = gridDivisionTicks(uiStore.getState().grid, history.present.meter);
  return [
    {
      id: 'grid-paste',
      label: 'Paste here',
      shortcut: 'Mod+V',
      icon: <ClipboardPaste />,
      disabled: !edits.hasNoteClipboard || ctx.atContentTick === null,
      onSelect: () => edits.pasteNotes(clip.id, ctx.atContentTick ?? 0),
    },
    {
      id: 'grid-add-note',
      label: 'Add note here',
      icon: <Plus />,
      disabled: !ctx.addNote,
      onSelect: () => ctx.addNote?.(),
    },
    SEPARATOR,
    {
      id: 'grid-select-all',
      label: 'Select all',
      shortcut: 'Mod+A',
      disabled: clip.notes.length === 0,
      onSelect: () =>
        uiStore.setState((s) =>
          selectNotes(
            s,
            clip.notes.map((n) => n.id),
          ),
        ),
    },
    {
      id: 'grid-deselect',
      label: 'Deselect all',
      shortcut: 'Esc',
      disabled: selected.size === 0,
      onSelect: () => uiStore.setState((s) => selectNotes(s, [])),
    },
    {
      id: 'grid-quantize-all',
      label: 'Quantize all notes',
      icon: <Wand2 />,
      disabled: clip.notes.length === 0,
      onSelect: () =>
        edits.quantizeNotes(
          clip.id,
          clip.notes.map((n) => n.id),
          gridTicks,
        ),
    },
  ];
}

/** Velocity lane: presets for the selected notes (or all notes when nothing is selected). */
export function velocityMenu(session: StudioSession, clip: MidiClip): MenuEntryInput[] {
  const selected = session.uiStore.getState().selection.noteIds;
  const ids = clip.notes.filter((n) => selected.has(n.id)).map((n) => n.id);
  const target = ids.length > 0 ? ids : clip.notes.map((n) => n.id);
  const scope = ids.length > 0 ? `${ids.length} selected` : 'all notes';
  return [
    { kind: 'label', label: `Velocity (${scope})` },
    ...VELOCITY_PRESETS.map((preset) => ({
      id: `velocity-${preset.value}`,
      label: preset.label,
      disabled: target.length === 0,
      onSelect: () => session.edits.setNotesVelocity(clip.id, target, preset.value),
    })),
    SEPARATOR,
    {
      id: 'velocity-select-all',
      label: 'Select all notes',
      shortcut: 'Mod+A',
      disabled: clip.notes.length === 0,
      onSelect: () =>
        session.uiStore.setState((s) =>
          selectNotes(
            s,
            clip.notes.map((n) => n.id),
          ),
        ),
    },
  ];
}
