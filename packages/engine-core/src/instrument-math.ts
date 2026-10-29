/**
 * Instrument math shared by backends: pitch, velocity, envelope shapes and the synth
 * filter/modulation mappings. Every function is pure, O(1) and deterministic up to
 * IEEE-754 `Math.pow/exp/log` rounding (port with ~1e-12 relative tolerance).
 */

/** Decay parameter = time to get within e^-4 (≈ 98 %) of the sustain level. */
export const DECAY_TIME_CONSTANT_DIVISOR = 4;
/** Release parameter = time to fall to e^-7 (≈ −61 dB) of the release start level. */
export const RELEASE_TIME_CONSTANT_DIVISOR = 7;
/** Pitch-bend range (± semitones) used when an instrument does not define one. */
export const PITCH_BEND_RANGE_SEMITONES = 2;
/** Mod-wheel vibrato. */
export const VIBRATO_RATE_HZ = 5.5;
export const VIBRATO_MAX_DEPTH_CENTS = 50;
/** Filter envelope reaches at most this many octaves above the cutoff (amount = 1). */
export const FILTER_ENV_MAX_OCTAVES = 4;
/** Exponent of the velocity → amplitude curve. */
export const VELOCITY_CURVE_EXPONENT = 1.6;

export interface AdsrShape {
  /** Seconds, linear rise 0 → 1. */
  readonly attack: number;
  /** Seconds (see {@link DECAY_TIME_CONSTANT_DIVISOR}). */
  readonly decay: number;
  /** 0..1 level held while the key is down. */
  readonly sustain: number;
}

/** Equal-tempered frequency (Hz) of a MIDI pitch; A4 = 69 = 440 Hz. */
export function midiToFrequency(pitch: number): number {
  return 440 * Math.pow(2, (pitch - 69) / 12);
}

/** Frequency ratio of an interval in semitones: 2^(st/12). */
export function semitoneRatio(semitones: number): number {
  return Math.pow(2, semitones / 12);
}

/** Sampler playback rate for `note` with the sample recorded at `rootNote`. */
export function samplerPlaybackRate(note: number, rootNote: number): number {
  return semitoneRatio(note - rootNote);
}

/** MIDI velocity (clamped to 0..127) → linear amplitude: (v/127)^1.6. */
export function velocityToGain(velocity: number): number {
  const v = Math.min(127, Math.max(0, velocity)) / 127;
  return Math.pow(v, VELOCITY_CURVE_EXPONENT);
}

/**
 * Envelope level (0..1) `elapsed` seconds after note-on while the key is held:
 * linear attack, then exponential approach to `sustain` with time constant
 * decay / {@link DECAY_TIME_CONSTANT_DIVISOR}.
 */
export function adsrLevelAt(shape: AdsrShape, elapsed: number): number {
  if (elapsed <= 0) return 0;
  const attack = Math.max(0, shape.attack);
  if (elapsed < attack) return elapsed / attack;
  const tau = Math.max(1e-6, shape.decay / DECAY_TIME_CONSTANT_DIVISOR);
  return shape.sustain + (1 - shape.sustain) * Math.exp(-(elapsed - attack) / tau);
}

/** Release time constant (s) for a release parameter. */
export function releaseTimeConstant(release: number): number {
  return Math.max(1e-4, release / RELEASE_TIME_CONSTANT_DIVISOR);
}

/** Level `elapsed` seconds into the release phase starting at `startLevel`. */
export function releaseLevelAt(startLevel: number, release: number, elapsed: number): number {
  if (elapsed <= 0) return startLevel;
  return startLevel * Math.exp(-elapsed / releaseTimeConstant(release));
}

/**
 * Peak cutoff (Hz) of the synth filter envelope: cutoff · 2^(4·amount), capped at
 * 0.45 · sampleRate (below Nyquist) and 20 kHz.
 */
export function filterEnvelopePeakHz(cutoffHz: number, amount: number, sampleRate: number): number {
  const a = Math.min(1, Math.max(0, amount));
  return Math.min(cutoffHz * Math.pow(2, FILTER_ENV_MAX_OCTAVES * a), 0.45 * sampleRate, 20000);
}

/**
 * Synth resonance (linear Q, 0.1..20) → Web Audio lowpass `Q` in dB (the resonant peak
 * height): 20·log10(Q). Q = 1/√2 → −3 dB (Butterworth), Q = 1 → 0 dB, Q = 20 → 26 dB.
 */
export function resonanceToQDb(resonance: number): number {
  return 20 * Math.log10(Math.max(1e-4, resonance));
}

/** Pitch-bend wheel (−1..1, clamped) → detune in cents for ± `rangeSemitones`. */
export function pitchBendCents(value: number, rangeSemitones = PITCH_BEND_RANGE_SEMITONES): number {
  const v = Number.isFinite(value) ? Math.min(1, Math.max(-1, value)) : 0;
  return v * rangeSemitones * 100;
}

/** Mod wheel (0..1, clamped) → vibrato depth in cents (peak deviation). */
export function vibratoDepthCents(modulation: number): number {
  const m = Number.isFinite(modulation) ? Math.min(1, Math.max(0, modulation)) : 0;
  return m * VIBRATO_MAX_DEPTH_CENTS;
}
