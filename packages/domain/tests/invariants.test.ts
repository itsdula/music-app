import { describe, expect, it } from 'vitest';
import {
  asAssetId,
  asClipId,
  asEffectId,
  asMappingId,
  asNoteId,
  asProjectId,
  asTrackId,
  asVocalNoteId,
  checkProjectInvariants,
  createAudioClip,
  createEffectSlot,
  createEmptyProject,
  createMidiClip,
  createMidiMapping,
  createTrack,
  DEFAULT_VOCAL_CORRECTION,
  type AssetRef,
  type AudioClip,
  type MidiClip,
  type Project,
  type TimeSignatureDenominator,
  type Track,
  type VocalEditDoc,
} from '../src';

const T_INST = asTrackId('inst');
const T_AUDIO = asTrackId('audio');
const MIDI = asClipId('midi');
const AUDIO = asClipId('aud');
const ASSET = asAssetId('asset');

const asset: AssetRef = {
  id: ASSET,
  name: 'Loop',
  kind: 'audio',
  mimeType: 'audio/wav',
  sampleRate: 48_000,
  channels: 2,
  frames: 48_000,
  contentHash: 'hash',
  byteLength: 384_000,
  source: 'import',
  createdAt: '2026-01-01T00:00:00.000Z',
};

const vocalDoc: VocalEditDoc = {
  assetId: ASSET,
  analysisKey: 'k',
  algorithmVersion: '1',
  segments: [
    {
      id: asVocalNoteId('v1'),
      startSeconds: 0,
      endSeconds: 0.5,
      detectedMidi: 60,
      confidence: 0.9,
      vibratoDepthCents: 0,
      vibratoRateHz: 0,
      driftCents: 0,
    },
    {
      id: asVocalNoteId('v2'),
      startSeconds: 0.5,
      endSeconds: 1,
      detectedMidi: 62,
      confidence: 0.9,
      vibratoDepthCents: 0,
      vibratoRateHz: 0,
      driftCents: 0,
    },
  ],
  noteEdits: {},
  correction: DEFAULT_VOCAL_CORRECTION,
  enabled: true,
  keyCandidates: [],
};

function validProject(): Project {
  const base = createEmptyProject({ id: asProjectId('p'), now: '2026-01-01T00:00:00.000Z' });
  const inst = {
    ...createTrack({ id: T_INST, kind: 'instrument' }),
    effects: [createEffectSlot(asEffectId('fx1'), 'reverb')],
  };
  const audio = createTrack({ id: T_AUDIO, kind: 'audio' });
  const midi = createMidiClip({
    id: MIDI,
    trackId: T_INST,
    startTick: 0,
    notes: [
      { id: asNoteId('n2'), startTick: 10, durationTicks: 10, pitch: 64, velocity: 90 },
      { id: asNoteId('n1'), startTick: 0, durationTicks: 10, pitch: 60, velocity: 90 },
    ],
  });
  const aud = createAudioClip({
    id: AUDIO,
    trackId: T_AUDIO,
    assetId: ASSET,
    startTick: 0,
    lengthFrames: 48_000,
  });
  return {
    ...base,
    trackOrder: [T_INST, T_AUDIO],
    tracks: { [T_INST]: inst, [T_AUDIO]: audio },
    clips: { [MIDI]: midi, [AUDIO]: aud },
    assets: { [ASSET]: asset },
    vocalEdits: { [ASSET]: vocalDoc },
    master: { gainDb: 0, effects: [createEffectSlot(asEffectId('m1'), 'compressor')] },
    midiMappings: [
      createMidiMapping({
        id: asMappingId('m1'),
        source: { kind: 'cc', channel: 1, controller: 1, mode: 'absolute' },
        target: { kind: 'action', action: 'transport.play' },
      }),
    ],
  };
}

const withTrack = (p: Project, track: Track): Project => ({
  ...p,
  tracks: { ...p.tracks, [track.id]: track },
});
const withMidi = (p: Project, patch: Partial<MidiClip>): Project => ({
  ...p,
  clips: { ...p.clips, [MIDI]: { ...(p.clips[MIDI] as MidiClip), ...patch } },
});
const withAudio = (p: Project, patch: Partial<AudioClip>): Project => ({
  ...p,
  clips: { ...p.clips, [AUDIO]: { ...(p.clips[AUDIO] as AudioClip), ...patch } },
});

function violations(project: Project): string[] {
  return checkProjectInvariants(project).map((v) => `${v.path}: ${v.message}`);
}

function expectViolation(project: Project, fragment: string): void {
  const found = violations(project);
  expect(
    found.some((v) => v.includes(fragment)),
    `expected "${fragment}" in ${JSON.stringify(found)}`,
  ).toBe(true);
}

describe('checkProjectInvariants', () => {
  it('accepts a valid project and an empty project', () => {
    expect(violations(validProject())).toEqual([]);
    expect(violations(createEmptyProject({ id: asProjectId('e'), now: 'now' }))).toEqual([]);
  });

  it('checks transport settings', () => {
    const p = validProject();
    expectViolation({ ...p, bpm: 10 }, 'bpm out of range');
    expectViolation({ ...p, bpm: Number.NaN }, 'bpm out of range');
    expectViolation({ ...p, meter: { numerator: 0, denominator: 4 } }, 'invalid time signature');
    expectViolation(
      { ...p, meter: { numerator: 4, denominator: 5 as TimeSignatureDenominator } },
      'invalid time signature',
    );
    expectViolation({ ...p, loop: { ...p.loop, startTick: 0.5 } }, 'non-negative integer');
    expectViolation({ ...p, loop: { ...p.loop, startTick: -10 } }, 'non-negative integer');
    expectViolation(
      { ...p, loop: { enabled: true, startTick: 100, endTick: 100 } },
      'loop end must be after',
    );
  });

  it('checks track order and tracks', () => {
    const p = validProject();
    const inst = p.tracks[T_INST]!;
    expectViolation(
      { ...p, trackOrder: [T_INST, T_INST, T_AUDIO] },
      'duplicate track in trackOrder',
    );
    expectViolation({ ...p, trackOrder: [T_INST] }, 'every track exactly once');
    expectViolation({ ...p, trackOrder: [T_INST, asTrackId('x')] }, 'every track exactly once');
    expectViolation(
      { ...p, tracks: { ...p.tracks, [T_INST]: { ...inst, id: asTrackId('other') } } },
      'track id does not match',
    );
    const { instrument: _removed, ...noInstrument } = inst;
    expectViolation(withTrack(p, noInstrument), 'instrument track without instrument');
    expectViolation(
      withTrack(p, { ...inst, mixer: { ...inst.mixer, pan: 1.5 } }),
      'pan out of range',
    );
    expectViolation(
      withTrack(p, { ...inst, mixer: { ...inst.mixer, pan: -1.5 } }),
      'pan out of range',
    );
    expectViolation(
      withTrack(p, { ...inst, effects: [...inst.effects, ...inst.effects] }),
      'tracks.inst.effects: duplicate effect id',
    );
  });

  it('checks master effect ids', () => {
    const p = validProject();
    expectViolation(
      { ...p, master: { ...p.master, effects: [...p.master.effects, ...p.master.effects] } },
      'master.effects: duplicate effect id',
    );
  });

  it('checks clip/track relations', () => {
    const p = validProject();
    expectViolation(
      { ...p, clips: { ...p.clips, [MIDI]: { ...p.clips[MIDI]!, id: asClipId('zz') } } },
      'clip id does not match',
    );
    expectViolation(withMidi(p, { trackId: asTrackId('missing') }), 'missing track');
    expectViolation(withMidi(p, { startTick: -1 }), 'startTick must be a non-negative integer');
    expectViolation(withMidi(p, { startTick: 1.5 }), 'startTick must be a non-negative integer');
    expectViolation(withMidi(p, { trackId: T_AUDIO }), 'MIDI clip on a non-instrument track');
    expectViolation(withAudio(p, { trackId: T_INST }), 'audio clip on an instrument track');
  });

  it('checks MIDI clip fields and notes', () => {
    const p = validProject();
    const notes = (p.clips[MIDI] as MidiClip).notes;
    expectViolation(withMidi(p, { lengthTicks: 0 }), 'lengthTicks must be a positive integer');
    expectViolation(withMidi(p, { lengthTicks: 1.5 }), 'lengthTicks must be a positive integer');
    expectViolation(withMidi(p, { contentOffsetTicks: -1 }), 'contentOffsetTicks');
    expectViolation(withMidi(p, { loopLengthTicks: 0 }), 'loopLengthTicks');
    expectViolation(
      withMidi(p, { notes: [notes[0]!, { ...notes[1]!, id: notes[0]!.id }] }),
      'duplicate note id',
    );
    expectViolation(withMidi(p, { notes: [{ ...notes[0]!, startTick: -1 }] }), 'note start');
    expectViolation(withMidi(p, { notes: [{ ...notes[0]!, durationTicks: 0 }] }), 'note duration');
    expectViolation(withMidi(p, { notes: [{ ...notes[0]!, pitch: 128 }] }), 'pitch out of range');
    expectViolation(withMidi(p, { notes: [{ ...notes[0]!, pitch: 60.5 }] }), 'pitch out of range');
    expectViolation(
      withMidi(p, { notes: [{ ...notes[0]!, velocity: 0 }] }),
      'velocity out of range',
    );
    expectViolation(withMidi(p, { notes: [notes[1]!, notes[0]!] }), 'notes are not sorted');
    const samePitchOrder = [
      { ...notes[0]!, pitch: 70 },
      { ...notes[1]!, startTick: notes[0]!.startTick, pitch: 60 },
    ];
    expectViolation(withMidi(p, { notes: samePitchOrder }), 'notes are not sorted');
  });

  it('checks audio clip fields', () => {
    const p = validProject();
    expectViolation({ ...p, assets: {}, vocalEdits: {} }, 'missing asset');
    expectViolation(withAudio(p, { sourceStartFrame: -1 }), 'sourceStartFrame');
    expectViolation(withAudio(p, { lengthFrames: 0 }), 'lengthFrames must be positive');
    expectViolation(withAudio(p, { fadeInFrames: -1 }), 'fades');
    expectViolation(withAudio(p, { fadeInFrames: 30_000, fadeOutFrames: 30_000 }), 'fades');
    expectViolation(withAudio(p, { sourceStartFrame: 10 }), 'past the end of its asset');
    expect(violations(withAudio(p, { sourceStartFrame: 10, loopLengthFrames: 100 }))).toEqual([]);
  });

  it('checks vocal edit docs and mappings', () => {
    const p = validProject();
    expectViolation(
      { ...p, vocalEdits: { [asAssetId('nope')]: { ...vocalDoc, assetId: asAssetId('nope') } } },
      'vocal edits for missing asset',
    );
    expectViolation(
      {
        ...p,
        vocalEdits: { [ASSET]: { ...vocalDoc, segments: [...vocalDoc.segments].reverse() } },
      },
      'segments are not sorted',
    );
    expectViolation(
      { ...p, midiMappings: [...p.midiMappings, ...p.midiMappings] },
      'duplicate mapping id',
    );
  });

  it('reports every violation, not just the first', () => {
    const p = validProject();
    expect(violations({ ...p, bpm: 1, meter: { numerator: 0, denominator: 4 } })).toHaveLength(2);
  });
});
