import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  EFFECT_KINDS,
  EFFECT_PARAM_SPECS,
  INSTRUMENT_PARAM_SPECS,
  MASTER_GAIN_SPEC,
  SYNTH_PRESETS,
  TEMPO_SPEC,
  TRACK_GAIN_SPEC,
  TRACK_PAN_SPEC,
  clampParam,
  defaultParamValues,
  denormalizeParam,
  findParamSpec,
  formatParamValue,
  normalizeParam,
  sanitizeParamValues,
  type ParamSpec,
} from '../src';

const ALL_SPECS: ParamSpec[] = [
  TRACK_GAIN_SPEC,
  TRACK_PAN_SPEC,
  MASTER_GAIN_SPEC,
  TEMPO_SPEC,
  ...Object.values(EFFECT_PARAM_SPECS).flat(),
  ...Object.values(INSTRUMENT_PARAM_SPECS).flat(),
];
const CONTINUOUS = ALL_SPECS.filter((s) => s.step === undefined);

const spec = (overrides: Partial<ParamSpec>): ParamSpec => ({
  id: 'p',
  label: 'P',
  min: 0,
  max: 1,
  default: 0.5,
  unit: '',
  curve: 'linear',
  ...overrides,
});

describe('spec tables', () => {
  it('have defaults inside their ranges and unique ids per group', () => {
    for (const s of ALL_SPECS) {
      expect(s.min, s.id).toBeLessThan(s.max);
      expect(s.default).toBeGreaterThanOrEqual(s.min);
      expect(s.default).toBeLessThanOrEqual(s.max);
      expect(clampParam(s, s.default)).toBe(s.default);
      if (s.curve === 'log') expect(s.min).toBeGreaterThan(0);
    }
    for (const group of [
      ...Object.values(EFFECT_PARAM_SPECS),
      ...Object.values(INSTRUMENT_PARAM_SPECS),
    ]) {
      expect(new Set(group.map((s) => s.id)).size).toBe(group.length);
    }
    expect(Object.keys(EFFECT_PARAM_SPECS).sort()).toEqual([...EFFECT_KINDS].sort());
  });

  it('presets only use known parameters within range', () => {
    for (const preset of SYNTH_PRESETS) {
      const specs = INSTRUMENT_PARAM_SPECS[preset.kind];
      for (const [id, value] of Object.entries(preset.params)) {
        const s = findParamSpec(specs, id);
        expect(s, `${preset.id}.${id}`).toBeDefined();
        expect(clampParam(s!, value)).toBe(value);
      }
    }
  });
});

describe('clampParam', () => {
  it('clamps to the range and maps non-finite input to the default', () => {
    expect(clampParam(TRACK_GAIN_SPEC, 20)).toBe(6);
    expect(clampParam(TRACK_GAIN_SPEC, -100)).toBe(-60);
    expect(clampParam(TRACK_PAN_SPEC, 0.25)).toBe(0.25);
    expect(clampParam(TRACK_GAIN_SPEC, Number.NaN)).toBe(0);
    expect(clampParam(TRACK_GAIN_SPEC, Number.POSITIVE_INFINITY)).toBe(0);
  });

  it('quantizes to the step without floating-point noise', () => {
    expect(clampParam(TEMPO_SPEC, 26.987)).toBe(26.99);
    expect(clampParam(TEMPO_SPEC, 22.74)).toBe(22.74);
    expect(clampParam(TEMPO_SPEC, 120.004)).toBe(120);
    const waveform = INSTRUMENT_PARAM_SPECS.synth[0]!;
    expect(clampParam(waveform, 1.6)).toBe(2);
    expect(clampParam(waveform, 7)).toBe(3);
    expect(clampParam(spec({ min: 0.3, max: 2, step: 0.25 }), 0.71)).toBe(0.8);
    expect(clampParam(spec({ min: 0, max: 1, step: 1e-7 }), 0.12345678)).toBe(0.1234568);
  });

  it('property: stepped values are exact decimal multiples of the step', () => {
    fc.assert(
      fc.property(fc.double({ min: 0, max: 500, noNaN: true }), (v) => {
        const c = clampParam(TEMPO_SPEC, v);
        expect(c).toBeGreaterThanOrEqual(TEMPO_SPEC.min);
        expect(c).toBeLessThanOrEqual(TEMPO_SPEC.max);
        expect(Math.round(c * 100) / 100).toBe(c);
        expect(Math.abs(c - Math.min(400, Math.max(20, v)))).toBeLessThanOrEqual(0.005 + 1e-9);
      }),
    );
  });

  it('keeps stepped values inside the range when the span is not a step multiple', () => {
    expect(clampParam(spec({ min: 0, max: 1, step: 0.3 }), 1)).toBe(0.9);
    // 2.5 steps round up to 1.2, which is then clamped back to the range maximum.
    expect(clampParam(spec({ min: 0, max: 1, step: 0.4 }), 1)).toBe(1);
    expect(clampParam(spec({ min: 0, max: 1, step: 0.7 }), 0.9)).toBe(0.7);
  });
});

describe('normalize / denormalize', () => {
  it('maps the end points to min and max', () => {
    for (const s of ALL_SPECS) {
      expect(denormalizeParam(s, 0), s.id).toBeCloseTo(s.min, 9);
      expect(denormalizeParam(s, 1), s.id).toBeCloseTo(s.max, 9);
      expect(normalizeParam(s, s.min)).toBeCloseTo(0, 12);
      expect(normalizeParam(s, s.max)).toBeCloseTo(1, 12);
    }
  });

  it('clamps out-of-range positions and values', () => {
    expect(denormalizeParam(TRACK_PAN_SPEC, -1)).toBe(-1);
    expect(denormalizeParam(TRACK_PAN_SPEC, 2)).toBe(1);
    expect(normalizeParam(TRACK_PAN_SPEC, 5)).toBe(1);
    expect(normalizeParam(TRACK_PAN_SPEC, -5)).toBe(0);
    expect(normalizeParam(spec({ min: 1, max: 1 }), 1)).toBe(0);
  });

  it('implements linear, log and db curves', () => {
    expect(denormalizeParam(TRACK_PAN_SPEC, 0.75)).toBe(0.5);
    const lowFreq = findParamSpec(EFFECT_PARAM_SPECS.eq3, 'lowFreq')!; // 40..800 Hz, log
    expect(denormalizeParam(lowFreq, 0.5)).toBeCloseTo(Math.sqrt(40 * 800), 9);
    // db: unity gain sits high on the fader.
    expect(normalizeParam(TRACK_GAIN_SPEC, 0)).toBeCloseTo(Math.pow(60 / 66, 2.5), 12);
    expect(normalizeParam(TRACK_GAIN_SPEC, 0)).toBeGreaterThan(0.75);
  });

  it('handles log curves with a non-positive minimum', () => {
    const s = spec({ min: 0, max: 100, curve: 'log' });
    expect(denormalizeParam(s, 1)).toBeCloseTo(100, 9);
    expect(normalizeParam(s, 0)).toBe(0);
    expect(normalizeParam(s, 100)).toBeCloseTo(1, 12);
  });

  it('round-trips normalized positions for every continuous spec and curve', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...CONTINUOUS),
        fc.double({ min: 0, max: 1, noNaN: true }),
        (s, n) => {
          expect(normalizeParam(s, denormalizeParam(s, n))).toBeCloseTo(n, 9);
        },
      ),
    );
  });

  it('round-trips values for every continuous spec and curve', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...CONTINUOUS),
        fc.double({ min: 0, max: 1, noNaN: true }),
        (s, t) => {
          const value = s.min + (s.max - s.min) * t;
          const back = denormalizeParam(s, normalizeParam(s, value));
          expect(Math.abs(back - value)).toBeLessThanOrEqual(1e-9 * Math.max(1, Math.abs(value)));
        },
      ),
    );
  });

  it('is monotonic for every spec', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...ALL_SPECS),
        fc.double({ min: 0, max: 1, noNaN: true }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        (s, a, b) => {
          const [lo, hi] = a <= b ? [a, b] : [b, a];
          expect(denormalizeParam(s, lo)).toBeLessThanOrEqual(denormalizeParam(s, hi));
        },
      ),
    );
  });

  it('quantizes stepped specs on denormalize', () => {
    const polyphony = findParamSpec(INSTRUMENT_PARAM_SPECS.synth, 'polyphony')!;
    expect(Number.isInteger(denormalizeParam(polyphony, 0.37))).toBe(true);
  });
});

describe('default and sanitized values', () => {
  it('builds defaults for every spec', () => {
    const values = defaultParamValues(EFFECT_PARAM_SPECS.delay);
    expect(values).toEqual({ timeMs: 375, feedback: 0.35, toneHz: 8000, mix: 0.25 });
  });

  it('fills gaps, clamps values and drops unknown ids', () => {
    const values = sanitizeParamValues(EFFECT_PARAM_SPECS.delay, {
      timeMs: 5000,
      feedback: undefined,
      bogus: 3,
    });
    expect(values).toEqual({ timeMs: 2000, feedback: 0.35, toneHz: 8000, mix: 0.25 });
  });

  it('finds specs by id', () => {
    expect(findParamSpec(EFFECT_PARAM_SPECS.gain, 'gainDb')?.max).toBe(24);
    expect(findParamSpec(EFFECT_PARAM_SPECS.gain, 'nope')).toBeUndefined();
  });
});

describe('formatParamValue', () => {
  it('formats each unit', () => {
    expect(formatParamValue(TRACK_GAIN_SPEC, -60)).toBe('-inf dB');
    expect(formatParamValue(TRACK_GAIN_SPEC, 0)).toBe('+0.0 dB');
    expect(formatParamValue(TRACK_GAIN_SPEC, -3.25)).toBe('-3.3 dB');
    expect(formatParamValue(spec({ unit: 'Hz' }), 440.4)).toBe('440 Hz');
    expect(formatParamValue(spec({ unit: 'Hz' }), 1500)).toBe('1.50 kHz');
    expect(formatParamValue(spec({ unit: 'Hz' }), 12_000)).toBe('12.0 kHz');
    expect(formatParamValue(spec({ unit: 'ms' }), 5.25)).toBe('5.3 ms');
    expect(formatParamValue(spec({ unit: 'ms' }), 150)).toBe('150 ms');
    expect(formatParamValue(spec({ unit: 'ms' }), 1500)).toBe('1.50 s');
    expect(formatParamValue(spec({ unit: 's' }), 2.2)).toBe('2.20 s');
    expect(formatParamValue(spec({ unit: '%' }), 0.256)).toBe('26%');
    expect(formatParamValue(spec({ unit: ':1' }), 4)).toBe('4.0:1');
    expect(formatParamValue(spec({ unit: 'st' }), 3)).toBe('+3 st');
    expect(formatParamValue(spec({ unit: 'st' }), -1.5)).toBe('-1.5 st');
    expect(formatParamValue(spec({ unit: 'ct' }), 7.4)).toBe('+7 ct');
    expect(formatParamValue(spec({ unit: 'ct' }), -12)).toBe('-12 ct');
    expect(formatParamValue(spec({ unit: 'voices' }), 8)).toBe('8');
    expect(formatParamValue(spec({ unit: '' }), 0.5)).toBe('0.50');
  });

  it('uses option labels for enumerated params', () => {
    const waveform = INSTRUMENT_PARAM_SPECS.synth[0]!;
    expect(formatParamValue(waveform, 0)).toBe('Sine');
    expect(formatParamValue(waveform, 2.2)).toBe('Sawtooth');
    expect(formatParamValue(spec({ options: [{ value: 0, label: 'Off' }] }), 0.7)).toBe('0.70');
  });
});
