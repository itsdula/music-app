/**
 * Edit commands: serializable, deterministic descriptions of persistent project changes.
 *
 * - Every persistent change goes through `applyCommand(project, command)`, a pure function
 *   returning a new Project (structural sharing; untouched entities keep identity).
 * - Commands carry every ID they create (callers generate IDs), so replay is deterministic.
 * - Invalid commands (missing entities, violated preconditions) throw `CommandError`;
 *   out-of-range numeric values are clamped to their ParamSpec range instead.
 * - `updatedAt` is not touched by commands (keeps them clock-free); persistence stamps it.
 */
import type {
  AssetId,
  AssetRef,
  AudioClip,
  Clip,
  ClipId,
  EffectId,
  EffectSlot,
  InstrumentConfig,
  LoopRegion,
  MappingId,
  MetronomeSettings,
  MidiClip,
  MidiInputRouting,
  MidiMapping,
  MidiNote,
  MonitorMode,
  NoteId,
  QuantizeOptions,
  TimeSignature,
  Track,
  TrackId,
  TrackMixer,
  VocalCorrectionSettings,
  VocalEditDoc,
  VocalNoteEdit,
  VocalNoteId,
  VocalNoteSegment,
} from '@studio/domain';

export type EffectTarget = TrackId | 'master';

export type NotePatch = Pick<MidiNote, 'id'> & Partial<Omit<MidiNote, 'id'>>;

export type TrackPatch = Partial<{
  name: string;
  color: string;
  armed: boolean;
  monitor: MonitorMode;
  inputChannels: 1 | 2;
  midiInput: MidiInputRouting;
}>;

export type MidiClipPatch = Partial<Pick<MidiClip, 'name' | 'color' | 'muted'>> & {
  /** null clears looping. */
  readonly loopLengthTicks?: number | null;
};

export type AudioClipPatch = Partial<
  Pick<AudioClip, 'name' | 'color' | 'muted' | 'gainDb' | 'fadeInFrames' | 'fadeOutFrames'>
> & {
  /** null clears looping. */
  readonly loopLengthFrames?: number | null;
};

export interface ClipMove {
  readonly clipId: ClipId;
  /** New absolute start (integer ticks, >= 0). */
  readonly startTick: number;
  /** Optional destination track (must accept the clip kind). */
  readonly trackId?: TrackId;
}

export type MappingPatch = Partial<Omit<MidiMapping, 'id' | 'scope'>>;

export type Command =
  // project
  | { readonly type: 'project.rename'; readonly name: string }
  | { readonly type: 'project.setTempo'; readonly bpm: number }
  | { readonly type: 'project.setMeter'; readonly meter: TimeSignature }
  | { readonly type: 'project.setLoop'; readonly loop: Partial<LoopRegion> }
  | { readonly type: 'project.setMetronome'; readonly metronome: Partial<MetronomeSettings> }
  // tracks
  | { readonly type: 'track.add'; readonly track: Track; readonly index?: number }
  /** Removes the track and all its clips. */
  | { readonly type: 'track.remove'; readonly trackId: TrackId }
  | { readonly type: 'track.update'; readonly trackId: TrackId; readonly patch: TrackPatch }
  | { readonly type: 'track.move'; readonly trackId: TrackId; readonly toIndex: number }
  | {
      readonly type: 'track.setMixer';
      readonly trackId: TrackId;
      readonly mixer: Partial<TrackMixer>;
    }
  | {
      readonly type: 'track.setInstrument';
      readonly trackId: TrackId;
      readonly instrument: InstrumentConfig;
    }
  /** Merges (and clamps) instrument parameter values. */
  | {
      readonly type: 'track.setInstrumentParams';
      readonly trackId: TrackId;
      readonly params: Readonly<Record<string, number>>;
    }
  // effects (track or master chains)
  | {
      readonly type: 'effect.add';
      readonly target: EffectTarget;
      readonly effect: EffectSlot;
      readonly index?: number;
    }
  | { readonly type: 'effect.remove'; readonly target: EffectTarget; readonly effectId: EffectId }
  | {
      readonly type: 'effect.move';
      readonly target: EffectTarget;
      readonly effectId: EffectId;
      readonly toIndex: number;
    }
  | {
      readonly type: 'effect.setParams';
      readonly target: EffectTarget;
      readonly effectId: EffectId;
      readonly params: Readonly<Record<string, number>>;
    }
  | {
      readonly type: 'effect.setBypass';
      readonly target: EffectTarget;
      readonly effectId: EffectId;
      readonly bypass: boolean;
    }
  | { readonly type: 'master.setGain'; readonly gainDb: number }
  // clips
  /** Adds one or more clips (paste / duplicate / create / import). */
  | { readonly type: 'clip.add'; readonly clips: readonly Clip[] }
  | { readonly type: 'clip.remove'; readonly clipIds: readonly ClipId[] }
  | { readonly type: 'clip.move'; readonly moves: readonly ClipMove[] }
  | { readonly type: 'clip.updateMidi'; readonly clipId: ClipId; readonly patch: MidiClipPatch }
  | { readonly type: 'clip.updateAudio'; readonly clipId: ClipId; readonly patch: AudioClipPatch }
  /** Non-destructive left trim: moves the left edge to `startTick`, adjusting content offset. */
  | { readonly type: 'clip.trimStart'; readonly clipId: ClipId; readonly startTick: number }
  /** Non-destructive right trim: sets the right edge (ticks; audio converts to frames at the current tempo). */
  | { readonly type: 'clip.trimEnd'; readonly clipId: ClipId; readonly endTick: number }
  /** Splits at an absolute tick strictly inside the clip; the right part gets `newClipId`. */
  | {
      readonly type: 'clip.split';
      readonly clipId: ClipId;
      readonly atTick: number;
      readonly newClipId: ClipId;
    }
  // notes (MIDI clips); note ids are unique within their clip
  | { readonly type: 'notes.add'; readonly clipId: ClipId; readonly notes: readonly MidiNote[] }
  | { readonly type: 'notes.remove'; readonly clipId: ClipId; readonly noteIds: readonly NoteId[] }
  /** Sets absolute values on existing notes (move/resize/velocity in one command). */
  | {
      readonly type: 'notes.update';
      readonly clipId: ClipId;
      readonly patches: readonly NotePatch[];
    }
  | {
      readonly type: 'notes.quantize';
      readonly clipId: ClipId;
      readonly noteIds: readonly NoteId[];
      readonly options: QuantizeOptions;
    }
  // assets
  | { readonly type: 'asset.register'; readonly asset: AssetRef }
  /** Fails if any clip, instrument or vocal doc still references the asset. */
  | { readonly type: 'asset.remove'; readonly assetId: AssetId }
  // vocal editing
  | { readonly type: 'vocal.setDoc'; readonly doc: VocalEditDoc }
  | { readonly type: 'vocal.removeDoc'; readonly assetId: AssetId }
  | {
      readonly type: 'vocal.setCorrection';
      readonly assetId: AssetId;
      readonly correction: Partial<VocalCorrectionSettings>;
    }
  /** Merges per-note edits; `targetMidi: undefined` in a patch is ignored, use `vocal.clearTargets`. */
  | {
      readonly type: 'vocal.setNoteEdits';
      readonly assetId: AssetId;
      readonly edits: Readonly<Record<VocalNoteId, Partial<VocalNoteEdit>>>;
    }
  | {
      readonly type: 'vocal.clearTargets';
      readonly assetId: AssetId;
      readonly noteIds: readonly VocalNoteId[];
    }
  /** Removes edits for the given notes (back to defaults). */
  | {
      readonly type: 'vocal.resetNotes';
      readonly assetId: AssetId;
      readonly noteIds: readonly VocalNoteId[];
    }
  /** Split/merge: callers compute new segments from analysis data (see @studio/vocal-dsp). */
  | {
      readonly type: 'vocal.replaceSegments';
      readonly assetId: AssetId;
      readonly removeIds: readonly VocalNoteId[];
      readonly add: readonly VocalNoteSegment[];
    }
  | { readonly type: 'vocal.setEnabled'; readonly assetId: AssetId; readonly enabled: boolean }
  // project-scoped MIDI mappings
  | { readonly type: 'mapping.add'; readonly mapping: MidiMapping }
  | { readonly type: 'mapping.update'; readonly mappingId: MappingId; readonly patch: MappingPatch }
  | { readonly type: 'mapping.remove'; readonly mappingIds: readonly MappingId[] };

export type CommandType = Command['type'];

export type CommandOf<T extends CommandType> = Extract<Command, { type: T }>;

export type CommandErrorCode =
  'not-found' | 'invalid-argument' | 'kind-mismatch' | 'precondition-failed' | 'transaction-state';

export class CommandError extends Error {
  constructor(
    readonly code: CommandErrorCode,
    message: string,
    readonly commandType?: CommandType,
  ) {
    super(message);
    this.name = 'CommandError';
  }
}
