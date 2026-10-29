import { type TimedNote } from './f0';

/**
 * Note sequences in known keys for key-estimation tests. All tunes are traditional or
 * long in the public domain; they are transcribed from memory as plain pitch/duration
 * lists (single voice, no harmony), which is exactly what a vocal analysis delivers.
 *
 * Notation for `parseMelody`: space-separated tokens `<Name><accidental?><octave>[:beats]`
 * (e.g. `F#4:1.5`, `Bb3`), `R[:beats]` for rests and `|` as an ignored bar line.
 * Default duration is one beat. MIDI 60 = C4.
 */
export type FixturePitchClass = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11;
export type FixtureMode = 'major' | 'naturalMinor';

export interface FixtureKey {
  readonly tonic: FixturePitchClass;
  readonly scale: FixtureMode;
}

export interface MelodyNote {
  /** MIDI pitch, or null for a rest. */
  readonly midi: number | null;
  readonly beats: number;
}

export interface KnownMelody {
  readonly name: string;
  readonly key: FixtureKey;
  readonly notes: readonly MelodyNote[];
  /** Why the label is what it is, and anything that makes the case hard. */
  readonly note?: string;
}

const LETTER_PC: Readonly<Record<string, number>> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

export function parseMelody(text: string): MelodyNote[] {
  const notes: MelodyNote[] = [];
  for (const token of text.trim().split(/\s+/)) {
    if (token === '|' || token === '') continue;
    const [name, beatText] = token.split(':') as [string, string | undefined];
    const beats = beatText === undefined ? 1 : Number(beatText);
    if (!(beats > 0)) throw new RangeError(`bad duration in ${token}`);
    if (name === 'R') {
      notes.push({ midi: null, beats });
      continue;
    }
    const match = /^([A-G])(#|b)?(-?\d)$/.exec(name);
    if (match === null) throw new RangeError(`bad note ${token}`);
    const pc = LETTER_PC[match[1]!]! + (match[2] === '#' ? 1 : match[2] === 'b' ? -1 : 0);
    notes.push({ midi: 12 * (Number(match[3]) + 1) + pc, beats });
  }
  return notes;
}

const key = (tonic: FixturePitchClass, scale: FixtureMode): FixtureKey => ({ tonic, scale });

const C = 0;
const D = 2;
const E = 4;
const F = 5;
const G = 7;
const A = 9;
const Bb = 10;
const B = 11;

const melody = (name: string, k: FixtureKey, text: string, note?: string): KnownMelody => ({
  name,
  key: k,
  notes: parseMelody(text),
  ...(note !== undefined ? { note } : {}),
});

export const KNOWN_MELODIES: readonly KnownMelody[] = [
  melody(
    'Twinkle, Twinkle, Little Star',
    key(C, 'major'),
    'C4 C4 G4 G4 A4 A4 G4:2 F4 F4 E4 E4 D4 D4 C4:2 G4 G4 F4 F4 E4 E4 D4:2 G4 G4 F4 F4 E4 E4 D4:2 C4 C4 G4 G4 A4 A4 G4:2 F4 F4 E4 E4 D4 D4 C4:2',
  ),
  melody(
    'Ode to Joy',
    key(D, 'major'),
    'F#4 F#4 G4 A4 A4 G4 F#4 E4 D4 D4 E4 F#4 F#4:1.5 E4:0.5 E4:2 F#4 F#4 G4 A4 A4 G4 F#4 E4 D4 D4 E4 F#4 E4:1.5 D4:0.5 D4:2 E4 E4 F#4 D4 E4 F#4:0.5 G4:0.5 F#4 D4 E4 F#4:0.5 G4:0.5 F#4 E4 D4 E4 A3:2 F#4 F#4 G4 A4 A4 G4 F#4 E4 D4 D4 E4 F#4 E4:1.5 D4:0.5 D4:2',
  ),
  melody(
    'Frère Jacques',
    key(F, 'major'),
    'F4 G4 A4 F4 F4 G4 A4 F4 A4 Bb4 C5:2 A4 Bb4 C5:2 C5:0.75 D5:0.25 C5:0.5 Bb4:0.5 A4 F4 C5:0.75 D5:0.25 C5:0.5 Bb4:0.5 A4 F4 F4 C4 F4:2 F4 C4 F4:2',
  ),
  melody(
    'Mary Had a Little Lamb',
    key(C, 'major'),
    'E4 D4 C4 D4 E4 E4 E4:2 D4 D4 D4:2 E4 G4 G4:2 E4 D4 C4 D4 E4 E4 E4 E4 D4 D4 E4 D4 C4:4',
  ),
  melody(
    'Amazing Grace',
    key(G, 'major'),
    'D4 G4:2 B4:0.5 G4:0.5 B4:2 A4 G4:2 E4 D4:2 D4 G4:2 B4:0.5 G4:0.5 B4:2 A4 D5:3 D5:2 B4 D5:1.5 B4:0.5 D5:0.5 B4:0.5 G4:2 D4 E4:1.5 G4:0.5 G4:0.5 E4:0.5 D4:2 D4 G4:2 B4:0.5 G4:0.5 B4:2 A4 G4:3',
    'Pentatonic: no C or F#, so G major vs E minor is decided by tonal weighting alone.',
  ),
  melody(
    'Joy to the World',
    key(D, 'major'),
    'D5:2 C#5:1.5 B4:0.5 A4:3 G4 F#4:2 E4:2 D4:3 A4 B4:3 B4 C#5:3 C#5 D5:3 D5 D5 C#5 B4 A4 A4:1.5 G4:0.5 F#4 D5 D5 C#5 B4 A4 A4:1.5 G4:0.5 F#4 F#4 F#4 F#4 F#4 F#4:0.5 G4:0.5 A4:3 G4:0.5 F#4:0.5 E4 E4 E4 E4:0.5 F#4:0.5 G4:3 F#4:0.5 E4:0.5 D4 D5:2 B4 A4:1.5 G4:0.5 F#4 G4 F#4:2 E4:2 D4:4',
  ),
  melody(
    'When the Saints Go Marching In',
    key(C, 'major'),
    'C4 E4 F4 G4:4 C4 E4 F4 G4:4 C4 E4 F4 G4:2 E4:2 C4:2 E4:2 D4:4 E4 E4 D4 C4:3 C4 E4:2 G4:2 G4 F4:3 E4 F4 G4:2 E4:2 C4:2 D4:2 C4:4',
  ),
  melody(
    'Auld Lang Syne',
    key(F, 'major'),
    'C4 F4:1.5 F4:0.5 F4 A4 G4:1.5 F4:0.5 G4 A4:0.5 G4:0.5 F4:1.5 F4:0.5 A4 C5 D5:3 D5 C5:1.5 A4:0.5 A4 F4 G4:1.5 F4:0.5 G4 A4:0.5 G4:0.5 F4:1.5 D4:0.5 D4 C4 F4:3',
    'Pentatonic (no Bb or E): F major vs D minor relies on tonic weighting.',
  ),
  melody(
    'Jingle Bells (chorus)',
    key(G, 'major'),
    'B4 B4 B4:2 B4 B4 B4:2 B4 D5 G4:1.5 A4:0.5 B4:4 C5 C5 C5:1.5 C5:0.5 C5 B4 B4 B4:0.5 B4:0.5 B4 A4 A4 B4 A4:2 D5:2 B4 B4 B4:2 B4 B4 B4:2 B4 D5 G4:1.5 A4:0.5 B4:4 C5 C5 C5:1.5 C5:0.5 C5 B4 B4 B4:0.5 B4:0.5 D5 D5 C5 A4 G4:4',
    'Dwells on the third (B), a classic trap for E minor.',
  ),
  melody(
    'Silent Night',
    key(C, 'major'),
    'G4:1.5 A4:0.5 G4 E4:3 G4:1.5 A4:0.5 G4 E4:3 D5:2 D5 B4:3 C5:2 C5 G4:3 A4:2 A4 C5:1.5 B4:0.5 A4 G4:1.5 A4:0.5 G4 E4:3 A4:2 A4 C5:1.5 B4:0.5 A4 G4:1.5 A4:0.5 G4 E4:3 D5:2 D5 F5:1.5 D5:0.5 B4 C5:3 E5:3 C5:1.5 G4:0.5 E4 G4:1.5 F4:0.5 D4 C4:6',
  ),
  melody(
    'Good Morning to All',
    key(C, 'major'),
    'G4:0.75 G4:0.25 A4 G4 C5 B4:2 G4:0.75 G4:0.25 A4 G4 D5 C5:2 G4:0.75 G4:0.25 G5 E5 C5 B4 A4 F5:0.75 F5:0.25 E5 C5 D5 C5:2',
  ),
  melody(
    'Minuet in G (Petzold)',
    key(G, 'major'),
    'D5 G4:0.5 A4:0.5 B4:0.5 C5:0.5 D5 G4 G4 E5 C5:0.5 D5:0.5 E5:0.5 F#5:0.5 G5 G4 G4 C5 D5:0.5 C5:0.5 B4:0.5 A4:0.5 B4 C5:0.5 B4:0.5 A4:0.5 G4:0.5 F#4 G4:0.5 A4:0.5 B4:0.5 G4:0.5 B4 A4:3 D5 G4:0.5 A4:0.5 B4:0.5 C5:0.5 D5 G4 G4 E5 C5:0.5 D5:0.5 E5:0.5 F#5:0.5 G5 G4 G4 C5 D5:0.5 C5:0.5 B4:0.5 A4:0.5 B4 C5:0.5 B4:0.5 A4:0.5 G4:0.5 A4 B4:0.5 A4:0.5 G4:0.5 F#4:0.5 G4:3',
  ),
  melody(
    'Yankee Doodle',
    key(G, 'major'),
    'G4 G4 A4 B4 G4 B4 A4 D4 G4 G4 A4 B4 G4:2 F#4:2 G4 G4 A4 B4 C5 B4 A4 G4 F#4 D4 E4 F#4 G4:2 G4:2',
  ),
  melody(
    'Wiegenlied (Brahms)',
    key(C, 'major'),
    'E4:0.5 E4:0.5 G4:2 E4:0.5 E4:0.5 G4:2 E4:0.5 G4:0.5 C5 B4:1.5 A4:0.5 A4 G4 D4:0.5 E4:0.5 F4 D4 D4:0.5 E4:0.5 F4:2 D4:0.5 F4:0.5 B4:0.5 A4:0.5 G4 B4 C5:2 C4:0.5 C4:0.5 C5:2 A4:0.5 F4:0.5 G4:2 E4:0.5 C4:0.5 F4 G4 A4 G4:2 C4:0.5 C4:0.5 C5:2 A4:0.5 F4:0.5 G4:2 E4:0.5 C4:0.5 F4 E4 D4 C4:3',
  ),
  melody(
    'Morning Mood (Grieg)',
    key(E, 'major'),
    'G#5 E5 C#5 B4 C#5 E5 G#5 E5 C#5 B4 C#5:0.5 E5:0.5 C#5:0.5 E5:0.5 G#5 E5 G#5 B5 G#5 E5 G#5 E5 C#5 B4 B4:3 E5:4',
    'Pentatonic line that circles the third; adversarial for C# minor.',
  ),
  melody(
    'Canon in D (upper line)',
    key(D, 'major'),
    'F#5:2 E5:2 D5:2 C#5:2 B4:2 A4:2 B4:2 C#5:2 D5:2 C#5:2 B4:2 A4:2 G4:2 F#4:2 G4:2 E4:2 D4:4',
  ),
  melody(
    'La Cucaracha',
    key(F, 'major'),
    'C4:0.5 C4:0.5 C4:0.5 F4:1.5 A4:0.5 C4:0.5 C4:0.5 C4:0.5 F4:1.5 A4:1 F4 F4:0.5 E4:0.5 E4:0.5 D4:0.5 D4:0.5 C4:2 C4:0.5 C4:0.5 C4:0.5 E4:1.5 G4:0.5 C4:0.5 C4:0.5 C4:0.5 E4:1.5 G4:1 C5 D5:0.5 C5:0.5 Bb4:0.5 A4:0.5 G4:0.5 F4:2',
  ),
  melody(
    'Oh! Susanna',
    key(C, 'major'),
    'C4:0.5 D4:0.5 E4 G4 G4:1.5 A4:0.5 G4 E4 C4:1.5 D4:0.5 E4 E4 D4 C4 D4:3 C4:0.5 D4:0.5 E4 G4 G4:1.5 A4:0.5 G4 E4 C4:1.5 D4:0.5 E4 E4 D4 D4 C4:4',
  ),
  melody(
    'Old MacDonald',
    key(G, 'major'),
    'G4 G4 G4 D4 E4 E4 D4:2 B4 B4 A4 A4 G4:3 D4 G4 G4 G4 D4 E4 E4 D4:2 B4 B4 A4 A4 G4:3',
  ),
  melody(
    'Row, Row, Row Your Boat',
    key(C, 'major'),
    'C4:1.5 C4:1.5 C4 D4:0.5 E4:1.5 E4 D4:0.5 E4 F4:0.5 G4:3 C5:0.5 C5:0.5 C5:0.5 G4:0.5 G4:0.5 G4:0.5 E4:0.5 E4:0.5 E4:0.5 C4:0.5 C4:0.5 C4:0.5 G4 F4:0.5 E4 D4:0.5 C4:3',
  ),
  melody(
    'Für Elise (opening)',
    key(A, 'naturalMinor'),
    'E5:0.5 D#5:0.5 E5:0.5 D#5:0.5 E5:0.5 B4:0.5 D5:0.5 C5:0.5 A4:1.5 C4:0.5 E4:0.5 A4:0.5 B4:1.5 E4:0.5 G#4:0.5 B4:0.5 C5:1.5 E4:0.5 E5:0.5 D#5:0.5 E5:0.5 D#5:0.5 E5:0.5 B4:0.5 D5:0.5 C5:0.5 A4:1.5 C4:0.5 E4:0.5 A4:0.5 B4:1.5 E4:0.5 C5:0.5 B4:0.5 A4:3',
    'Minor with raised leading tone (G#) and chromatic D#.',
  ),
  melody(
    'Korobeiniki',
    key(A, 'naturalMinor'),
    'E5 B4:0.5 C5:0.5 D5 C5:0.5 B4:0.5 A4 A4:0.5 C5:0.5 E5 D5:0.5 C5:0.5 B4:1.5 C5:0.5 D5 E5 C5 A4 A4:2 D5:1.5 F5:0.5 A5 G5:0.5 F5:0.5 E5:1.5 C5:0.5 E5 D5:0.5 C5:0.5 B4 B4:0.5 C5:0.5 D5 E5 C5 A4 A4:2',
  ),
  melody(
    'God Rest You Merry, Gentlemen',
    key(E, 'naturalMinor'),
    'E4 E4 B4 B4 A4 G4 F#4 E4 D4 E4 F#4 G4 A4 B4:3 E4 E4 B4 B4 A4 G4 F#4 E4 D4 E4 F#4 G4 A4 B4:3 B4 C5 A4 B4 C5 D5 E5 B4 A4 G4 E4 F#4 G4 A4:2 G4 A4 B4:2 C5 B4 B4 A4 G4 F#4 E4:2 G4:0.5 F#4:0.5 E4 A4:2 G4 A4 B4 C5 D5 E5 B4 A4 G4 F#4 E4:3',
  ),
  melody(
    'Greensleeves',
    key(A, 'naturalMinor'),
    'A4 C5:2 D5 E5:1.5 F5:0.5 E5 D5:2 B4 G4:1.5 A4:0.5 B4 C5:2 A4 A4:1.5 G#4:0.5 A4 B4:2 G#4 E4:2 A4 C5:2 D5 E5:1.5 F5:0.5 E5 D5:2 B4 G4:1.5 A4:0.5 B4 C5:1.5 B4:0.5 A4 G#4:1.5 F#4:0.5 G#4 A4:3',
    'Mixes natural, dorian (F#) and harmonic (G#) colours.',
  ),
  melody(
    'Minuet in G minor (Petzold)',
    key(G, 'naturalMinor'),
    'D5 Bb4:0.5 C5:0.5 D5:0.5 Bb4:0.5 A4 D4 G4:0.5 A4:0.5 Bb4:0.5 G4:0.5 F#4 D4 G4:0.5 A4:0.5 Bb4:0.5 G4:0.5 C5 Bb4:0.5 A4:0.5 Bb4:0.5 G4:0.5 A4 F#4:0.5 E4:0.5 F#4:0.5 D4:0.5 G4:3',
    'Raised sixth and seventh (E, F#) in the melodic-minor style.',
  ),
  melody(
    'Swan Lake (theme)',
    key(B, 'naturalMinor'),
    'F#5:4 B4 C#5 D5 E5 F#5:3 D5 F#5:3 D5 F#5:3 B4 D5 B4 G4 D5 B4:4 F#5:4 B4 C#5 D5 E5 F#5:3 D5 F#5:3 D5 F#5:3 B4 D5 B4 G4 D5 B4:4',
  ),
  melody(
    'In the Hall of the Mountain King',
    key(B, 'naturalMinor'),
    'B3:0.5 C#4:0.5 D4:0.5 E4:0.5 F#4:0.5 D4:0.5 F#4 F4:0.5 C#4:0.5 F4 E4:0.5 C4:0.5 E4 B3:0.5 C#4:0.5 D4:0.5 E4:0.5 F#4:0.5 D4:0.5 F#4:0.5 B4:0.5 A4:0.5 F#4:0.5 D4:0.5 F#4:0.5 A4:2',
    'Chromatic inflections (F natural, C natural) and a short excerpt.',
  ),
  melody(
    'Symphony No. 40 (Mozart, opening)',
    key(G, 'naturalMinor'),
    'Eb5:0.5 D5:0.5 D5 Eb5:0.5 D5:0.5 D5 Eb5:0.5 D5:0.5 D5 Bb5:2 Bb5:0.5 A5:0.5 G5 G5:0.5 F5:0.5 Eb5 Eb5:0.5 D5:0.5 C5 C5:2 D5:0.5 C5:0.5 C5 D5:0.5 C5:0.5 C5 D5:0.5 C5:0.5 C5 A5:2 A5:0.5 G5:0.5 F#5 F#5:0.5 Eb5:0.5 D5 D5:0.5 C5:0.5 Bb4 Bb4:2',
    'Dwells on the dominant (D) and never states the tonic; genuinely hard.',
  ),
  melody(
    'Funeral March (Chopin)',
    key(Bb, 'naturalMinor'),
    'Bb3:1.5 Bb3:0.5 Bb3 Bb3:1.5 Bb3:0.5 Db4:1.5 C4:0.5 C4:1.5 Bb3:0.5 Bb3:1.5 A3:0.5 Bb3:4 Bb3:1.5 Bb3:0.5 Bb3 Bb3:1.5 Bb3:0.5 Db4:1.5 C4:0.5 C4:1.5 Bb3:0.5 Bb3:1.5 A3:0.5 Bb3:4',
    'Very few pitch classes (Bb, C, Db, A); tests the evidence-shrinkage rule.',
  ),
];

/** Modal/pentatonic tunes whose "key" is not a major/minor key; used for ambiguity tests only. */
export const MODAL_MELODIES: readonly (KnownMelody & { readonly mode: string })[] = [
  {
    ...melody(
      'Scarborough Fair',
      key(D, 'naturalMinor'),
      'D4:2 D4 A4:2 A4 E4:1.5 F4:0.5 E4 D4:3 A4 C5:2 D5 C5:2 A4 B4 G4 A4 R:3 D5:2 D5 D5:2 C5 A4 A4 G4 F4 E4 C4:2 D4:2 A4 G4 F4:2 E4 D4:3',
    ),
    mode: 'D dorian (B natural); closest major/minor label: D minor',
  },
  {
    ...melody(
      'Drunken Sailor',
      key(D, 'naturalMinor'),
      'A4 A4 A4:0.5 A4:0.5 A4 D4 F4 A4 G4 G4 G4:0.5 G4:0.5 G4 C4 E4 G4 A4 A4 A4:0.5 A4:0.5 A4 B4 C5 D5 C5 A4 G4 E4 D4:2 D4:2',
    ),
    mode: 'D dorian; strong C major implication in bar 2',
  },
];

export interface MelodyTimingOptions {
  readonly bpm?: number;
  readonly startSeconds?: number;
  readonly transpose?: number;
  /** Fraction of each note's duration that sounds (default 1 = legato). */
  readonly articulation?: number;
}

/** Converts beats to seconds (rests advance time but produce no note). */
export function melodyToTimedNotes(
  notes: readonly MelodyNote[],
  options: MelodyTimingOptions = {},
): TimedNote[] {
  const secondsPerBeat = 60 / (options.bpm ?? 120);
  const articulation = options.articulation ?? 1;
  const out: TimedNote[] = [];
  let t = options.startSeconds ?? 0;
  for (const note of notes) {
    const duration = note.beats * secondsPerBeat;
    if (note.midi !== null) {
      out.push({
        midi: note.midi + (options.transpose ?? 0),
        startSeconds: t,
        durationSeconds: duration * articulation,
      });
    }
    t += duration;
  }
  return out;
}

/** Duration-weighted notes for key estimators (`weight` = beats). */
export function melodyWeights(
  melodyNotes: readonly MelodyNote[],
  transpose = 0,
): { midi: number; weight: number }[] {
  return melodyNotes
    .filter((n): n is MelodyNote & { midi: number } => n.midi !== null)
    .map((n) => ({ midi: n.midi + transpose, weight: n.beats }));
}

export function transposeKey(k: FixtureKey, semitones: number): FixtureKey {
  return { tonic: ((((k.tonic + semitones) % 12) + 12) % 12) as FixturePitchClass, scale: k.scale };
}
