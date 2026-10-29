/**
 * Parameter specifications: the single source of truth for every automatable or
 * mappable numeric parameter (ranges, defaults, units and value curves). The UI,
 * MIDI mapping, validation and audio engines all read these specs.
 *
 * Every parameter is numeric. Enumerations are encoded as integer indices with
 * `options` so that mapping/automation can treat all parameters uniformly.
 */

export type ParamUnit = '' | 'dB' | 'Hz' | 'ms' | 's' | '%' | ':1' | 'st' | 'ct' | 'voices';

/** How a normalized 0..1 control position maps onto the parameter range. */
export type ParamCurve = 'linear' | 'log' | 'db';

export interface ParamOption {
  readonly value: number;
  readonly label: string;
}

export interface ParamSpec {
  readonly id: string;
  readonly label: string;
  readonly min: number;
  readonly max: number;
  readonly default: number;
  readonly unit: ParamUnit;
  readonly curve: ParamCurve;
  /** Quantization step in parameter units; omitted for continuous parameters. */
  readonly step?: number;
  readonly options?: readonly ParamOption[];
}

export type ParamValues = Readonly<Record<string, number>>;

/** Floor used by the `db` curve: positions at 0 map to `min` (treated as -inf when min <= -60). */
const DB_CURVE_EXPONENT = 2.5;

/** Number of decimal places in a number's shortest decimal representation. */
function decimalPlaces(n: number): number {
  if (!Number.isFinite(n) || Number.isInteger(n)) return 0;
  const text = String(n);
  const exp = text.indexOf('e-');
  const mantissa = exp >= 0 ? text.slice(0, exp) : text;
  const dot = mantissa.indexOf('.');
  const fraction = dot >= 0 ? mantissa.length - dot - 1 : 0;
  return fraction + (exp >= 0 ? Number(text.slice(exp + 2)) : 0);
}

export function clampParam(spec: ParamSpec, value: number): number {
  if (!Number.isFinite(value)) return spec.default;
  let v = Math.min(spec.max, Math.max(spec.min, value));
  if (spec.step !== undefined && spec.step > 0) {
    v = spec.min + Math.round((v - spec.min) / spec.step) * spec.step;
    // Remove binary floating-point noise (e.g. 26.990000000000002 for a 0.01 step).
    const places = Math.min(20, Math.max(decimalPlaces(spec.step), decimalPlaces(spec.min)));
    v = Number(v.toFixed(places));
    v = Math.min(spec.max, Math.max(spec.min, v));
  }
  return v;
}

/** Maps a normalized control position (0..1) to a parameter value. */
export function denormalizeParam(spec: ParamSpec, normalized: number): number {
  const n = Math.min(1, Math.max(0, normalized));
  let value: number;
  switch (spec.curve) {
    case 'log': {
      const lo = Math.max(spec.min, 1e-6);
      value = lo * Math.pow(spec.max / lo, n);
      break;
    }
    case 'db': {
      // Perceptual fader law: position^exponent over the span, so unity sits high on the fader.
      value = spec.min + (spec.max - spec.min) * Math.pow(n, 1 / DB_CURVE_EXPONENT);
      break;
    }
    default:
      value = spec.min + (spec.max - spec.min) * n;
  }
  return clampParam(spec, value);
}

/** Inverse of {@link denormalizeParam}. */
export function normalizeParam(spec: ParamSpec, value: number): number {
  const v = Math.min(spec.max, Math.max(spec.min, value));
  if (spec.max === spec.min) return 0;
  switch (spec.curve) {
    case 'log': {
      const lo = Math.max(spec.min, 1e-6);
      return Math.log(Math.max(v, lo) / lo) / Math.log(spec.max / lo);
    }
    case 'db':
      return Math.pow((v - spec.min) / (spec.max - spec.min), DB_CURVE_EXPONENT);
    default:
      return (v - spec.min) / (spec.max - spec.min);
  }
}

export function defaultParamValues(specs: readonly ParamSpec[]): Record<string, number> {
  const values: Record<string, number> = {};
  for (const spec of specs) values[spec.id] = spec.default;
  return values;
}

/** Returns values for every spec, filling gaps with defaults and clamping out-of-range input. */
export function sanitizeParamValues(
  specs: readonly ParamSpec[],
  values: Readonly<Record<string, number | undefined>>,
): Record<string, number> {
  const result: Record<string, number> = {};
  for (const spec of specs) {
    const raw = values[spec.id];
    result[spec.id] = raw === undefined ? spec.default : clampParam(spec, raw);
  }
  return result;
}

export function findParamSpec(specs: readonly ParamSpec[], id: string): ParamSpec | undefined {
  return specs.find((s) => s.id === id);
}

export function formatParamValue(spec: ParamSpec, value: number): string {
  if (spec.options) {
    const option = spec.options.find((o) => o.value === Math.round(value));
    if (option) return option.label;
  }
  switch (spec.unit) {
    case 'dB':
      return value <= -60 ? '-inf dB' : `${value >= 0 ? '+' : ''}${value.toFixed(1)} dB`;
    case 'Hz':
      return value >= 1000
        ? `${(value / 1000).toFixed(value >= 10000 ? 1 : 2)} kHz`
        : `${Math.round(value)} Hz`;
    case 'ms':
      return value >= 1000
        ? `${(value / 1000).toFixed(2)} s`
        : `${value.toFixed(value < 10 ? 1 : 0)} ms`;
    case 's':
      return `${value.toFixed(2)} s`;
    case '%':
      return `${Math.round(value * 100)}%`;
    case ':1':
      return `${value.toFixed(1)}:1`;
    case 'st':
      return `${value > 0 ? '+' : ''}${value.toFixed(value % 1 === 0 ? 0 : 1)} st`;
    case 'ct':
      return `${value > 0 ? '+' : ''}${Math.round(value)} ct`;
    case 'voices':
      return `${Math.round(value)}`;
    default:
      return value.toFixed(2);
  }
}

// ---------------------------------------------------------------------------
// Mixer parameters
// ---------------------------------------------------------------------------

export const TRACK_GAIN_SPEC: ParamSpec = {
  id: 'gainDb',
  label: 'Volume',
  min: -60,
  max: 6,
  default: 0,
  unit: 'dB',
  curve: 'db',
};

export const TRACK_PAN_SPEC: ParamSpec = {
  id: 'pan',
  label: 'Pan',
  min: -1,
  max: 1,
  default: 0,
  unit: '',
  curve: 'linear',
};

export const MASTER_GAIN_SPEC: ParamSpec = { ...TRACK_GAIN_SPEC, label: 'Master' };

export const TEMPO_SPEC: ParamSpec = {
  id: 'bpm',
  label: 'Tempo',
  min: 20,
  max: 400,
  default: 120,
  unit: '',
  curve: 'linear',
  step: 0.01,
};

// ---------------------------------------------------------------------------
// Effects
// ---------------------------------------------------------------------------

export type EffectKind = 'gain' | 'eq3' | 'compressor' | 'reverb' | 'delay' | 'distortion';

export const EFFECT_KINDS: readonly EffectKind[] = [
  'gain',
  'eq3',
  'compressor',
  'reverb',
  'delay',
  'distortion',
];

export const EFFECT_LABELS: Readonly<Record<EffectKind, string>> = {
  gain: 'Gain',
  eq3: 'EQ Three',
  compressor: 'Compressor',
  reverb: 'Reverb',
  delay: 'Delay',
  distortion: 'Distortion',
};

const mixSpec: ParamSpec = {
  id: 'mix',
  label: 'Mix',
  min: 0,
  max: 1,
  default: 0.25,
  unit: '%',
  curve: 'linear',
};

export const EFFECT_PARAM_SPECS: Readonly<Record<EffectKind, readonly ParamSpec[]>> = {
  gain: [
    { id: 'gainDb', label: 'Gain', min: -60, max: 24, default: 0, unit: 'dB', curve: 'linear' },
  ],
  eq3: [
    { id: 'lowGainDb', label: 'Low', min: -18, max: 18, default: 0, unit: 'dB', curve: 'linear' },
    { id: 'lowFreq', label: 'Low Freq', min: 40, max: 800, default: 200, unit: 'Hz', curve: 'log' },
    { id: 'midGainDb', label: 'Mid', min: -18, max: 18, default: 0, unit: 'dB', curve: 'linear' },
    {
      id: 'midFreq',
      label: 'Mid Freq',
      min: 200,
      max: 8000,
      default: 1000,
      unit: 'Hz',
      curve: 'log',
    },
    { id: 'midQ', label: 'Mid Q', min: 0.3, max: 6, default: 0.7, unit: '', curve: 'log' },
    { id: 'highGainDb', label: 'High', min: -18, max: 18, default: 0, unit: 'dB', curve: 'linear' },
    {
      id: 'highFreq',
      label: 'High Freq',
      min: 1500,
      max: 16000,
      default: 5000,
      unit: 'Hz',
      curve: 'log',
    },
  ],
  compressor: [
    {
      id: 'thresholdDb',
      label: 'Threshold',
      min: -60,
      max: 0,
      default: -18,
      unit: 'dB',
      curve: 'linear',
    },
    { id: 'ratio', label: 'Ratio', min: 1, max: 20, default: 4, unit: ':1', curve: 'log' },
    { id: 'attackMs', label: 'Attack', min: 0.1, max: 200, default: 10, unit: 'ms', curve: 'log' },
    {
      id: 'releaseMs',
      label: 'Release',
      min: 10,
      max: 2000,
      default: 150,
      unit: 'ms',
      curve: 'log',
    },
    { id: 'kneeDb', label: 'Knee', min: 0, max: 40, default: 6, unit: 'dB', curve: 'linear' },
    { id: 'makeupDb', label: 'Makeup', min: 0, max: 24, default: 0, unit: 'dB', curve: 'linear' },
  ],
  reverb: [
    {
      id: 'decaySeconds',
      label: 'Decay',
      min: 0.2,
      max: 10,
      default: 2.2,
      unit: 's',
      curve: 'log',
    },
    {
      id: 'preDelayMs',
      label: 'Pre-delay',
      min: 0,
      max: 200,
      default: 20,
      unit: 'ms',
      curve: 'linear',
    },
    {
      id: 'dampingHz',
      label: 'Damping',
      min: 1000,
      max: 18000,
      default: 8000,
      unit: 'Hz',
      curve: 'log',
    },
    mixSpec,
  ],
  delay: [
    { id: 'timeMs', label: 'Time', min: 1, max: 2000, default: 375, unit: 'ms', curve: 'log' },
    {
      id: 'feedback',
      label: 'Feedback',
      min: 0,
      max: 0.95,
      default: 0.35,
      unit: '%',
      curve: 'linear',
    },
    { id: 'toneHz', label: 'Tone', min: 500, max: 18000, default: 8000, unit: 'Hz', curve: 'log' },
    mixSpec,
  ],
  distortion: [
    { id: 'drive', label: 'Drive', min: 0, max: 1, default: 0.3, unit: '%', curve: 'linear' },
    { id: 'toneHz', label: 'Tone', min: 500, max: 18000, default: 6000, unit: 'Hz', curve: 'log' },
    { ...mixSpec, default: 1 },
    { id: 'outputDb', label: 'Output', min: -24, max: 6, default: 0, unit: 'dB', curve: 'linear' },
  ],
};

// ---------------------------------------------------------------------------
// Instruments
// ---------------------------------------------------------------------------

export type InstrumentKind = 'synth' | 'drums' | 'sampler';

export const INSTRUMENT_LABELS: Readonly<Record<InstrumentKind, string>> = {
  synth: 'Poly Synth',
  drums: 'Drum Kit',
  sampler: 'Sampler',
};

export const OSCILLATOR_WAVEFORMS = ['sine', 'triangle', 'sawtooth', 'square'] as const;
export type OscillatorWaveform = (typeof OSCILLATOR_WAVEFORMS)[number];

const waveformOptions: readonly ParamOption[] = OSCILLATOR_WAVEFORMS.map((w, i) => ({
  value: i,
  label: w[0]!.toUpperCase() + w.slice(1),
}));

export const INSTRUMENT_PARAM_SPECS: Readonly<Record<InstrumentKind, readonly ParamSpec[]>> = {
  synth: [
    {
      id: 'osc1Waveform',
      label: 'Osc 1',
      min: 0,
      max: 3,
      default: 2,
      unit: '',
      curve: 'linear',
      step: 1,
      options: waveformOptions,
    },
    {
      id: 'osc2Waveform',
      label: 'Osc 2',
      min: 0,
      max: 3,
      default: 3,
      unit: '',
      curve: 'linear',
      step: 1,
      options: waveformOptions,
    },
    { id: 'osc2Mix', label: 'Osc 2 Mix', min: 0, max: 1, default: 0.3, unit: '%', curve: 'linear' },
    {
      id: 'osc2Detune',
      label: 'Detune',
      min: -50,
      max: 50,
      default: 7,
      unit: 'ct',
      curve: 'linear',
    },
    {
      id: 'osc2Octave',
      label: 'Osc 2 Oct',
      min: -2,
      max: 2,
      default: 0,
      unit: '',
      curve: 'linear',
      step: 1,
    },
    { id: 'attack', label: 'Attack', min: 0.001, max: 5, default: 0.005, unit: 's', curve: 'log' },
    { id: 'decay', label: 'Decay', min: 0.005, max: 5, default: 0.3, unit: 's', curve: 'log' },
    { id: 'sustain', label: 'Sustain', min: 0, max: 1, default: 0.7, unit: '%', curve: 'linear' },
    {
      id: 'release',
      label: 'Release',
      min: 0.005,
      max: 10,
      default: 0.25,
      unit: 's',
      curve: 'log',
    },
    {
      id: 'cutoffHz',
      label: 'Cutoff',
      min: 40,
      max: 18000,
      default: 4000,
      unit: 'Hz',
      curve: 'log',
    },
    { id: 'resonance', label: 'Resonance', min: 0.1, max: 20, default: 1, unit: '', curve: 'log' },
    {
      id: 'filterEnvAmount',
      label: 'Filter Env',
      min: 0,
      max: 1,
      default: 0.3,
      unit: '%',
      curve: 'linear',
    },
    {
      id: 'filterDecay',
      label: 'Filter Decay',
      min: 0.005,
      max: 5,
      default: 0.4,
      unit: 's',
      curve: 'log',
    },
    {
      id: 'polyphony',
      label: 'Voices',
      min: 1,
      max: 16,
      default: 8,
      unit: 'voices',
      curve: 'linear',
      step: 1,
    },
    { id: 'glideMs', label: 'Glide', min: 0, max: 1000, default: 0, unit: 'ms', curve: 'linear' },
    { id: 'gainDb', label: 'Level', min: -36, max: 6, default: -6, unit: 'dB', curve: 'linear' },
  ],
  drums: [
    { id: 'tune', label: 'Tune', min: -12, max: 12, default: 0, unit: 'st', curve: 'linear' },
    { id: 'decayScale', label: 'Decay', min: 0.25, max: 4, default: 1, unit: '', curve: 'log' },
    { id: 'tone', label: 'Tone', min: 0, max: 1, default: 0.5, unit: '%', curve: 'linear' },
    { id: 'gainDb', label: 'Level', min: -36, max: 6, default: -3, unit: 'dB', curve: 'linear' },
  ],
  sampler: [
    {
      id: 'rootNote',
      label: 'Root',
      min: 0,
      max: 127,
      default: 60,
      unit: '',
      curve: 'linear',
      step: 1,
    },
    { id: 'attack', label: 'Attack', min: 0.001, max: 5, default: 0.002, unit: 's', curve: 'log' },
    { id: 'release', label: 'Release', min: 0.005, max: 10, default: 0.2, unit: 's', curve: 'log' },
    {
      id: 'oneShot',
      label: 'One-shot',
      min: 0,
      max: 1,
      default: 0,
      unit: '',
      curve: 'linear',
      step: 1,
      options: [
        { value: 0, label: 'Gate' },
        { value: 1, label: 'One-shot' },
      ],
    },
    { id: 'gainDb', label: 'Level', min: -36, max: 6, default: -3, unit: 'dB', curve: 'linear' },
  ],
};

export interface InstrumentPreset {
  readonly id: string;
  readonly label: string;
  readonly kind: InstrumentKind;
  readonly params: ParamValues;
}

/** Original factory presets (designed for this project; no third-party patch data). */
export const SYNTH_PRESETS: readonly InstrumentPreset[] = [
  {
    id: 'synth.pad',
    label: 'Soft Pad',
    kind: 'synth',
    params: {
      osc1Waveform: 2,
      osc2Waveform: 1,
      osc2Mix: 0.5,
      osc2Detune: 12,
      osc2Octave: 0,
      attack: 0.6,
      decay: 1.2,
      sustain: 0.8,
      release: 1.8,
      cutoffHz: 1800,
      resonance: 0.8,
      filterEnvAmount: 0.15,
      filterDecay: 1.5,
      polyphony: 12,
      glideMs: 0,
      gainDb: -10,
    },
  },
  {
    id: 'synth.bass',
    label: 'Round Bass',
    kind: 'synth',
    params: {
      osc1Waveform: 3,
      osc2Waveform: 0,
      osc2Mix: 0.6,
      osc2Detune: 0,
      osc2Octave: -1,
      attack: 0.003,
      decay: 0.25,
      sustain: 0.6,
      release: 0.12,
      cutoffHz: 600,
      resonance: 2.5,
      filterEnvAmount: 0.45,
      filterDecay: 0.22,
      polyphony: 1,
      glideMs: 40,
      gainDb: -6,
    },
  },
  {
    id: 'synth.lead',
    label: 'Bright Lead',
    kind: 'synth',
    params: {
      osc1Waveform: 2,
      osc2Waveform: 2,
      osc2Mix: 0.45,
      osc2Detune: 9,
      osc2Octave: 0,
      attack: 0.01,
      decay: 0.2,
      sustain: 0.75,
      release: 0.2,
      cutoffHz: 5200,
      resonance: 3,
      filterEnvAmount: 0.3,
      filterDecay: 0.3,
      polyphony: 4,
      glideMs: 25,
      gainDb: -9,
    },
  },
  {
    id: 'synth.pluck',
    label: 'Pluck',
    kind: 'synth',
    params: {
      osc1Waveform: 2,
      osc2Waveform: 3,
      osc2Mix: 0.25,
      osc2Detune: 5,
      osc2Octave: 1,
      attack: 0.002,
      decay: 0.28,
      sustain: 0,
      release: 0.25,
      cutoffHz: 900,
      resonance: 4,
      filterEnvAmount: 0.7,
      filterDecay: 0.18,
      polyphony: 8,
      glideMs: 0,
      gainDb: -8,
    },
  },
  {
    id: 'synth.keys',
    label: 'Electric Keys',
    kind: 'synth',
    params: {
      osc1Waveform: 1,
      osc2Waveform: 0,
      osc2Mix: 0.5,
      osc2Detune: 3,
      osc2Octave: 1,
      attack: 0.004,
      decay: 1.1,
      sustain: 0.35,
      release: 0.45,
      cutoffHz: 3000,
      resonance: 0.9,
      filterEnvAmount: 0.25,
      filterDecay: 0.8,
      polyphony: 10,
      glideMs: 0,
      gainDb: -8,
    },
  },
];
