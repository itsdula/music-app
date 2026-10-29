/**
 * Validation and normalization of entities supplied by commands.
 *
 * Conventions (see the package README section in the report / types.ts):
 * - Structural problems (wrong id, non-integer ticks/frames, unknown param ids, bad
 *   colours, out-of-range pitches) throw `CommandError('invalid-argument')`.
 * - Out-of-range continuous values (gain, pan, velocity, params) are clamped.
 * - Non-finite numbers are always invalid arguments (never silently defaulted).
 * - Normalizers return the input object itself when it is already normalized.
 */
import {
  DEFAULT_VOCAL_NOTE_EDIT,
  EFFECT_KINDS,
  EFFECT_PARAM_SPECS,
  INSTRUMENT_PARAM_SPECS,
  SCALES,
  TRACK_GAIN_SPEC,
  TRACK_PAN_SPEC,
  clampParam,
  findParamSpec,
  sanitizeParamValues,
  sortNotes,
  type AudioClip,
  type Clip,
  type EffectSlot,
  type InstrumentConfig,
  type InstrumentKind,
  type MidiClip,
  type MidiControlSource,
  type MidiInputRouting,
  type MidiMapping,
  type MidiNote,
  type MidiValueTransform,
  type MusicalKey,
  type ParamSpec,
  type Project,
  type Track,
  type TrackMixer,
  type VocalCorrectionSettings,
  type VocalEditDoc,
  type VocalNoteEdit,
  type VocalNoteSegment,
} from '@studio/domain';
import {
  clamp,
  clampFinite,
  clampInt,
  fail,
  getOwn,
  hasOwn,
  keepIfEqual,
  mergeChanged,
  requireFinite,
  requireInt,
  requireUniqueIds,
} from './util';

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

const HEX_COLOR = /^#[0-9A-Fa-f]{6}$/;

export function requireColor(color: string, what: string): string {
  if (typeof color !== 'string' || !HEX_COLOR.test(color)) {
    fail('invalid-argument', `${what} must be a #RRGGBB colour (got ${String(color)})`);
  }
  return color;
}

export function requireName(name: string, what: string): string {
  const trimmed = typeof name === 'string' ? name.trim() : '';
  if (trimmed.length === 0) fail('invalid-argument', `${what} must not be empty`);
  return trimmed;
}

const MONITOR_MODES = new Set(['off', 'auto', 'on']);
const TRACK_KINDS = new Set(['audio', 'instrument', 'vocal']);

export function requireMonitor(mode: string): void {
  if (!MONITOR_MODES.has(mode)) fail('invalid-argument', `invalid monitor mode ${mode}`);
}

export function requireInputChannels(channels: number): void {
  if (channels !== 1 && channels !== 2) fail('invalid-argument', 'inputChannels must be 1 or 2');
}

// ---------------------------------------------------------------------------
// Parameters
// ---------------------------------------------------------------------------

/**
 * Validates a partial parameter map against specs: unknown ids are invalid arguments,
 * values are clamped (and step-quantized) via `clampParam`.
 */
export function clampParamPatch(
  specs: readonly ParamSpec[],
  params: Readonly<Record<string, number>>,
  what: string,
): Record<string, number> {
  const result: Record<string, number> = {};
  for (const [id, raw] of Object.entries(params)) {
    const spec = findParamSpec(specs, id);
    if (!spec) fail('invalid-argument', `unknown ${what} parameter ${id}`);
    result[id] = clampParam(spec, requireFinite(raw, `${what} parameter ${id}`));
  }
  return result;
}

/** Full parameter set: validated, clamped, missing ids filled with defaults. */
export function normalizeParams(
  specs: readonly ParamSpec[],
  params: Readonly<Record<string, number>>,
  what: string,
): Record<string, number> {
  return sanitizeParamValues(specs, clampParamPatch(specs, params, what));
}

export function requireInstrumentKind(kind: string): InstrumentKind {
  if (!hasOwn(INSTRUMENT_PARAM_SPECS, kind as InstrumentKind)) {
    fail('invalid-argument', `unknown instrument kind ${kind}`);
  }
  return kind as InstrumentKind;
}

export function normalizeInstrument(
  project: Project,
  instrument: InstrumentConfig,
): InstrumentConfig {
  const kind = requireInstrumentKind(instrument.kind);
  const params = normalizeParams(INSTRUMENT_PARAM_SPECS[kind], instrument.params, 'instrument');
  if (instrument.sampleAssetId !== undefined) {
    if (kind !== 'sampler') fail('invalid-argument', 'sampleAssetId is only valid for samplers');
    if (!hasOwn(project.assets, instrument.sampleAssetId)) {
      fail('not-found', `asset ${instrument.sampleAssetId} not found`);
    }
  }
  return keepIfEqual(instrument, { ...instrument, params });
}

export function normalizeEffect(effect: EffectSlot): EffectSlot {
  if (!EFFECT_KINDS.includes(effect.kind))
    fail('invalid-argument', `unknown effect ${effect.kind}`);
  if (typeof effect.id !== 'string' || effect.id.length === 0) {
    fail('invalid-argument', 'effect id must be a non-empty string');
  }
  const params = normalizeParams(EFFECT_PARAM_SPECS[effect.kind], effect.params, 'effect');
  return keepIfEqual(effect, { ...effect, bypass: effect.bypass === true, params });
}

// ---------------------------------------------------------------------------
// Tracks
// ---------------------------------------------------------------------------

export function normalizeMixerPatch(mixer: Partial<TrackMixer>): Partial<TrackMixer> {
  const result: { -readonly [K in keyof TrackMixer]?: TrackMixer[K] } = {};
  if (mixer.gainDb !== undefined) {
    result.gainDb = clampParam(TRACK_GAIN_SPEC, requireFinite(mixer.gainDb, 'gainDb'));
  }
  if (mixer.pan !== undefined) {
    result.pan = clampParam(TRACK_PAN_SPEC, requireFinite(mixer.pan, 'pan'));
  }
  if (mixer.mute !== undefined) result.mute = mixer.mute === true;
  if (mixer.solo !== undefined) result.solo = mixer.solo === true;
  return result;
}

export function normalizeMidiInput(routing: MidiInputRouting): MidiInputRouting {
  const { channel } = routing;
  if (channel !== 'all' && !(Number.isInteger(channel) && channel >= 1 && channel <= 16)) {
    fail('invalid-argument', `MIDI input channel must be 'all' or 1..16 (got ${String(channel)})`);
  }
  const transpose = clampInt(routing.transpose, -48, 48, 'transpose');
  return keepIfEqual(routing, { channel, transpose });
}

/** Validates a whole track for `track.add`. */
export function normalizeTrack(project: Project, track: Track): Track {
  if (typeof track.id !== 'string' || track.id.length === 0) {
    fail('invalid-argument', 'track id must be a non-empty string');
  }
  if (!TRACK_KINDS.has(track.kind)) fail('invalid-argument', `unknown track kind ${track.kind}`);
  const name = requireName(track.name, 'track name');
  const color = requireColor(track.color, 'track color');
  requireMonitor(track.monitor);
  const mixer = {
    ...track.mixer,
    ...normalizeMixerPatch({
      gainDb: track.mixer.gainDb,
      pan: track.mixer.pan,
      mute: track.mixer.mute === true,
      solo: track.mixer.solo === true,
    }),
  };
  const effects = track.effects.map(normalizeEffect);
  requireUniqueIds(
    effects.map((e) => e.id),
    'effect',
  );

  const next: { -readonly [K in keyof Track]: Track[K] } = {
    ...track,
    name,
    color,
    armed: track.armed === true,
    mixer: keepIfEqual(track.mixer, mixer),
    effects: keepIfEqual(track.effects, effects),
  };
  if (track.kind === 'instrument') {
    if (!track.instrument) fail('invalid-argument', 'instrument tracks require an instrument');
    next.instrument = normalizeInstrument(project, track.instrument);
    next.midiInput = normalizeMidiInput(track.midiInput ?? { channel: 'all', transpose: 0 });
    if (track.inputChannels !== undefined) {
      fail('invalid-argument', 'inputChannels is only valid on audio/vocal tracks');
    }
  } else {
    if (track.instrument !== undefined) {
      fail('invalid-argument', `${track.kind} tracks cannot have an instrument`);
    }
    if (track.midiInput !== undefined) {
      fail('invalid-argument', `${track.kind} tracks cannot have MIDI input routing`);
    }
    if (track.inputChannels !== undefined) requireInputChannels(track.inputChannels);
  }
  return keepIfEqual(track, next);
}

// ---------------------------------------------------------------------------
// Notes
// ---------------------------------------------------------------------------

export function requirePitch(pitch: number): number {
  if (!Number.isInteger(pitch) || pitch < 0 || pitch > 127) {
    fail('invalid-argument', `pitch must be an integer 0..127 (got ${String(pitch)})`);
  }
  return pitch;
}

export function clampVelocity(velocity: number): number {
  return clamp(Math.round(requireFinite(velocity, 'velocity')), 1, 127);
}

export function normalizeNote(note: MidiNote): MidiNote {
  if (typeof note.id !== 'string' || note.id.length === 0) {
    fail('invalid-argument', 'note id must be a non-empty string');
  }
  const startTick = requireInt(note.startTick, 'note startTick', 0);
  const durationTicks = requireInt(note.durationTicks, 'note durationTicks', 1);
  const pitch = requirePitch(note.pitch);
  const velocity = clampVelocity(note.velocity);
  if (velocity === note.velocity) return note;
  return { id: note.id, startTick, durationTicks, pitch, velocity };
}

/**
 * Merges two arrays that are each sorted by `compare` (stable; ties keep `a` first).
 * O(n + m), used when adding notes to large clips.
 */
export function mergeSorted<T>(a: readonly T[], b: readonly T[], compare: (x: T, y: T) => number) {
  const result: T[] = new Array<T>(a.length + b.length);
  let i = 0;
  let j = 0;
  let k = 0;
  while (i < a.length && j < b.length) {
    result[k++] = compare(b[j]!, a[i]!) < 0 ? b[j++]! : a[i++]!;
  }
  while (i < a.length) result[k++] = a[i++]!;
  while (j < b.length) result[k++] = b[j++]!;
  return result;
}

/** Validates and sorts a full note list (unique ids). Returns the input when already valid. */
export function normalizeNoteList(notes: readonly MidiNote[]): readonly MidiNote[] {
  requireUniqueIds(
    notes.map((n) => n.id),
    'note',
  );
  const normalized = notes.map(normalizeNote);
  const sorted = sortNotes(normalized);
  return sorted.every((n, i) => n === notes[i]) ? notes : sorted;
}

// ---------------------------------------------------------------------------
// Clips
// ---------------------------------------------------------------------------

export function requireClipTrack(project: Project, clip: Pick<Clip, 'kind' | 'trackId'>): Track {
  const track = getOwn(project.tracks, clip.trackId);
  if (!track) fail('not-found', `track ${clip.trackId} not found`);
  const accepts = track.kind === 'instrument' ? 'midi' : 'audio';
  if (clip.kind !== accepts) {
    fail('kind-mismatch', `${clip.kind} clips cannot be placed on ${track.kind} tracks`);
  }
  return track;
}

/**
 * Clamps fades so both are >= 0 and fadeIn + fadeOut <= length. The fade named by
 * `keep` is clamped first (to [0, length]) and the other gets the remaining room.
 */
export function clampFades(
  lengthFrames: number,
  fadeInFrames: number,
  fadeOutFrames: number,
  keep: 'in' | 'out',
): { fadeInFrames: number; fadeOutFrames: number } {
  if (keep === 'in') {
    const fadeIn = clamp(fadeInFrames, 0, lengthFrames);
    return { fadeInFrames: fadeIn, fadeOutFrames: clamp(fadeOutFrames, 0, lengthFrames - fadeIn) };
  }
  const fadeOut = clamp(fadeOutFrames, 0, lengthFrames);
  return { fadeInFrames: clamp(fadeInFrames, 0, lengthFrames - fadeOut), fadeOutFrames: fadeOut };
}

export const CLIP_GAIN_SPEC = TRACK_GAIN_SPEC;

function normalizeClipBase(clip: Clip): void {
  if (typeof clip.id !== 'string' || clip.id.length === 0) {
    fail('invalid-argument', 'clip id must be a non-empty string');
  }
  requireInt(clip.startTick, 'clip startTick', 0);
  if (clip.color !== undefined) requireColor(clip.color, 'clip color');
}

export function normalizeMidiClip(clip: MidiClip): MidiClip {
  normalizeClipBase(clip);
  requireInt(clip.lengthTicks, 'lengthTicks', 1);
  requireInt(clip.contentOffsetTicks, 'contentOffsetTicks', 0);
  if (clip.loopLengthTicks !== undefined) requireInt(clip.loopLengthTicks, 'loopLengthTicks', 1);
  const notes = normalizeNoteList(clip.notes);
  return notes === clip.notes ? clip : { ...clip, notes };
}

export function normalizeAudioClip(project: Project, clip: AudioClip): AudioClip {
  normalizeClipBase(clip);
  const asset = getOwn(project.assets, clip.assetId);
  if (!asset) fail('not-found', `asset ${clip.assetId} not found`);
  const sourceStartFrame = requireInt(clip.sourceStartFrame, 'sourceStartFrame', 0);
  let lengthFrames = requireInt(clip.lengthFrames, 'lengthFrames', 1);
  if (clip.loopLengthFrames !== undefined) {
    requireInt(clip.loopLengthFrames, 'loopLengthFrames', 1);
  } else {
    if (sourceStartFrame >= asset.frames) {
      fail('invalid-argument', 'sourceStartFrame is past the end of the asset');
    }
    lengthFrames = Math.min(lengthFrames, asset.frames - sourceStartFrame);
  }
  const fades = clampFades(
    lengthFrames,
    requireInt(clip.fadeInFrames, 'fadeInFrames'),
    requireInt(clip.fadeOutFrames, 'fadeOutFrames'),
    'in',
  );
  const gainDb = clampParam(CLIP_GAIN_SPEC, requireFinite(clip.gainDb, 'clip gainDb'));
  return mergeChanged(clip, { lengthFrames, gainDb, ...fades });
}

export function normalizeClip(project: Project, clip: Clip): Clip {
  requireClipTrack(project, clip);
  return clip.kind === 'midi' ? normalizeMidiClip(clip) : normalizeAudioClip(project, clip);
}

// ---------------------------------------------------------------------------
// Vocal editing
// ---------------------------------------------------------------------------

export function compareSegments(a: VocalNoteSegment, b: VocalNoteSegment): number {
  return a.startSeconds - b.startSeconds || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

export function normalizeSegment(segment: VocalNoteSegment): VocalNoteSegment {
  if (typeof segment.id !== 'string' || segment.id.length === 0) {
    fail('invalid-argument', 'vocal note id must be a non-empty string');
  }
  const start = requireFinite(segment.startSeconds, 'segment startSeconds');
  const end = requireFinite(segment.endSeconds, 'segment endSeconds');
  if (start < 0 || end < start) {
    fail('invalid-argument', `segment ${segment.id} must satisfy 0 <= start <= end`);
  }
  requireFinite(segment.detectedMidi, 'segment detectedMidi');
  const confidence = clampFinite(segment.confidence, 0, 1, 'segment confidence');
  return confidence === segment.confidence ? segment : { ...segment, confidence };
}

/** Applies a partial note edit (ignoring `targetMidi: undefined`) with clamping. */
export function applyNoteEditPatch(
  base: VocalNoteEdit,
  patch: Partial<VocalNoteEdit>,
): VocalNoteEdit {
  const normalized: { -readonly [K in keyof VocalNoteEdit]?: VocalNoteEdit[K] } = {};
  if (patch.targetMidi !== undefined) {
    normalized.targetMidi = clampFinite(patch.targetMidi, 0, 127, 'targetMidi');
  }
  if (patch.driftCorrection !== undefined) {
    normalized.driftCorrection = clampFinite(patch.driftCorrection, 0, 1, 'driftCorrection');
  }
  if (patch.modulationScale !== undefined) {
    normalized.modulationScale = clampFinite(patch.modulationScale, 0, 2, 'modulationScale');
  }
  if (patch.transitionMs !== undefined) {
    normalized.transitionMs = clampFinite(patch.transitionMs, 0, 1000, 'transitionMs');
  }
  if (patch.bypass !== undefined) normalized.bypass = patch.bypass === true;
  return mergeChanged(base, normalized);
}

export function normalizeNoteEdit(edit: VocalNoteEdit): VocalNoteEdit {
  return applyNoteEditPatch(edit, { ...DEFAULT_VOCAL_NOTE_EDIT, ...edit });
}

export function requireMusicalKey(key: MusicalKey | null): MusicalKey | null {
  if (key === null) return null;
  if (!Number.isInteger(key.tonic) || key.tonic < 0 || key.tonic > 11) {
    fail('invalid-argument', 'key tonic must be a pitch class 0..11');
  }
  if (!hasOwn(SCALES, key.scale)) fail('invalid-argument', `unknown scale ${key.scale}`);
  return key;
}

export function applyCorrectionPatch(
  base: VocalCorrectionSettings,
  patch: Partial<VocalCorrectionSettings>,
): VocalCorrectionSettings {
  const normalized: {
    -readonly [K in keyof VocalCorrectionSettings]?: VocalCorrectionSettings[K];
  } = {};
  if (patch.key !== undefined) normalized.key = requireMusicalKey(patch.key);
  if (patch.amount !== undefined) normalized.amount = clampFinite(patch.amount, 0, 1, 'amount');
  if (patch.humanize !== undefined) {
    normalized.humanize = clampFinite(patch.humanize, 0, 1, 'humanize');
  }
  if (patch.retuneSpeedMs !== undefined) {
    normalized.retuneSpeedMs = clampFinite(patch.retuneSpeedMs, 0, 1000, 'retuneSpeedMs');
  }
  if (patch.formantShiftSemitones !== undefined) {
    normalized.formantShiftSemitones = clampFinite(
      patch.formantShiftSemitones,
      -12,
      12,
      'formantShiftSemitones',
    );
  }
  if (patch.formantPreservation !== undefined) {
    normalized.formantPreservation = patch.formantPreservation === true;
  }
  return mergeChanged(base, normalized);
}

/** Validates a whole vocal edit doc for `vocal.setDoc`. */
export function normalizeVocalDoc(doc: VocalEditDoc): VocalEditDoc {
  const segments = doc.segments.map(normalizeSegment);
  const ids = requireUniqueIds(
    segments.map((s) => s.id),
    'vocal note',
  );
  segments.sort(compareSegments);
  const noteEdits: Record<string, VocalNoteEdit> = {};
  for (const [id, edit] of Object.entries(doc.noteEdits)) {
    if (!ids.has(id)) fail('not-found', `vocal note ${id} not found in segments`);
    noteEdits[id] = normalizeNoteEdit(edit);
  }
  const correction = applyCorrectionPatch(doc.correction, doc.correction);
  return keepIfEqual(doc, {
    ...doc,
    segments: keepIfEqual(doc.segments, segments),
    noteEdits: keepIfEqual(doc.noteEdits, noteEdits),
    correction,
    enabled: doc.enabled === true,
  });
}

// ---------------------------------------------------------------------------
// MIDI mappings
// ---------------------------------------------------------------------------

function requireChannelFilter(channel: number | 'any'): void {
  if (channel !== 'any' && !(Number.isInteger(channel) && channel >= 1 && channel <= 16)) {
    fail('invalid-argument', `MIDI channel must be 'any' or 1..16 (got ${String(channel)})`);
  }
}

function requireMidiByte(value: number, what: string): void {
  if (!Number.isInteger(value) || value < 0 || value > 127) {
    fail('invalid-argument', `${what} must be an integer 0..127`);
  }
}

export function requireControlSource(source: MidiControlSource): void {
  requireChannelFilter(source.channel);
  switch (source.kind) {
    case 'cc':
      requireMidiByte(source.controller, 'controller');
      break;
    case 'note':
      requireMidiByte(source.note, 'note');
      break;
    case 'programChange':
      if (source.program !== undefined) requireMidiByte(source.program, 'program');
      break;
    case 'pitchBend':
      break;
    default:
      fail('invalid-argument', 'unknown MIDI control source');
  }
}

export function normalizeTransform(transform: MidiValueTransform): MidiValueTransform {
  return mergeChanged(transform, {
    min: clampFinite(transform.min, 0, 1, 'transform min'),
    max: clampFinite(transform.max, 0, 1, 'transform max'),
    relativeStep: clampFinite(transform.relativeStep, 0, 1, 'transform relativeStep'),
  });
}

/** Validates a project-scoped mapping; targeted tracks must exist. */
export function normalizeMapping(project: Project, mapping: MidiMapping): MidiMapping {
  if (mapping.scope !== 'project') {
    fail('invalid-argument', 'only project-scoped mappings can be stored in a project');
  }
  if (typeof mapping.id !== 'string' || mapping.id.length === 0) {
    fail('invalid-argument', 'mapping id must be a non-empty string');
  }
  requireControlSource(mapping.source);
  if (mapping.target.kind === 'parameter') {
    const address = mapping.target.address;
    if (
      (address.scope === 'track' || address.scope === 'instrument' || address.scope === 'effect') &&
      address.trackId !== 'master' &&
      !hasOwn(project.tracks, address.trackId)
    ) {
      fail('not-found', `mapping target track ${address.trackId} not found`);
    }
  }
  const transform = normalizeTransform(mapping.transform);
  return transform === mapping.transform ? mapping : { ...mapping, transform };
}
