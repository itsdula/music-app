/**
 * The persistent project model.
 *
 * Rules:
 * - Plain, JSON-serializable data only (no class instances, typed arrays, AudioBuffers).
 * - Entities are normalized into ID-keyed maps; ordering lives in explicit arrays.
 * - Values are treated as immutable; commands return new objects (structural sharing).
 * - Ephemeral UI state (selection, zoom, scroll) is NOT stored here.
 */
import type {
  AssetId,
  ClipId,
  EffectId,
  MappingId,
  NoteId,
  ProjectId,
  TrackId,
  VocalNoteId,
} from './ids';
import type { EffectKind, InstrumentKind, ParamValues } from './params';
import type { MusicalKey } from './theory';
import type { Frames, Ticks, TimeSignature } from './time';

export const CURRENT_SCHEMA_VERSION = 1;

// ---------------------------------------------------------------------------
// Project
// ---------------------------------------------------------------------------

export interface LoopRegion {
  readonly enabled: boolean;
  readonly startTick: Ticks;
  /** Exclusive; invariant: endTick > startTick. */
  readonly endTick: Ticks;
}

export interface MetronomeSettings {
  readonly enabled: boolean;
  readonly gainDb: number;
  /** Count-in bars before recording starts (0 = off). */
  readonly countInBars: number;
}

export interface Project {
  readonly id: ProjectId;
  readonly schemaVersion: number;
  readonly name: string;
  /** ISO-8601 timestamps. */
  readonly createdAt: string;
  readonly updatedAt: string;
  /** Global tempo in quarter notes per minute. */
  readonly bpm: number;
  readonly meter: TimeSignature;
  readonly loop: LoopRegion;
  readonly metronome: MetronomeSettings;
  readonly trackOrder: readonly TrackId[];
  readonly tracks: Readonly<Record<TrackId, Track>>;
  readonly clips: Readonly<Record<ClipId, Clip>>;
  readonly master: MasterBus;
  /** Metadata for binary assets stored separately in the asset repository. */
  readonly assets: Readonly<Record<AssetId, AssetRef>>;
  /** Non-destructive vocal edits keyed by the source asset they apply to. */
  readonly vocalEdits: Readonly<Record<AssetId, VocalEditDoc>>;
  /** Project-scoped MIDI mappings (global mappings live in host settings). */
  readonly midiMappings: readonly MidiMapping[];
}

// ---------------------------------------------------------------------------
// Tracks and mixer
// ---------------------------------------------------------------------------

export type TrackKind = 'audio' | 'instrument' | 'vocal';

export const TRACK_COLORS = [
  '#8B7CF6',
  '#5EA8FF',
  '#3CC8B4',
  '#7BD66B',
  '#F2C14E',
  '#F59152',
  '#F16D75',
  '#E57BD3',
] as const;
export type TrackColor = string;

export type MonitorMode = 'off' | 'auto' | 'on';

export interface TrackMixer {
  readonly gainDb: number;
  /** -1 (left) .. 1 (right). */
  readonly pan: number;
  readonly mute: boolean;
  readonly solo: boolean;
}

export interface EffectSlot {
  readonly id: EffectId;
  readonly kind: EffectKind;
  readonly bypass: boolean;
  readonly params: ParamValues;
}

export interface InstrumentConfig {
  readonly kind: InstrumentKind;
  readonly params: ParamValues;
  /** Preset this config started from, for display only. */
  readonly presetId?: string;
  /** Sampler only: the sample to play. */
  readonly sampleAssetId?: AssetId;
}

export interface MidiInputRouting {
  /** 1-16, or 'all' to accept every channel. */
  readonly channel: number | 'all';
  /** Semitones added to incoming notes. */
  readonly transpose: number;
}

export interface Track {
  readonly id: TrackId;
  readonly kind: TrackKind;
  readonly name: string;
  readonly color: TrackColor;
  readonly mixer: TrackMixer;
  readonly armed: boolean;
  readonly monitor: MonitorMode;
  /** Instrument tracks only. */
  readonly instrument?: InstrumentConfig;
  readonly midiInput?: MidiInputRouting;
  readonly effects: readonly EffectSlot[];
  /** Audio/vocal tracks: preferred input channel count when recording. */
  readonly inputChannels?: 1 | 2;
}

export interface MasterBus {
  readonly gainDb: number;
  readonly effects: readonly EffectSlot[];
}

// ---------------------------------------------------------------------------
// Clips
// ---------------------------------------------------------------------------

export interface MidiNote {
  readonly id: NoteId;
  /** Relative to the clip content start (tick 0 = first tick of clip content). */
  readonly startTick: Ticks;
  /** > 0 */
  readonly durationTicks: Ticks;
  /** 0..127 */
  readonly pitch: number;
  /** 1..127 */
  readonly velocity: number;
}

interface ClipBase {
  readonly id: ClipId;
  readonly trackId: TrackId;
  readonly name: string;
  /** Overrides the track colour when set. */
  readonly color?: TrackColor;
  /** Timeline position of the clip's left edge. */
  readonly startTick: Ticks;
  readonly muted: boolean;
}

export interface MidiClip extends ClipBase {
  readonly kind: 'midi';
  /** Visible length on the timeline; > 0. */
  readonly lengthTicks: Ticks;
  /** Content tick shown at the clip's left edge (non-destructive left trim); >= 0. */
  readonly contentOffsetTicks: Ticks;
  /** When set, content in [0, loopLengthTicks) repeats to fill the clip. */
  readonly loopLengthTicks?: Ticks;
  /** Kept sorted by (startTick, pitch, id); see `sortNotes`. */
  readonly notes: readonly MidiNote[];
}

export interface AudioClip extends ClipBase {
  readonly kind: 'audio';
  readonly assetId: AssetId;
  /** First source frame played (non-destructive left trim), at the asset sample rate. */
  readonly sourceStartFrame: Frames;
  /** Visible length in source frames; timeline length in ticks is derived from tempo. */
  readonly lengthFrames: Frames;
  /** When set, source frames [sourceStartFrame, sourceStartFrame + loopLengthFrames) repeat. */
  readonly loopLengthFrames?: Frames;
  readonly gainDb: number;
  readonly fadeInFrames: Frames;
  readonly fadeOutFrames: Frames;
}

export type Clip = MidiClip | AudioClip;
export type ClipKind = Clip['kind'];

// ---------------------------------------------------------------------------
// Assets (metadata only — bytes live in the AssetRepository)
// ---------------------------------------------------------------------------

export type AssetSource = 'import' | 'recording' | 'render' | 'bundled';

export interface AssetRef {
  readonly id: AssetId;
  readonly name: string;
  readonly kind: 'audio';
  /** MIME type of the stored bytes, e.g. audio/wav. */
  readonly mimeType: string;
  readonly sampleRate: number;
  readonly channels: number;
  readonly frames: Frames;
  /** Hex SHA-256 of the stored bytes; cache key for derived data. */
  readonly contentHash: string;
  readonly byteLength: number;
  readonly source: AssetSource;
  readonly createdAt: string;
}

// ---------------------------------------------------------------------------
// Vocal editing (non-destructive; applies to an asset in source time)
// ---------------------------------------------------------------------------

export interface VocalNoteSegment {
  readonly id: VocalNoteId;
  /** Source-time seconds within the asset. */
  readonly startSeconds: number;
  readonly endSeconds: number;
  /** Detected pitch centre as fractional MIDI (e.g. 60.23). */
  readonly detectedMidi: number;
  /** 0..1 confidence from analysis; low values render muted/dashed. */
  readonly confidence: number;
  /** Detected vibrato depth in cents (peak deviation) and rate in Hz (0 when none). */
  readonly vibratoDepthCents: number;
  readonly vibratoRateHz: number;
  /** Detected linear drift across the note in cents (end minus start). */
  readonly driftCents: number;
}

export interface VocalNoteEdit {
  /** Absolute target pitch as fractional MIDI; undefined = follow automatic correction. */
  readonly targetMidi?: number;
  /** 0..1, how much of the detected drift to remove. */
  readonly driftCorrection: number;
  /** 0..2 vibrato/modulation scale (1 = unchanged, 0 = flattened). */
  readonly modulationScale: number;
  /** Transition (glide) time into this note in milliseconds. */
  readonly transitionMs: number;
  /** When true the note is left unprocessed. */
  readonly bypass: boolean;
}

export interface VocalCorrectionSettings {
  /** Key/scale used for snapping and guides; null = chromatic. */
  readonly key: MusicalKey | null;
  /** 0..1 automatic correction amount ("Auto Tune amount"). */
  readonly amount: number;
  /** Retune speed in ms: time to reach the target pitch at note starts. */
  readonly retuneSpeedMs: number;
  /** 0..1 amount of natural variation preserved within notes. */
  readonly humanize: number;
  readonly formantPreservation: boolean;
  /** Formant shift in semitones (only when the processor supports it). */
  readonly formantShiftSemitones: number;
}

export interface VocalEditDoc {
  readonly assetId: AssetId;
  /** Identifies the analysis these segments came from (content hash + algorithm version + params). */
  readonly analysisKey: string;
  readonly algorithmVersion: string;
  /** Detected segments, including user split/merge results. Sorted by startSeconds. */
  readonly segments: readonly VocalNoteSegment[];
  readonly noteEdits: Readonly<Record<VocalNoteId, VocalNoteEdit>>;
  readonly correction: VocalCorrectionSettings;
  /** A/B: false plays the original audio. */
  readonly enabled: boolean;
  /** Ranked key suggestions from analysis (display only). */
  readonly keyCandidates: readonly KeyCandidate[];
}

export interface KeyCandidate {
  readonly key: MusicalKey;
  /** 0..1, softmax-normalized across candidates. */
  readonly confidence: number;
}

// ---------------------------------------------------------------------------
// Parameter addressing (MIDI mapping, automation, UI bindings)
// ---------------------------------------------------------------------------

export type TrackParam = 'gainDb' | 'pan' | 'mute' | 'solo' | 'arm';

export type ParameterAddress =
  | { readonly scope: 'track'; readonly trackId: TrackId; readonly param: TrackParam }
  | { readonly scope: 'instrument'; readonly trackId: TrackId; readonly param: string }
  | {
      readonly scope: 'effect';
      readonly trackId: TrackId | 'master';
      readonly effectId: EffectId;
      readonly param: string;
    }
  | { readonly scope: 'master'; readonly param: 'gainDb' }
  | { readonly scope: 'transport'; readonly param: 'bpm' }
  /** Follows the currently selected track (useful for controller knobs). */
  | { readonly scope: 'selectedTrack'; readonly param: TrackParam }
  | { readonly scope: 'selectedInstrument'; readonly param: string };

export type StudioActionId =
  | 'transport.play'
  | 'transport.stop'
  | 'transport.togglePlay'
  | 'transport.record'
  | 'transport.toggleLoop'
  | 'transport.toggleMetronome'
  | 'transport.rewind'
  | 'transport.tapTempo'
  | 'edit.undo'
  | 'edit.redo'
  | 'track.selectNext'
  | 'track.selectPrevious'
  | 'track.toggleArmSelected'
  | 'track.toggleMuteSelected'
  | 'track.toggleSoloSelected';

// ---------------------------------------------------------------------------
// MIDI mappings (persistent part; the engine lives in @studio/midi-core)
// ---------------------------------------------------------------------------

export type MidiChannelFilter = number | 'any'; // 1..16

export type RelativeEncoding = 'twosComplement' | 'signedBit' | 'binaryOffset';

export type MidiControlSource =
  | {
      readonly kind: 'cc';
      readonly channel: MidiChannelFilter;
      readonly controller: number;
      /** Absolute values (0..127) or a relative encoder encoding. */
      readonly mode: 'absolute' | RelativeEncoding;
    }
  | {
      readonly kind: 'note';
      readonly channel: MidiChannelFilter;
      readonly note: number;
      /** trigger: fire on note-on; gate: on while held; toggle: flip on each note-on. */
      readonly behavior: 'trigger' | 'gate' | 'toggle';
    }
  | { readonly kind: 'pitchBend'; readonly channel: MidiChannelFilter }
  | {
      readonly kind: 'programChange';
      readonly channel: MidiChannelFilter;
      readonly program?: number;
    };

export interface MidiDeviceSelector {
  /** Device profile id (e.g. 'akai.mpk-mini-mk3'); matches any port of that profile. */
  readonly profileId?: string;
  /** Exact port name match, used when no profile applies. */
  readonly portName?: string;
}

export type MappingTarget =
  | { readonly kind: 'parameter'; readonly address: ParameterAddress }
  | { readonly kind: 'action'; readonly action: StudioActionId };

export type MappingCurve = 'linear' | 'exponential' | 'logarithmic' | 'sCurve';

export type TakeoverMode = 'immediate' | 'pickup';

export interface MidiValueTransform {
  /** Output range in normalized parameter space, 0..1 (min may exceed max via `invert`). */
  readonly min: number;
  readonly max: number;
  readonly invert: boolean;
  readonly curve: MappingCurve;
  /** Absolute controls only: pickup ignores input until it crosses the current value. */
  readonly takeover: TakeoverMode;
  /** Relative controls only: normalized change per encoder step. */
  readonly relativeStep: number;
}

export type MappingScope = 'global' | 'project';

export interface MidiMapping {
  readonly id: MappingId;
  readonly source: MidiControlSource;
  /** null = any device. */
  readonly device: MidiDeviceSelector | null;
  readonly target: MappingTarget;
  readonly transform: MidiValueTransform;
  readonly scope: MappingScope;
  readonly enabled: boolean;
  /** Optional label shown in mapping lists (e.g. the physical control name). */
  readonly label?: string;
}
