import { describe, expect, it } from 'vitest';
import {
  chordRoot,
  estimateKey,
  keyName,
  parseChord,
  parseKey,
  parsePitch,
  resolveDrumVoice,
  scaleNotes,
  voiceChord,
} from '../src/session/tools/music';

describe('tool music helpers', () => {
  it('parses pitches as MIDI numbers or names (C4 = 60)', () => {
    expect(parsePitch(60)).toBe(60);
    expect(parsePitch('60')).toBe(60);
    expect(parsePitch('C4')).toBe(60);
    expect(parsePitch('a4')).toBe(69);
    expect(parsePitch('F#3')).toBe(54);
    expect(parsePitch('Bb2')).toBe(46);
    expect(parsePitch('C-1')).toBe(0);
    expect(() => parsePitch(128)).toThrow(/0-127/);
    expect(() => parsePitch('H4')).toThrow(/note name/);
    expect(() => parsePitch(60.5)).toThrow();
  });

  it('parses chord symbols including slash chords', () => {
    expect(parseChord('Am')).toMatchObject({ root: 9, intervals: [0, 3, 7], bass: 9 });
    expect(parseChord('G7').intervals).toEqual([0, 4, 7, 10]);
    expect(parseChord('Bbmaj7')).toMatchObject({ root: 10, intervals: [0, 4, 7, 11] });
    expect(parseChord('D/F#')).toMatchObject({ root: 2, bass: 6 });
    expect(() => parseChord('Q')).toThrow(/Unknown chord/);
  });

  it('voices chords close to a centre and finds roots of inversions', () => {
    const voicing = voiceChord(parseChord('C'), 64);
    expect(voicing).toHaveLength(3);
    expect(new Set(voicing.map((p) => p % 12))).toEqual(new Set([0, 4, 7]));
    const mean = voicing.reduce((a, b) => a + b, 0) / 3;
    expect(Math.abs(mean - 64)).toBeLessThan(3);
    expect(chordRoot([60, 64, 69])).toBe(69); // A minor in first inversion
    expect(chordRoot([62, 65])).toBe(62);
  });

  it('parses keys and lists scale notes', () => {
    expect(parseKey('A minor')).toEqual({ tonic: 9, scale: 'naturalMinor' });
    expect(parseKey('Am')).toEqual({ tonic: 9, scale: 'naturalMinor' });
    expect(parseKey('E minor pentatonic')).toEqual({ tonic: 4, scale: 'minorPentatonic' });
    expect(keyName({ tonic: 10, scale: 'major' })).toBe('Bb major');
    expect(scaleNotes(parseKey('C major'), 4)).toEqual([60, 62, 64, 65, 67, 69, 71, 72]);
    expect(() => parseKey('Z flat')).toThrow(/Unknown key/);
  });

  it('estimates keys from weighted pitches', () => {
    const cMajor = [60, 62, 64, 65, 67, 69, 71].map((pitch) => ({ pitch, weight: 1 }));
    expect(estimateKey([...cMajor, { pitch: 60, weight: 3 }])?.label).toBe('C major');
    expect(estimateKey([...cMajor, { pitch: 69, weight: 3 }], [57, 57])?.label).toBe('A minor');
    expect(estimateKey([])).toBeNull();
  });

  it('maps drum voice names and aliases to kit notes', () => {
    expect(resolveDrumVoice('kick')).toBe(36);
    expect(resolveDrumVoice('closed_hat')).toBe(42);
    expect(resolveDrumVoice('hihat')).toBe(42);
    expect(resolveDrumVoice('Open Hat')).toBe(46);
    expect(() => resolveDrumVoice('gong')).toThrow(/Unknown drum voice/);
  });
});
