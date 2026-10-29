import { describe, expect, it } from 'vitest';
import {
  CURRENT_SCHEMA_VERSION,
  DEFAULT_VALUE_TRANSFORM,
  EFFECT_PARAM_SPECS,
  INSTRUMENT_PARAM_SPECS,
  PPQ,
  TRACK_COLORS,
  asAssetId,
  asClipId,
  asEffectId,
  asMappingId,
  asNoteId,
  asProjectId,
  asTrackId,
  asVocalNoteId,
  checkProjectInvariants,
  compareNotes,
  createAudioClip,
  createEffectSlot,
  createEmptyProject,
  createIdFactory,
  createInstrumentConfig,
  createMidiClip,
  createMidiMapping,
  createSequentialIdFactory,
  createTrack,
  defaultParamValues,
  err,
  ok,
  sortNotes,
  unwrap,
  type MidiNote,
} from '../src';

const note = (id: string, startTick: number, pitch: number): MidiNote => ({
  id: asNoteId(id),
  startTick,
  durationTicks: 10,
  pitch,
  velocity: 100,
});

describe('ids', () => {
  it('creates prefixed ids from an injected suffix source', () => {
    let n = 0;
    const ids = createIdFactory(() => `s${++n}`);
    expect(ids.create('track')).toBe('trk_s1');
    expect(ids.create('clip')).toBe('clp_s2');
    expect(ids.create('vocalNote')).toBe('vn_s3');
  });

  it('creates deterministic sequential ids', () => {
    const ids = createSequentialIdFactory(5);
    expect([ids.create('note'), ids.create('asset'), ids.create('effect')]).toEqual([
      'nte_5',
      'ast_6',
      'fx_7',
    ]);
    const fresh = createSequentialIdFactory();
    expect([fresh.create('project'), fresh.create('mapping')]).toEqual(['prj_1', 'map_2']);
  });

  it('casts strings without changing them', () => {
    for (const cast of [
      asTrackId,
      asClipId,
      asNoteId,
      asAssetId,
      asEffectId,
      asMappingId,
      asProjectId,
      asVocalNoteId,
    ]) {
      expect(cast('x')).toBe('x');
    }
  });
});

describe('result helpers', () => {
  it('wraps and unwraps values and errors', () => {
    expect(ok(3)).toEqual({ ok: true, value: 3 });
    expect(err('bad')).toEqual({ ok: false, error: 'bad' });
    expect(unwrap(ok(3))).toBe(3);
    const error = new TypeError('boom');
    expect(() => unwrap(err(error))).toThrow(error);
    expect(() => unwrap(err('plain'))).toThrow('plain');
  });
});

describe('factories', () => {
  it('creates a valid empty project', () => {
    const p = createEmptyProject({ id: asProjectId('p'), now: '2026-01-01T00:00:00.000Z' });
    expect(p).toMatchObject({
      schemaVersion: CURRENT_SCHEMA_VERSION,
      name: 'Untitled Project',
      bpm: 120,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      loop: { enabled: false, startTick: 0, endTick: PPQ * 16 },
    });
    expect(checkProjectInvariants(p)).toEqual([]);
    expect(
      createEmptyProject({ id: asProjectId('q'), now: 'n', name: 'Song', bpm: 90 }),
    ).toMatchObject({
      name: 'Song',
      bpm: 90,
    });
  });

  it('creates instrument configs from presets or defaults', () => {
    const keys = createInstrumentConfig('synth', 'synth.keys');
    expect(keys.presetId).toBe('synth.keys');
    expect(keys.params.osc1Waveform).toBe(1);
    expect(Object.keys(keys.params).sort()).toEqual(
      INSTRUMENT_PARAM_SPECS.synth.map((s) => s.id).sort(),
    );
    expect(createInstrumentConfig('drums')).toEqual({
      kind: 'drums',
      params: defaultParamValues(INSTRUMENT_PARAM_SPECS.drums),
    });
    // A preset of another kind is ignored.
    expect(createInstrumentConfig('drums', 'synth.keys').presetId).toBeUndefined();
  });

  it('creates tracks per kind with default names and colours', () => {
    const inst = createTrack({ id: asTrackId('t1'), kind: 'instrument' });
    expect(inst).toMatchObject({
      name: 'Instrument',
      color: TRACK_COLORS[0],
      monitor: 'auto',
      midiInput: { channel: 'all', transpose: 0 },
    });
    expect(inst.instrument?.presetId).toBe('synth.keys');
    const audio = createTrack({ id: asTrackId('t2'), kind: 'audio', index: 9 });
    expect(audio).toMatchObject({
      name: 'Audio',
      color: TRACK_COLORS[1],
      monitor: 'off',
      inputChannels: 1,
    });
    expect(audio.instrument).toBeUndefined();
    const vocal = createTrack({
      id: asTrackId('t3'),
      kind: 'vocal',
      name: 'Lead',
      color: '#000000',
    });
    expect(vocal).toMatchObject({ name: 'Lead', color: '#000000' });
    const drums = createTrack({
      id: asTrackId('t4'),
      kind: 'instrument',
      instrument: createInstrumentConfig('drums'),
    });
    expect(drums.instrument?.kind).toBe('drums');
  });

  it('creates effect slots with default params', () => {
    expect(createEffectSlot(asEffectId('fx'), 'delay')).toEqual({
      id: 'fx',
      kind: 'delay',
      bypass: false,
      params: defaultParamValues(EFFECT_PARAM_SPECS.delay),
    });
  });

  it('creates clips with sorted notes', () => {
    const clip = createMidiClip({
      id: asClipId('c'),
      trackId: asTrackId('t'),
      startTick: 0,
      notes: [note('b', 10, 60), note('a', 0, 60)],
    });
    expect(clip.notes.map((n) => n.id)).toEqual(['a', 'b']);
    expect(clip.lengthTicks).toBe(PPQ * 16);
    expect(
      createMidiClip({
        id: asClipId('d'),
        trackId: asTrackId('t'),
        startTick: 5,
        name: 'X',
        lengthTicks: 7,
      }),
    ).toMatchObject({ name: 'X', lengthTicks: 7, notes: [] });
    expect(
      createAudioClip({
        id: asClipId('e'),
        trackId: asTrackId('t'),
        assetId: asAssetId('a'),
        startTick: 3,
        lengthFrames: 9,
        name: 'Vox',
      }),
    ).toMatchObject({
      name: 'Vox',
      sourceStartFrame: 0,
      lengthFrames: 9,
      fadeInFrames: 0,
      fadeOutFrames: 0,
    });
  });

  it('orders notes by start, pitch, then id', () => {
    const notes = [note('c', 0, 62), note('b', 0, 60), note('a', 0, 60), note('d', -1, 99)];
    expect(sortNotes(notes).map((n) => n.id)).toEqual(['d', 'a', 'b', 'c']);
    expect(compareNotes(note('a', 0, 60), note('a', 0, 60))).toBe(0);
    expect(notes.map((n) => n.id)).toEqual(['c', 'b', 'a', 'd']); // input untouched
  });

  it('creates MIDI mappings with defaults', () => {
    const source = { kind: 'cc', channel: 1, controller: 7, mode: 'absolute' } as const;
    const target = { kind: 'action', action: 'transport.play' } as const;
    const mapping = createMidiMapping({ id: asMappingId('m'), source, target });
    expect(mapping).toEqual({
      id: 'm',
      source,
      device: null,
      target,
      transform: DEFAULT_VALUE_TRANSFORM,
      scope: 'project',
      enabled: true,
    });
    const custom = createMidiMapping({
      id: asMappingId('n'),
      source,
      target,
      scope: 'global',
      device: { profileId: 'akai.mpk-mini-mk3' },
      transform: { invert: true },
      label: 'K1',
    });
    expect(custom).toMatchObject({
      scope: 'global',
      label: 'K1',
      transform: { invert: true, min: 0 },
    });
  });
});
