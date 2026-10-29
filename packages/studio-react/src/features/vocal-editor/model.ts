/**
 * Pure vocal-editor logic: note targets, snapping, nudging, labels, key choices and
 * split/merge selection rules. No React, no canvas — unit-tested directly.
 */
import {
  DEFAULT_VOCAL_NOTE_EDIT,
  SCALES,
  keyLabel,
  midiToNoteName,
  nearestScaleNote,
  type KeyCandidate,
  type MusicalKey,
  type PitchClass,
  type ScaleId,
  type VocalEditDoc,
  type VocalNoteEdit,
  type VocalNoteId,
  type VocalNoteSegment,
} from '@studio/domain';
import { autoTargetMidi } from '@studio/vocal-dsp';

export function noteEditOf(doc: VocalEditDoc, id: VocalNoteId): VocalNoteEdit {
  const edit = doc.noteEdits[id];
  return edit === undefined ? DEFAULT_VOCAL_NOTE_EDIT : { ...DEFAULT_VOCAL_NOTE_EDIT, ...edit };
}

export function hasManualTarget(
  edit: VocalNoteEdit,
): edit is VocalNoteEdit & { readonly targetMidi: number } {
  return edit.targetMidi !== undefined && Number.isFinite(edit.targetMidi);
}

/**
 * Pitch the note centre is moved to, matching the correction model: a manual target is
 * applied fully; otherwise the centre moves `amount` of the way to its automatic target.
 * Bypassed notes stay where they were sung.
 */
export function displayTargetMidi(segment: VocalNoteSegment, doc: VocalEditDoc): number {
  const edit = noteEditOf(doc, segment.id);
  if (edit.bypass) return segment.detectedMidi;
  if (hasManualTarget(edit)) return edit.targetMidi;
  const amount = Math.min(1, Math.max(0, doc.correction.amount));
  return (
    segment.detectedMidi +
    amount * (autoTargetMidi(segment.detectedMidi, doc) - segment.detectedMidi)
  );
}

export type SnapMode = 'free' | 'semitone' | 'scale';

/** Alt = free (cent resolution); otherwise scale degrees when a key is set, else semitones. */
export function snapModeFor(key: MusicalKey | null, free: boolean): SnapMode {
  if (free) return 'free';
  return key === null || key.scale === 'chromatic' ? 'semitone' : 'scale';
}

export function clampMidi(midi: number): number {
  return Math.min(127, Math.max(0, midi));
}

/** Snaps a target pitch for dragging; free mode keeps whole cents. */
export function snapTargetMidi(midi: number, key: MusicalKey | null, mode: SnapMode): number {
  if (mode === 'free') return clampMidi(Math.round(midi * 100) / 100);
  if (mode === 'scale' && key !== null) return clampMidi(nearestScaleNote(midi, key));
  return clampMidi(Math.round(midi));
}

/**
 * Keyboard nudge: ±1 semitone lands on the next whole semitone in that direction (so a
 * note at 60.3 goes to 61 or 60); fine steps move by exactly ±10 cents.
 */
export function nudgeTargetMidi(current: number, direction: 1 | -1, fine: boolean): number {
  if (fine) return clampMidi(Math.round((current + direction * 0.1) * 100) / 100);
  const eps = 1e-6;
  const next = direction > 0 ? Math.floor(current + eps) + 1 : Math.ceil(current - eps) - 1;
  return clampMidi(next);
}

/** Signed cents of a pitch from its nearest semitone (−50..+50). */
export function centsFromNearest(midi: number): number {
  return Math.round((midi - Math.round(midi)) * 100);
}

export function formatCents(cents: number): string {
  if (cents === 0) return '±0¢';
  return `${cents > 0 ? '+' : '−'}${Math.abs(cents)}¢`;
}

/** "A4 −23¢" for a fractional pitch. */
export function pitchLabel(midi: number): string {
  return `${midiToNoteName(midi)} ${formatCents(centsFromNearest(midi))}`;
}

/** Spoken summary of one note for the live region and the notes table. */
export function describeNoteForScreenReader(segment: VocalNoteSegment, doc: VocalEditDoc): string {
  const edit = noteEditOf(doc, segment.id);
  const cents = centsFromNearest(segment.detectedMidi);
  const tuning =
    cents === 0 ? 'in tune' : `${Math.abs(cents)} cents ${cents > 0 ? 'sharp' : 'flat'}`;
  const target = edit.bypass
    ? 'bypassed'
    : hasManualTarget(edit)
      ? `target ${pitchLabel(edit.targetMidi)}`
      : `automatic target ${pitchLabel(displayTargetMidi(segment, doc))}`;
  return `${midiToNoteName(segment.detectedMidi)}, ${tuning}, ${target}`;
}

export function summarizeSelection(
  segments: readonly VocalNoteSegment[],
  doc: VocalEditDoc,
): string {
  if (segments.length === 0) return `${doc.segments.length} notes, none selected.`;
  if (segments.length === 1)
    return `Selected note: ${describeNoteForScreenReader(segments[0]!, doc)}.`;
  return `${segments.length} notes selected.`;
}

// --- key choices --------------------------------------------------------------------------

export const NO_KEY_VALUE = 'none';
export const ALL_KEYS_HEADER = 'header:all';

export function encodeKey(prefix: 's' | 'k' | 'c', key: MusicalKey): string {
  return `${prefix}:${key.tonic}:${key.scale}`;
}

export function decodeKeyValue(value: string): MusicalKey | null {
  if (value === NO_KEY_VALUE) return null;
  const [, tonic, scale] = value.split(':');
  const pc = Number(tonic);
  if (!Number.isInteger(pc) || pc < 0 || pc > 11 || scale === undefined || !(scale in SCALES))
    return null;
  return { tonic: pc as PitchClass, scale: scale as ScaleId };
}

export function sameKey(a: MusicalKey | null, b: MusicalKey | null): boolean {
  return a === b || (a !== null && b !== null && a.tonic === b.tonic && a.scale === b.scale);
}

export interface KeyOption {
  readonly value: string;
  readonly label: string;
  readonly disabled?: boolean;
}

const MAX_SUGGESTIONS = 5;

/**
 * Options for the key picker: ranked suggestions with confidence, "Chromatic (no key)",
 * then every major/minor key; a custom scale chosen in Advanced is appended.
 */
export function keyOptions(
  candidates: readonly KeyCandidate[],
  current: MusicalKey | null,
): { readonly options: readonly KeyOption[]; readonly value: string } {
  const options: KeyOption[] = [];
  let value: string | null = current === null ? NO_KEY_VALUE : null;
  for (const candidate of candidates.slice(0, MAX_SUGGESTIONS)) {
    const v = encodeKey('s', candidate.key);
    options.push({
      value: v,
      label: `${keyLabel(candidate.key)} · ${Math.round(candidate.confidence * 100)}%`,
    });
    if (value === null && sameKey(candidate.key, current)) value = v;
  }
  options.push({ value: NO_KEY_VALUE, label: 'Chromatic (no key)' });
  options.push({ value: ALL_KEYS_HEADER, label: 'All keys', disabled: true });
  for (const scale of ['major', 'naturalMinor'] as const) {
    for (let tonic = 0; tonic < 12; tonic++) {
      const key: MusicalKey = { tonic: tonic as PitchClass, scale };
      const v = encodeKey('k', key);
      options.push({ value: v, label: keyLabel(key) });
      if (value === null && sameKey(key, current)) value = v;
    }
  }
  if (value === null && current !== null) {
    value = encodeKey('c', current);
    options.push({ value, label: keyLabel(current) });
  }
  return { options, value: value ?? NO_KEY_VALUE };
}

// --- split / merge ------------------------------------------------------------------------

export function sortedSegments(segments: readonly VocalNoteSegment[]): VocalNoteSegment[] {
  return [...segments].sort((a, b) => a.startSeconds - b.startSeconds);
}

/** The two selected notes when exactly two neighbouring notes are selected, else null. */
export function adjacentPair(
  segments: readonly VocalNoteSegment[],
  selected: ReadonlySet<VocalNoteId>,
): readonly [VocalNoteSegment, VocalNoteSegment] | null {
  if (selected.size !== 2) return null;
  const ordered = sortedSegments(segments);
  for (let i = 0; i + 1 < ordered.length; i++) {
    const a = ordered[i]!;
    const b = ordered[i + 1]!;
    if (selected.has(a.id) && selected.has(b.id)) return [a, b];
  }
  return null;
}

/** Minimum length of each half when splitting, seconds. */
export const MIN_SPLIT_SECONDS = 0.02;

/**
 * Picks the note to split and where: the first selected note containing the playhead,
 * else the one containing the pointer; both halves must keep `MIN_SPLIT_SECONDS`.
 */
export function chooseSplit(
  segments: readonly VocalNoteSegment[],
  selected: ReadonlySet<VocalNoteId>,
  candidatesSeconds: readonly (number | null)[],
): { readonly segment: VocalNoteSegment; readonly atSeconds: number } | null {
  const chosen = sortedSegments(segments).filter((s) => selected.has(s.id));
  for (const at of candidatesSeconds) {
    if (at === null) continue;
    const segment = chosen.find(
      (s) => at > s.startSeconds + MIN_SPLIT_SECONDS && at < s.endSeconds - MIN_SPLIT_SECONDS,
    );
    if (segment) return { segment, atSeconds: at };
  }
  return null;
}

export function pitchRange(segments: readonly VocalNoteSegment[]): {
  min: number | null;
  max: number | null;
} {
  let min: number | null = null;
  let max: number | null = null;
  for (const s of segments) {
    if (!Number.isFinite(s.detectedMidi)) continue;
    min = min === null ? s.detectedMidi : Math.min(min, s.detectedMidi);
    max = max === null ? s.detectedMidi : Math.max(max, s.detectedMidi);
  }
  return { min, max };
}

export function formatSeconds(seconds: number): string {
  return `${seconds.toFixed(2)} s`;
}

/** "+2 st 14¢" style offset of a target from the sung pitch. */
export function formatSemitones(delta: number): string {
  const cents = Math.round(delta * 100);
  if (cents === 0) return 'unchanged';
  const st = Math.trunc(cents / 100);
  const rest = cents - st * 100;
  const sign = cents > 0 ? '+' : '−';
  const parts = [];
  if (st !== 0) parts.push(`${Math.abs(st)} st`);
  if (rest !== 0) parts.push(`${Math.abs(rest)}¢`);
  return `${sign}${parts.join(' ')}`;
}
