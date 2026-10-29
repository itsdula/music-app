import { PPQ, ticksPerBar, type MidiClip } from '@studio/domain';
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_STUDIO_CONFIG } from '../src/config';
import { createStudioSession, type StudioSession } from '../src/session/studio-session';
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
  const trackId = session.history.present.trackOrder[0]!;
  const bar = ticksPerBar(session.history.present.meter);
  const clipId = session.edits.createMidiClip(trackId, 0, bar * 2)!;
  session.edits.addNotes(clipId, [
    { startTick: 0, durationTicks: PPQ, pitch: 60, velocity: 100 },
    { startTick: bar, durationTicks: PPQ, pitch: 64, velocity: 100 },
  ]);
  return { session, trackId, clipId, bar };
}

describe('EditController', () => {
  it('splits a clip into two non-destructive halves (one undo entry)', async () => {
    const { session, clipId, bar } = await setup();
    session.edits.splitClipsAt([clipId], bar);
    const clips = Object.values(session.history.present.clips) as MidiClip[];
    expect(clips).toHaveLength(2);
    const right = clips.find((c) => c.id !== clipId)!;
    expect(right).toMatchObject({ startTick: bar, lengthTicks: bar, contentOffsetTicks: bar });
    expect(session.history.undoLabel).toBe('Split');
    session.history.undo();
    expect(Object.keys(session.history.present.clips)).toEqual([clipId]);
  });

  it('ignores split positions outside the clip', async () => {
    const { session, clipId, bar } = await setup();
    session.edits.splitClipsAt([clipId], bar * 5);
    expect(Object.keys(session.history.present.clips)).toHaveLength(1);
  });

  it('duplicates clips right after the selection end and selects the copies', async () => {
    const { session, clipId, bar } = await setup();
    const [copyId] = session.edits.duplicateClips([clipId]);
    const copy = session.history.present.clips[copyId!] as MidiClip;
    expect(copy.startTick).toBe(bar * 2);
    expect(copy.notes).toHaveLength(2);
    expect([...session.uiStore.getState().selection.clipIds]).toEqual([copyId]);
  });

  it('copies and pastes at a position, and cut removes the source', async () => {
    const { session, clipId, trackId, bar } = await setup();
    session.edits.copyClips([clipId]);
    const [pasted] = session.edits.paste(bar * 8, trackId);
    expect(session.history.present.clips[pasted!]?.startTick).toBe(bar * 8);
    session.edits.cutClips([pasted!]);
    expect(session.history.present.clips[pasted!]).toBeUndefined();
    const [again] = session.edits.paste(bar * 4, trackId);
    expect(session.history.present.clips[again!]?.startTick).toBe(bar * 4);
  });

  it('refuses to paste MIDI onto an audio track and uses the original track instead', async () => {
    const { session, clipId, bar, trackId } = await setup();
    const audioTrack = session.edits.addTrack('audio');
    session.edits.copyClips([clipId]);
    const [pasted] = session.edits.paste(bar * 4, audioTrack);
    expect(session.history.present.clips[pasted!]?.trackId).toBe(trackId);
  });

  it('deletes selected clips and clears the selection', async () => {
    const { session, clipId } = await setup();
    session.edits.deleteClips([clipId]);
    expect(session.history.present.clips[clipId]).toBeUndefined();
    expect(session.uiStore.getState().selection.clipIds.size).toBe(0);
  });

  it('names new tracks uniquely and inserts after the selected track', async () => {
    const { session, trackId } = await setup();
    const a = session.edits.addTrack('instrument');
    session.uiStore.setState((s) => ({ ...s, selection: { ...s.selection, trackId } }));
    const b = session.edits.addTrack('instrument');
    const project = session.history.present;
    expect(project.tracks[a]!.name).toBe('Instrument');
    expect(project.tracks[b]!.name).toBe('Instrument 2');
    expect(project.trackOrder.indexOf(b)).toBe(1);
  });
});
