/**
 * Ephemeral editor state (never persisted inside the project): selection, viewports,
 * panel layout, active editor, grid/snap and tool. A vanilla Zustand store so controllers
 * and canvas renderers can read it without React.
 */
import type { ClipId, GridDivision, NoteId, TrackId, VocalNoteId } from '@studio/domain';
import { createStore, type StoreApi } from 'zustand/vanilla';

export type BottomPanel = 'editor' | 'mixer' | 'controller';
/**
 * Top-level Studio pages: the project list, the arrangement (with the bottom panel) and a
 * full-height clip editor (piano roll / audio / vocal) for focused editing.
 */
export type StudioView = 'projects' | 'arrange' | 'editor';
export const STUDIO_VIEWS: readonly StudioView[] = ['projects', 'arrange', 'editor'];
export type EditTool = 'select' | 'draw';

export interface Viewport {
  /** Pixels per tick. */
  readonly pxPerTick: number;
  readonly scrollTick: number;
}

export interface PianoRollViewport extends Viewport {
  /** Highest visible MIDI pitch at the top edge (fractional for smooth scrolling). */
  readonly topPitch: number;
  readonly rowHeight: number;
}

export interface VocalViewport extends Viewport {
  readonly topPitch: number;
  readonly rowHeight: number;
}

export interface Selection {
  readonly trackId: TrackId | null;
  readonly clipIds: ReadonlySet<ClipId>;
  /** Clip open in the bottom editor. */
  readonly editorClipId: ClipId | null;
  readonly noteIds: ReadonlySet<NoteId>;
  readonly vocalNoteIds: ReadonlySet<VocalNoteId>;
}

export interface PanelLayout {
  readonly browserOpen: boolean;
  readonly browserWidth: number;
  readonly bottomOpen: boolean;
  readonly bottomHeight: number;
  readonly bottomPanel: BottomPanel;
}

export interface UiState {
  readonly view: StudioView;
  /** Right-side AI assistant panel. */
  readonly assistantOpen: boolean;
  readonly selection: Selection;
  readonly arrangement: Viewport & { readonly trackHeight: number; readonly scrollY: number };
  readonly pianoRoll: PianoRollViewport;
  readonly vocal: VocalViewport;
  readonly grid: GridDivision;
  readonly snap: boolean;
  readonly tool: EditTool;
  readonly panels: PanelLayout;
  readonly followPlayhead: boolean;
  /** Audio clip editor mode; 'auto' = pitch editor on vocal tracks, audio editor elsewhere. */
  readonly audioEditorMode: 'auto' | 'audio' | 'pitch';
}

const EMPTY_SET: ReadonlySet<never> = new Set<never>();

export const INITIAL_UI_STATE: UiState = {
  view: 'arrange',
  assistantOpen: false,
  selection: {
    trackId: null,
    clipIds: EMPTY_SET,
    editorClipId: null,
    noteIds: EMPTY_SET,
    vocalNoteIds: EMPTY_SET,
  },
  arrangement: { pxPerTick: 48 / 960, scrollTick: 0, trackHeight: 64, scrollY: 0 },
  pianoRoll: { pxPerTick: 96 / 960, scrollTick: 0, topPitch: 84, rowHeight: 14 },
  vocal: { pxPerTick: 96 / 960, scrollTick: 0, topPitch: 79, rowHeight: 14 },
  grid: '1/16',
  snap: true,
  tool: 'select',
  panels: {
    browserOpen: true,
    browserWidth: 232,
    bottomOpen: true,
    bottomHeight: 300,
    bottomPanel: 'editor',
  },
  followPlayhead: true,
  audioEditorMode: 'auto',
};

export type UiStore = StoreApi<UiState>;

export function createUiStore(initial: Partial<UiState> = {}): UiStore {
  return createStore<UiState>()(() => ({ ...INITIAL_UI_STATE, ...initial }));
}

// --- pure state updaters (keep logic testable and out of components) -----------------------

export function navigate(state: UiState, view: StudioView): UiState {
  return state.view === view ? state : { ...state, view };
}

export function selectTrack(state: UiState, trackId: TrackId | null): UiState {
  if (state.selection.trackId === trackId) return state;
  return { ...state, selection: { ...state.selection, trackId } };
}

export function selectClips(
  state: UiState,
  clipIds: readonly ClipId[],
  mode: 'replace' | 'toggle' | 'add' = 'replace',
): UiState {
  let next: Set<ClipId>;
  if (mode === 'replace') next = new Set(clipIds);
  else {
    next = new Set(state.selection.clipIds);
    for (const id of clipIds) {
      if (mode === 'toggle' && next.has(id)) next.delete(id);
      else next.add(id);
    }
  }
  return { ...state, selection: { ...state.selection, clipIds: next } };
}

export function openClipInEditor(state: UiState, clipId: ClipId | null): UiState {
  if (state.selection.editorClipId === clipId) return state;
  return {
    ...state,
    selection: {
      ...state.selection,
      editorClipId: clipId,
      noteIds: EMPTY_SET,
      vocalNoteIds: EMPTY_SET,
    },
    panels: clipId ? { ...state.panels, bottomOpen: true, bottomPanel: 'editor' } : state.panels,
  };
}

export function selectNotes(
  state: UiState,
  noteIds: readonly NoteId[],
  mode: 'replace' | 'toggle' | 'add' = 'replace',
): UiState {
  let next: Set<NoteId>;
  if (mode === 'replace') next = new Set(noteIds);
  else {
    next = new Set(state.selection.noteIds);
    for (const id of noteIds) {
      if (mode === 'toggle' && next.has(id)) next.delete(id);
      else next.add(id);
    }
  }
  return { ...state, selection: { ...state.selection, noteIds: next } };
}

export function selectVocalNotes(
  state: UiState,
  ids: readonly VocalNoteId[],
  mode: 'replace' | 'toggle' = 'replace',
): UiState {
  let next: Set<VocalNoteId>;
  if (mode === 'replace') next = new Set(ids);
  else {
    next = new Set(state.selection.vocalNoteIds);
    for (const id of ids) {
      if (next.has(id)) next.delete(id);
      else next.add(id);
    }
  }
  return { ...state, selection: { ...state.selection, vocalNoteIds: next } };
}

/** Removes selection entries that no longer exist (after undo, delete, project load). */
export function pruneSelection(
  state: UiState,
  exists: {
    readonly track: (id: TrackId) => boolean;
    readonly clip: (id: ClipId) => boolean;
    readonly note: (clipId: ClipId, id: NoteId) => boolean;
  },
): UiState {
  const sel = state.selection;
  const trackId = sel.trackId && exists.track(sel.trackId) ? sel.trackId : null;
  const clipIds = new Set([...sel.clipIds].filter((id) => exists.clip(id)));
  const editorClipId = sel.editorClipId && exists.clip(sel.editorClipId) ? sel.editorClipId : null;
  const noteIds = editorClipId
    ? new Set([...sel.noteIds].filter((id) => exists.note(editorClipId, id)))
    : new Set<NoteId>();
  const unchanged =
    trackId === sel.trackId &&
    editorClipId === sel.editorClipId &&
    clipIds.size === sel.clipIds.size &&
    noteIds.size === sel.noteIds.size;
  if (unchanged) return state;
  return { ...state, selection: { ...sel, trackId, clipIds, editorClipId, noteIds } };
}
