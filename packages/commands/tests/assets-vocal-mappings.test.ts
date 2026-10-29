import {
  DEFAULT_VOCAL_NOTE_EDIT,
  asAssetId,
  asMappingId,
  asTrackId,
  asVocalNoteId,
  checkProjectInvariants,
  createInstrumentConfig,
  createMidiMapping,
  type AssetRef,
  type MidiMapping,
  type ScaleId,
} from '@studio/domain';
import { describe, expect, it } from 'vitest';
import { applyCommands } from '../src';
import {
  apply,
  expectCommandError,
  expectNoop,
  ids,
  makeAsset,
  makeProject,
  makeVocalDoc,
  segment,
} from './fixtures';

const NEW_ASSET = asAssetId('ast_new');

describe('asset.register', () => {
  it('registers new assets and shares the rest', () => {
    const p = makeProject();
    const asset = makeAsset({ id: NEW_ASSET, contentHash: 'cc' });
    const next = apply(p, { type: 'asset.register', asset });
    expect(next.assets[NEW_ASSET]).toBe(asset);
    expect(next.assets[ids.take]).toBe(p.assets[ids.take]);
    expect(next.clips).toBe(p.clips);
  });

  it('is a no-op for an identical ref and rejects conflicting content', () => {
    const p = makeProject();
    expectNoop(p, { type: 'asset.register', asset: makeAsset() });
    expectCommandError(
      p,
      { type: 'asset.register', asset: makeAsset({ contentHash: 'zz' }) },
      'invalid-argument',
    );
  });

  it('validates the ref', () => {
    const p = makeProject();
    const bad = (o: Partial<AssetRef>) =>
      ({ type: 'asset.register', asset: makeAsset({ id: NEW_ASSET, ...o }) }) as const;
    expectCommandError(p, bad({ id: asAssetId('') }), 'invalid-argument');
    expectCommandError(p, bad({ kind: 'midi' as 'audio' }), 'invalid-argument');
    expectCommandError(p, bad({ sampleRate: 0 }), 'invalid-argument');
    expectCommandError(p, bad({ sampleRate: Number.NaN }), 'invalid-argument');
    expectCommandError(p, bad({ channels: 0 }), 'invalid-argument');
    expectCommandError(p, bad({ frames: -1 }), 'invalid-argument');
    expectCommandError(p, bad({ byteLength: 1.5 }), 'invalid-argument');
  });
});

describe('asset.remove', () => {
  it('removes unreferenced assets', () => {
    const next = apply(makeProject(), { type: 'asset.remove', assetId: ids.sample });
    expect(next.assets[ids.sample]).toBeUndefined();
    expect(checkProjectInvariants(next)).toEqual([]);
  });

  it('refuses while a clip, sampler or vocal doc references the asset', () => {
    const p = makeProject();
    expectCommandError(
      p,
      { type: 'asset.remove', assetId: ids.take },
      'precondition-failed',
      /clip/,
    );
    const noClip = apply(p, { type: 'clip.remove', clipIds: [ids.audioClip] });
    expectCommandError(
      noClip,
      { type: 'asset.remove', assetId: ids.take },
      'precondition-failed',
      /vocal/,
    );
    const free = apply(noClip, { type: 'vocal.removeDoc', assetId: ids.take });
    expect(
      apply(free, { type: 'asset.remove', assetId: ids.take }).assets[ids.take],
    ).toBeUndefined();
    const sampler = apply(p, {
      type: 'track.setInstrument',
      trackId: ids.inst,
      instrument: { ...createInstrumentConfig('sampler'), sampleAssetId: ids.sample },
    });
    expectCommandError(
      sampler,
      { type: 'asset.remove', assetId: ids.sample },
      'precondition-failed',
      /track/,
    );
  });

  it('fails for unknown assets', () => {
    expectCommandError(makeProject(), { type: 'asset.remove', assetId: NEW_ASSET }, 'not-found');
  });
});

describe('vocal.setDoc / vocal.removeDoc', () => {
  it('stores a doc with sorted segments and clamped settings', () => {
    const p = apply(makeProject(), {
      type: 'asset.register',
      asset: makeAsset({ id: NEW_ASSET, contentHash: 'cc' }),
    });
    const next = apply(p, {
      type: 'vocal.setDoc',
      doc: makeVocalDoc({
        assetId: NEW_ASSET,
        segments: [segment('b', 1, 2), { ...segment('a', 0, 1), confidence: 3 }],
        noteEdits: { [asVocalNoteId('a')]: { ...DEFAULT_VOCAL_NOTE_EDIT, modulationScale: 9 } },
        correction: { ...makeVocalDoc().correction, amount: 4 },
      }),
    });
    const doc = next.vocalEdits[NEW_ASSET]!;
    expect(doc.segments.map((s) => [s.id, s.confidence])).toEqual([
      ['a', 1],
      ['b', 0.9],
    ]);
    expect(doc.noteEdits[asVocalNoteId('a')]!.modulationScale).toBe(2);
    expect(doc.correction.amount).toBe(1);
    expect(next.vocalEdits[ids.take]).toBe(p.vocalEdits[ids.take]);
    expect(checkProjectInvariants(next)).toEqual([]);
  });

  it('keeps a valid doc by reference and is a no-op for an equal doc', () => {
    const p = makeProject();
    expectNoop(p, { type: 'vocal.setDoc', doc: makeVocalDoc() });
    const doc = makeVocalDoc({ enabled: false });
    expect(apply(p, { type: 'vocal.setDoc', doc }).vocalEdits[ids.take]).toBe(doc);
  });

  it('validates the doc', () => {
    const p = makeProject();
    expectCommandError(
      p,
      { type: 'vocal.setDoc', doc: makeVocalDoc({ assetId: NEW_ASSET }) },
      'not-found',
    );
    expectCommandError(
      p,
      {
        type: 'vocal.setDoc',
        doc: makeVocalDoc({ segments: [segment('a', 0, 1), segment('a', 1, 2)] }),
      },
      'invalid-argument',
    );
    expectCommandError(
      p,
      { type: 'vocal.setDoc', doc: makeVocalDoc({ segments: [segment('a', 2, 1)] }) },
      'invalid-argument',
    );
    expectCommandError(
      p,
      { type: 'vocal.setDoc', doc: makeVocalDoc({ segments: [segment('a', -1, 1)] }) },
      'invalid-argument',
    );
    expectCommandError(
      p,
      { type: 'vocal.setDoc', doc: makeVocalDoc({ segments: [segment('', 0, 1)] }) },
      'invalid-argument',
    );
    expectCommandError(
      p,
      {
        type: 'vocal.setDoc',
        doc: makeVocalDoc({ segments: [{ ...segment('a', 0, 1), detectedMidi: Number.NaN }] }),
      },
      'invalid-argument',
    );
    expectCommandError(
      p,
      { type: 'vocal.setDoc', doc: makeVocalDoc({ segments: [segment('a', 0, 1)] }) },
      'not-found',
    ); // edits reference vn_1
  });

  it('removes docs', () => {
    const p = makeProject();
    expect(apply(p, { type: 'vocal.removeDoc', assetId: ids.take }).vocalEdits).toEqual({});
    expectCommandError(p, { type: 'vocal.removeDoc', assetId: ids.sample }, 'not-found');
  });
});

describe('vocal.setCorrection', () => {
  it('merges and clamps', () => {
    const p = makeProject();
    const next = apply(p, {
      type: 'vocal.setCorrection',
      assetId: ids.take,
      correction: {
        amount: 2,
        humanize: -1,
        retuneSpeedMs: 5000,
        formantShiftSemitones: -30,
        formantPreservation: false,
        key: { tonic: 9, scale: 'naturalMinor' },
      },
    });
    expect(next.vocalEdits[ids.take]!.correction).toEqual({
      key: { tonic: 9, scale: 'naturalMinor' },
      amount: 1,
      retuneSpeedMs: 1000,
      humanize: 0,
      formantPreservation: false,
      formantShiftSemitones: -12,
    });
    expect(next.vocalEdits[ids.take]!.segments).toBe(p.vocalEdits[ids.take]!.segments);
    const back = apply(next, {
      type: 'vocal.setCorrection',
      assetId: ids.take,
      correction: { key: null, formantShiftSemitones: 40 },
    });
    expect(back.vocalEdits[ids.take]!.correction).toMatchObject({
      key: null,
      formantShiftSemitones: 12,
    });
  });

  it('validates keys and values, and is a no-op when unchanged', () => {
    const p = makeProject();
    expectCommandError(
      p,
      {
        type: 'vocal.setCorrection',
        assetId: ids.take,
        correction: { key: { tonic: 12 as 0, scale: 'major' } },
      },
      'invalid-argument',
    );
    expectCommandError(
      p,
      {
        type: 'vocal.setCorrection',
        assetId: ids.take,
        correction: { key: { tonic: 0, scale: 'weird' as ScaleId } },
      },
      'invalid-argument',
    );
    expectCommandError(
      p,
      { type: 'vocal.setCorrection', assetId: ids.take, correction: { amount: Number.NaN } },
      'invalid-argument',
    );
    expectCommandError(
      p,
      { type: 'vocal.setCorrection', assetId: ids.sample, correction: {} },
      'not-found',
    );
    expectNoop(p, {
      type: 'vocal.setCorrection',
      assetId: ids.take,
      correction: { amount: 0, key: null },
    });
  });
});

describe('vocal note edits', () => {
  it('merges partial edits onto existing edits or the defaults', () => {
    const p = makeProject();
    const next = apply(p, {
      type: 'vocal.setNoteEdits',
      assetId: ids.take,
      edits: {
        [ids.v1]: { driftCorrection: 2, targetMidi: undefined },
        [ids.v2]: { targetMidi: 200, modulationScale: -1, transitionMs: 5000, bypass: true },
      },
    });
    const edits = next.vocalEdits[ids.take]!.noteEdits;
    expect(edits[ids.v1]).toEqual({
      driftCorrection: 1,
      modulationScale: 1,
      transitionMs: 60,
      bypass: false,
      targetMidi: 60,
    });
    expect(edits[ids.v2]).toEqual({
      ...DEFAULT_VOCAL_NOTE_EDIT,
      targetMidi: 127,
      modulationScale: 0,
      transitionMs: 1000,
      bypass: true,
    });
    expectNoop(next, {
      type: 'vocal.setNoteEdits',
      assetId: ids.take,
      edits: { [ids.v2]: { bypass: true } },
    });
    expectCommandError(
      p,
      {
        type: 'vocal.setNoteEdits',
        assetId: ids.take,
        edits: { [asVocalNoteId('zz')]: { bypass: true } },
      },
      'not-found',
    );
    expectCommandError(
      p,
      {
        type: 'vocal.setNoteEdits',
        assetId: ids.take,
        edits: { [ids.v3]: { transitionMs: Number.NaN } },
      },
      'invalid-argument',
    );
  });

  it('clears targets', () => {
    const p = makeProject();
    const next = apply(p, {
      type: 'vocal.clearTargets',
      assetId: ids.take,
      noteIds: [ids.v1, ids.v2],
    });
    expect(next.vocalEdits[ids.take]!.noteEdits[ids.v1]).toEqual({
      driftCorrection: 0.5,
      modulationScale: 1,
      transitionMs: 60,
      bypass: false,
    });
    expectNoop(next, { type: 'vocal.clearTargets', assetId: ids.take, noteIds: [ids.v1] });
    expectCommandError(
      p,
      { type: 'vocal.clearTargets', assetId: ids.take, noteIds: [asVocalNoteId('zz')] },
      'not-found',
    );
  });

  it('resets notes to defaults', () => {
    const p = makeProject();
    const next = apply(p, { type: 'vocal.resetNotes', assetId: ids.take, noteIds: [ids.v1] });
    expect(next.vocalEdits[ids.take]!.noteEdits).toEqual({});
    expectNoop(next, { type: 'vocal.resetNotes', assetId: ids.take, noteIds: [ids.v1, ids.v2] });
    expectCommandError(
      p,
      { type: 'vocal.resetNotes', assetId: ids.take, noteIds: [asVocalNoteId('zz')] },
      'not-found',
    );
  });
});

describe('vocal.replaceSegments', () => {
  it('splits a segment, keeping order and unrelated edits', () => {
    const p = makeProject();
    const next = apply(p, {
      type: 'vocal.replaceSegments',
      assetId: ids.take,
      removeIds: [ids.v2],
      add: [segment('vn_2b', 0.75, 1), segment('vn_2a', 0.5, 0.75)],
    });
    const doc = next.vocalEdits[ids.take]!;
    expect(doc.segments.map((s) => s.id)).toEqual(['vn_1', 'vn_2a', 'vn_2b', 'vn_3']);
    expect(doc.noteEdits).toBe(p.vocalEdits[ids.take]!.noteEdits);
    expect(checkProjectInvariants(next)).toEqual([]);
  });

  it('merges segments, dropping edits of removed notes', () => {
    const next = apply(makeProject(), {
      type: 'vocal.replaceSegments',
      assetId: ids.take,
      removeIds: [ids.v1, ids.v2],
      add: [segment('vn_12', 0, 1)],
    });
    const doc = next.vocalEdits[ids.take]!;
    expect(doc.segments.map((s) => s.id)).toEqual(['vn_12', 'vn_3']);
    expect(doc.noteEdits).toEqual({});
  });

  it('validates ids and is a no-op when empty', () => {
    const p = makeProject();
    expectCommandError(
      p,
      {
        type: 'vocal.replaceSegments',
        assetId: ids.take,
        removeIds: [asVocalNoteId('zz')],
        add: [],
      },
      'not-found',
    );
    expectCommandError(
      p,
      {
        type: 'vocal.replaceSegments',
        assetId: ids.take,
        removeIds: [],
        add: [segment('vn_3', 3, 4)],
      },
      'invalid-argument',
    );
    expectCommandError(
      p,
      {
        type: 'vocal.replaceSegments',
        assetId: ids.take,
        removeIds: [],
        add: [segment('x', 3, 4), segment('x', 4, 5)],
      },
      'invalid-argument',
    );
    expectNoop(p, { type: 'vocal.replaceSegments', assetId: ids.take, removeIds: [], add: [] });
    // Re-adding a removed id in the same command is allowed (e.g. shortening a segment).
    const reshaped = apply(p, {
      type: 'vocal.replaceSegments',
      assetId: ids.take,
      removeIds: [ids.v3],
      add: [segment('vn_3', 1.3, 2)],
    });
    expect(reshaped.vocalEdits[ids.take]!.segments[2]!.startSeconds).toBe(1.3);
  });
});

describe('vocal.setEnabled', () => {
  it('toggles A/B and is a no-op when unchanged', () => {
    const p = makeProject();
    expect(
      apply(p, { type: 'vocal.setEnabled', assetId: ids.take, enabled: false }).vocalEdits[
        ids.take
      ]!.enabled,
    ).toBe(false);
    expectNoop(p, { type: 'vocal.setEnabled', assetId: ids.take, enabled: true });
    expectCommandError(
      p,
      { type: 'vocal.setEnabled', assetId: ids.sample, enabled: true },
      'not-found',
    );
  });
});

describe('MIDI mappings', () => {
  const mapping = (overrides: Partial<MidiMapping> = {}): MidiMapping => ({
    ...createMidiMapping({
      id: asMappingId('map_new'),
      source: { kind: 'cc', channel: 'any', controller: 74, mode: 'absolute' },
      target: {
        kind: 'parameter',
        address: { scope: 'instrument', trackId: ids.inst, param: 'cutoffHz' },
      },
    }),
    ...overrides,
  });

  it('adds project-scope mappings', () => {
    const p = makeProject();
    const m = mapping();
    const next = apply(p, { type: 'mapping.add', mapping: m });
    expect(next.midiMappings.at(-1)).toBe(m);
    expect(next.midiMappings[0]).toBe(p.midiMappings[0]);
    const clamped = apply(p, {
      type: 'mapping.add',
      mapping: mapping({ transform: { ...m.transform, min: -1, max: 3 } }),
    });
    expect(clamped.midiMappings.at(-1)!.transform).toMatchObject({ min: 0, max: 1 });
    apply(p, {
      type: 'mapping.add',
      mapping: mapping({
        target: {
          kind: 'parameter',
          address: { scope: 'effect', trackId: 'master', effectId: ids.masterFx, param: 'ratio' },
        },
      }),
    });
    apply(p, {
      type: 'mapping.add',
      mapping: mapping({ source: { kind: 'pitchBend', channel: 2 } }),
    });
    apply(p, {
      type: 'mapping.add',
      mapping: mapping({ source: { kind: 'programChange', channel: 16, program: 5 } }),
    });
  });

  it('validates mappings', () => {
    const p = makeProject();
    expectCommandError(
      p,
      { type: 'mapping.add', mapping: mapping({ scope: 'global' }) },
      'invalid-argument',
    );
    expectCommandError(
      p,
      { type: 'mapping.add', mapping: mapping({ id: ids.gainMapping }) },
      'invalid-argument',
    );
    expectCommandError(
      p,
      { type: 'mapping.add', mapping: mapping({ id: asMappingId('') }) },
      'invalid-argument',
    );
    expectCommandError(
      p,
      {
        type: 'mapping.add',
        mapping: mapping({ source: { kind: 'cc', channel: 17, controller: 1, mode: 'absolute' } }),
      },
      'invalid-argument',
    );
    expectCommandError(
      p,
      {
        type: 'mapping.add',
        mapping: mapping({ source: { kind: 'cc', channel: 1, controller: 128, mode: 'absolute' } }),
      },
      'invalid-argument',
    );
    expectCommandError(
      p,
      {
        type: 'mapping.add',
        mapping: mapping({ source: { kind: 'note', channel: 1, note: -1, behavior: 'gate' } }),
      },
      'invalid-argument',
    );
    expectCommandError(
      p,
      {
        type: 'mapping.add',
        mapping: mapping({ source: { kind: 'programChange', channel: 1, program: 200 } }),
      },
      'invalid-argument',
    );
    expectCommandError(
      p,
      {
        type: 'mapping.add',
        mapping: mapping({ source: { kind: 'sysex' } as unknown as MidiMapping['source'] }),
      },
      'invalid-argument',
    );
    expectCommandError(
      p,
      {
        type: 'mapping.add',
        mapping: mapping({ transform: { ...mapping().transform, relativeStep: Number.NaN } }),
      },
      'invalid-argument',
    );
    expectCommandError(
      p,
      {
        type: 'mapping.add',
        mapping: mapping({
          target: {
            kind: 'parameter',
            address: { scope: 'track', trackId: asTrackId('gone'), param: 'pan' },
          },
        }),
      },
      'not-found',
    );
  });

  it('updates mappings by patch', () => {
    const p = makeProject();
    const next = apply(p, {
      type: 'mapping.update',
      mappingId: ids.playMapping,
      patch: { enabled: false, label: 'Pad 1' },
    });
    expect(next.midiMappings[1]).toMatchObject({
      enabled: false,
      label: 'Pad 1',
      scope: 'project',
    });
    expect(next.midiMappings[0]).toBe(p.midiMappings[0]);
    const transform = apply(p, {
      type: 'mapping.update',
      mappingId: ids.gainMapping,
      patch: { transform: { ...p.midiMappings[0]!.transform, min: 0.25, max: 5 } },
    });
    expect(transform.midiMappings[0]!.transform).toMatchObject({ min: 0.25, max: 1 });
  });

  it('rejects scope/id changes and unknown mappings; no-op when unchanged', () => {
    const p = makeProject();
    expectCommandError(
      p,
      { type: 'mapping.update', mappingId: ids.playMapping, patch: { scope: 'global' } as never },
      'invalid-argument',
    );
    expectCommandError(
      p,
      {
        type: 'mapping.update',
        mappingId: ids.playMapping,
        patch: { id: asMappingId('other') } as never,
      },
      'invalid-argument',
    );
    expectCommandError(
      p,
      { type: 'mapping.update', mappingId: asMappingId('x'), patch: {} },
      'not-found',
    );
    expectNoop(p, { type: 'mapping.update', mappingId: ids.playMapping, patch: { enabled: true } });
    expectNoop(p, {
      type: 'mapping.update',
      mappingId: ids.gainMapping,
      patch: { transform: { ...p.midiMappings[0]!.transform, max: 5 } },
    } as never);
    expectNoop(p, {
      type: 'mapping.update',
      mappingId: ids.playMapping,
      patch: { scope: 'project' } as never,
    });
  });

  it('removes mappings', () => {
    const p = makeProject();
    const next = apply(p, { type: 'mapping.remove', mappingIds: [ids.gainMapping, ids.fxMapping] });
    expect(next.midiMappings.map((m) => m.id)).toEqual([ids.playMapping]);
    expectCommandError(
      p,
      { type: 'mapping.remove', mappingIds: [ids.gainMapping, asMappingId('x')] },
      'not-found',
    );
    expectNoop(p, { type: 'mapping.remove', mappingIds: [] });
  });

  it('works through applyCommands', () => {
    const p = makeProject();
    const next = applyCommands(p, [
      { type: 'mapping.add', mapping: mapping() },
      { type: 'mapping.remove', mappingIds: [asMappingId('map_new')] },
    ]);
    expect(next.midiMappings).toEqual(p.midiMappings);
  });
});
