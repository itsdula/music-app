import { asClipId, asNoteId, asTrackId } from '@studio/domain';
import { afterEach, describe, expect, it } from 'vitest';
import {
  clearSelection,
  installSelectionZones,
  selectionKindsForTarget,
  SELECTION_ZONE_ATTRIBUTE,
} from '../src/state/selection-zones';
import {
  createUiStore,
  INITIAL_UI_STATE,
  openClipInEditor,
  selectClips,
  selectNotes,
  selectTrack,
  type UiState,
} from '../src/state/ui-store';

function editing(): UiState {
  let s = selectTrack(INITIAL_UI_STATE, asTrackId('t1'));
  s = selectClips(s, [asClipId('c1')]);
  s = openClipInEditor(s, asClipId('c1'));
  return selectNotes(s, [asNoteId('n1')]);
}

describe('clearSelection', () => {
  it('drops clips together with the open editor clip and its notes', () => {
    const s = clearSelection(editing(), ['clips']);
    expect(s.selection.trackId).toBe('t1');
    expect(s.selection.clipIds.size).toBe(0);
    expect(s.selection.editorClipId).toBeNull();
    expect(s.selection.noteIds.size).toBe(0);
    expect(s.panels.bottomPanel).toBe('track');
  });

  it('drops the track', () => {
    const s = clearSelection(editing(), ['track', 'clips']);
    expect(s.selection.trackId).toBeNull();
    expect(s.selection.editorClipId).toBeNull();
  });

  it('returns the same state when there is nothing to drop', () => {
    expect(clearSelection(INITIAL_UI_STATE, ['track', 'clips'])).toBe(INITIAL_UI_STATE);
    const s = editing();
    expect(clearSelection(s, [])).toBe(s);
  });
});

describe('selection zones', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  function mount(): HTMLElement {
    const root = document.createElement('div');
    root.innerHTML = `
      <div ${SELECTION_ZONE_ATTRIBUTE}="track-list">
        <div ${SELECTION_ZONE_ATTRIBUTE}="track" id="header">
          <span id="name">Keys</span>
          <div ${SELECTION_ZONE_ATTRIBUTE}="keep"><button id="mute">M</button></div>
        </div>
        <div id="blank"></div>
      </div>
      <div id="editor"><canvas id="piano-roll"></canvas></div>`;
    document.body.append(root);
    return root;
  }
  const el = (id: string) => document.getElementById(id)!;

  it('resolves the nearest zone up the tree', () => {
    const root = mount();
    expect(selectionKindsForTarget(el('blank'), root)).toEqual(['track', 'clips']);
    expect(selectionKindsForTarget(el('name'), root)).toEqual(['clips']);
    expect(selectionKindsForTarget(el('mute'), root)).toEqual([]);
    expect(selectionKindsForTarget(el('piano-roll'), root)).toEqual([]);
  });

  it('ignores zones outside the root', () => {
    const root = mount();
    const outside = document.createElement('div');
    outside.setAttribute(SELECTION_ZONE_ATTRIBUTE, 'track-list');
    document.body.append(outside);
    expect(selectionKindsForTarget(outside, root)).toEqual([]);
  });

  it('applies the rules on pointer presses', () => {
    const root = mount();
    const store = createUiStore(editing());
    const dispose = installSelectionZones(root, store);
    const press = (id: string) =>
      el(id).dispatchEvent(new Event('pointerdown', { bubbles: true, cancelable: true }));

    press('piano-roll');
    expect(store.getState().selection.editorClipId).toBe('c1');
    press('mute');
    expect(store.getState().selection.editorClipId).toBe('c1');
    press('name');
    expect(store.getState().selection.editorClipId).toBeNull();
    expect(store.getState().selection.trackId).toBe('t1');
    press('blank');
    expect(store.getState().selection.trackId).toBeNull();

    dispose();
    store.setState(editing());
    press('blank');
    expect(store.getState().selection.trackId).toBe('t1');
  });
});
