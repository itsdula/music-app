import { PPQ, ticksPerBar, type MidiClip } from '@studio/domain';
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_STUDIO_CONFIG } from '../src/config';
import {
  laneMenu,
  regionMenu,
  selectionForContextClick,
  trackMenu,
} from '../src/features/arrangement/arrangement-menus';
import { gridMenu, noteMenu } from '../src/features/piano-roll/note-menus';
import { isAction, normalizeMenu, type MenuAction } from '../src/components/context-menu';
import { createStudioSession, type StudioSession } from '../src/session/studio-session';
import { selectClips } from '../src/state/ui-store';
import { createTestPlatform } from './helpers/test-platform';

const sessions: StudioSession[] = [];
afterEach(async () => {
  while (sessions.length) await sessions.pop()!.dispose();
});

async function setup() {
  const session = createStudioSession(createTestPlatform(), {
    ...DEFAULT_STUDIO_CONFIG,
    autosaveDelayMs: 5,
  });
  sessions.push(session);
  await session.start();
  await session.projects.newProject('empty');
  const trackId = session.history.present.trackOrder[0]!;
  const bar = ticksPerBar(session.history.present.meter);
  const a = session.edits.createMidiClip(trackId, 0, bar)!;
  const b = session.edits.createMidiClip(trackId, bar, bar)!;
  const c = session.edits.createMidiClip(trackId, bar * 2, bar)!;
  const notes = session.edits.addNotes(a, [
    { startTick: 10, durationTicks: PPQ, pitch: 60, velocity: 100 },
    { startTick: PPQ + 7, durationTicks: PPQ, pitch: 64, velocity: 90 },
    { startTick: PPQ * 2, durationTicks: PPQ, pitch: 60, velocity: 80 },
  ]);
  return { session, trackId, bar, a, b, c, noteIds: notes.map((n) => n.id) };
}

/** Finds an action by id (searching submenus) in a built menu. */
function action(entries: ReturnType<typeof normalizeMenu>, id: string): MenuAction {
  for (const entry of entries) {
    if (isAction(entry) && entry.id === id) return entry;
    if (entry.kind === 'submenu') {
      try {
        return action(normalizeMenu(entry.items), id);
      } catch {
        // keep looking
      }
    }
  }
  throw new Error(`no menu action ${id}`);
}

describe('arrangement menu actions', () => {
  it('region actions act on every selected clip and are single undo entries', async () => {
    const { session, a, b, c, bar } = await setup();
    const menu = normalizeMenu(
      regionMenu(session, { clipIds: [a, b], anchorClipId: b, atTick: bar, onRename: () => {} }),
    );
    expect(action(menu, 'clip-delete').label).toBe('Delete 2 clips');

    action(menu, 'clip-mute').onSelect();
    const project = session.history.present;
    expect(project.clips[a]!.muted && project.clips[b]!.muted).toBe(true);
    expect(project.clips[c]!.muted).toBe(false);
    expect(session.history.undoLabel).toBe('Mute Clips');

    action(menu, 'clip-loop').onSelect();
    expect((session.history.present.clips[a] as MidiClip).loopLengthTicks).toBe(bar);
    session.history.undo();
    expect((session.history.present.clips[a] as MidiClip).loopLengthTicks).toBeUndefined();

    action(menu, 'clip-delete').onSelect();
    expect(Object.keys(session.history.present.clips)).toEqual([c]);
    session.history.undo();
    expect(Object.keys(session.history.present.clips).sort()).toEqual([a, b, c].sort());
  });

  it('quantizes the notes of selected MIDI clips and recolors/renames clips', async () => {
    const { session, a, b, bar } = await setup();
    const menu = normalizeMenu(
      regionMenu(session, { clipIds: [a, b], anchorClipId: a, atTick: 0, onRename: () => {} }),
    );
    action(menu, 'clip-quantize').onSelect();
    const starts = (session.history.present.clips[a] as MidiClip).notes.map((n) => n.startTick);
    const grid = bar / 16;
    expect(starts.every((t) => t % grid === 0)).toBe(true);
    expect(session.history.undoLabel).toBe('Quantize');

    action(menu, 'clip-color-2').onSelect();
    expect(session.history.present.clips[a]!.color).toBe(session.history.present.clips[b]!.color);
    expect(session.edits.renameClip(a, '  Verse  ')).toBe(true);
    expect(session.history.present.clips[a]!.name).toBe('Verse');
    expect(session.history.undoLabel).toBe('Rename Clip');
  });

  it('pastes into a lane and creates a clip at the clicked bar', async () => {
    const { session, trackId, a, bar } = await setup();
    session.edits.copyClips([a]);
    const menu = normalizeMenu(laneMenu(session, { trackId, atTick: bar * 6 + 10 }));
    action(menu, 'lane-paste').onSelect();
    const pasted = Object.values(session.history.present.clips).find(
      (clip) => clip.startTick === bar * 6 + 10,
    );
    expect(pasted).toBeDefined();
    action(menu, 'lane-new-clip').onSelect();
    expect(
      Object.values(session.history.present.clips).some((clip) => clip.startTick === bar * 6),
    ).toBe(true);
  });

  it('duplicates, moves and deletes tracks (undoable)', async () => {
    const { session, trackId } = await setup();
    const menu = normalizeMenu(trackMenu(session, trackId, { onRename: () => {} }));
    expect(action(menu, 'track-move-up').disabled).toBe(true);
    action(menu, 'track-duplicate').onSelect();
    const order = session.history.present.trackOrder;
    expect(order).toHaveLength(2);
    const copyId = order[1]!;
    const copyClips = Object.values(session.history.present.clips).filter(
      (clip) => clip.trackId === copyId,
    );
    expect(copyClips).toHaveLength(3);
    expect(session.history.undoLabel).toBe('Duplicate Track');

    expect(session.edits.moveTrack(copyId, -1)).toBe(true);
    expect(session.history.present.trackOrder[0]).toBe(copyId);
    expect(session.edits.deleteTrack(copyId)).toBe(true);
    expect(session.history.present.trackOrder).toEqual([trackId]);
    expect(session.uiStore.getState().selection.trackId).toBe(trackId);
    session.history.undo();
    expect(session.history.present.trackOrder).toHaveLength(2);
  });
});

describe('piano roll menu actions', () => {
  it('transposes, sets velocity, duplicates and deletes the note selection', async () => {
    const { session, a, noteIds } = await setup();
    const clip = () => session.history.present.clips[a] as MidiClip;
    const ids = noteIds.slice(0, 2);
    const menu = normalizeMenu(
      noteMenu(session, clip(), { noteIds: ids, anchorId: ids[0]!, atContentTick: 0 }),
    );
    action(menu, 'notes-transpose-octave-up').onSelect();
    expect(
      clip()
        .notes.filter((n) => ids.includes(n.id))
        .map((n) => n.pitch),
    ).toEqual([72, 76]);
    expect(session.history.undoLabel).toBe('Transpose Up an Octave');
    action(menu, 'notes-velocity-127').onSelect();
    expect(
      clip()
        .notes.filter((n) => ids.includes(n.id))
        .every((n) => n.velocity === 127),
    ).toBe(true);
    action(menu, 'notes-duplicate').onSelect();
    expect(clip().notes).toHaveLength(5);
    action(menu, 'notes-delete').onSelect();
    expect(clip().notes.map((n) => n.id)).not.toContain(ids[0]);
    session.history.undo();
    expect(clip().notes.map((n) => n.id)).toContain(ids[0]);
  });

  it('selects same-pitch notes and pastes copied notes on the grid', async () => {
    const { session, a, noteIds } = await setup();
    const clip = () => session.history.present.clips[a] as MidiClip;
    const menu = normalizeMenu(
      noteMenu(session, clip(), {
        noteIds: [noteIds[0]!],
        anchorId: noteIds[0]!,
        atContentTick: 0,
      }),
    );
    action(menu, 'notes-select-pitch').onSelect();
    expect([...session.uiStore.getState().selection.noteIds].sort()).toEqual(
      [noteIds[0]!, noteIds[2]!].sort(),
    );
    expect(session.edits.copyNotes(a, [noteIds[0]!, noteIds[1]!])).toBe(true);
    const grid = normalizeMenu(
      gridMenu(session, clip(), { atContentTick: PPQ * 3, addNote: null }),
    );
    expect(action(grid, 'grid-add-note').disabled).toBe(true);
    action(grid, 'grid-paste').onSelect();
    const pasted = clip().notes.filter((n) => n.startTick >= PPQ * 3);
    expect(pasted.map((n) => n.startTick)).toEqual([PPQ * 3, PPQ * 4 - 3]);
    expect([...session.uiStore.getState().selection.noteIds].sort()).toEqual(
      pasted.map((n) => n.id).sort(),
    );
  });

  it('keeps the selection when a selected clip is right-clicked', async () => {
    const { session, a, b, c } = await setup();
    session.uiStore.setState((s) => selectClips(s, [a, b]));
    expect(selectionForContextClick(session, session.history.present.clips[b]!).sort()).toEqual(
      [a, b].sort(),
    );
    expect(selectionForContextClick(session, session.history.present.clips[c]!)).toEqual([c]);
  });
});
