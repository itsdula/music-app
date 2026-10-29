import {
  INSTRUMENT_PARAM_SPECS,
  asAssetId,
  asEffectId,
  asTrackId,
  checkProjectInvariants,
  createEffectSlot,
  createInstrumentConfig,
  createTrack,
  defaultParamValues,
  type InstrumentConfig,
  type Track,
} from '@studio/domain';
import { describe, expect, it } from 'vitest';
import { applyCommand } from '../src';
import { apply, expectCommandError, expectNoop, ids, makeProject } from './fixtures';

const newTrack = (overrides: Partial<Track> = {}): Track => ({
  ...createTrack({ id: asTrackId('trk_new'), kind: 'audio' }),
  ...overrides,
});

describe('track.add', () => {
  it('appends by default and inserts at a clamped index', () => {
    const p = makeProject();
    const appended = apply(p, { type: 'track.add', track: newTrack() });
    expect(appended.trackOrder).toEqual([ids.inst, ids.audio, ids.vocal, 'trk_new']);
    expect(appended.tracks[ids.inst]).toBe(p.tracks[ids.inst]);
    expect(appended.clips).toBe(p.clips);
    expect(apply(p, { type: 'track.add', track: newTrack(), index: 1 }).trackOrder).toEqual([
      ids.inst,
      'trk_new',
      ids.audio,
      ids.vocal,
    ]);
    expect(apply(p, { type: 'track.add', track: newTrack(), index: -5 }).trackOrder[0]).toBe(
      'trk_new',
    );
    expect(apply(p, { type: 'track.add', track: newTrack(), index: 99 }).trackOrder[3]).toBe(
      'trk_new',
    );
    expect(checkProjectInvariants(appended)).toEqual([]);
  });

  it('keeps an already-valid track object by reference', () => {
    const track = newTrack();
    const next = apply(makeProject(), { type: 'track.add', track });
    expect(next.tracks[track.id]).toBe(track);
  });

  it('normalizes mixer values, trims names and fills instrument defaults', () => {
    const inst = createTrack({ id: asTrackId('trk_syn'), kind: 'instrument' });
    const { midiInput: _omit, ...withoutRouting } = inst;
    const next = apply(makeProject(), {
      type: 'track.add',
      track: {
        ...withoutRouting,
        name: '  Bass ',
        mixer: { gainDb: 99, pan: -4, mute: false, solo: false },
        instrument: { kind: 'synth', params: { cutoffHz: 1e9 } },
      },
    });
    const added = next.tracks[asTrackId('trk_syn')]!;
    expect(added.name).toBe('Bass');
    expect(added.mixer).toEqual({ gainDb: 6, pan: -1, mute: false, solo: false });
    expect(added.midiInput).toEqual({ channel: 'all', transpose: 0 });
    expect(added.instrument?.params).toEqual({
      ...defaultParamValues(INSTRUMENT_PARAM_SPECS.synth),
      cutoffHz: 18_000,
    });
  });

  it('rejects duplicate ids and malformed tracks', () => {
    const p = makeProject();
    expectCommandError(
      p,
      { type: 'track.add', track: newTrack({ id: ids.audio }) },
      'invalid-argument',
    );
    expectCommandError(
      p,
      { type: 'track.add', track: newTrack({ id: asTrackId('') }) },
      'invalid-argument',
    );
    expectCommandError(
      p,
      { type: 'track.add', track: newTrack({ name: ' ' }) },
      'invalid-argument',
    );
    expectCommandError(
      p,
      { type: 'track.add', track: newTrack({ color: 'red' }) },
      'invalid-argument',
    );
    expectCommandError(
      p,
      { type: 'track.add', track: newTrack({ kind: 'bus' as Track['kind'] }) },
      'invalid-argument',
    );
    expectCommandError(
      p,
      { type: 'track.add', track: newTrack({ monitor: 'loud' as Track['monitor'] }) },
      'invalid-argument',
    );
    expectCommandError(p, { type: 'track.add', track: newTrack(), index: 1.5 }, 'invalid-argument');
    expectCommandError(
      p,
      {
        type: 'track.add',
        track: newTrack({ mixer: { gainDb: Number.NaN, pan: 0, mute: false, solo: false } }),
      },
      'invalid-argument',
    );
    expectCommandError(
      p,
      { type: 'track.add', track: newTrack({ instrument: createInstrumentConfig('synth') }) },
      'invalid-argument',
    );
    expectCommandError(
      p,
      { type: 'track.add', track: newTrack({ midiInput: { channel: 1, transpose: 0 } }) },
      'invalid-argument',
    );
    expectCommandError(
      p,
      { type: 'track.add', track: newTrack({ inputChannels: 3 as 1 }) },
      'invalid-argument',
    );
    const fx = createEffectSlot(asEffectId('fx'), 'gain');
    expectCommandError(
      p,
      { type: 'track.add', track: newTrack({ effects: [fx, fx] }) },
      'invalid-argument',
    );
    expectCommandError(
      p,
      { type: 'track.add', track: newTrack({ effects: [{ ...fx, params: { bogus: 1 } }] }) },
      'invalid-argument',
    );
  });

  it('validates instrument tracks', () => {
    const p = makeProject();
    const inst = createTrack({ id: asTrackId('trk_i'), kind: 'instrument' });
    const { instrument: _omit, ...noInstrument } = inst;
    expectCommandError(p, { type: 'track.add', track: noInstrument }, 'invalid-argument');
    expectCommandError(
      p,
      { type: 'track.add', track: { ...inst, inputChannels: 1 } },
      'invalid-argument',
    );
    expectCommandError(
      p,
      {
        type: 'track.add',
        track: { ...inst, instrument: { kind: 'theremin' as 'synth', params: {} } },
      },
      'invalid-argument',
    );
    expectCommandError(
      p,
      { type: 'track.add', track: { ...inst, midiInput: { channel: 17, transpose: 0 } } },
      'invalid-argument',
    );
  });
});

describe('track.remove', () => {
  it('removes the track, its clips, its order entry and mappings that target it', () => {
    const p = makeProject();
    const next = apply(p, { type: 'track.remove', trackId: ids.inst });
    expect(next.tracks[ids.inst]).toBeUndefined();
    expect(next.trackOrder).toEqual([ids.audio, ids.vocal]);
    expect(next.clips[ids.midi]).toBeUndefined();
    expect(next.clips[ids.audioClip]).toBe(p.clips[ids.audioClip]);
    expect(next.midiMappings.map((m) => m.id)).toEqual([ids.playMapping]);
    expect(next.midiMappings[0]).toBe(p.midiMappings[1]);
    expect(checkProjectInvariants(next)).toEqual([]);
  });

  it('keeps unrelated collections by reference', () => {
    const p = makeProject();
    const next = apply(p, { type: 'track.remove', trackId: ids.vocal });
    expect(next.clips).toBe(p.clips);
    expect(next.midiMappings).toBe(p.midiMappings);
    expect(next.assets).toBe(p.assets);
  });

  it('fails for unknown tracks (including inherited keys)', () => {
    expectCommandError(
      makeProject(),
      { type: 'track.remove', trackId: asTrackId('nope') },
      'not-found',
    );
    expectCommandError(
      makeProject(),
      { type: 'track.remove', trackId: asTrackId('toString') },
      'not-found',
    );
  });
});

describe('track.update', () => {
  it('applies a patch and shares untouched fields', () => {
    const p = makeProject();
    const next = apply(p, {
      type: 'track.update',
      trackId: ids.audio,
      patch: { name: ' Gtr ', color: '#112233', armed: true, monitor: 'on', inputChannels: 2 },
    });
    const track = next.tracks[ids.audio]!;
    expect(track).toMatchObject({
      name: 'Gtr',
      color: '#112233',
      armed: true,
      monitor: 'on',
      inputChannels: 2,
    });
    expect(track.mixer).toBe(p.tracks[ids.audio]!.mixer);
    expect(next.tracks[ids.inst]).toBe(p.tracks[ids.inst]);
  });

  it('validates and clamps MIDI input routing on instrument tracks', () => {
    const p = makeProject();
    const next = apply(p, {
      type: 'track.update',
      trackId: ids.inst,
      patch: { midiInput: { channel: 10, transpose: 99 } },
    });
    expect(next.tracks[ids.inst]!.midiInput).toEqual({ channel: 10, transpose: 48 });
    expectCommandError(
      p,
      {
        type: 'track.update',
        trackId: ids.inst,
        patch: { midiInput: { channel: 0, transpose: 0 } },
      },
      'invalid-argument',
    );
    expectCommandError(
      p,
      {
        type: 'track.update',
        trackId: ids.inst,
        patch: { midiInput: { channel: 'all', transpose: 0.5 } },
      },
      'invalid-argument',
    );
  });

  it('rejects patches that do not apply to the track kind', () => {
    const p = makeProject();
    expectCommandError(
      p,
      {
        type: 'track.update',
        trackId: ids.audio,
        patch: { midiInput: { channel: 'all', transpose: 0 } },
      },
      'kind-mismatch',
    );
    expectCommandError(
      p,
      { type: 'track.update', trackId: ids.inst, patch: { inputChannels: 1 } },
      'kind-mismatch',
    );
  });

  it('rejects invalid values and unknown tracks', () => {
    const p = makeProject();
    expectCommandError(
      p,
      { type: 'track.update', trackId: ids.audio, patch: { name: '' } },
      'invalid-argument',
    );
    expectCommandError(
      p,
      { type: 'track.update', trackId: ids.audio, patch: { color: '#12345' } },
      'invalid-argument',
    );
    expectCommandError(
      p,
      { type: 'track.update', trackId: ids.audio, patch: { monitor: 'x' as 'on' } },
      'invalid-argument',
    );
    expectCommandError(
      p,
      { type: 'track.update', trackId: ids.audio, patch: { inputChannels: 0 as 1 } },
      'invalid-argument',
    );
    expectCommandError(
      p,
      { type: 'track.update', trackId: asTrackId('nope'), patch: { armed: true } },
      'not-found',
    );
  });

  it('is a no-op for identical values', () => {
    const p = makeProject();
    expectNoop(p, {
      type: 'track.update',
      trackId: ids.audio,
      patch: { name: 'Guitar', armed: false },
    });
    expectNoop(p, {
      type: 'track.update',
      trackId: ids.inst,
      patch: { midiInput: { channel: 'all', transpose: 0 } },
    });
    expectNoop(p, { type: 'track.update', trackId: ids.audio, patch: {} });
  });
});

describe('track.move', () => {
  it('reorders and clamps the destination', () => {
    const p = makeProject();
    expect(apply(p, { type: 'track.move', trackId: ids.inst, toIndex: 2 }).trackOrder).toEqual([
      ids.audio,
      ids.vocal,
      ids.inst,
    ]);
    expect(apply(p, { type: 'track.move', trackId: ids.vocal, toIndex: -3 }).trackOrder).toEqual([
      ids.vocal,
      ids.inst,
      ids.audio,
    ]);
    expect(apply(p, { type: 'track.move', trackId: ids.inst, toIndex: 50 }).trackOrder).toEqual([
      ids.audio,
      ids.vocal,
      ids.inst,
    ]);
    expect(apply(p, { type: 'track.move', trackId: ids.inst, toIndex: 1 }).tracks).toBe(p.tracks);
  });

  it('is a no-op in place and validates input', () => {
    const p = makeProject();
    expectNoop(p, { type: 'track.move', trackId: ids.audio, toIndex: 1 });
    expectCommandError(
      p,
      { type: 'track.move', trackId: ids.audio, toIndex: 0.5 },
      'invalid-argument',
    );
    expectCommandError(p, { type: 'track.move', trackId: asTrackId('x'), toIndex: 0 }, 'not-found');
  });
});

describe('track.setMixer', () => {
  it('clamps gain and pan and merges', () => {
    const p = makeProject();
    const next = apply(p, {
      type: 'track.setMixer',
      trackId: ids.audio,
      mixer: { gainDb: 12, pan: 2, solo: true },
    });
    expect(next.tracks[ids.audio]!.mixer).toEqual({ gainDb: 6, pan: 1, mute: false, solo: true });
    expect(
      apply(p, { type: 'track.setMixer', trackId: ids.audio, mixer: { gainDb: -200, mute: true } })
        .tracks[ids.audio]!.mixer,
    ).toMatchObject({ gainDb: -60, mute: true });
    expect(next.tracks[ids.inst]).toBe(p.tracks[ids.inst]);
    expect(next.tracks[ids.audio]!.effects).toBe(p.tracks[ids.audio]!.effects);
  });

  it('returns the same project for identical values', () => {
    const p = makeProject();
    expectNoop(p, {
      type: 'track.setMixer',
      trackId: ids.audio,
      mixer: { gainDb: 0, pan: 0, mute: false, solo: false },
    });
    expectNoop(p, {
      type: 'track.setMixer',
      trackId: ids.audio,
      mixer: { gainDb: -0 }, // -0 equals the stored 0: still a no-op
    });
  });

  it('rejects non-finite values and unknown tracks', () => {
    const p = makeProject();
    expectCommandError(
      p,
      { type: 'track.setMixer', trackId: ids.audio, mixer: { pan: Number.NaN } },
      'invalid-argument',
    );
    expectCommandError(
      p,
      { type: 'track.setMixer', trackId: asTrackId('x'), mixer: { pan: 0 } },
      'not-found',
    );
  });
});

describe('track.setInstrument', () => {
  it('replaces the instrument with sanitized params', () => {
    const p = makeProject();
    const instrument: InstrumentConfig = { kind: 'drums', params: { tune: 40 } };
    const next = apply(p, { type: 'track.setInstrument', trackId: ids.inst, instrument });
    expect(next.tracks[ids.inst]!.instrument).toEqual({
      kind: 'drums',
      params: { ...defaultParamValues(INSTRUMENT_PARAM_SPECS.drums), tune: 12 },
    });
    expect(next.tracks[ids.inst]!.effects).toBe(p.tracks[ids.inst]!.effects);
  });

  it('accepts samplers referencing registered assets only', () => {
    const p = makeProject();
    const sampler = { ...createInstrumentConfig('sampler'), sampleAssetId: ids.sample };
    expect(
      apply(p, { type: 'track.setInstrument', trackId: ids.inst, instrument: sampler }).tracks[
        ids.inst
      ]!.instrument,
    ).toBe(sampler);
    expectCommandError(
      p,
      {
        type: 'track.setInstrument',
        trackId: ids.inst,
        instrument: { ...sampler, sampleAssetId: asAssetId('missing') },
      },
      'not-found',
    );
    expectCommandError(
      p,
      {
        type: 'track.setInstrument',
        trackId: ids.inst,
        instrument: { ...createInstrumentConfig('synth'), sampleAssetId: ids.sample },
      },
      'invalid-argument',
    );
  });

  it('is a no-op for an equal instrument and validates input', () => {
    const p = makeProject();
    const current = p.tracks[ids.inst]!.instrument!;
    expectNoop(p, {
      type: 'track.setInstrument',
      trackId: ids.inst,
      instrument: { ...current, params: { ...current.params } },
    });
    expectCommandError(
      p,
      { type: 'track.setInstrument', trackId: ids.audio, instrument: current },
      'kind-mismatch',
    );
    expectCommandError(
      p,
      {
        type: 'track.setInstrument',
        trackId: ids.inst,
        instrument: { kind: 'synth', params: { nope: 1 } },
      },
      'invalid-argument',
    );
    expectCommandError(
      p,
      {
        type: 'track.setInstrument',
        trackId: ids.inst,
        instrument: { kind: 'organ' as 'synth', params: {} },
      },
      'invalid-argument',
    );
  });
});

describe('track.setInstrumentParams', () => {
  it('merges and clamps params, keeping other references', () => {
    const p = makeProject();
    const next = apply(p, {
      type: 'track.setInstrumentParams',
      trackId: ids.inst,
      params: { cutoffHz: 1, polyphony: 3.6 },
    });
    const params = next.tracks[ids.inst]!.instrument!.params;
    expect(params.cutoffHz).toBe(40);
    expect(params.polyphony).toBe(4);
    expect(params.attack).toBe(p.tracks[ids.inst]!.instrument!.params.attack);
    expect(next.tracks[ids.audio]).toBe(p.tracks[ids.audio]);
  });

  it('rejects unknown param ids, non-finite values and non-instrument tracks', () => {
    const p = makeProject();
    expectCommandError(
      p,
      { type: 'track.setInstrumentParams', trackId: ids.inst, params: { wobble: 1 } },
      'invalid-argument',
    );
    expectCommandError(
      p,
      {
        type: 'track.setInstrumentParams',
        trackId: ids.inst,
        params: { attack: Number.POSITIVE_INFINITY },
      },
      'invalid-argument',
    );
    expectCommandError(
      p,
      { type: 'track.setInstrumentParams', trackId: ids.vocal, params: { attack: 1 } },
      'kind-mismatch',
    );
    expectCommandError(
      p,
      { type: 'track.setInstrumentParams', trackId: asTrackId('x'), params: {} },
      'not-found',
    );
  });

  it('is a no-op for identical values', () => {
    const p = makeProject();
    const { cutoffHz } = p.tracks[ids.inst]!.instrument!.params;
    expectNoop(p, {
      type: 'track.setInstrumentParams',
      trackId: ids.inst,
      params: { cutoffHz: cutoffHz! },
    });
    expect(
      applyCommand(p, { type: 'track.setInstrumentParams', trackId: ids.inst, params: {} }),
    ).toBe(p);
  });
});
