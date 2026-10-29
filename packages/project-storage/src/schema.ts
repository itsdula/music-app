/**
 * Runtime schema for the persistent project model (`Project` in @studio/domain).
 *
 * The schema mirrors the TypeScript model exactly — a compile-time check at the end
 * of this file fails the build if the two drift apart. Branded IDs are validated as
 * strings with a conservative character set (they also become bundle file names).
 * Every object is strict (unknown keys are rejected: any shape change requires a
 * schema version bump), every number must be finite, and strings/collections are
 * bounded so hostile input cannot exhaust memory during validation.
 *
 * Cross-entity rules (references, ordering, key/id agreement for tracks and clips)
 * are checked by `checkProjectInvariants` in @studio/domain after the schema passes.
 */
import {
  CURRENT_SCHEMA_VERSION,
  EFFECT_KINDS,
  MAX_BPM,
  MIN_BPM,
  type Brand,
  type Project,
} from '@studio/domain';
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Limits
// ---------------------------------------------------------------------------

/** Upper bounds that keep validation of untrusted documents cheap. */
export const SCHEMA_LIMITS = {
  idLength: 128,
  nameLength: 256,
  shortTextLength: 128,
  longTextLength: 1024,
  paramsPerSlot: 256,
  tracks: 1024,
  clips: 100_000,
  effectsPerChain: 64,
  notesPerClip: 500_000,
  assets: 10_000,
  vocalDocs: 10_000,
  vocalSegments: 200_000,
  keyCandidates: 512,
  midiMappings: 4096,
} as const;

/**
 * Entity IDs: 1–128 characters from `[A-Za-z0-9_.-]`, starting with a letter or digit.
 * Domain IDs look like `trk_3f2c…` (prefix + UUID suffix). The restriction keeps IDs
 * usable as file names inside project bundles (no separators, no `..`, no `__proto__`).
 */
export const ENTITY_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/;

const entityId = () =>
  z
    .string()
    .regex(
      ENTITY_ID_PATTERN,
      'must be 1-128 characters of [A-Za-z0-9_.-] starting with a letter or digit',
    );

const isoTimestamp = () =>
  z.iso.datetime({ offset: true, message: 'must be an ISO-8601 timestamp' });
const text = (max: number) => z.string().max(max);
const nonEmptyText = (max: number) => z.string().min(1).max(max);
/** zod 4 numbers already reject NaN and ±Infinity. */
const finite = () => z.number();
const unit = () => z.number().min(0).max(1);
const nonNegativeInt = () => z.int().min(0);
const positiveInt = () => z.int().min(1);
const midi7 = () => z.int().min(0).max(127);

function boundedRecord<K extends z.ZodType<string>, V extends z.ZodType>(
  key: K,
  value: V,
  max: number,
) {
  return z
    .record(key, value)
    .refine((record) => Object.keys(record).length <= max, `must have at most ${max} entries`);
}

const ParamValuesSchema = boundedRecord(nonEmptyText(64), finite(), SCHEMA_LIMITS.paramsPerSlot);

// ---------------------------------------------------------------------------
// Theory and time
// ---------------------------------------------------------------------------

const PitchClassSchema = z.literal([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);

const ScaleIdSchema = z.enum([
  'major',
  'naturalMinor',
  'harmonicMinor',
  'melodicMinor',
  'dorian',
  'phrygian',
  'lydian',
  'mixolydian',
  'locrian',
  'majorPentatonic',
  'minorPentatonic',
  'blues',
  'chromatic',
]);

export const MusicalKeySchema = z.strictObject({ tonic: PitchClassSchema, scale: ScaleIdSchema });

const TimeSignatureSchema = z.strictObject({
  numerator: z.int().min(1).max(32),
  denominator: z.literal([1, 2, 4, 8, 16, 32]),
});

// ---------------------------------------------------------------------------
// Tracks and mixer
// ---------------------------------------------------------------------------

const EffectKindSchema = z.enum(EFFECT_KINDS);
const InstrumentKindSchema = z.enum(['synth', 'drums', 'sampler']);

export const EffectSlotSchema = z.strictObject({
  id: entityId(),
  kind: EffectKindSchema,
  bypass: z.boolean(),
  params: ParamValuesSchema,
});

const EffectChainSchema = z.array(EffectSlotSchema).max(SCHEMA_LIMITS.effectsPerChain);

const InstrumentConfigSchema = z.strictObject({
  kind: InstrumentKindSchema,
  params: ParamValuesSchema,
  presetId: nonEmptyText(SCHEMA_LIMITS.shortTextLength).optional(),
  sampleAssetId: entityId().optional(),
});

const MidiInputRoutingSchema = z.strictObject({
  channel: z.union([z.int().min(1).max(16), z.literal('all')]),
  transpose: z.int().min(-127).max(127),
});

const TrackMixerSchema = z.strictObject({
  gainDb: finite(),
  pan: z.number().min(-1).max(1),
  mute: z.boolean(),
  solo: z.boolean(),
});

export const TrackSchema = z.strictObject({
  id: entityId(),
  kind: z.enum(['audio', 'instrument', 'vocal']),
  name: text(SCHEMA_LIMITS.nameLength),
  color: nonEmptyText(64),
  mixer: TrackMixerSchema,
  armed: z.boolean(),
  monitor: z.enum(['off', 'auto', 'on']),
  instrument: InstrumentConfigSchema.optional(),
  midiInput: MidiInputRoutingSchema.optional(),
  effects: EffectChainSchema,
  inputChannels: z.literal([1, 2]).optional(),
});

const MasterBusSchema = z.strictObject({ gainDb: finite(), effects: EffectChainSchema });

// ---------------------------------------------------------------------------
// Clips
// ---------------------------------------------------------------------------

const MidiNoteSchema = z.strictObject({
  id: entityId(),
  startTick: nonNegativeInt(),
  durationTicks: positiveInt(),
  pitch: midi7(),
  velocity: z.int().min(1).max(127),
});

const clipBase = {
  id: entityId(),
  trackId: entityId(),
  name: text(SCHEMA_LIMITS.nameLength),
  color: nonEmptyText(64).optional(),
  startTick: nonNegativeInt(),
  muted: z.boolean(),
};

const MidiClipSchema = z.strictObject({
  ...clipBase,
  kind: z.literal('midi'),
  lengthTicks: positiveInt(),
  contentOffsetTicks: nonNegativeInt(),
  loopLengthTicks: positiveInt().optional(),
  notes: z.array(MidiNoteSchema).max(SCHEMA_LIMITS.notesPerClip),
});

const AudioClipSchema = z.strictObject({
  ...clipBase,
  kind: z.literal('audio'),
  assetId: entityId(),
  sourceStartFrame: nonNegativeInt(),
  lengthFrames: positiveInt(),
  loopLengthFrames: positiveInt().optional(),
  gainDb: finite(),
  fadeInFrames: nonNegativeInt(),
  fadeOutFrames: nonNegativeInt(),
});

export const ClipSchema = z.discriminatedUnion('kind', [MidiClipSchema, AudioClipSchema]);

// ---------------------------------------------------------------------------
// Assets
// ---------------------------------------------------------------------------

export const SHA256_HEX_PATTERN = /^[0-9a-f]{64}$/;

export const AssetRefSchema = z.strictObject({
  id: entityId(),
  name: text(SCHEMA_LIMITS.nameLength),
  kind: z.literal('audio'),
  mimeType: nonEmptyText(SCHEMA_LIMITS.shortTextLength),
  sampleRate: z.number().positive().max(1_536_000),
  channels: z.int().min(1).max(64),
  frames: nonNegativeInt(),
  contentHash: z.string().regex(SHA256_HEX_PATTERN, 'must be a lower-case hex SHA-256 digest'),
  byteLength: nonNegativeInt(),
  source: z.enum(['import', 'recording', 'render', 'bundled']),
  createdAt: isoTimestamp(),
});

// ---------------------------------------------------------------------------
// Vocal editing
// ---------------------------------------------------------------------------

const VocalNoteSegmentSchema = z
  .strictObject({
    id: entityId(),
    startSeconds: z.number().min(0),
    endSeconds: z.number().min(0),
    detectedMidi: finite(),
    confidence: unit(),
    vibratoDepthCents: z.number().min(0),
    vibratoRateHz: z.number().min(0),
    driftCents: finite(),
  })
  .refine((s) => s.endSeconds >= s.startSeconds, {
    message: 'endSeconds must not be before startSeconds',
    path: ['endSeconds'],
  });

const VocalNoteEditSchema = z.strictObject({
  targetMidi: finite().optional(),
  driftCorrection: unit(),
  modulationScale: z.number().min(0).max(2),
  transitionMs: z.number().min(0),
  bypass: z.boolean(),
});

const VocalCorrectionSettingsSchema = z.strictObject({
  key: MusicalKeySchema.nullable(),
  amount: unit(),
  retuneSpeedMs: z.number().min(0),
  humanize: unit(),
  formantPreservation: z.boolean(),
  formantShiftSemitones: finite(),
});

const KeyCandidateSchema = z.strictObject({ key: MusicalKeySchema, confidence: unit() });

export const VocalEditDocSchema = z.strictObject({
  assetId: entityId(),
  analysisKey: text(SCHEMA_LIMITS.longTextLength),
  algorithmVersion: text(SCHEMA_LIMITS.shortTextLength),
  segments: z.array(VocalNoteSegmentSchema).max(SCHEMA_LIMITS.vocalSegments),
  noteEdits: boundedRecord(entityId(), VocalNoteEditSchema, SCHEMA_LIMITS.vocalSegments),
  correction: VocalCorrectionSettingsSchema,
  enabled: z.boolean(),
  keyCandidates: z.array(KeyCandidateSchema).max(SCHEMA_LIMITS.keyCandidates),
});

// ---------------------------------------------------------------------------
// Parameter addressing and MIDI mappings
// ---------------------------------------------------------------------------

const TrackParamSchema = z.enum(['gainDb', 'pan', 'mute', 'solo', 'arm']);
const paramName = () => nonEmptyText(64);

export const ParameterAddressSchema = z.discriminatedUnion('scope', [
  z.strictObject({ scope: z.literal('track'), trackId: entityId(), param: TrackParamSchema }),
  z.strictObject({ scope: z.literal('instrument'), trackId: entityId(), param: paramName() }),
  z.strictObject({
    scope: z.literal('effect'),
    trackId: z.union([z.literal('master'), entityId()]),
    effectId: entityId(),
    param: paramName(),
  }),
  z.strictObject({ scope: z.literal('master'), param: z.literal('gainDb') }),
  z.strictObject({ scope: z.literal('transport'), param: z.literal('bpm') }),
  z.strictObject({ scope: z.literal('selectedTrack'), param: TrackParamSchema }),
  z.strictObject({ scope: z.literal('selectedInstrument'), param: paramName() }),
]);

const StudioActionIdSchema = z.enum([
  'transport.play',
  'transport.stop',
  'transport.togglePlay',
  'transport.record',
  'transport.toggleLoop',
  'transport.toggleMetronome',
  'transport.rewind',
  'transport.tapTempo',
  'edit.undo',
  'edit.redo',
  'track.selectNext',
  'track.selectPrevious',
  'track.toggleArmSelected',
  'track.toggleMuteSelected',
  'track.toggleSoloSelected',
]);

const MidiChannelFilterSchema = z.union([z.int().min(1).max(16), z.literal('any')]);

export const MidiControlSourceSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('cc'),
    channel: MidiChannelFilterSchema,
    controller: midi7(),
    mode: z.enum(['absolute', 'twosComplement', 'signedBit', 'binaryOffset']),
  }),
  z.strictObject({
    kind: z.literal('note'),
    channel: MidiChannelFilterSchema,
    note: midi7(),
    behavior: z.enum(['trigger', 'gate', 'toggle']),
  }),
  z.strictObject({ kind: z.literal('pitchBend'), channel: MidiChannelFilterSchema }),
  z.strictObject({
    kind: z.literal('programChange'),
    channel: MidiChannelFilterSchema,
    program: midi7().optional(),
  }),
]);

const MidiDeviceSelectorSchema = z.strictObject({
  profileId: nonEmptyText(SCHEMA_LIMITS.shortTextLength).optional(),
  portName: nonEmptyText(SCHEMA_LIMITS.nameLength).optional(),
});

const MappingTargetSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('parameter'), address: ParameterAddressSchema }),
  z.strictObject({ kind: z.literal('action'), action: StudioActionIdSchema }),
]);

const MidiValueTransformSchema = z.strictObject({
  min: unit(),
  max: unit(),
  invert: z.boolean(),
  curve: z.enum(['linear', 'exponential', 'logarithmic', 'sCurve']),
  takeover: z.enum(['immediate', 'pickup']),
  relativeStep: unit(),
});

export const MidiMappingSchema = z.strictObject({
  id: entityId(),
  source: MidiControlSourceSchema,
  device: MidiDeviceSelectorSchema.nullable(),
  target: MappingTargetSchema,
  transform: MidiValueTransformSchema,
  scope: z.enum(['global', 'project']),
  enabled: z.boolean(),
  label: text(SCHEMA_LIMITS.nameLength).optional(),
});

// ---------------------------------------------------------------------------
// Project
// ---------------------------------------------------------------------------

export const ProjectSchema = z
  .strictObject({
    id: entityId(),
    schemaVersion: z
      .int()
      .refine((v): boolean => v === CURRENT_SCHEMA_VERSION, `must be ${CURRENT_SCHEMA_VERSION}`),
    name: text(SCHEMA_LIMITS.nameLength),
    createdAt: isoTimestamp(),
    updatedAt: isoTimestamp(),
    bpm: z.number().min(MIN_BPM).max(MAX_BPM),
    meter: TimeSignatureSchema,
    loop: z.strictObject({
      enabled: z.boolean(),
      startTick: nonNegativeInt(),
      endTick: nonNegativeInt(),
    }),
    metronome: z.strictObject({
      enabled: z.boolean(),
      gainDb: finite(),
      countInBars: z.int().min(0).max(64),
    }),
    trackOrder: z.array(entityId()).max(SCHEMA_LIMITS.tracks),
    tracks: boundedRecord(entityId(), TrackSchema, SCHEMA_LIMITS.tracks),
    clips: boundedRecord(entityId(), ClipSchema, SCHEMA_LIMITS.clips),
    master: MasterBusSchema,
    assets: boundedRecord(entityId(), AssetRefSchema, SCHEMA_LIMITS.assets),
    vocalEdits: boundedRecord(entityId(), VocalEditDocSchema, SCHEMA_LIMITS.vocalDocs),
    midiMappings: z.array(MidiMappingSchema).max(SCHEMA_LIMITS.midiMappings),
  })
  .superRefine((project, ctx) => {
    // Key/id agreement for maps that `checkProjectInvariants` does not cover.
    for (const [key, asset] of Object.entries(project.assets)) {
      if (asset.id !== key)
        ctx.addIssue({
          code: 'custom',
          path: ['assets', key, 'id'],
          message: 'asset id does not match its key',
        });
    }
    for (const [key, doc] of Object.entries(project.vocalEdits)) {
      if (doc.assetId !== key)
        ctx.addIssue({
          code: 'custom',
          path: ['vocalEdits', key, 'assetId'],
          message: 'vocal edit assetId does not match its key',
        });
    }
  });

// ---------------------------------------------------------------------------
// Compile-time guarantee: the schema output is exactly `Project` minus ID brands.
// ---------------------------------------------------------------------------

type AnyBrand = Brand<string, string>;

/** `Project` with branded ids widened to `string` and readonly modifiers removed. */
export type Unbranded<T> = T extends AnyBrand
  ? string
  : T extends string | number | boolean | null | undefined
    ? T
    : T extends readonly (infer U)[]
      ? Unbranded<U>[]
      : { -readonly [K in keyof T as K extends AnyBrand ? string : K]: Unbranded<T[K]> };

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

export type ProjectSchemaOutput = z.output<typeof ProjectSchema>;

const schemaMirrorsProject: Equal<Unbranded<ProjectSchemaOutput>, Unbranded<Project>> = true;
void schemaMirrorsProject;
