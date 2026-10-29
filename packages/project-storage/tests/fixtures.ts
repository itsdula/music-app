/**
 * Test fixtures built with the domain factories, covering every clip kind, effect
 * kind, instrument kind, vocal edit documents and every mapping source/target kind.
 */
import { createHash } from 'node:crypto';
import {
  DEFAULT_VOCAL_CORRECTION,
  DEFAULT_VOCAL_NOTE_EDIT,
  EFFECT_KINDS,
  asAssetId,
  asClipId,
  asEffectId,
  asMappingId,
  asNoteId,
  asProjectId,
  asTrackId,
  asVocalNoteId,
  createAudioClip,
  createEffectSlot,
  createEmptyProject,
  createInstrumentConfig,
  createMidiClip,
  createMidiMapping,
  createTrack,
  type AssetRef,
  type Project,
  type ProjectId,
  type Track,
  type VocalEditDoc,
} from '@studio/domain';
import type { AssetRecord } from '../src/repositories';

export const NOW = '2026-01-02T03:04:05.000Z';

export const sha256Hex = (bytes: Uint8Array): string =>
  createHash('sha256').update(bytes).digest('hex');

export const sha256 = (bytes: Uint8Array): Promise<string> => Promise.resolve(sha256Hex(bytes));

/** Deterministic pseudo-random bytes (a fake "encoded audio file"). */
export function fakeAudioBytes(length: number, seed = 1): Uint8Array {
  const bytes = new Uint8Array(length);
  let x = seed >>> 0 || 1;
  for (let i = 0; i < length; i++) {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    bytes[i] = x & 0xff;
  }
  return bytes;
}

export function makeAsset(
  id: string,
  bytes: Uint8Array,
  overrides: Partial<AssetRef> = {},
): AssetRecord {
  const meta: AssetRef = {
    id: asAssetId(id),
    name: `${id}.wav`,
    kind: 'audio',
    mimeType: 'audio/wav',
    sampleRate: 48_000,
    channels: 2,
    frames: 480_000,
    contentHash: sha256Hex(bytes),
    byteLength: bytes.byteLength,
    source: 'import',
    createdAt: NOW,
    ...overrides,
  };
  return { meta, bytes };
}

export function emptyProject(id = 'prj_1'): Project {
  return createEmptyProject({ id: asProjectId(id), name: 'Empty', now: NOW });
}

export interface RichFixture {
  readonly project: Project;
  readonly assets: AssetRecord[];
}

/** A project exercising every part of the model. */
export function buildRichProject(id: ProjectId | string = 'prj_rich'): RichFixture {
  const base = createEmptyProject({
    id: asProjectId(id),
    name: 'Rich ✓ project',
    now: NOW,
    bpm: 98.5,
  });

  const drumsAsset = makeAsset('ast_kick', fakeAudioBytes(2048, 7), {
    mimeType: 'audio/wav',
    frames: 1000,
  });
  const vocalAsset = makeAsset('ast_vocal', fakeAudioBytes(4096, 11), {
    mimeType: 'audio/mpeg',
    name: 'take 1.mp3',
    source: 'recording',
  });
  const loopAsset = makeAsset('ast_loop', fakeAudioBytes(1024, 13), {
    mimeType: 'audio/ogg',
    frames: 96_000,
    channels: 1,
    sampleRate: 44_100,
  });

  const synth: Track = {
    ...createTrack({ id: asTrackId('trk_synth'), kind: 'instrument', index: 0 }),
    effects: EFFECT_KINDS.map((kind, i) => createEffectSlot(asEffectId(`fx_${i}`), kind)),
  };
  const drums = createTrack({
    id: asTrackId('trk_drums'),
    kind: 'instrument',
    name: 'Drums',
    index: 1,
    instrument: createInstrumentConfig('drums'),
  });
  const sampler = createTrack({
    id: asTrackId('trk_sampler'),
    kind: 'instrument',
    index: 2,
    instrument: { ...createInstrumentConfig('sampler'), sampleAssetId: drumsAsset.meta.id },
  });
  const audio = createTrack({ id: asTrackId('trk_audio'), kind: 'audio', index: 3 });
  const vocal: Track = {
    ...createTrack({ id: asTrackId('trk_vocal'), kind: 'vocal', index: 4, color: '#123456' }),
    mixer: { gainDb: -3.5, pan: -0.25, mute: false, solo: true },
    inputChannels: 2,
    monitor: 'on',
    armed: true,
  };

  const midiClip = {
    ...createMidiClip({
      id: asClipId('clp_midi'),
      trackId: synth.id,
      startTick: 0,
      notes: [
        { id: asNoteId('nte_2'), startTick: 480, durationTicks: 240, pitch: 64, velocity: 90 },
        { id: asNoteId('nte_1'), startTick: 0, durationTicks: 480, pitch: 60, velocity: 100 },
        { id: asNoteId('nte_3'), startTick: 480, durationTicks: 240, pitch: 67, velocity: 1 },
      ],
    }),
    loopLengthTicks: 1920,
    contentOffsetTicks: 120,
    color: '#ABCDEF',
  };
  const drumClip = createMidiClip({
    id: asClipId('clp_drums'),
    trackId: drums.id,
    startTick: 3840,
  });
  const audioClip = {
    ...createAudioClip({
      id: asClipId('clp_audio'),
      trackId: audio.id,
      assetId: loopAsset.meta.id,
      startTick: 960,
      lengthFrames: 48_000,
    }),
    loopLengthFrames: 24_000,
    fadeInFrames: 100,
    fadeOutFrames: 200,
    gainDb: -1.5,
    muted: true,
  };
  const vocalClip = createAudioClip({
    id: asClipId('clp_vocal'),
    trackId: vocal.id,
    assetId: vocalAsset.meta.id,
    startTick: 0,
    lengthFrames: 480_000,
  });

  const vocalDoc: VocalEditDoc = {
    assetId: vocalAsset.meta.id,
    analysisKey: `pitch:${vocalAsset.meta.contentHash}:1:-`,
    algorithmVersion: 'yin-1',
    segments: [
      {
        id: asVocalNoteId('vn_1'),
        startSeconds: 0.1,
        endSeconds: 0.6,
        detectedMidi: 60.23,
        confidence: 0.92,
        vibratoDepthCents: 18,
        vibratoRateHz: 5.5,
        driftCents: -4,
      },
      {
        id: asVocalNoteId('vn_2'),
        startSeconds: 0.7,
        endSeconds: 1.2,
        detectedMidi: 62.9,
        confidence: 0.4,
        vibratoDepthCents: 0,
        vibratoRateHz: 0,
        driftCents: 12.5,
      },
    ],
    noteEdits: {
      [asVocalNoteId('vn_1')]: { ...DEFAULT_VOCAL_NOTE_EDIT, targetMidi: 60 },
      [asVocalNoteId('vn_2')]: { ...DEFAULT_VOCAL_NOTE_EDIT, bypass: true, modulationScale: 0 },
    },
    correction: {
      ...DEFAULT_VOCAL_CORRECTION,
      key: { tonic: 9, scale: 'naturalMinor' },
      amount: 0.8,
    },
    enabled: true,
    keyCandidates: [
      { key: { tonic: 9, scale: 'naturalMinor' }, confidence: 0.7 },
      { key: { tonic: 0, scale: 'major' }, confidence: 0.3 },
    ],
  };

  const mappings = [
    createMidiMapping({
      id: asMappingId('map_cc'),
      source: { kind: 'cc', channel: 1, controller: 70, mode: 'absolute' },
      target: {
        kind: 'parameter',
        address: { scope: 'track', trackId: synth.id, param: 'gainDb' },
      },
      device: { profileId: 'akai.mpk-mini-mk3' },
      label: 'K1',
    }),
    createMidiMapping({
      id: asMappingId('map_rel'),
      source: { kind: 'cc', channel: 'any', controller: 71, mode: 'twosComplement' },
      target: {
        kind: 'parameter',
        address: { scope: 'instrument', trackId: synth.id, param: 'cutoffHz' },
      },
      transform: { takeover: 'pickup', curve: 'exponential', invert: true },
    }),
    createMidiMapping({
      id: asMappingId('map_fx'),
      source: { kind: 'cc', channel: 2, controller: 72, mode: 'signedBit' },
      target: {
        kind: 'parameter',
        address: {
          scope: 'effect',
          trackId: 'master',
          effectId: asEffectId('fx_master'),
          param: 'mix',
        },
      },
      scope: 'global',
    }),
    createMidiMapping({
      id: asMappingId('map_note'),
      source: { kind: 'note', channel: 10, note: 36, behavior: 'toggle' },
      target: { kind: 'action', action: 'transport.togglePlay' },
      device: { portName: 'MPK mini 3' },
    }),
    createMidiMapping({
      id: asMappingId('map_pb'),
      source: { kind: 'pitchBend', channel: 'any' },
      target: { kind: 'parameter', address: { scope: 'master', param: 'gainDb' } },
    }),
    createMidiMapping({
      id: asMappingId('map_pc'),
      source: { kind: 'programChange', channel: 1, program: 5 },
      target: { kind: 'parameter', address: { scope: 'transport', param: 'bpm' } },
    }),
    createMidiMapping({
      id: asMappingId('map_pc_any'),
      source: { kind: 'programChange', channel: 3 },
      target: { kind: 'parameter', address: { scope: 'selectedTrack', param: 'arm' } },
    }),
    {
      ...createMidiMapping({
        id: asMappingId('map_sel'),
        source: { kind: 'cc', channel: 1, controller: 1, mode: 'binaryOffset' },
        target: { kind: 'parameter', address: { scope: 'selectedInstrument', param: 'attack' } },
      }),
      enabled: false,
    },
  ];

  const tracks = [synth, drums, sampler, audio, vocal];
  const project: Project = {
    ...base,
    loop: { enabled: true, startTick: 960, endTick: 7680 },
    metronome: { enabled: true, gainDb: -12, countInBars: 1 },
    meter: { numerator: 7, denominator: 8 },
    trackOrder: tracks.map((t) => t.id),
    tracks: Object.fromEntries(tracks.map((t) => [t.id, t])),
    clips: Object.fromEntries([midiClip, drumClip, audioClip, vocalClip].map((c) => [c.id, c])),
    master: { gainDb: -0.5, effects: [createEffectSlot(asEffectId('fx_master'), 'reverb')] },
    assets: Object.fromEntries(
      [drumsAsset, vocalAsset, loopAsset].map((a) => [a.meta.id, a.meta]),
    ) as Project['assets'],
    vocalEdits: { [vocalAsset.meta.id]: vocalDoc } as Project['vocalEdits'],
    midiMappings: mappings,
  };
  return { project, assets: [drumsAsset, vocalAsset, loopAsset] };
}

/** Deep-clones JSON data and lets a test mutate it freely. */
export function mutableCopy(value: unknown): Record<string, unknown> {
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
}
