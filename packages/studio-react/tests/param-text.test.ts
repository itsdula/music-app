import { normalizeParam, type ParamSpec } from '@studio/domain';
import { describe, expect, it } from 'vitest';
import { parseParamText } from '../src/lib/param-text';

const spec = (patch: Partial<ParamSpec>): ParamSpec => ({
  id: 'p',
  label: 'P',
  min: 0,
  max: 1,
  default: 0,
  unit: '',
  curve: 'linear',
  ...patch,
});

describe('parseParamText', () => {
  it('reads frequencies with a kHz suffix on a log curve', () => {
    const cutoff = spec({ min: 20, max: 20000, unit: 'Hz', curve: 'log' });
    expect(parseParamText(cutoff, '1.2 kHz')).toBeCloseTo(normalizeParam(cutoff, 1200), 9);
    expect(parseParamText(cutoff, '440')).toBeCloseTo(normalizeParam(cutoff, 440), 9);
  });

  it('reads decibels, including silence and the typographic minus', () => {
    const gain = spec({ min: -60, max: 6, unit: 'dB', curve: 'db' });
    expect(parseParamText(gain, '-inf')).toBe(0);
    expect(parseParamText(gain, '−6 dB')).toBeCloseTo(normalizeParam(gain, -6), 9);
  });

  it('reads seconds as milliseconds and percentages as fractions', () => {
    const time = spec({ min: 1, max: 2000, unit: 'ms' });
    expect(parseParamText(time, '1.5 s')).toBeCloseTo(normalizeParam(time, 1500), 9);
    expect(parseParamText(time, '350 ms')).toBeCloseTo(normalizeParam(time, 350), 9);
    expect(parseParamText(spec({ unit: '%' }), '40%')).toBeCloseTo(0.4, 9);
  });

  it('matches option labels and clamps out-of-range numbers', () => {
    const wave = spec({
      min: 0,
      max: 2,
      options: [
        { value: 0, label: 'Sine' },
        { value: 1, label: 'Saw' },
        { value: 2, label: 'Square' },
      ],
    });
    expect(parseParamText(wave, 'saw')).toBeCloseTo(0.5, 9);
    expect(parseParamText(spec({}), '7')).toBe(1);
  });

  it('rejects text without a value', () => {
    expect(parseParamText(spec({}), 'loud')).toBeNull();
  });
});
