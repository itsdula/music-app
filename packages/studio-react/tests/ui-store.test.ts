import { asClipId, asNoteId, asTrackId } from '@studio/domain';
import { describe, expect, it } from 'vitest';
import {
  INITIAL_UI_STATE,
  openClipInEditor,
  pruneSelection,
  selectClips,
  selectNotes,
  selectTrack,
} from '../src/state/ui-store';

describe('ui-store updaters', () => {
  it('selects tracks and returns the same state when unchanged', () => {
    const next = selectTrack(INITIAL_UI_STATE, asTrackId('t1'));
    expect(next.selection.trackId).toBe('t1');
    expect(selectTrack(next, asTrackId('t1'))).toBe(next);
  });

  it('supports replace/add/toggle clip selection', () => {
    let s = selectClips(INITIAL_UI_STATE, [asClipId('a'), asClipId('b')]);
    s = selectClips(s, [asClipId('b'), asClipId('c')], 'toggle');
    expect([...s.selection.clipIds].sort()).toEqual(['a', 'c']);
    s = selectClips(s, [asClipId('d')], 'add');
    expect(s.selection.clipIds.size).toBe(3);
  });

  it('opening a clip resets note selection and opens the editor panel', () => {
    let s = selectNotes(INITIAL_UI_STATE, [asNoteId('n1')]);
    s = { ...s, panels: { ...s.panels, bottomOpen: false, bottomPanel: 'mixer' } };
    const opened = openClipInEditor(s, asClipId('c1'));
    expect(opened.selection.noteIds.size).toBe(0);
    expect(opened.panels).toMatchObject({ bottomOpen: true, bottomPanel: 'editor' });
  });

  it('prunes selection entries that no longer exist', () => {
    let s = selectTrack(INITIAL_UI_STATE, asTrackId('gone'));
    s = selectClips(s, [asClipId('keep'), asClipId('drop')]);
    s = openClipInEditor(s, asClipId('keep'));
    s = selectNotes(s, [asNoteId('n1'), asNoteId('n2')]);
    const pruned = pruneSelection(s, {
      track: () => false,
      clip: (id) => id === 'keep',
      note: (_clip, id) => id === 'n1',
    });
    expect(pruned.selection.trackId).toBeNull();
    expect([...pruned.selection.clipIds]).toEqual(['keep']);
    expect([...pruned.selection.noteIds]).toEqual(['n1']);
    expect(pruneSelection(pruned, { track: () => true, clip: () => true, note: () => true })).toBe(pruned);
  });
});
