/**
 * Music theory primitives: pitch classes, note names, scales and keys.
 * MIDI note 60 is displayed as C4 by default (scientific pitch notation);
 * `octaveOffset` lets the UI match vendors that call 60 "C3".
 */

export type PitchClass = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11;

export const PITCH_CLASS_NAMES_SHARP = [
  'C',
  'C#',
  'D',
  'D#',
  'E',
  'F',
  'F#',
  'G',
  'G#',
  'A',
  'A#',
  'B',
] as const;

export const PITCH_CLASS_NAMES_FLAT = [
  'C',
  'Db',
  'D',
  'Eb',
  'E',
  'F',
  'Gb',
  'G',
  'Ab',
  'A',
  'Bb',
  'B',
] as const;

export type ScaleId =
  | 'major'
  | 'naturalMinor'
  | 'harmonicMinor'
  | 'melodicMinor'
  | 'dorian'
  | 'phrygian'
  | 'lydian'
  | 'mixolydian'
  | 'locrian'
  | 'majorPentatonic'
  | 'minorPentatonic'
  | 'blues'
  | 'chromatic';

export interface ScaleDefinition {
  readonly id: ScaleId;
  readonly label: string;
  /** Semitone offsets from the tonic, ascending, starting at 0. */
  readonly intervals: readonly number[];
}

export const SCALES: Readonly<Record<ScaleId, ScaleDefinition>> = {
  major: { id: 'major', label: 'Major', intervals: [0, 2, 4, 5, 7, 9, 11] },
  naturalMinor: { id: 'naturalMinor', label: 'Minor', intervals: [0, 2, 3, 5, 7, 8, 10] },
  harmonicMinor: {
    id: 'harmonicMinor',
    label: 'Harmonic Minor',
    intervals: [0, 2, 3, 5, 7, 8, 11],
  },
  melodicMinor: { id: 'melodicMinor', label: 'Melodic Minor', intervals: [0, 2, 3, 5, 7, 9, 11] },
  dorian: { id: 'dorian', label: 'Dorian', intervals: [0, 2, 3, 5, 7, 9, 10] },
  phrygian: { id: 'phrygian', label: 'Phrygian', intervals: [0, 1, 3, 5, 7, 8, 10] },
  lydian: { id: 'lydian', label: 'Lydian', intervals: [0, 2, 4, 6, 7, 9, 11] },
  mixolydian: { id: 'mixolydian', label: 'Mixolydian', intervals: [0, 2, 4, 5, 7, 9, 10] },
  locrian: { id: 'locrian', label: 'Locrian', intervals: [0, 1, 3, 5, 6, 8, 10] },
  majorPentatonic: {
    id: 'majorPentatonic',
    label: 'Major Pentatonic',
    intervals: [0, 2, 4, 7, 9],
  },
  minorPentatonic: {
    id: 'minorPentatonic',
    label: 'Minor Pentatonic',
    intervals: [0, 3, 5, 7, 10],
  },
  blues: { id: 'blues', label: 'Blues', intervals: [0, 3, 5, 6, 7, 10] },
  chromatic: {
    id: 'chromatic',
    label: 'Chromatic',
    intervals: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
  },
};

export interface MusicalKey {
  readonly tonic: PitchClass;
  readonly scale: ScaleId;
}

export const A4_MIDI = 69;
export const A4_HZ = 440;

export function toPitchClass(midi: number): PitchClass {
  return (((Math.round(midi) % 12) + 12) % 12) as PitchClass;
}

export function midiToFrequency(midi: number, a4Hz: number = A4_HZ): number {
  return a4Hz * Math.pow(2, (midi - A4_MIDI) / 12);
}

/** Fractional MIDI pitch for a frequency; returns NaN for non-positive input. */
export function frequencyToMidi(hz: number, a4Hz: number = A4_HZ): number {
  if (!(hz > 0)) return Number.NaN;
  return A4_MIDI + 12 * Math.log2(hz / a4Hz);
}

export function centsBetween(fromMidi: number, toMidi: number): number {
  return (toMidi - fromMidi) * 100;
}

export interface NoteNameOptions {
  readonly preferFlats?: boolean;
  /** Octave number assigned to MIDI 60. Default 4 (C4). */
  readonly middleCOctave?: number;
}

export function midiToNoteName(midi: number, options: NoteNameOptions = {}): string {
  const rounded = Math.round(midi);
  const names = options.preferFlats ? PITCH_CLASS_NAMES_FLAT : PITCH_CLASS_NAMES_SHARP;
  const middleCOctave = options.middleCOctave ?? 4;
  const octave = Math.floor(rounded / 12) - 5 + middleCOctave;
  return `${names[toPitchClass(rounded)]}${octave}`;
}

export function pitchClassName(pc: PitchClass, preferFlats = false): string {
  return (preferFlats ? PITCH_CLASS_NAMES_FLAT : PITCH_CLASS_NAMES_SHARP)[pc];
}

export function keyLabel(key: MusicalKey, preferFlats = false): string {
  return `${pitchClassName(key.tonic, preferFlats)} ${SCALES[key.scale].label}`;
}

export function scalePitchClasses(key: MusicalKey): ReadonlySet<PitchClass> {
  return new Set(SCALES[key.scale].intervals.map((i) => toPitchClass(key.tonic + i)));
}

export function isInScale(midi: number, key: MusicalKey): boolean {
  return scalePitchClasses(key).has(toPitchClass(midi));
}

/**
 * Nearest in-scale MIDI note to a (fractional) pitch. Ties resolve downward so
 * results are deterministic.
 */
export function nearestScaleNote(midi: number, key: MusicalKey): number {
  const pcs = scalePitchClasses(key);
  const base = Math.round(midi);
  let best = base;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let candidate = base - 6; candidate <= base + 6; candidate++) {
    if (!pcs.has(toPitchClass(candidate))) continue;
    const distance = Math.abs(candidate - midi);
    if (distance < bestDistance - 1e-9) {
      best = candidate;
      bestDistance = distance;
    }
  }
  return best;
}

/** Relative major/minor partner of a key (e.g. A minor ↔ C major); undefined for modes. */
export function relativeKey(key: MusicalKey): MusicalKey | undefined {
  if (key.scale === 'major') return { tonic: toPitchClass(key.tonic + 9), scale: 'naturalMinor' };
  if (key.scale === 'naturalMinor') return { tonic: toPitchClass(key.tonic + 3), scale: 'major' };
  return undefined;
}
