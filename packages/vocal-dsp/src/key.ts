import { type KeyCandidate, type PitchClass, type VocalNoteSegment } from '@studio/domain';

/**
 * Key estimation by profile matching on duration-weighted pitch classes (research §4.2):
 * an ensemble of the Aarden–Essen profile (Pearson correlation) and the
 * Albrecht–Shanahan profile (negative Euclidean distance). Each model's 24 scores are
 * z-normalised, averaged and turned into probabilities by a temperature softmax whose
 * temperature was fitted on KNOWN_MELODIES (maximum likelihood; see docs).
 * Thin evidence shrinks all confidences (sum < 1): the missing mass means "no
 * confident key". Works for vocal note segments and for MIDI notes alike.
 */

// Aarden–Essen (melodic folk corpus); values as published in music21 (BSD-3).
const AARDEN_MAJOR = [
  17.7661, 0.145624, 14.9265, 0.160186, 19.8049, 11.3587, 0.291248, 22.062, 0.145624, 8.15494,
  0.232998, 4.95122,
];
const AARDEN_MINOR = [
  18.2648, 0.737619, 14.0499, 16.8599, 0.702494, 14.4362, 0.702494, 18.6161, 4.56621, 1.93186,
  7.37619, 1.75623,
];
// Albrecht & Shanahan (2013); values as published in AMADS (MIT).
const ALBRECHT_MAJOR = [
  0.238, 0.006, 0.111, 0.006, 0.137, 0.094, 0.016, 0.214, 0.009, 0.08, 0.008, 0.081,
];
const ALBRECHT_MINOR = [
  0.22, 0.006, 0.104, 0.123, 0.019, 0.103, 0.012, 0.214, 0.062, 0.022, 0.061, 0.052,
];

/**
 * Softmax temperature over averaged z-scores. The maximum-likelihood value on
 * KNOWN_MELODIES is 0.10 (in-sample NLL 0.118); 0.15 (NLL 0.141, mean top-1 confidence
 * 0.92 at 93 % top-1 accuracy) leaves headroom for noisier vocal note input. See docs.
 */
export const KEY_SOFTMAX_TEMPERATURE = 0.15;
/** Maximum number of candidates returned. */
export const KEY_MAX_CANDIDATES = 6;
/** Evidence needed for unshrunk confidences. */
export const KEY_FULL_EVIDENCE_NOTES = 12;
export const KEY_FULL_EVIDENCE_PITCH_CLASSES = 5;
/** Notes shorter than this are ignored by `keyCandidatesFromSegments`. */
export const KEY_MIN_SEGMENT_SECONDS = 0.08;

export interface KeyNote {
  /** Fractional or integer MIDI pitch. */
  readonly midi: number;
  /** Non-negative weight, e.g. duration (any consistent unit). */
  readonly weight: number;
}

export interface KeyScore {
  readonly tonic: PitchClass;
  readonly scale: 'major' | 'naturalMinor';
  /** Averaged z-score (higher = better). */
  readonly score: number;
}

function normalise(profile: readonly number[]): number[] {
  const total = profile.reduce((a, b) => a + b, 0);
  return profile.map((v) => v / total);
}

const PROFILES = {
  aardenMajor: normalise(AARDEN_MAJOR),
  aardenMinor: normalise(AARDEN_MINOR),
  albrechtMajor: ALBRECHT_MAJOR,
  albrechtMinor: ALBRECHT_MINOR,
};

function pearson(histogram: readonly number[], profile: readonly number[], tonic: number): number {
  let mh = 0;
  let mp = 0;
  for (let i = 0; i < 12; i++) {
    mh += histogram[i]!;
    mp += profile[i]!;
  }
  mh /= 12;
  mp /= 12;
  let num = 0;
  let dh = 0;
  let dp = 0;
  for (let i = 0; i < 12; i++) {
    const h = histogram[(i + tonic) % 12]! - mh;
    const p = profile[i]! - mp;
    num += h * p;
    dh += h * h;
    dp += p * p;
  }
  return dh > 0 && dp > 0 ? num / Math.sqrt(dh * dp) : 0;
}

function euclidean(
  histogram: readonly number[],
  profile: readonly number[],
  tonic: number,
): number {
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    const d = histogram[(i + tonic) % 12]! - profile[i]!;
    sum += d * d;
  }
  return Math.sqrt(sum);
}

function zScores(values: readonly number[]): number[] {
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length;
  const sd = Math.sqrt(variance);
  return values.map((v) => (sd > 0 ? (v - mean) / sd : 0));
}

/**
 * Global tuning offset in semitones (−0.5..0.5): weighted circular mean of the
 * fractional part. Integer (MIDI) input yields 0.
 */
export function estimateTuningOffset(notes: readonly KeyNote[]): number {
  let x = 0;
  let y = 0;
  for (const note of notes) {
    if (!(note.weight > 0) || !Number.isFinite(note.midi)) continue;
    const angle = 2 * Math.PI * (note.midi - Math.round(note.midi));
    x += note.weight * Math.cos(angle);
    y += note.weight * Math.sin(angle);
  }
  if (Math.hypot(x, y) < 1e-12) return 0;
  const offset = Math.atan2(y, x) / (2 * Math.PI);
  return Math.abs(offset) < 1e-9 ? 0 : offset;
}

/** Duration-weighted pitch-class histogram (sums to 1, or all zeros). */
export function pitchClassHistogram(notes: readonly KeyNote[]): number[] {
  const tuning = estimateTuningOffset(notes);
  const histogram = new Array<number>(12).fill(0);
  let total = 0;
  for (const note of notes) {
    if (!(note.weight > 0) || !Number.isFinite(note.midi)) continue;
    const pc = (((Math.round(note.midi - tuning) % 12) + 12) % 12) as PitchClass;
    histogram[pc] = histogram[pc]! + note.weight;
    total += note.weight;
  }
  return total > 0 ? histogram.map((v) => v / total) : histogram;
}

/** Averaged z-scores for all 24 major/minor keys (C major, C minor, C# major, …). */
export function scoreKeys(histogram: readonly number[]): KeyScore[] {
  const aarden: number[] = [];
  const albrecht: number[] = [];
  for (let tonic = 0; tonic < 12; tonic++) {
    aarden.push(pearson(histogram, PROFILES.aardenMajor, tonic));
    aarden.push(pearson(histogram, PROFILES.aardenMinor, tonic));
    albrecht.push(-euclidean(histogram, PROFILES.albrechtMajor, tonic));
    albrecht.push(-euclidean(histogram, PROFILES.albrechtMinor, tonic));
  }
  const za = zScores(aarden);
  const zb = zScores(albrecht);
  const scores: KeyScore[] = [];
  for (let k = 0; k < 24; k++) {
    scores.push({
      tonic: (k >> 1) as PitchClass,
      scale: k % 2 === 0 ? 'major' : 'naturalMinor',
      score: 0.5 * (za[k]! + zb[k]!),
    });
  }
  return scores;
}

/**
 * Ranked key candidates (best first, at most KEY_MAX_CANDIDATES, confidences sum ≤ 1).
 * Returns [] when there is no usable note.
 */
export function estimateKey(notes: ReadonlyArray<KeyNote>): KeyCandidate[] {
  const usable = notes.filter((n) => n.weight > 0 && Number.isFinite(n.midi));
  if (usable.length === 0) return [];
  const histogram = pitchClassHistogram(usable);
  const scores = scoreKeys(histogram);
  const max = Math.max(...scores.map((s) => s.score));
  const exp = scores.map((s) => Math.exp((s.score - max) / KEY_SOFTMAX_TEMPERATURE));
  const total = exp.reduce((a, b) => a + b, 0);
  const distinct = histogram.filter((v) => v > 0).length;
  const evidence =
    Math.min(1, usable.length / KEY_FULL_EVIDENCE_NOTES) *
    Math.min(1, distinct / KEY_FULL_EVIDENCE_PITCH_CLASSES);
  const ranked = scores
    .map((s, index) => ({ s, p: (exp[index]! / total) * evidence, index }))
    // Stable, deterministic: by probability, then by index (C major first).
    .sort((a, b) => b.p - a.p || a.index - b.index);
  return ranked.slice(0, KEY_MAX_CANDIDATES).map(({ s, p }) => ({
    key: { tonic: s.tonic, scale: s.scale },
    confidence: p,
  }));
}

/** Key candidates from analysed notes (weight = duration × confidence; notes < 80 ms ignored). */
export function keyCandidatesFromSegments(segments: readonly VocalNoteSegment[]): KeyCandidate[] {
  return estimateKey(
    segments
      .filter((s) => s.endSeconds - s.startSeconds >= KEY_MIN_SEGMENT_SECONDS)
      .map((s) => ({
        midi: s.detectedMidi,
        weight: (s.endSeconds - s.startSeconds) * Math.max(0.05, s.confidence),
      })),
  );
}
