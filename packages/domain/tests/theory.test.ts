import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  A4_HZ,
  SCALES,
  centsBetween,
  frequencyToMidi,
  isInScale,
  keyLabel,
  midiToFrequency,
  midiToNoteName,
  nearestScaleNote,
  pitchClassName,
  relativeKey,
  scalePitchClasses,
  toPitchClass,
  type MusicalKey,
  type PitchClass,
  type ScaleId,
} from '../src';

const C_MAJOR: MusicalKey = { tonic: 0, scale: 'major' };

describe('note names', () => {
  it('uses scientific pitch notation by default (60 = C4)', () => {
    expect(midiToNoteName(60)).toBe('C4');
    expect(midiToNoteName(61)).toBe('C#4');
    expect(midiToNoteName(69)).toBe('A4');
    expect(midiToNoteName(0)).toBe('C-1');
    expect(midiToNoteName(127)).toBe('G9');
    expect(midiToNoteName(59)).toBe('B3');
  });

  it('supports flats and a configurable middle-C octave', () => {
    expect(midiToNoteName(61, { preferFlats: true })).toBe('Db4');
    expect(midiToNoteName(70, { preferFlats: true })).toBe('Bb4');
    expect(midiToNoteName(60, { middleCOctave: 3 })).toBe('C3');
    expect(midiToNoteName(48, { middleCOctave: 5, preferFlats: true })).toBe('C4');
  });

  it('rounds fractional pitches', () => {
    expect(midiToNoteName(60.4)).toBe('C4');
    expect(midiToNoteName(60.6)).toBe('C#4');
    expect(midiToNoteName(59.5)).toBe('C4');
  });

  it('names pitch classes and keys', () => {
    expect(pitchClassName(3)).toBe('D#');
    expect(pitchClassName(3, true)).toBe('Eb');
    expect(keyLabel({ tonic: 9, scale: 'naturalMinor' })).toBe('A Minor');
    expect(keyLabel({ tonic: 10, scale: 'dorian' }, true)).toBe('Bb Dorian');
  });

  it('maps any integer to a pitch class 0..11', () => {
    expect(toPitchClass(-1)).toBe(11);
    expect(toPitchClass(-12)).toBe(0);
    expect(toPitchClass(64.4)).toBe(4);
    fc.assert(
      fc.property(fc.integer({ min: -1000, max: 1000 }), (m) => {
        const pc = toPitchClass(m);
        expect(pc).toBeGreaterThanOrEqual(0);
        expect(pc).toBeLessThan(12);
        expect((((m - pc) % 12) + 12) % 12).toBe(0);
      }),
    );
  });
});

describe('frequency conversions', () => {
  it('converts MIDI to Hz', () => {
    expect(midiToFrequency(69)).toBe(A4_HZ);
    expect(midiToFrequency(81)).toBeCloseTo(880, 10);
    expect(midiToFrequency(57)).toBeCloseTo(220, 10);
    expect(midiToFrequency(60)).toBeCloseTo(261.6255653, 6);
    expect(midiToFrequency(69, 432)).toBe(432);
  });

  it('converts Hz to fractional MIDI and rejects non-positive input', () => {
    expect(frequencyToMidi(440)).toBe(69);
    expect(frequencyToMidi(466.1637615)).toBeCloseTo(70, 6);
    expect(frequencyToMidi(432, 432)).toBe(69);
    expect(frequencyToMidi(0)).toBeNaN();
    expect(frequencyToMidi(-10)).toBeNaN();
    expect(frequencyToMidi(Number.NaN)).toBeNaN();
  });

  it('round-trips midi <-> Hz', () => {
    fc.assert(
      fc.property(fc.double({ min: -20, max: 140, noNaN: true }), (midi) => {
        expect(frequencyToMidi(midiToFrequency(midi))).toBeCloseTo(midi, 9);
      }),
    );
  });

  it('measures cents', () => {
    expect(centsBetween(60, 61)).toBe(100);
    expect(centsBetween(60, 59.5)).toBe(-50);
  });
});

describe('scales', () => {
  it('builds pitch-class sets', () => {
    expect([...scalePitchClasses(C_MAJOR)].sort((a, b) => a - b)).toEqual([0, 2, 4, 5, 7, 9, 11]);
    expect(
      [...scalePitchClasses({ tonic: 9, scale: 'minorPentatonic' })].sort((a, b) => a - b),
    ).toEqual([0, 2, 4, 7, 9]);
    expect(isInScale(64, C_MAJOR)).toBe(true);
    expect(isInScale(61, C_MAJOR)).toBe(false);
    expect(isInScale(73, { tonic: 1, scale: 'major' })).toBe(true);
  });

  it('defines ascending intervals starting at 0 for every scale', () => {
    for (const scale of Object.values(SCALES)) {
      expect(scale.intervals[0]).toBe(0);
      for (let i = 1; i < scale.intervals.length; i++) {
        expect(scale.intervals[i]!).toBeGreaterThan(scale.intervals[i - 1]!);
      }
      expect(scale.intervals[scale.intervals.length - 1]!).toBeLessThan(12);
    }
  });
});

describe('nearestScaleNote', () => {
  it('returns in-scale notes unchanged and snaps others', () => {
    expect(nearestScaleNote(64, C_MAJOR)).toBe(64);
    expect(nearestScaleNote(63.8, C_MAJOR)).toBe(64);
    expect(nearestScaleNote(66.2, C_MAJOR)).toBe(67);
    expect(nearestScaleNote(65.8, C_MAJOR)).toBe(65);
    expect(nearestScaleNote(61.5, C_MAJOR)).toBe(62);
  });

  it('resolves ties downward', () => {
    expect(nearestScaleNote(61, C_MAJOR)).toBe(60); // C# between C and D
    expect(nearestScaleNote(66, C_MAJOR)).toBe(65); // F# between F and G
    expect(nearestScaleNote(63, { tonic: 0, scale: 'majorPentatonic' })).toBe(62); // D# between D and E
  });

  it('property: result is in scale and no in-scale note is strictly closer', () => {
    const scaleIds = Object.keys(SCALES) as ScaleId[];
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 127, noNaN: true }),
        fc.integer({ min: 0, max: 11 }),
        fc.constantFrom(...scaleIds),
        (midi, tonic, scale) => {
          const key: MusicalKey = { tonic: tonic as PitchClass, scale };
          const result = nearestScaleNote(midi, key);
          expect(isInScale(result, key)).toBe(true);
          const distance = Math.abs(result - midi);
          for (let c = Math.floor(midi) - 12; c <= Math.ceil(midi) + 12; c++) {
            if (!isInScale(c, key)) continue;
            const d = Math.abs(c - midi);
            expect(d).toBeGreaterThanOrEqual(distance - 1e-9);
            // Ties resolve to the lower candidate.
            if (Math.abs(d - distance) < 1e-9) expect(result).toBeLessThanOrEqual(c);
          }
        },
      ),
    );
  });
});

describe('relativeKey', () => {
  it('maps major and minor partners', () => {
    expect(relativeKey(C_MAJOR)).toEqual({ tonic: 9, scale: 'naturalMinor' });
    expect(relativeKey({ tonic: 9, scale: 'naturalMinor' })).toEqual({ tonic: 0, scale: 'major' });
    expect(relativeKey({ tonic: 4, scale: 'naturalMinor' })).toEqual({ tonic: 7, scale: 'major' });
    expect(relativeKey({ tonic: 5, scale: 'major' })).toEqual({ tonic: 2, scale: 'naturalMinor' });
  });

  it('is an involution for major/minor and undefined for modes', () => {
    for (let t = 0; t < 12; t++) {
      const key: MusicalKey = { tonic: t as PitchClass, scale: 'major' };
      expect(relativeKey(relativeKey(key)!)).toEqual(key);
    }
    expect(relativeKey({ tonic: 2, scale: 'dorian' })).toBeUndefined();
    expect(relativeKey({ tonic: 0, scale: 'harmonicMinor' })).toBeUndefined();
  });
});
