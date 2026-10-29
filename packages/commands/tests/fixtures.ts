/**
 * Shared fixtures for command tests. Every project returned here is deep-frozen, so a
 * handler that mutates its input throws a TypeError (ESM modules run in strict mode).
 *
 * Timing: 120 BPM and 48 kHz assets, so 1 tick = 25 frames exactly.
 */
import {
  DEFAULT_VOCAL_CORRECTION,
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
  createMidiClip,
  createMidiMapping,
  createTrack,
  type AssetRef,
  type AudioClip,
  type MidiClip,
  type MidiNote,
  type Project,
  type VocalEditDoc,
  type VocalNoteSegment,
} from '@studio/domain';
import { expect } from 'vitest';
import { CommandError, applyCommand, type Command, type CommandErrorCode } from '../src';

export const ids = {
  project: asProjectId('prj_1'),
  inst: asTrackId('trk_inst'),
  audio: asTrackId('trk_audio'),
  vocal: asTrackId('trk_vocal'),
  midi: asClipId('clp_midi'),
  audioClip: asClipId('clp_audio'),
  take: asAssetId('ast_take'),
  sample: asAssetId('ast_sample'),
  trackFx: asEffectId('fx_eq'),
  trackFx2: asEffectId('fx_delay'),
  masterFx: asEffectId('fx_comp'),
  gainMapping: asMappingId('map_gain'),
  playMapping: asMappingId('map_play'),
  fxMapping: asMappingId('map_fx'),
  v1: asVocalNoteId('vn_1'),
  v2: asVocalNoteId('vn_2'),
  v3: asVocalNoteId('vn_3'),
} as const;

export function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value)) deepFreeze((value as Record<string, unknown>)[key]);
  }
  return value;
}

export const note = (
  id: string,
  startTick: number,
  durationTicks = 240,
  pitch = 60,
  velocity = 100,
): MidiNote => ({ id: asNoteId(id), startTick, durationTicks, pitch, velocity });

export function makeAsset(overrides: Partial<AssetRef> = {}): AssetRef {
  return {
    id: ids.take,
    name: 'Take 1',
    kind: 'audio',
    mimeType: 'audio/wav',
    sampleRate: 48_000,
    channels: 1,
    frames: 480_000,
    contentHash: 'aa',
    byteLength: 960_000,
    source: 'recording',
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

export const segment = (
  id: string,
  startSeconds: number,
  endSeconds: number,
): VocalNoteSegment => ({
  id: asVocalNoteId(id),
  startSeconds,
  endSeconds,
  detectedMidi: 60.2,
  confidence: 0.9,
  vibratoDepthCents: 20,
  vibratoRateHz: 5,
  driftCents: 10,
});

export function makeVocalDoc(overrides: Partial<VocalEditDoc> = {}): VocalEditDoc {
  return {
    assetId: ids.take,
    analysisKey: 'aa:v1',
    algorithmVersion: '1',
    segments: [segment('vn_1', 0, 0.5), segment('vn_2', 0.5, 1), segment('vn_3', 1.2, 2)],
    noteEdits: {
      [ids.v1]: {
        driftCorrection: 0.5,
        modulationScale: 1,
        transitionMs: 60,
        bypass: false,
        targetMidi: 60,
      },
    },
    correction: DEFAULT_VOCAL_CORRECTION,
    enabled: true,
    keyCandidates: [],
    ...overrides,
  };
}

export function makeMidiClip(overrides: Partial<MidiClip> = {}): MidiClip {
  return {
    ...createMidiClip({
      id: ids.midi,
      trackId: ids.inst,
      startTick: 960,
      lengthTicks: 3840,
      notes: [
        note('n1', 0, 240, 60),
        note('n2', 480, 240, 64),
        note('n3', 960, 480, 67),
        note('n4', 1920, 240, 72),
      ],
    }),
    ...overrides,
  };
}

export function makeAudioClip(overrides: Partial<AudioClip> = {}): AudioClip {
  return {
    ...createAudioClip({
      id: ids.audioClip,
      trackId: ids.audio,
      assetId: ids.take,
      startTick: 1920,
      lengthFrames: 96_000,
    }),
    sourceStartFrame: 48_000,
    ...overrides,
  };
}

/** A small but complete project: three tracks, both clip kinds, effects, assets, vocal edits, mappings. */
export function makeProject(): Project {
  const base = createEmptyProject({
    id: ids.project,
    now: '2026-01-01T00:00:00.000Z',
    name: 'Demo',
  });
  const inst = {
    ...createTrack({ id: ids.inst, kind: 'instrument', name: 'Keys', index: 0 }),
    effects: [createEffectSlot(ids.trackFx, 'eq3'), createEffectSlot(ids.trackFx2, 'delay')],
  };
  const audio = createTrack({ id: ids.audio, kind: 'audio', name: 'Guitar', index: 1 });
  const vocal = createTrack({ id: ids.vocal, kind: 'vocal', name: 'Lead Vox', index: 2 });
  const midi = makeMidiClip();
  const audioClip = makeAudioClip();
  const project: Project = {
    ...base,
    trackOrder: [ids.inst, ids.audio, ids.vocal],
    tracks: { [ids.inst]: inst, [ids.audio]: audio, [ids.vocal]: vocal },
    clips: { [midi.id]: midi, [audioClip.id]: audioClip },
    master: { gainDb: 0, effects: [createEffectSlot(ids.masterFx, 'compressor')] },
    assets: {
      [ids.take]: makeAsset(),
      [ids.sample]: makeAsset({
        id: ids.sample,
        name: 'Kick',
        sampleRate: 44_100,
        frames: 44_100,
        contentHash: 'bb',
      }),
    },
    vocalEdits: { [ids.take]: makeVocalDoc() },
    midiMappings: [
      createMidiMapping({
        id: ids.gainMapping,
        source: { kind: 'cc', channel: 1, controller: 7, mode: 'absolute' },
        target: {
          kind: 'parameter',
          address: { scope: 'track', trackId: ids.inst, param: 'gainDb' },
        },
      }),
      createMidiMapping({
        id: ids.playMapping,
        source: { kind: 'note', channel: 'any', note: 36, behavior: 'trigger' },
        target: { kind: 'action', action: 'transport.play' },
      }),
      createMidiMapping({
        id: ids.fxMapping,
        source: { kind: 'cc', channel: 1, controller: 70, mode: 'twosComplement' },
        target: {
          kind: 'parameter',
          address: {
            scope: 'effect',
            trackId: ids.inst,
            effectId: ids.trackFx,
            param: 'lowGainDb',
          },
        },
      }),
    ],
  };
  return deepFreeze(project);
}

/** Asserts that applying the command throws a CommandError with the given code and type tag. */
export function expectCommandError(
  project: Project,
  command: Command,
  code: CommandErrorCode,
  message?: string | RegExp,
): CommandError {
  let caught: unknown;
  try {
    applyCommand(project, command);
  } catch (error) {
    caught = error;
  }
  expect(caught, `expected ${command.type} to throw ${code}`).toBeInstanceOf(CommandError);
  const error = caught as CommandError;
  expect(error.code).toBe(code);
  expect(error.commandType).toBe(command.type);
  if (message !== undefined) expect(error.message).toMatch(message);
  return error;
}

/** Applies a command expecting success; asserts it really changed the project. */
export function apply(project: Project, command: Command): Project {
  const next = deepFreeze(applyCommand(project, command));
  expect(next, `${command.type} unexpectedly returned the same project`).not.toBe(project);
  return next;
}

/** Asserts the command is a no-op (returns the identical project). */
export function expectNoop(project: Project, command: Command): void {
  expect(applyCommand(project, command)).toBe(project);
}
