import { PPQ, type MidiClip, type Project } from '@studio/domain';
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_STUDIO_CONFIG } from '../src/config';
import { createStudioSession, type StudioSession } from '../src/session/studio-session';
import { createTestPlatform } from './helpers/test-platform';

const sessions: StudioSession[] = [];

async function startSession() {
  const platform = createTestPlatform();
  const session = createStudioSession(platform, { ...DEFAULT_STUDIO_CONFIG, autosaveDelayMs: 5 });
  sessions.push(session);
  await session.start();
  return { session, platform };
}

afterEach(async () => {
  while (sessions.length) await sessions.pop()!.dispose();
});

type Obj = Record<string, unknown>;
const call = (session: StudioSession, name: string, input: Obj = {}) =>
  session.tools.call(name, input) as Promise<Obj>;

function midiClips(project: Project): MidiClip[] {
  return Object.values(project.clips).filter((c): c is MidiClip => c.kind === 'midi');
}

describe('core tools: registry', () => {
  it('registers every core tool with an object schema and a description', async () => {
    const { session } = await startSession();
    const names = session.tools.list().map((t) => t.name);
    for (const expected of [
      'get_project_summary',
      'list_tracks',
      'get_clip_notes',
      'list_projects',
      'get_selection',
      'get_current_view',
      'navigate',
      'select_track',
      'open_clip_in_editor',
      'set_tempo',
      'set_time_signature',
      'add_track',
      'rename_track',
      'delete_track',
      'set_track_mixer',
      'add_effect',
      'set_effect_params',
      'set_instrument_params',
      'create_midi_clip',
      'add_notes',
      'replace_notes',
      'add_chord_progression',
      'add_drum_pattern',
      'quantize_notes',
      'transpose_notes',
      'delete_clips',
      'play',
      'stop',
      'seek',
      'set_loop',
      'undo',
      'redo',
      'new_project',
      'open_project',
      'rename_project',
    ]) {
      expect(names).toContain(expected);
    }
    for (const tool of session.tools.list()) {
      expect(tool.inputSchema.type).toBe('object');
      expect(tool.description.length).toBeGreaterThan(20);
    }
  });

  it('unregisters the tools when the session is disposed', async () => {
    const { session } = await startSession();
    expect(session.tools.list().length).toBeGreaterThan(30);
    await session.dispose();
    sessions.length = 0;
    expect(session.tools.list()).toHaveLength(0);
  });
});

describe('core tools: reading', () => {
  it('summarizes the project with tracks, tempo and view', async () => {
    const { session } = await startSession();
    const summary = await call(session, 'get_project_summary');
    expect(summary).toMatchObject({
      name: 'Untitled Project',
      tempoBpm: 120,
      timeSignature: '4/4',
      estimatedKey: null,
      view: { view: 'arrange' },
    });
    expect(summary.tracks).toEqual([
      expect.objectContaining({ name: 'Keys', kind: 'instrument', instrument: 'synth' }),
    ]);
  });

  it('estimates the key from pitched notes', async () => {
    const { session } = await startSession();
    await call(session, 'add_chord_progression', {
      trackId: 'Keys',
      chords: ['Am', 'F', 'C', 'G', 'Am'],
    });
    const summary = await call(session, 'get_project_summary');
    expect(summary.estimatedKey).toBe('A minor');
  });

  it('lists scale notes and the sound catalog', async () => {
    const { session } = await startSession();
    const scale = await call(session, 'get_scale_notes', { key: 'A minor', octave: 3 });
    expect((scale.notes as Obj[]).map((n) => n.pitch)).toEqual([
      'A3',
      'B3',
      'C4',
      'D4',
      'E4',
      'F4',
      'G4',
      'A4',
    ]);
    const catalog = await call(session, 'get_sound_catalog');
    expect(JSON.stringify(catalog)).toContain('synth.pad');
    expect(JSON.stringify(catalog)).toContain('decaySeconds');
  });
});

describe('core tools: editing', () => {
  it('creates a MIDI clip from beats and steps with pitch names, as one undo entry', async () => {
    const { session } = await startSession();
    const result = await call(session, 'create_midi_clip', {
      trackId: 'Keys',
      startBar: 2,
      notes: [
        { pitch: 'C4', beat: 0, length: 2 },
        { pitch: 64, step: 8, length: 4, velocity: 80 },
        { pitch: 'G4', beat: 5 },
      ],
    });
    const clipInfo = result.clip as Obj;
    expect(clipInfo).toMatchObject({ startBar: 2, lengthBars: 2, noteCount: 3 });
    const clip = session.history.present.clips[clipInfo.id as MidiClip['id']] as MidiClip;
    expect(clip.startTick).toBe(PPQ * 4);
    expect(clip.notes.map((n) => [n.pitch, n.startTick, n.durationTicks, n.velocity])).toEqual([
      [60, 0, PPQ * 2, 100],
      [64, PPQ * 2, PPQ, 80],
      [67, PPQ * 5, PPQ, 100],
    ]);
    expect(session.uiStore.getState().selection.editorClipId).toBe(clip.id);
    expect(session.history.undoLabel).toBe('Create MIDI Clip');
    await call(session, 'undo');
    expect(midiClips(session.history.present)).toHaveLength(0);
    await call(session, 'redo');
    expect(midiClips(session.history.present)).toHaveLength(1);
  });

  it('returns clear, fixable errors for bad input', async () => {
    const { session } = await startSession();
    await expect(call(session, 'create_midi_clip', { trackId: 'Nope', notes: [] })).rejects.toThrow(
      /Track "Nope" not found.*Keys/,
    );
    await expect(
      call(session, 'create_midi_clip', { trackId: 'Keys', notes: [{ pitch: 'H2', beat: 0 }] }),
    ).rejects.toThrow(/note name like "C4"/);
    await expect(
      call(session, 'create_midi_clip', { trackId: 'Keys', notes: [{ pitch: 'C4' }] }),
    ).rejects.toThrow(/give a position/);
    await expect(
      call(session, 'create_midi_clip', {
        trackId: 'Keys',
        lengthBars: 1,
        notes: [{ pitch: 'C4', beat: 6 }],
      }),
    ).rejects.toThrow(/start after the clip ends/);
    await expect(call(session, 'set_tempo', { bpm: 1000 })).rejects.toThrow(/≤ 400/);
    await expect(
      call(session, 'set_instrument_params', { trackId: 'Keys', params: { cutoffHz: 99999 } }),
    ).rejects.toThrow(/cutoffHz must be between 40 and 18000/);
    expect(session.history.canUndo).toBe(false);
  });

  it('builds a beat on a new drums track and refuses drum patterns on synths', async () => {
    const { session } = await startSession();
    await expect(
      call(session, 'add_drum_pattern', { trackId: 'Keys', pattern: { kick: 'x---' } }),
    ).rejects.toThrow(/needs? a drums track/);
    const added = await call(session, 'add_track', { instrument: 'drums' });
    const trackId = (added.track as Obj).id as string;
    expect(added.track).toMatchObject({ name: 'Drums', instrument: 'drums' });
    const beat = await call(session, 'add_drum_pattern', {
      trackId,
      bars: 4,
      pattern: {
        kick: 'x---x---x---x---',
        clap: '----X-------X---',
        closedHat: '--x---x---x---x-',
      },
    });
    expect(beat.clip).toMatchObject({ startBar: 1, lengthBars: 4, noteCount: 4 * (4 + 2 + 4) });
    const clip = session.history.present.clips[(beat.clip as Obj).id as MidiClip['id']] as MidiClip;
    expect(clip.notes.filter((n) => n.pitch === 36).map((n) => n.startTick / (PPQ / 4))).toEqual([
      0, 4, 8, 12, 16, 20, 24, 28, 32, 36, 40, 44, 48, 52, 56, 60,
    ]);
    expect(clip.notes.find((n) => n.pitch === 39)?.velocity).toBe(120);
  });

  it('adds a smoothly voiced chord progression with a rhythm', async () => {
    const { session } = await startSession();
    const result = await call(session, 'add_chord_progression', {
      trackId: 'Keys',
      chords: ['Am', 'F', 'C', 'G'],
      rhythm: 'quarters',
      startBar: 3,
    });
    expect(result.clip).toMatchObject({ startBar: 3, lengthBars: 4, noteCount: 4 * 4 * 3 });
    expect(result.chords).toHaveLength(4);
    const clip = midiClips(session.history.present)[0]!;
    const pitches = clip.notes.map((n) => n.pitch);
    expect(Math.max(...pitches) - Math.min(...pitches)).toBeLessThanOrEqual(12);
    await expect(
      call(session, 'add_chord_progression', { trackId: 'Keys', chords: ['Xm'] }),
    ).rejects.toThrow(/Unknown chord "Xm"/);
  });

  it('edits notes: add (growing the clip), transpose, quantize and replace', async () => {
    const { session } = await startSession();
    const created = await call(session, 'create_midi_clip', {
      trackId: 'Keys',
      lengthBars: 1,
      notes: [{ pitch: 'C4', beat: 0.1 }],
    });
    const clipId = (created.clip as Obj).id as string;
    const grown = await call(session, 'add_notes', {
      clipId,
      notes: [{ pitch: 'E4', beat: 5 }],
    });
    expect(grown.clip).toMatchObject({ lengthBars: 2, noteCount: 2 });
    await call(session, 'transpose_notes', { clipId, semitones: 12 });
    await call(session, 'quantize_notes', { clipId, grid: '1/4' });
    let clip = session.history.present.clips[clipId as MidiClip['id']] as MidiClip;
    expect(clip.notes.map((n) => [n.pitch, n.startTick])).toEqual([
      [72, 0],
      [76, PPQ * 5],
    ]);
    const notes = await call(session, 'get_clip_notes', { clipId });
    expect(notes.notes).toEqual([
      expect.objectContaining({ pitch: 'C5', beat: 0 }),
      expect.objectContaining({ pitch: 'E5', beat: 5 }),
    ]);
    await call(session, 'replace_notes', { clipId, notes: [{ pitch: 'A3', step: 2 }] });
    clip = session.history.present.clips[clipId as MidiClip['id']] as MidiClip;
    expect(clip.notes.map((n) => [n.pitch, n.startTick, n.durationTicks])).toEqual([
      [57, PPQ / 2, PPQ / 4],
    ]);
    await expect(call(session, 'transpose_notes', { clipId, semitones: 48 })).resolves.toBeTruthy();
    await expect(call(session, 'transpose_notes', { clipId, semitones: 48 })).rejects.toThrow(
      /MIDI range/,
    );
  });

  it('duplicates, moves and deletes clips', async () => {
    const { session } = await startSession();
    const created = await call(session, 'create_midi_clip', {
      trackId: 'Keys',
      notes: [{ pitch: 'C4', beat: 0 }],
    });
    const clipId = (created.clip as Obj).id as string;
    const dup = await call(session, 'duplicate_clip', { clipId, times: 3 });
    expect((dup.copies as Obj[]).map((c) => c.startBar)).toEqual([2, 3, 4]);
    await call(session, 'move_clip', { clipId, startBar: 9 });
    expect(session.history.present.clips[clipId as MidiClip['id']]?.startTick).toBe(PPQ * 4 * 8);
    const deleted = await call(session, 'delete_clips', { clipIds: [clipId] });
    expect(deleted).toMatchObject({ undoable: true, deleted: [{ id: clipId }] });
    expect(midiClips(session.history.present)).toHaveLength(3);
  });

  it('manages tracks, mixer, instruments and effects', async () => {
    const { session } = await startSession();
    const added = await call(session, 'add_track', { preset: 'synth.bass', name: 'Bass' });
    expect(added.track).toMatchObject({ name: 'Bass', instrument: 'synth', preset: 'synth.bass' });
    await call(session, 'rename_track', { trackId: 'Bass', name: 'Sub Bass' });
    await call(session, 'set_track_mixer', { trackId: 'Sub Bass', mute: true, volumeDb: -6 });
    await call(session, 'set_instrument_params', {
      trackId: 'Sub Bass',
      params: { cutoffHz: 300, osc1Waveform: 'sine' },
    });
    const fx = await call(session, 'add_effect', {
      trackId: 'Sub Bass',
      kind: 'reverb',
      params: { mix: 0.4 },
    });
    const effectId = (fx.effect as Obj).id as string;
    await call(session, 'set_effect_params', {
      trackId: 'Sub Bass',
      kind: 'reverb',
      params: { decaySeconds: 4 },
    });
    await call(session, 'add_effect', { trackId: 'master', kind: 'compressor' });
    const project = session.history.present;
    const bass = Object.values(project.tracks).find((t) => t.name === 'Sub Bass')!;
    expect(bass.mixer).toMatchObject({ mute: true, gainDb: -6 });
    expect(bass.instrument?.params).toMatchObject({ cutoffHz: 300, osc1Waveform: 0 });
    expect(bass.effects.map((e) => [e.id, e.kind])).toEqual([[effectId, 'reverb']]);
    expect(bass.effects[0]!.params).toMatchObject({ mix: 0.4, decaySeconds: 4 });
    expect(project.master.effects.map((e) => e.kind)).toEqual(['compressor']);
    await expect(
      call(session, 'set_effect_params', { trackId: 'Sub Bass', kind: 'delay', params: {} }),
    ).rejects.toThrow(/Effect not found/);
    const removed = await call(session, 'delete_track', { trackId: 'Sub Bass' });
    expect(removed).toMatchObject({ deleted: { name: 'Sub Bass' }, undoable: true });
    expect(Object.values(session.history.present.tracks)).toHaveLength(1);
  });

  it('sets tempo, time signature and loop in bars', async () => {
    const { session } = await startSession();
    await call(session, 'set_tempo', { bpm: 124 });
    await call(session, 'set_time_signature', { numerator: 3, denominator: 4 });
    const loop = await call(session, 'set_loop', { startBar: 2, lengthBars: 4 });
    const p = session.history.present;
    expect(p.bpm).toBe(124);
    expect(p.meter).toEqual({ numerator: 3, denominator: 4 });
    expect(p.loop).toEqual({ enabled: true, startTick: PPQ * 3, endTick: PPQ * 3 * 5 });
    expect(loop.loop).toEqual({ enabled: true, startBar: 2, endBar: 6 });
  });
});

describe('core tools: navigation, transport and projects', () => {
  it('navigates pages and bottom panels, selects tracks and opens clips', async () => {
    const { session } = await startSession();
    await call(session, 'navigate', { view: 'projects' });
    expect(session.uiStore.getState().view).toBe('projects');
    await call(session, 'navigate', { view: 'mixer' });
    expect(session.uiStore.getState().view).toBe('arrange');
    expect(session.uiStore.getState().panels).toMatchObject({
      bottomOpen: true,
      bottomPanel: 'mixer',
    });
    await expect(call(session, 'navigate', { view: 'kitchen' })).rejects.toThrow(/must be one of/);
    const created = await call(session, 'create_midi_clip', {
      trackId: 'Keys',
      notes: [{ pitch: 'C4', beat: 0 }],
    });
    await call(session, 'navigate', { view: 'arrange' });
    await call(session, 'open_clip_in_editor', {
      clipId: (created.clip as Obj).id,
      fullScreen: true,
    });
    expect(session.uiStore.getState().view).toBe('editor');
    const view = await call(session, 'get_current_view');
    expect(view.view).toBe('editor');
    const selection = await call(session, 'get_selection');
    expect(selection.editorClip).toMatchObject({ id: (created.clip as Obj).id });
  });

  it('plays, seeks and stops', async () => {
    const { session, platform } = await startSession();
    await call(session, 'seek', { bar: 3 });
    expect(session.engineStore.getState().cursorTick).toBe(PPQ * 8);
    const playing = await call(session, 'play', { fromBar: 2 });
    expect(playing.state).toBe('playing');
    expect(platform.engine.getTransportPosition().state).toBe('playing');
    await call(session, 'stop');
    expect(platform.engine.getTransportPosition().state).toBe('stopped');
  });

  it('creates, lists, renames and reopens projects', async () => {
    const { session } = await startSession();
    const firstId = session.history.present.id;
    await call(session, 'rename_project', { name: 'First Song' });
    await call(session, 'navigate', { view: 'projects' });
    const created = await call(session, 'new_project', { template: 'demo', name: 'Groove' });
    expect(created).toMatchObject({ name: 'Groove', tracks: 3 });
    expect(session.uiStore.getState().view).toBe('arrange');
    await session.projects.flush();
    const list = await call(session, 'list_projects');
    expect((list.projects as Obj[]).map((p) => p.name)).toEqual(
      expect.arrayContaining(['First Song', 'Groove']),
    );
    await call(session, 'open_project', { projectId: 'first song' });
    expect(session.history.present.id).toBe(firstId);
    await expect(call(session, 'open_project', { projectId: 'missing' })).rejects.toThrow(
      /not found.*First Song/,
    );
  });

  it('reports when there is nothing to undo', async () => {
    const { session } = await startSession();
    await expect(call(session, 'undo')).rejects.toThrow('Nothing to undo.');
  });
});
