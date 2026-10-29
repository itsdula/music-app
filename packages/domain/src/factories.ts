import type { AssetId, ClipId, EffectId, MappingId, ProjectId, TrackId } from './ids';
import {
  CURRENT_SCHEMA_VERSION,
  TRACK_COLORS,
  type AudioClip,
  type EffectSlot,
  type InstrumentConfig,
  type MappingTarget,
  type MidiClip,
  type MidiControlSource,
  type MidiDeviceSelector,
  type MidiMapping,
  type MidiNote,
  type MidiValueTransform,
  type Project,
  type Track,
  type TrackKind,
  type VocalCorrectionSettings,
  type VocalNoteEdit,
} from './model';
import {
  EFFECT_PARAM_SPECS,
  INSTRUMENT_PARAM_SPECS,
  SYNTH_PRESETS,
  defaultParamValues,
  sanitizeParamValues,
  type EffectKind,
  type InstrumentKind,
} from './params';
import { PPQ, ticksPerBar } from './time';

export interface CreateProjectInput {
  readonly id: ProjectId;
  readonly name?: string;
  /** ISO timestamp supplied by the caller (keeps the domain clock-free). */
  readonly now: string;
  readonly bpm?: number;
}

export function createEmptyProject(input: CreateProjectInput): Project {
  const meter = { numerator: 4, denominator: 4 } as const;
  return {
    id: input.id,
    schemaVersion: CURRENT_SCHEMA_VERSION,
    name: input.name ?? 'Untitled Project',
    createdAt: input.now,
    updatedAt: input.now,
    bpm: input.bpm ?? 120,
    meter,
    loop: { enabled: false, startTick: 0, endTick: ticksPerBar(meter) * 4 },
    metronome: { enabled: false, gainDb: -6, countInBars: 0 },
    trackOrder: [],
    tracks: {},
    clips: {},
    master: { gainDb: 0, effects: [] },
    assets: {},
    vocalEdits: {},
    midiMappings: [],
  };
}

export function createInstrumentConfig(kind: InstrumentKind, presetId?: string): InstrumentConfig {
  const specs = INSTRUMENT_PARAM_SPECS[kind];
  const preset = presetId
    ? SYNTH_PRESETS.find((p) => p.id === presetId && p.kind === kind)
    : undefined;
  return {
    kind,
    params: preset ? sanitizeParamValues(specs, preset.params) : defaultParamValues(specs),
    ...(preset ? { presetId: preset.id } : {}),
  };
}

export interface CreateTrackInput {
  readonly id: TrackId;
  readonly kind: TrackKind;
  readonly name?: string;
  readonly color?: string;
  /** Used to pick a default colour when none is given. */
  readonly index?: number;
  readonly instrument?: InstrumentConfig;
}

const DEFAULT_TRACK_NAMES: Record<TrackKind, string> = {
  audio: 'Audio',
  instrument: 'Instrument',
  vocal: 'Vocal',
};

export function createTrack(input: CreateTrackInput): Track {
  const color = input.color ?? TRACK_COLORS[(input.index ?? 0) % TRACK_COLORS.length]!;
  const base: Track = {
    id: input.id,
    kind: input.kind,
    name: input.name ?? DEFAULT_TRACK_NAMES[input.kind],
    color,
    mixer: { gainDb: 0, pan: 0, mute: false, solo: false },
    armed: false,
    monitor: input.kind === 'instrument' ? 'auto' : 'off',
    effects: [],
  };
  if (input.kind === 'instrument') {
    return {
      ...base,
      instrument: input.instrument ?? createInstrumentConfig('synth', 'synth.keys'),
      midiInput: { channel: 'all', transpose: 0 },
    };
  }
  return { ...base, inputChannels: 1 };
}

export function createEffectSlot(id: EffectId, kind: EffectKind): EffectSlot {
  return { id, kind, bypass: false, params: defaultParamValues(EFFECT_PARAM_SPECS[kind]) };
}

export interface CreateMidiClipInput {
  readonly id: ClipId;
  readonly trackId: TrackId;
  readonly startTick: number;
  readonly lengthTicks?: number;
  readonly name?: string;
  readonly notes?: readonly MidiNote[];
}

export function createMidiClip(input: CreateMidiClipInput): MidiClip {
  return {
    id: input.id,
    kind: 'midi',
    trackId: input.trackId,
    name: input.name ?? 'MIDI Clip',
    startTick: input.startTick,
    lengthTicks: input.lengthTicks ?? PPQ * 4 * 4,
    contentOffsetTicks: 0,
    muted: false,
    notes: input.notes ? sortNotes(input.notes) : [],
  };
}

export interface CreateAudioClipInput {
  readonly id: ClipId;
  readonly trackId: TrackId;
  readonly assetId: AssetId;
  readonly startTick: number;
  readonly lengthFrames: number;
  readonly name?: string;
}

export function createAudioClip(input: CreateAudioClipInput): AudioClip {
  return {
    id: input.id,
    kind: 'audio',
    trackId: input.trackId,
    assetId: input.assetId,
    name: input.name ?? 'Audio Clip',
    startTick: input.startTick,
    muted: false,
    sourceStartFrame: 0,
    lengthFrames: input.lengthFrames,
    gainDb: 0,
    fadeInFrames: 0,
    fadeOutFrames: 0,
  };
}

/** Sort order for clip notes: start, then pitch, then id (total order, deterministic). */
export function compareNotes(a: MidiNote, b: MidiNote): number {
  return a.startTick - b.startTick || a.pitch - b.pitch || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

export function sortNotes(notes: readonly MidiNote[]): MidiNote[] {
  return [...notes].sort(compareNotes);
}

export const DEFAULT_VALUE_TRANSFORM: MidiValueTransform = {
  min: 0,
  max: 1,
  invert: false,
  curve: 'linear',
  takeover: 'immediate',
  relativeStep: 1 / 128,
};

export interface CreateMappingInput {
  readonly id: MappingId;
  readonly source: MidiControlSource;
  readonly target: MappingTarget;
  readonly device?: MidiDeviceSelector | null;
  readonly scope?: MidiMapping['scope'];
  readonly transform?: Partial<MidiValueTransform>;
  readonly label?: string;
}

export function createMidiMapping(input: CreateMappingInput): MidiMapping {
  return {
    id: input.id,
    source: input.source,
    device: input.device ?? null,
    target: input.target,
    transform: { ...DEFAULT_VALUE_TRANSFORM, ...input.transform },
    scope: input.scope ?? 'project',
    enabled: true,
    ...(input.label !== undefined ? { label: input.label } : {}),
  };
}

export const DEFAULT_VOCAL_CORRECTION: VocalCorrectionSettings = {
  key: null,
  amount: 0,
  retuneSpeedMs: 80,
  humanize: 0.5,
  formantPreservation: true,
  formantShiftSemitones: 0,
};

export const DEFAULT_VOCAL_NOTE_EDIT: VocalNoteEdit = {
  driftCorrection: 0,
  modulationScale: 1,
  transitionMs: 60,
  bypass: false,
};
