/**
 * Music helpers for tools: pitch names, chord symbols, scale/key parsing, key estimation and
 * the drum-kit voice map. Pure functions so they are easy to test and reuse.
 */
import { drumKindForNote } from '@studio/audio-dsp';
import {
  midiToNoteName,
  SCALES,
  scalePitchClasses,
  toPitchClass,
  type MusicalKey,
  type PitchClass,
  type ScaleId,
} from '@studio/domain';
import { ToolInputError } from './registry';

const LETTER_PC: Record<string, number> = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };

function accidentalOffset(acc: string): number {
  let offset = 0;
  for (const ch of acc) {
    if (ch === '#' || ch === '♯') offset += 1;
    else if (ch === 'b' || ch === '♭') offset -= 1;
  }
  return offset;
}

/** Pitch class of a note letter with optional accidentals ("C", "F#", "Bb"), or undefined. */
export function parsePitchClass(text: string): PitchClass | undefined {
  const m = /^([A-Ga-g])([#b♯♭]{0,2})$/.exec(text.trim());
  if (!m) return undefined;
  return toPitchClass(LETTER_PC[m[1]!.toLowerCase()]! + accidentalOffset(m[2]!));
}

/**
 * Parses a pitch given as a MIDI number (0-127) or a note name such as "C4", "F#3", "Bb2"
 * (scientific pitch notation, C4 = 60). Throws a ToolInputError the model can act on.
 */
export function parsePitch(value: unknown, path = 'pitch'): number {
  if (typeof value === 'number') {
    if (!Number.isInteger(value) || value < 0 || value > 127)
      throw new ToolInputError(`${path} must be a MIDI number 0-127 or a name like "C4"`);
    return value;
  }
  if (typeof value === 'string') {
    const text = value.trim();
    if (/^\d{1,3}$/.test(text)) return parsePitch(Number(text), path);
    const m = /^([A-Ga-g])([#b♯♭]{0,2})(-?\d)$/.exec(text);
    if (m) {
      const midi =
        (Number(m[3]) + 1) * 12 + LETTER_PC[m[1]!.toLowerCase()]! + accidentalOffset(m[2]!);
      if (midi >= 0 && midi <= 127) return midi;
      throw new ToolInputError(`${path} "${value}" is outside the MIDI range (C-1 to G9)`);
    }
  }
  throw new ToolInputError(
    `${path} must be a MIDI number 0-127 or a note name like "C4", "F#3" or "Bb2" (C4 = 60); got ${JSON.stringify(value)}`,
  );
}

export function noteName(midi: number): string {
  return midiToNoteName(midi);
}

// ---------------------------------------------------------------------------
// Chords
// ---------------------------------------------------------------------------

/** Chord qualities (suffix after the root) and their intervals in semitones. */
const CHORD_QUALITIES: Readonly<Record<string, readonly number[]>> = {
  '': [0, 4, 7],
  maj: [0, 4, 7],
  M: [0, 4, 7],
  m: [0, 3, 7],
  min: [0, 3, 7],
  '-': [0, 3, 7],
  '5': [0, 7],
  '6': [0, 4, 7, 9],
  m6: [0, 3, 7, 9],
  '7': [0, 4, 7, 10],
  maj7: [0, 4, 7, 11],
  M7: [0, 4, 7, 11],
  m7: [0, 3, 7, 10],
  min7: [0, 3, 7, 10],
  '-7': [0, 3, 7, 10],
  mmaj7: [0, 3, 7, 11],
  mM7: [0, 3, 7, 11],
  dim: [0, 3, 6],
  dim7: [0, 3, 6, 9],
  m7b5: [0, 3, 6, 10],
  aug: [0, 4, 8],
  '+': [0, 4, 8],
  sus2: [0, 2, 7],
  sus4: [0, 5, 7],
  sus: [0, 5, 7],
  '7sus4': [0, 5, 7, 10],
  add9: [0, 4, 7, 14],
  madd9: [0, 3, 7, 14],
  '9': [0, 4, 7, 10, 14],
  m9: [0, 3, 7, 10, 14],
  maj9: [0, 4, 7, 11, 14],
};

export interface ParsedChord {
  readonly symbol: string;
  readonly root: PitchClass;
  readonly intervals: readonly number[];
  /** Slash-chord bass note pitch class (e.g. "C/E"), else the root. */
  readonly bass: PitchClass;
}

export function parseChord(symbol: string): ParsedChord {
  const m = /^([A-G])([#b♯♭]?)([^/]*)(?:\/([A-G][#b♯♭]?))?$/.exec(symbol.trim());
  const intervals = m ? CHORD_QUALITIES[m[3]!] : undefined;
  if (!m || !intervals) {
    throw new ToolInputError(
      `Unknown chord "${symbol}". Use a root A-G with optional # or b and a quality: ${Object.keys(
        CHORD_QUALITIES,
      )
        .filter(Boolean)
        .join(', ')} (e.g. "Am", "F", "G7", "Cmaj7", "D/F#").`,
    );
  }
  const root = parsePitchClass(m[1]! + m[2]!)!;
  const bass = m[4] ? parsePitchClass(m[4])! : root;
  return { symbol: symbol.trim(), root, intervals, bass };
}

/**
 * Close voicing of a chord whose average pitch is nearest `center` (smooth voice leading when
 * `center` is the previous chord's average).
 */
export function voiceChord(chord: ParsedChord, center: number): number[] {
  const base = Math.floor(center / 12) * 12 + chord.root;
  const closed = chord.intervals.map((i) => base + i);
  let best = closed;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let shift = -2; shift <= 1; shift++) {
    for (let inv = 0; inv < closed.length; inv++) {
      const voicing = closed.map((p, i) => p + shift * 12 + (i < inv ? 12 : 0));
      const mean = voicing.reduce((a, b) => a + b, 0) / voicing.length;
      const distance = Math.abs(mean - center);
      if (distance < bestDistance - 1e-9) {
        best = voicing;
        bestDistance = distance;
      }
    }
  }
  return [...best].sort((a, b) => a - b).filter((p) => p >= 0 && p <= 127);
}

// ---------------------------------------------------------------------------
// Keys and scales
// ---------------------------------------------------------------------------

const SCALE_ALIASES: ReadonlyArray<readonly [string, ScaleId]> = [
  ['natural minor', 'naturalMinor'],
  ['harmonic minor', 'harmonicMinor'],
  ['melodic minor', 'melodicMinor'],
  ['major pentatonic', 'majorPentatonic'],
  ['minor pentatonic', 'minorPentatonic'],
  ['pentatonic', 'majorPentatonic'],
  ['aeolian', 'naturalMinor'],
  ['ionian', 'major'],
  ['minor', 'naturalMinor'],
  ['min', 'naturalMinor'],
  ['m', 'naturalMinor'],
  ['major', 'major'],
  ['maj', 'major'],
  ['dorian', 'dorian'],
  ['phrygian', 'phrygian'],
  ['lydian', 'lydian'],
  ['mixolydian', 'mixolydian'],
  ['locrian', 'locrian'],
  ['blues', 'blues'],
  ['chromatic', 'chromatic'],
  ['', 'major'],
];

/** Parses "A minor", "Am", "C# major", "D dorian", "E minor pentatonic". */
export function parseKey(text: string): MusicalKey {
  const m = /^\s*([A-Ga-g][#b♯♭]?)\s*(.*?)\s*$/.exec(text);
  const tonic = m ? parsePitchClass(m[1]!) : undefined;
  const rest = (m?.[2] ?? '').toLowerCase();
  const scale = SCALE_ALIASES.find(([alias]) => alias === rest)?.[1];
  if (tonic === undefined || !scale) {
    throw new ToolInputError(
      `Unknown key "${text}". Use a tonic and scale like "A minor", "C major", "D dorian", "E minor pentatonic" or "Bb blues".`,
    );
  }
  return { tonic, scale };
}

export function keyName(key: MusicalKey): string {
  const flats = [1, 3, 6, 8, 10].includes(key.tonic) && key.scale !== 'naturalMinor';
  const names = flats
    ? ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B']
    : ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  return `${names[key.tonic]} ${SCALES[key.scale].label.toLowerCase()}`;
}

/** Scale notes from the tonic in `octave` upward for `octaves` octaves (plus the top tonic). */
export function scaleNotes(key: MusicalKey, octave: number, octaves = 1): number[] {
  const start = (octave + 1) * 12 + key.tonic;
  const notes: number[] = [];
  for (let o = 0; o < octaves; o++)
    for (const i of SCALES[key.scale].intervals) notes.push(start + o * 12 + i);
  notes.push(start + octaves * 12);
  return notes.filter((n) => n >= 0 && n <= 127);
}

/**
 * Root of a group of simultaneous pitches: the pitch whose fifth and third (major or minor)
 * are also present, else the lowest pitch. Works for any inversion of a triad.
 */
export function chordRoot(pitches: readonly number[]): number {
  const sorted = [...pitches].sort((a, b) => a - b);
  const pcs = new Set(sorted.map(toPitchClass));
  const root = sorted.find(
    (p) =>
      pcs.has(toPitchClass(p + 7)) &&
      (pcs.has(toPitchClass(p + 3)) || pcs.has(toPitchClass(p + 4))),
  );
  return root ?? sorted[0] ?? 0;
}

export interface KeyEstimate {
  readonly key: MusicalKey;
  readonly label: string;
  /** Share of note time that falls inside the key's scale (0..1). */
  readonly fit: number;
}

/**
 * Rough key estimate from (pitch, weight) pairs: the major/minor key whose scale covers the
 * most note time, with a bonus for tonic and fifth emphasis. `anchors` are structurally
 * important pitches (e.g. the lowest note of each clip's first and last chord); a key whose
 * tonic matches them scores higher. Returns null without notes.
 */
export function estimateKey(
  notes: ReadonlyArray<{ readonly pitch: number; readonly weight: number }>,
  anchors: readonly number[] = [],
): KeyEstimate | null {
  const histogram = new Array<number>(12).fill(0);
  let total = 0;
  for (const n of notes) {
    histogram[toPitchClass(n.pitch)]! += n.weight;
    total += n.weight;
  }
  if (total <= 0) return null;
  let best: KeyEstimate | null = null;
  let bestScore = Number.NEGATIVE_INFINITY;
  for (const scale of ['major', 'naturalMinor'] as const) {
    for (let tonic = 0; tonic < 12; tonic++) {
      const key: MusicalKey = { tonic: tonic as PitchClass, scale };
      const pcs = scalePitchClasses(key);
      let inScale = 0;
      for (const pc of pcs) inScale += histogram[pc]!;
      const fit = inScale / total;
      const emphasis = (histogram[tonic]! * 1.0 + histogram[(tonic + 7) % 12]! * 0.5) / total;
      const anchored =
        anchors.length > 0
          ? anchors.filter((p) => toPitchClass(p) === tonic).length / anchors.length
          : 0;
      const score = fit + emphasis * 0.35 + anchored * 0.25;
      if (score > bestScore + 1e-9) {
        bestScore = score;
        best = { key, label: keyName(key), fit: Math.round(fit * 100) / 100 };
      }
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Drum kit
// ---------------------------------------------------------------------------

/** Drum-kit voices and the MIDI notes that trigger them (General MIDI convention). */
export const DRUM_VOICE_NOTES: Readonly<Record<string, number>> = {
  kick: 36,
  snare: 38,
  clap: 39,
  rim: 37,
  closedHat: 42,
  openHat: 46,
  lowTom: 41,
  midTom: 45,
  highTom: 48,
  crash: 49,
  cowbell: 56,
};

const DRUM_ALIASES: Readonly<Record<string, string>> = {
  bd: 'kick',
  bassdrum: 'kick',
  sd: 'snare',
  cp: 'clap',
  hat: 'closedHat',
  hihat: 'closedHat',
  hh: 'closedHat',
  closedhihat: 'closedHat',
  ch: 'closedHat',
  oh: 'openHat',
  openhihat: 'openHat',
  rimshot: 'rim',
  tom: 'midTom',
  cymbal: 'crash',
};

export function resolveDrumVoice(name: string): number {
  const compact = name.replace(/[\s_-]/g, '').toLowerCase();
  const voice =
    Object.keys(DRUM_VOICE_NOTES).find((v) => v.toLowerCase() === compact) ?? DRUM_ALIASES[compact];
  if (voice) return DRUM_VOICE_NOTES[voice]!;
  throw new ToolInputError(
    `Unknown drum voice "${name}". Use one of: ${Object.keys(DRUM_VOICE_NOTES).join(', ')}.`,
  );
}

/** Kit voice a MIDI note plays on a drums track (e.g. 36 → "kick"), if any. */
export function drumVoiceName(note: number): string | undefined {
  return drumKindForNote(note);
}
