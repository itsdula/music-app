import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { DEFAULT_VALUE_TRANSFORM, type MappingCurve } from '@studio/domain';
import {
  applyMappingCurve,
  applyValueTransform,
  applyVelocityCurve,
  describeMidiMessage,
  formatMidiBytes,
  type MidiMessage,
} from '../src';

describe('formatMidiBytes', () => {
  it('formats uppercase hex pairs', () => {
    expect(formatMidiBytes(Uint8Array.of(0x90, 0x3c, 0x0a))).toBe('90 3C 0A');
    expect(formatMidiBytes(new Uint8Array())).toBe('');
  });

  it('truncates long input', () => {
    const bytes = Uint8Array.from({ length: 20 }, (_, i) => i);
    expect(formatMidiBytes(bytes)).toBe(
      '00 01 02 03 04 05 06 07 08 09 0A 0B 0C 0D 0E 0F … (+4 bytes)',
    );
    expect(formatMidiBytes(bytes.subarray(0, 3), 2)).toBe('00 01 … (+1 byte)');
    expect(formatMidiBytes(bytes.subarray(0, 3), 0)).toBe('… (+3 bytes)');
  });
});

describe('describeMidiMessage', () => {
  it.each<[MidiMessage, string]>([
    [{ type: 'noteOn', channel: 1, note: 60, velocity: 100 }, 'Note On ch 1 C4 (60) vel 100'],
    [{ type: 'noteOff', channel: 10, note: 36, velocity: 0 }, 'Note Off ch 10 C2 (36) vel 0'],
    [
      { type: 'polyPressure', channel: 2, note: 61, pressure: 5 },
      'Poly Aftertouch ch 2 C#4 (61) = 5',
    ],
    [{ type: 'controlChange', channel: 1, controller: 70, value: 64 }, 'CC ch 1 #70 = 64'],
    [{ type: 'programChange', channel: 1, program: 3 }, 'Program Change ch 1 program 3'],
    [{ type: 'channelPressure', channel: 1, pressure: 9 }, 'Channel Aftertouch ch 1 = 9'],
    [{ type: 'pitchBend', channel: 1, value: 100 }, 'Pitch Bend ch 1 +100'],
    [{ type: 'pitchBend', channel: 1, value: -5 }, 'Pitch Bend ch 1 -5'],
    [{ type: 'mtcQuarterFrame', value: 3 }, 'MTC Quarter Frame 3'],
    [{ type: 'songPosition', sixteenths: 16 }, 'Song Position 16 sixteenths'],
    [{ type: 'songSelect', song: 1 }, 'Song Select 1'],
    [{ type: 'tuneRequest' }, 'Tune Request'],
    [{ type: 'clock' }, 'Clock'],
    [{ type: 'start' }, 'Start'],
    [{ type: 'continue' }, 'Continue'],
    [{ type: 'stop' }, 'Stop'],
    [{ type: 'activeSensing' }, 'Active Sensing'],
    [{ type: 'systemReset' }, 'System Reset'],
  ])('describes %j', (message, text) => {
    expect(describeMidiMessage(message)).toBe(text);
  });

  it('truncates SysEx payloads', () => {
    const bytes = Uint8Array.from([0xf0, ...Array.from({ length: 30 }, () => 0x11), 0xf7]);
    expect(describeMidiMessage({ type: 'sysex', bytes })).toBe(
      'SysEx 32 bytes [F0 11 11 11 11 11 11 11 … (+24 bytes)]',
    );
  });
});

const CURVES: MappingCurve[] = ['linear', 'exponential', 'logarithmic', 'sCurve'];

describe('applyMappingCurve', () => {
  it.each(CURVES)('%s maps endpoints exactly and clamps', (curve) => {
    expect(applyMappingCurve(0, curve)).toBe(0);
    expect(applyMappingCurve(1, curve)).toBe(1);
    expect(applyMappingCurve(-3, curve)).toBe(0);
    expect(applyMappingCurve(7, curve)).toBe(1);
  });

  it.each(CURVES)('%s is monotonically non-decreasing over 0..127', (curve) => {
    let previous = -Infinity;
    for (let v = 0; v <= 127; v++) {
      const y = applyMappingCurve(v / 127, curve);
      expect(y).toBeGreaterThanOrEqual(previous);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(1);
      previous = y;
    }
  });

  it('has the documented shapes', () => {
    expect(applyMappingCurve(0.5, 'linear')).toBe(0.5);
    expect(applyMappingCurve(0.5, 'exponential')).toBeLessThan(0.5);
    expect(applyMappingCurve(0.5, 'logarithmic')).toBeGreaterThan(0.5);
    expect(applyMappingCurve(0.5, 'sCurve')).toBeCloseTo(0.5);
    expect(applyMappingCurve(0.1, 'sCurve')).toBeLessThan(0.1);
    expect(applyMappingCurve(0.9, 'sCurve')).toBeGreaterThan(0.9);
  });

  it('logarithmic is the inverse of exponential', () => {
    fc.assert(
      fc.property(fc.double({ min: 0, max: 1, noNaN: true }), (x) => {
        expect(applyMappingCurve(applyMappingCurve(x, 'exponential'), 'logarithmic')).toBeCloseTo(
          x,
          9,
        );
      }),
    );
  });
});

describe('applyValueTransform', () => {
  it('scales into range, inverts and clamps', () => {
    const t = { ...DEFAULT_VALUE_TRANSFORM, min: 0.2, max: 0.6 };
    expect(applyValueTransform(0, t)).toBeCloseTo(0.2);
    expect(applyValueTransform(1, t)).toBeCloseTo(0.6);
    expect(applyValueTransform(0.5, t)).toBeCloseTo(0.4);
    const inverted = { ...t, invert: true };
    expect(applyValueTransform(0, inverted)).toBeCloseTo(0.6);
    expect(applyValueTransform(1, inverted)).toBeCloseTo(0.2);
    expect(applyValueTransform(1, { ...t, min: 0.5, max: 2 })).toBe(1);
  });

  it('allows min > max as a reversed range', () => {
    const t = { ...DEFAULT_VALUE_TRANSFORM, min: 1, max: 0 };
    expect(applyValueTransform(0.25, t)).toBeCloseTo(0.75);
  });
});

describe('applyVelocityCurve', () => {
  it('linear is identity on 1..127', () => {
    for (let v = 1; v <= 127; v++) expect(applyVelocityCurve(v, 'linear')).toBe(v);
  });

  it('soft is louder, hard is quieter, both monotonic with fixed endpoints', () => {
    let prevSoft = 0;
    let prevHard = 0;
    for (let v = 1; v <= 127; v++) {
      const soft = applyVelocityCurve(v, 'soft');
      const hard = applyVelocityCurve(v, 'hard');
      expect(soft).toBeGreaterThanOrEqual(v);
      expect(hard).toBeLessThanOrEqual(v);
      expect(soft).toBeGreaterThanOrEqual(prevSoft);
      expect(hard).toBeGreaterThanOrEqual(prevHard);
      expect(hard).toBeGreaterThanOrEqual(1);
      prevSoft = soft;
      prevHard = hard;
    }
    expect(applyVelocityCurve(127, 'soft')).toBe(127);
    expect(applyVelocityCurve(127, 'hard')).toBe(127);
  });

  it('fixed returns the fixed value (default 100), clamped', () => {
    expect(applyVelocityCurve(5, 'fixed')).toBe(100);
    expect(applyVelocityCurve(5, 'fixed', 127)).toBe(127);
    expect(applyVelocityCurve(5, 'fixed', 400)).toBe(127);
    expect(applyVelocityCurve(5, 'fixed', 0)).toBe(1);
    expect(applyVelocityCurve(5, 'fixed', Number.NaN)).toBe(1);
  });

  it('keeps 0 as 0 (never turns note-offs into note-ons) and clamps > 127', () => {
    expect(applyVelocityCurve(0, 'fixed')).toBe(0);
    expect(applyVelocityCurve(0, 'soft')).toBe(0);
    expect(applyVelocityCurve(Number.NaN, 'linear')).toBe(0);
    expect(applyVelocityCurve(200, 'linear')).toBe(127);
  });
});
