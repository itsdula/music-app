import {
  DEFAULT_VOCAL_NOTE_EDIT,
  nearestScaleNote,
  type VocalEditDoc,
  type VocalNoteEdit,
  type VocalNoteSegment,
} from '@studio/domain';
import { clamp, clampedMovingAverage, hzToMidi, smoothRamp } from './internal/math';
import { frameRange } from './expression';
import { type PitchTrack } from './types';

/**
 * Correction model: per-frame target pitch (fractional MIDI) from the pitch track, the
 * note segments and the edit document. Exact semantics are specified in
 * docs/vocal-dsp.md §"Correction model"; in short, for a voiced frame t of a processed
 * note n with centre μ, linear drift trend δ(t) = D·(t − mid)/dur and deviation
 * e(t) = c(t) − μ − δ(t) split into a slow part e_s (cascaded 250 ms + 167 ms moving
 * averages, nulls 4 and 6 Hz) and a fast part e_f = e − e_s (vibrato, jitter):
 *
 *   T   = targetMidi (manual) | nearestScaleNote(μ, key) | round(μ)   (auto)
 *   Δ   = T − μ (manual, applied fully) | amount·(T − μ) (auto)
 *   f   = amount·(1 − humanize)            slow-variation flattening
 *   o(t) = Δ − k_d·δ(t) + (m − 1)·e_f(t) + (m·(1 − f) − 1)·e_s(t)
 *   target(t) = c(t) + o(t)
 *
 * with k_d = driftCorrection and m = modulationScale. Offsets change smoothly at note
 * starts (raised-cosine ramps over the retune/transition time), voiced gaps between
 * processed notes interpolate the offsets (the original glide shape is kept, its end
 * points move), and offsets are released over 40 ms when voicing continues past a note.
 * Bypassed notes, unvoiced frames and frames outside processed notes are NaN.
 */
export const CORRECTION_PARAMS = {
  /** Cascaded moving-average windows separating slow variation from vibrato. */
  slowVariationWindowsSeconds: [0.25, 1 / 6],
  /** Longest all-voiced gap between processed notes whose offsets are interpolated. */
  maxTransitionGapSeconds: 0.3,
  /** Offset release when voicing continues after a processed note into unprocessed audio. */
  releaseSeconds: 0.04,
} as const;

/** Fractional MIDI per frame (NaN for unvoiced frames). */
export function pitchTrackMidi(track: PitchTrack): Float64Array {
  const out = new Float64Array(track.frameCount);
  for (let i = 0; i < track.frameCount; i++) {
    const hz = track.f0Hz[i]!;
    out[i] = hz > 0 ? hzToMidi(hz) : Number.NaN;
  }
  return out;
}

function noteEditFor(doc: VocalEditDoc, segment: VocalNoteSegment): VocalNoteEdit {
  const edit = doc.noteEdits[segment.id];
  return edit === undefined ? DEFAULT_VOCAL_NOTE_EDIT : { ...DEFAULT_VOCAL_NOTE_EDIT, ...edit };
}

/** The automatic (snapped) target of a note centre. */
export function autoTargetMidi(centreMidi: number, doc: VocalEditDoc): number {
  return doc.correction.key === null
    ? Math.round(centreMidi)
    : nearestScaleNote(centreMidi, doc.correction.key);
}

interface NoteFrames {
  readonly segment: VocalNoteSegment;
  readonly edit: VocalNoteEdit;
  /** Voiced frame indices inside the note (ascending). */
  readonly voiced: number[];
}

/** Unramped offsets o(t) for the voiced frames of one note. */
function noteOffsets(
  track: PitchTrack,
  midi: Float64Array,
  note: NoteFrames,
  doc: VocalEditDoc,
): Float64Array {
  const { segment, edit, voiced } = note;
  const correction = doc.correction;
  const amount = clamp(correction.amount, 0, 1);
  const humanize = clamp(correction.humanize, 0, 1);
  const driftCorrection = clamp(edit.driftCorrection, 0, 1);
  const modulation = clamp(edit.modulationScale, 0, 2);
  const centre = segment.detectedMidi;
  const manual = edit.targetMidi !== undefined && Number.isFinite(edit.targetMidi);
  const target = manual ? edit.targetMidi! : autoTargetMidi(centre, doc);
  const delta = manual ? target - centre : amount * (target - centre);
  const flatten = amount * (1 - humanize);
  const duration = Math.max(1e-6, segment.endSeconds - segment.startSeconds);
  const mid = 0.5 * (segment.startSeconds + segment.endSeconds);
  const driftSemitones = Number.isFinite(segment.driftCents) ? segment.driftCents / 100 : 0;

  const n = voiced.length;
  const trend = new Float64Array(n);
  const deviation = new Float64Array(n);
  for (let k = 0; k < n; k++) {
    const t = track.firstFrameSeconds + voiced[k]! * track.hopSeconds;
    trend[k] = (driftSemitones * (t - mid)) / duration;
    deviation[k] = midi[voiced[k]!]! - centre - trend[k]!;
  }
  let slow: Float64Array = deviation;
  for (const seconds of CORRECTION_PARAMS.slowVariationWindowsSeconds) {
    slow = clampedMovingAverage(slow, Math.max(1, Math.round(seconds / track.hopSeconds)));
  }
  const out = new Float64Array(n);
  for (let k = 0; k < n; k++) {
    const fast = deviation[k]! - slow[k]!;
    out[k] =
      delta -
      driftCorrection * trend[k]! +
      (modulation - 1) * fast +
      (modulation * (1 - flatten) - 1) * slow[k]!;
  }
  return out;
}

/**
 * Target pitch per frame as fractional MIDI; NaN where audio is left unprocessed.
 * `segments` are normally `doc.segments`.
 */
export function computeTargetPitchCurve(
  track: PitchTrack,
  segments: readonly VocalNoteSegment[],
  doc: VocalEditDoc,
): Float32Array {
  const frames = track.frameCount;
  const target = new Float32Array(frames).fill(Number.NaN);
  if (!doc.enabled) return target;
  const midi = pitchTrackMidi(track);
  const hop = track.hopSeconds;
  const timeOf = (i: number): number => track.firstFrameSeconds + i * hop;
  const isVoiced = (i: number): boolean => i >= 0 && i < frames && Number.isFinite(midi[i]!);

  const ordered = segments
    .map((segment, index) => ({ segment, index }))
    .sort((a, b) => a.segment.startSeconds - b.segment.startSeconds || a.index - b.index)
    .map(({ segment }) => segment);

  // Frames of bypassed notes stay untouched and block interpolation/release.
  const blocked = new Uint8Array(frames);
  const notes: NoteFrames[] = [];
  for (const segment of ordered) {
    const edit = noteEditFor(doc, segment);
    const [first, end] = frameRange(track, segment.startSeconds, segment.endSeconds);
    if (edit.bypass || !Number.isFinite(segment.detectedMidi)) {
      for (let i = first; i < end; i++) blocked[i] = 1;
      continue;
    }
    const voiced: number[] = [];
    for (let i = first; i < end; i++) if (isVoiced(i)) voiced.push(i);
    if (voiced.length > 0) notes.push({ segment, edit, voiced });
  }

  const offset = new Float64Array(frames).fill(Number.NaN);
  const retuneSeconds = Math.max(0, doc.correction.retuneSpeedMs) / 1000;
  const releaseSeconds = CORRECTION_PARAMS.releaseSeconds;
  const maxGapFrames = Math.round(CORRECTION_PARAMS.maxTransitionGapSeconds / hop);

  const release = (from: number, until: number): void => {
    // Ramp the offset at frame `from` to 0 over the following voiced, unblocked frames.
    const start = offset[from]!;
    for (let i = from + 1; i < until; i++) {
      if (!isVoiced(i) || blocked[i] === 1 || !Number.isNaN(offset[i]!)) break;
      const w = smoothRamp((timeOf(i) - timeOf(from)) / releaseSeconds);
      if (w >= 1) break;
      offset[i] = start * (1 - w);
    }
  };

  let previousLast = -1;
  for (let n = 0; n < notes.length; n++) {
    const note = notes[n]!;
    const values = noteOffsets(track, midi, note, doc);
    const firstVoiced = note.voiced[0]!;
    const auto = note.edit.targetMidi === undefined || !Number.isFinite(note.edit.targetMidi);
    const transitionSeconds = Math.max(0, note.edit.transitionMs) / 1000;

    // Interpolate across an all-voiced, unblocked gap from the previous processed note.
    let gapFilled = false;
    if (previousLast >= 0 && firstVoiced - previousLast - 1 <= maxGapFrames) {
      let clean = true;
      for (let i = previousLast + 1; i < firstVoiced; i++) {
        if (!isVoiced(i) || blocked[i] === 1) {
          clean = false;
          break;
        }
      }
      if (clean) {
        const a = offset[previousLast]!;
        const b = values[0]!;
        const span = firstVoiced - previousLast;
        for (let i = previousLast + 1; i < firstVoiced; i++) {
          offset[i] = a + ((b - a) * (i - previousLast)) / span;
        }
        gapFilled = true;
      }
    }
    if (!gapFilled && previousLast >= 0) release(previousLast, firstVoiced);

    const legato = isVoiced(firstVoiced - 1);
    const before = offset[firstVoiced - 1];
    const startValue = legato && before !== undefined && Number.isFinite(before) ? before : 0;
    const rampSeconds = legato
      ? Math.max(transitionSeconds, auto ? retuneSeconds : 0)
      : auto
        ? retuneSeconds
        : 0;
    const onset = timeOf(firstVoiced);
    for (let k = 0; k < note.voiced.length; k++) {
      const i = note.voiced[k]!;
      const w = rampSeconds > 0 ? smoothRamp((timeOf(i) - onset + hop) / rampSeconds) : 1;
      offset[i] = startValue + (values[k]! - startValue) * w;
    }
    previousLast = note.voiced[note.voiced.length - 1]!;
  }
  if (previousLast >= 0) release(previousLast, frames);

  for (let i = 0; i < frames; i++) {
    const o = offset[i]!;
    if (Number.isFinite(o) && isVoiced(i)) target[i] = midi[i]! + o;
  }
  return target;
}

/** Offsets smaller than this (0.01 cent) are treated as no change. */
export const IDENTITY_EPSILON_SEMITONES = 1e-4;

/**
 * Pitch-shift ratio per frame: 2^((target − detected)/12) clamped to [0.5, 2]; exactly 1
 * where the target is NaN, the frame is unvoiced or the offset is below 0.01 cent.
 */
export function computePitchRatioCurve(track: PitchTrack, target: Float32Array): Float32Array {
  const ratio = new Float32Array(track.frameCount).fill(1);
  const n = Math.min(track.frameCount, target.length);
  for (let i = 0; i < n; i++) {
    const t = target[i]!;
    const hz = track.f0Hz[i]!;
    if (!Number.isFinite(t) || !(hz > 0)) continue;
    const semitones = t - hzToMidi(hz);
    // Offsets below 0.01 cent are float32 rounding of an identity target: keep exactly 1.
    if (Math.abs(semitones) < IDENTITY_EPSILON_SEMITONES) continue;
    ratio[i] = clamp(Math.pow(2, semitones / 12), 0.5, 2);
  }
  return ratio;
}
