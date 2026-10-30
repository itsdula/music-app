/**
 * UI-state helpers for opening clips in the editor and switching between the arrangement and
 * the full-height editor view. Pure updaters on top of `ui-store` (which owns the state).
 */
import type { ClipId } from '@studio/domain';
import type { StudioSession } from '../session/studio-session';
import { navigate, openClipInEditor, type UiState } from '../state/ui-store';

/**
 * Makes `clipId` the editor target after a plain selection click. Unlike `openClipInEditor`
 * it does not switch away from the tab the user picked (Track, Mixer, Controller), so the
 * track's devices stay in view; it only opens the bottom panel (on the clip tab) when hidden.
 */
export function showClipOnSelect(state: UiState, clipId: ClipId): UiState {
  const sel = state.selection;
  const panels = state.panels.bottomOpen
    ? state.panels
    : { ...state.panels, bottomOpen: true, bottomPanel: 'clip' as const };
  if (sel.editorClipId === clipId && panels === state.panels) return state;
  return {
    ...state,
    panels,
    selection:
      sel.editorClipId === clipId
        ? sel
        : { ...sel, editorClipId: clipId, noteIds: new Set(), vocalNoteIds: new Set() },
  };
}

/** Opens the clip in the editor and makes the editor visible (explicit "Open in editor"). */
export function revealClipInEditor(state: UiState, clipId: ClipId): UiState {
  const opened = openClipInEditor(state, clipId);
  if (opened.panels.bottomOpen && opened.panels.bottomPanel === 'clip') return opened;
  return { ...opened, panels: { ...opened.panels, bottomOpen: true, bottomPanel: 'clip' } };
}

/** Toggles between the arrangement and the full-height editor view. */
export function toggleEditorView(state: UiState): UiState {
  return navigate(state, state.view === 'editor' ? 'arrange' : 'editor');
}

/** Transport position used by edit actions: the playhead while playing, else the cursor. */
export function playheadTick(session: Pick<StudioSession, 'engine' | 'engineStore'>): number {
  const position = session.engine.getTransportPosition();
  return position.state === 'stopped'
    ? session.engineStore.getState().cursorTick
    : Math.round(position.ticks);
}
