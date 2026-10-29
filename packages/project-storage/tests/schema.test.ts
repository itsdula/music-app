import {
  CURRENT_SCHEMA_VERSION,
  EFFECT_KINDS,
  asAssetId,
  asClipId,
  asEffectId,
  asMappingId,
  asNoteId,
  asProjectId,
  asTrackId,
  createAudioClip,
  createEffectSlot,
  createEmptyProject,
  createInstrumentConfig,
  createMidiClip,
  createMidiMapping,
  createTrack,
  sortNotes,
  type AssetRef,
  type Clip,
  type MidiNote,
  type Project,
  type Track,
} from '@studio/domain';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  ProjectSchema,
  ProjectValidationError,
  parseProject,
  parseProjectJson,
  serializeProject,
  stableStringify,
} from '../src';
import { NOW, buildRichProject, emptyProject, mutableCopy } from './fixtures';

type JsonObject = Record<string, unknown>;
type Mutation = (p: JsonObject) => void;
type Path = string | readonly string[];

const segments = (path: Path) => (typeof path === 'string' ? path.split('.') : path);

function get(root: JsonObject, path: Path): unknown {
  let node: unknown = root;
  for (const key of segments(path)) node = (node as JsonObject)[key];
  return node;
}

function locate(root: JsonObject, path: Path): [JsonObject, string] {
  const keys = segments(path);
  return [get(root, keys.slice(0, -1)) as JsonObject, keys[keys.length - 1]!];
}

const set =
  (path: Path, value: unknown): Mutation =>
  (p) => {
    const [parent, key] = locate(p, path);
    parent[key] = value;
  };

const del =
  (path: Path): Mutation =>
  (p) => {
    const [parent, key] = locate(p, path);
    delete parent[key];
  };

const editArray =
  (path: Path, edit: (items: unknown[]) => void): Mutation =>
  (p) =>
    edit(get(p, path) as unknown[]);

function expectRejected(project: unknown, stage: string, path: string, message?: RegExp) {
  const result = parseProject(project);
  expect(result.ok).toBe(false);
  if (result.ok) return;
  expect(result.error).toBeInstanceOf(ProjectValidationError);
  expect(result.error.stage).toBe(stage);
  const paths = result.error.issues.map((i) => i.path);
  expect(paths).toContain(path);
  if (message) {
    const issue = result.error.issues.find((i) => i.path === path)!;
    expect(issue.message).toMatch(message);
  }
}

describe('ProjectSchema / parseProject: valid projects', () => {
  it('accepts an empty project from the factory', () => {
    const project = emptyProject();
    const result = parseProject(project);
    expect(result).toEqual({ ok: true, value: { project, migratedFrom: CURRENT_SCHEMA_VERSION } });
  });

  it('accepts a project using every clip, effect, instrument, vocal and mapping kind', () => {
    const { project } = buildRichProject();
    const result = parseProject(project);
    if (!result.ok) throw result.error;
    expect(result.value.project).toEqual(project);
    expect(result.value.migratedFrom).toBe(1);
    // Every effect and instrument kind is represented.
    const effectKinds = new Set(project.tracks[asTrackId('trk_synth')]!.effects.map((e) => e.kind));
    expect([...effectKinds].sort()).toEqual([...EFFECT_KINDS].sort());
  });

  it('returns a detached copy (mutating the result does not affect the input)', () => {
    const { project } = buildRichProject();
    const result = parseProject(project);
    if (!result.ok) throw result.error;
    expect(result.value.project).not.toBe(project);
    expect(result.value.project.tracks).not.toBe(project.tracks);
  });

  it('exposes the zod schema for direct use', () => {
    expect(ProjectSchema.safeParse(emptyProject()).success).toBe(true);
  });
});

describe('ProjectSchema / parseProject: rejections carry useful paths', () => {
  const cases: [string, Mutation, string, string, RegExp?][] = [
    ['unknown root key', set('extra', 1), 'schema', '', /Unrecognized key/],
    ['NaN bpm', set('bpm', Number.NaN), 'schema', 'bpm'],
    ['infinite bpm', set('bpm', Number.POSITIVE_INFINITY), 'schema', 'bpm'],
    ['bpm below range', set('bpm', 5), 'schema', 'bpm'],
    ['bad denominator', set('meter.denominator', 3), 'schema', 'meter.denominator'],
    ['non-ISO createdAt', set('createdAt', 'yesterday'), 'schema', 'createdAt', /ISO-8601/],
    ['overlong name', set('name', 'x'.repeat(257)), 'schema', 'name'],
    ['fractional loop tick', set('loop.startTick', 1.5), 'schema', 'loop.startTick'],
    ['id with a slash', set('trackOrder.0', 'trk/../x'), 'schema', 'trackOrder.0'],
    [
      'record key with traversal',
      (p) => set(['tracks', '../x'], get(p, 'tracks.trk_audio'))(p),
      'schema',
      'tracks.../x',
    ],
    [
      'pan out of range',
      set('tracks.trk_vocal.mixer.pan', 2),
      'schema',
      'tracks.trk_vocal.mixer.pan',
    ],
    ['bad track kind', set('tracks.trk_audio.kind', 'video'), 'schema', 'tracks.trk_audio.kind'],
    [
      'bad monitor',
      set('tracks.trk_audio.monitor', 'always'),
      'schema',
      'tracks.trk_audio.monitor',
    ],
    [
      'unknown effect kind',
      set('tracks.trk_synth.effects.0.kind', 'flanger'),
      'schema',
      'tracks.trk_synth.effects.0.kind',
    ],
    [
      'non-numeric param',
      set('tracks.trk_synth.effects.0.params.gainDb', 'loud'),
      'schema',
      'tracks.trk_synth.effects.0.params.gainDb',
    ],
    [
      'too many effects',
      editArray('tracks.trk_audio.effects', (fx) => {
        for (let i = 0; i < 65; i++)
          fx.push({ id: `fx_n${i}`, kind: 'gain', bypass: false, params: {} });
      }),
      'schema',
      'tracks.trk_audio.effects',
    ],
    [
      'unknown instrument kind',
      set('tracks.trk_synth.instrument.kind', 'theremin'),
      'schema',
      'tracks.trk_synth.instrument.kind',
    ],
    [
      'bad midi input channel',
      set('tracks.trk_synth.midiInput.channel', 0),
      'schema',
      'tracks.trk_synth.midiInput.channel',
    ],
    [
      'bad input channels',
      set('tracks.trk_vocal.inputChannels', 3),
      'schema',
      'tracks.trk_vocal.inputChannels',
    ],
    ['unknown clip kind', set('clips.clp_midi.kind', 'video'), 'schema', 'clips.clp_midi.kind'],
    [
      'pitch out of range',
      set('clips.clp_midi.notes.0.pitch', 128),
      'schema',
      'clips.clp_midi.notes.0.pitch',
    ],
    [
      'zero velocity',
      set('clips.clp_midi.notes.0.velocity', 0),
      'schema',
      'clips.clp_midi.notes.0.velocity',
    ],
    [
      'zero-length note',
      set('clips.clp_midi.notes.0.durationTicks', 0),
      'schema',
      'clips.clp_midi.notes.0.durationTicks',
    ],
    [
      'audio field on midi clip',
      set('clips.clp_midi.assetId', 'ast_kick'),
      'schema',
      'clips.clp_midi',
      /Unrecognized key/,
    ],
    [
      'negative frames',
      set('clips.clp_audio.sourceStartFrame', -1),
      'schema',
      'clips.clp_audio.sourceStartFrame',
    ],
    [
      'bad content hash',
      set('assets.ast_kick.contentHash', 'ABC'),
      'schema',
      'assets.ast_kick.contentHash',
      /SHA-256/,
    ],
    ['asset key mismatch', set('assets.ast_kick.id', 'ast_other'), 'schema', 'assets.ast_kick.id'],
    [
      'bad asset source',
      set('assets.ast_kick.source', 'stolen'),
      'schema',
      'assets.ast_kick.source',
    ],
    [
      'vocal doc key mismatch',
      set('vocalEdits.ast_vocal.assetId', 'ast_kick'),
      'schema',
      'vocalEdits.ast_vocal.assetId',
    ],
    [
      'confidence above 1',
      set('vocalEdits.ast_vocal.segments.0.confidence', 2),
      'schema',
      'vocalEdits.ast_vocal.segments.0.confidence',
    ],
    [
      'segment ends before it starts',
      set('vocalEdits.ast_vocal.segments.0.endSeconds', 0),
      'schema',
      'vocalEdits.ast_vocal.segments.0.endSeconds',
    ],
    [
      'modulation scale above 2',
      set('vocalEdits.ast_vocal.noteEdits.vn_1.modulationScale', 3),
      'schema',
      'vocalEdits.ast_vocal.noteEdits.vn_1.modulationScale',
    ],
    [
      'bad key tonic',
      set('vocalEdits.ast_vocal.correction.key.tonic', 12),
      'schema',
      'vocalEdits.ast_vocal.correction.key.tonic',
    ],
    [
      'unknown mapping source kind',
      set('midiMappings.0.source.kind', 'aftertouch'),
      'schema',
      'midiMappings.0.source.kind',
    ],
    [
      'cc channel 17',
      set('midiMappings.0.source.channel', 17),
      'schema',
      'midiMappings.0.source.channel',
    ],
    [
      'unknown address scope',
      set('midiMappings.0.target.address.scope', 'clip'),
      'schema',
      'midiMappings.0.target.address.scope',
    ],
    [
      'unknown action',
      set('midiMappings.3.target.action', 'app.quit'),
      'schema',
      'midiMappings.3.target.action',
    ],
    [
      'transform min above 1',
      set('midiMappings.0.transform.min', 1.5),
      'schema',
      'midiMappings.0.transform.min',
    ],
    // Domain invariants (cross-entity rules) run after the schema.
    [
      'clip on missing track',
      set('clips.clp_midi.trackId', 'trk_missing'),
      'invariants',
      'clips.clp_midi',
      /missing track/,
    ],
    [
      'track not in trackOrder',
      editArray('trackOrder', (a) => a.pop()),
      'invariants',
      'trackOrder',
    ],
    [
      'unsorted notes',
      editArray('clips.clp_midi.notes', (a) => a.reverse()),
      'invariants',
      'clips.clp_midi.notes',
      /not sorted/,
    ],
    ['loop end before start', set('loop.endTick', 0), 'invariants', 'loop'],
    ['clip references missing asset', del('assets.ast_loop'), 'invariants', 'clips.clp_audio'],
    ['duplicate mapping id', set('midiMappings.1.id', 'map_cc'), 'invariants', 'midiMappings'],
    // Version handling.
    ['missing schemaVersion', del('schemaVersion'), 'version', 'schemaVersion', /missing/],
    ['string schemaVersion', set('schemaVersion', '1'), 'version', 'schemaVersion'],
    ['future schemaVersion', set('schemaVersion', 99), 'version', 'schemaVersion', /newer version/],
  ];

  it.each(cases)('rejects %s', (_label, mutate, stage, path, message) => {
    const data = mutableCopy(buildRichProject().project);
    mutate(data);
    expectRejected(data, stage, path, message);
  });

  it('rejects non-object input', () => {
    for (const input of [null, 42, 'project', [1, 2]]) expectRejected(input, 'schema', '');
  });

  it('formats a readable error message', () => {
    const data = mutableCopy(buildRichProject().project);
    (data as { bpm: number }).bpm = 1000;
    const result = parseProject(data);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toMatch(/^Invalid project \(schema\): bpm: /);
      expect(result.error.name).toBe('ProjectValidationError');
    }
  });

  it('summarizes long issue lists', () => {
    const data = mutableCopy(buildRichProject().project) as { midiMappings: { label: unknown }[] };
    for (const m of data.midiMappings) m.label = 7;
    const result = parseProject(data);
    if (result.ok) throw new Error('expected failure');
    expect(result.error.issues).toHaveLength(8);
    expect(result.error.message).toMatch(/\(\+3 more\)$/);
  });
});

describe('parseProjectJson', () => {
  it('reports malformed JSON at the json stage', () => {
    const result = parseProjectJson('{"id": ');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.stage).toBe('json');
      expect(result.error.issues[0]!.message).toMatch(/invalid JSON/);
    }
  });

  it('parses serialized projects', () => {
    const { project } = buildRichProject();
    expect(parseProjectJson(serializeProject(project))).toEqual({
      ok: true,
      value: { project, migratedFrom: 1 },
    });
  });
});

describe('serializeProject', () => {
  it('sorts keys deterministically regardless of insertion order', () => {
    const { project } = buildRichProject();
    const reordered = Object.fromEntries(Object.entries(project).reverse()) as unknown as Project;
    expect(serializeProject(reordered)).toBe(serializeProject(project));
    const text = serializeProject(project);
    expect(text.endsWith('}\n')).toBe(true);
    const topKeys = Object.keys(JSON.parse(text) as object);
    expect(topKeys).toEqual([...topKeys].sort());
  });

  it('omits undefined optional fields like JSON.stringify', () => {
    expect(stableStringify({ b: 1, a: undefined, c: [undefined] })).toBe(
      '{\n  "b": 1,\n  "c": [\n    null\n  ]\n}\n',
    );
  });

  it('keeps __proto__ keys as plain data', () => {
    const value = JSON.parse('{"__proto__": {"x": 1}, "a": 2}') as unknown;
    expect(stableStringify(value)).toBe('{\n  "__proto__": {\n    "x": 1\n  },\n  "a": 2\n}\n');
  });
});

// ---------------------------------------------------------------------------
// Property test: serialize → parse is the identity on valid projects.
// ---------------------------------------------------------------------------

const zeroSafe = (x: number) => x + 0; // turns -0 into +0 (JSON cannot represent -0)
const finiteDouble = (min: number, max: number) =>
  fc.double({ min, max, noNaN: true, noDefaultInfinity: true }).map(zeroSafe);
const suffix = fc.stringMatching(/^[a-z0-9]{1,6}$/);
const text = fc.string({ maxLength: 40, unit: 'binary' });

const noteArb = fc.record({
  startTick: fc.integer({ min: 0, max: 100_000 }),
  durationTicks: fc.integer({ min: 1, max: 10_000 }),
  pitch: fc.integer({ min: 0, max: 127 }),
  velocity: fc.integer({ min: 1, max: 127 }),
});

const trackSpecArb = fc.record({
  kind: fc.constantFrom('audio', 'instrument', 'vocal') as fc.Arbitrary<Track['kind']>,
  name: text,
  gainDb: finiteDouble(-60, 6),
  pan: finiteDouble(-1, 1),
  mute: fc.boolean(),
  solo: fc.boolean(),
  instrument: fc.constantFrom('synth', 'drums', 'sampler') as fc.Arbitrary<
    'synth' | 'drums' | 'sampler'
  >,
  effects: fc.array(fc.constantFrom(...EFFECT_KINDS), { maxLength: 3 }),
  clips: fc.array(
    fc.record({
      startTick: fc.integer({ min: 0, max: 1_000_000 }),
      length: fc.integer({ min: 1, max: 100_000 }),
      notes: fc.array(noteArb, { maxLength: 8 }),
      loop: fc.option(fc.integer({ min: 1, max: 10_000 }), { nil: undefined }),
      gainDb: finiteDouble(-24, 24),
      fade: fc.integer({ min: 0, max: 100 }),
    }),
    { maxLength: 3 },
  ),
});

const projectArb: fc.Arbitrary<Project> = fc
  .record({
    id: suffix,
    name: text,
    bpm: finiteDouble(20, 400),
    numerator: fc.integer({ min: 1, max: 32 }),
    denominator: fc.constantFrom(1, 2, 4, 8, 16, 32) as fc.Arbitrary<1 | 2 | 4 | 8 | 16 | 32>,
    loopStart: fc.integer({ min: 0, max: 1_000_000 }),
    loopLength: fc.integer({ min: 1, max: 1_000_000 }),
    loopEnabled: fc.boolean(),
    tracks: fc.array(trackSpecArb, { maxLength: 5 }),
    masterGain: finiteDouble(-60, 6),
    mappingCount: fc.integer({ min: 0, max: 3 }),
    sampleRate: fc.constantFrom(44_100, 48_000, 96_000),
  })
  .map((spec) => {
    let project = createEmptyProject({
      id: asProjectId(`prj_${spec.id}`),
      name: spec.name,
      now: NOW,
      bpm: spec.bpm,
    });
    const tracks: Track[] = [];
    const clips: Clip[] = [];
    const assets: Record<string, AssetRef> = {};
    spec.tracks.forEach((t, ti) => {
      const id = asTrackId(`trk_${ti}`);
      const base = createTrack({
        id,
        kind: t.kind,
        name: t.name,
        index: ti,
        ...(t.kind === 'instrument' ? { instrument: createInstrumentConfig(t.instrument) } : {}),
      });
      tracks.push({
        ...base,
        mixer: { gainDb: t.gainDb, pan: t.pan, mute: t.mute, solo: t.solo },
        effects: t.effects.map((kind, ei) => createEffectSlot(asEffectId(`fx_${ti}_${ei}`), kind)),
      });
      t.clips.forEach((c, ci) => {
        const clipId = asClipId(`clp_${ti}_${ci}`);
        if (t.kind === 'instrument') {
          const notes: MidiNote[] = c.notes.map((n, ni) => ({ ...n, id: asNoteId(`nte_${ni}`) }));
          clips.push({
            ...createMidiClip({
              id: clipId,
              trackId: id,
              startTick: c.startTick,
              lengthTicks: c.length,
            }),
            notes: sortNotes(notes),
            ...(c.loop !== undefined ? { loopLengthTicks: c.loop } : {}),
          });
        } else {
          const assetId = asAssetId(`ast_${ti}_${ci}`);
          assets[assetId] = {
            id: assetId,
            name: `${assetId}.wav`,
            kind: 'audio',
            mimeType: 'audio/wav',
            sampleRate: spec.sampleRate,
            channels: 2,
            frames: c.length + 10,
            contentHash: 'a'.repeat(64),
            byteLength: c.length * 4,
            source: 'recording',
            createdAt: NOW,
          };
          clips.push({
            ...createAudioClip({
              id: clipId,
              trackId: id,
              assetId,
              startTick: c.startTick,
              lengthFrames: c.length,
            }),
            gainDb: c.gainDb,
            fadeInFrames: Math.min(c.fade, Math.floor(c.length / 2)),
            fadeOutFrames: 0,
            ...(c.loop !== undefined ? { loopLengthFrames: c.loop } : {}),
          });
        }
      });
    });
    const mappings = Array.from({ length: spec.mappingCount }, (_, i) =>
      createMidiMapping({
        id: asMappingId(`map_${i}`),
        source: { kind: 'cc', channel: (i % 16) + 1, controller: i, mode: 'absolute' },
        target: { kind: 'action', action: 'transport.play' },
      }),
    );
    project = {
      ...project,
      meter: { numerator: spec.numerator, denominator: spec.denominator },
      loop: {
        enabled: spec.loopEnabled,
        startTick: spec.loopStart,
        endTick: spec.loopStart + spec.loopLength,
      },
      trackOrder: tracks.map((t) => t.id),
      tracks: Object.fromEntries(tracks.map((t) => [t.id, t])),
      clips: Object.fromEntries(clips.map((c) => [c.id, c])),
      assets: assets as Project['assets'],
      master: { gainDb: spec.masterGain, effects: [] },
      midiMappings: mappings,
    };
    return project;
  });

describe('property: serialize → parse round trip', () => {
  it('generated projects are valid and survive the round trip unchanged', () => {
    fc.assert(
      fc.property(projectArb, (project) => {
        const text = serializeProject(project);
        const result = parseProjectJson(text);
        if (!result.ok) throw result.error;
        expect(result.value.project).toEqual(project);
        expect(serializeProject(result.value.project)).toBe(text);
      }),
      { numRuns: 200 },
    );
  });
});
