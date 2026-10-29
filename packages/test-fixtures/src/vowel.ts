import { type F0Curve } from './f0';
import { framesFor, monoPcm, normalizePeak, type FixturePcm } from './pcm';
import { createSeededRandom } from './random';

/**
 * Source–filter vowel synthesiser for pitch-tracking and pitch-shifting fixtures.
 *
 * Source: a band-limited Rosenberg (type C) glottal pulse, differentiated for lip
 * radiation. Its Fourier coefficients are integrated analytically, and the waveform is
 * produced by additive synthesis driven by a float64 phase accumulator, so the source
 * is phase-continuous for any f0 curve and contains no aliasing (harmonics fade out
 * between 0.42·fs and 0.48·fs).
 * Filter: a cascade of five Klatt-style second-order resonators (F1–F5).
 * Aspiration ("breathiness"): seeded white noise, pitch-synchronously modulated,
 * added before the vocal-tract filter.
 */
export type VowelId = 'a' | 'e' | 'i' | 'o' | 'u';

export interface FormantSet {
  readonly frequenciesHz: readonly [number, number, number, number, number];
  readonly bandwidthsHz: readonly [number, number, number, number, number];
}

/** Average adult male formants (Peterson & Barney-style values, rounded). */
export const VOWEL_FORMANTS: Readonly<Record<VowelId, FormantSet>> = {
  a: { frequenciesHz: [730, 1090, 2440, 3400, 4500], bandwidthsHz: [80, 90, 120, 180, 250] },
  e: { frequenciesHz: [530, 1840, 2480, 3400, 4500], bandwidthsHz: [70, 100, 120, 180, 250] },
  i: { frequenciesHz: [270, 2290, 3010, 3600, 4500], bandwidthsHz: [60, 100, 140, 200, 250] },
  o: { frequenciesHz: [570, 840, 2410, 3400, 4500], bandwidthsHz: [70, 80, 120, 180, 250] },
  u: { frequenciesHz: [300, 870, 2240, 3400, 4500], bandwidthsHz: [60, 80, 120, 180, 250] },
};

export interface VowelOptions {
  readonly sampleRate: number;
  readonly durationSeconds: number;
  /** f0 in Hz at time t; 0 = unvoiced (silent). */
  readonly f0: F0Curve;
  readonly vowel?: VowelId;
  /** 0..1 aspiration noise; 1 ≈ 5 dB harmonics-to-noise ratio. Default 0. */
  readonly breathiness?: number;
  readonly seed?: number;
  /** Output peak level (default 0.5). */
  readonly amplitude?: number;
  /** Voicing on/off ramps inside each voiced span, seconds (default 0.01). */
  readonly rampSeconds?: number;
  /** Cycle-to-cycle f0 perturbation, fraction (e.g. 0.005 = 0.5 %). Default 0. */
  readonly jitter?: number;
  /** Cycle-to-cycle amplitude perturbation, fraction. Default 0. */
  readonly shimmer?: number;
  /** Override formants (e.g. to test formant preservation with unusual vowels). */
  readonly formants?: FormantSet;
}

const ROSENBERG_OPEN = 0.4;
const ROSENBERG_CLOSE = 0.16;
const MAX_HARMONICS = 2048;

interface Harmonics {
  readonly cos: Float64Array;
  readonly sin: Float64Array;
}

let cachedHarmonics: Harmonics | undefined;

/** ∫ sin(ωθ+ψ)·cos(νθ) dθ and ∫ sin(ωθ+ψ)·sin(νθ) dθ over [θ0, θ1]. */
function sinusoidProducts(
  omega: number,
  psi: number,
  nu: number,
  theta0: number,
  theta1: number,
): [number, number] {
  const sum = omega + nu;
  const diff = omega - nu;
  const primitiveCos = (theta: number): number => {
    const a = -Math.cos(sum * theta + psi) / sum;
    const b = Math.abs(diff) < 1e-12 ? Math.sin(psi) * theta : -Math.cos(diff * theta + psi) / diff;
    return 0.5 * (a + b);
  };
  const primitiveSin = (theta: number): number => {
    const a = Math.abs(diff) < 1e-12 ? Math.cos(psi) * theta : Math.sin(diff * theta + psi) / diff;
    const b = Math.sin(sum * theta + psi) / sum;
    return 0.5 * (a - b);
  };
  return [primitiveCos(theta1) - primitiveCos(theta0), primitiveSin(theta1) - primitiveSin(theta0)];
}

/** Fourier coefficients (per cycle) of the Rosenberg flow derivative. */
export function rosenbergDerivativeHarmonics(): Harmonics {
  if (cachedHarmonics !== undefined) return cachedHarmonics;
  const tp = ROSENBERG_OPEN;
  const tn = ROSENBERG_CLOSE;
  const cos = new Float64Array(MAX_HARMONICS + 1);
  const sin = new Float64Array(MAX_HARMONICS + 1);
  // Opening phase: g' = (π/2tp)·sin(πθ/tp) on [0, tp].
  const w1 = Math.PI / tp;
  const a1 = Math.PI / (2 * tp);
  // Closing phase: g' = -(π/2tn)·sin(π(θ - tp)/(2tn)) on [tp, tp + tn].
  const w2 = Math.PI / (2 * tn);
  const a2 = -Math.PI / (2 * tn);
  for (let k = 1; k <= MAX_HARMONICS; k++) {
    const nu = 2 * Math.PI * k;
    const [c1, s1] = sinusoidProducts(w1, 0, nu, 0, tp);
    const [c2, s2] = sinusoidProducts(w2, -w2 * tp, nu, tp, tp + tn);
    cos[k] = 2 * (a1 * c1 + a2 * c2);
    sin[k] = 2 * (a1 * s1 + a2 * s2);
  }
  cachedHarmonics = { cos, sin };
  return cachedHarmonics;
}

/** Klatt digital resonator coefficients with unity gain at DC. */
function resonator(
  frequencyHz: number,
  bandwidthHz: number,
  sampleRate: number,
): [number, number, number] {
  const T = 1 / sampleRate;
  const c = -Math.exp(-2 * Math.PI * bandwidthHz * T);
  const b = 2 * Math.exp(-Math.PI * bandwidthHz * T) * Math.cos(2 * Math.PI * frequencyHz * T);
  const a = 1 - b - c;
  return [a, b, c];
}

/** Applies a formant cascade in place (float64 state). */
export function applyFormants(
  signal: Float64Array,
  sampleRate: number,
  formants: FormantSet,
): void {
  for (let f = 0; f < 5; f++) {
    const freq = formants.frequenciesHz[f]!;
    if (freq >= sampleRate * 0.49) continue;
    const [a, b, c] = resonator(freq, formants.bandwidthsHz[f]!, sampleRate);
    let y1 = 0;
    let y2 = 0;
    for (let i = 0; i < signal.length; i++) {
      const y = a * signal[i]! + b * y1 + c * y2;
      y2 = y1;
      y1 = y;
      signal[i] = y;
    }
  }
}

/** Per-sample envelope: linear ramps at the edges of every voiced span. */
function voicingEnvelope(voiced: Uint8Array, rampFrames: number): Float64Array {
  const env = new Float64Array(voiced.length);
  let i = 0;
  while (i < voiced.length) {
    if (voiced[i] === 0) {
      i++;
      continue;
    }
    let j = i;
    while (j < voiced.length && voiced[j] === 1) j++;
    const ramp = Math.max(1, Math.min(rampFrames, Math.floor((j - i) / 2)));
    for (let n = i; n < j; n++) {
      const fromStart = (n - i + 0.5) / ramp;
      const fromEnd = (j - n - 0.5) / ramp;
      env[n] = Math.min(1, fromStart, fromEnd);
    }
    i = j;
  }
  return env;
}

export function synthesizeVowel(options: VowelOptions): FixturePcm {
  const { sampleRate } = options;
  const frames = framesFor(sampleRate, options.durationSeconds);
  const formants = options.formants ?? VOWEL_FORMANTS[options.vowel ?? 'a'];
  const breathiness = options.breathiness ?? 0;
  const jitter = options.jitter ?? 0;
  const shimmer = options.shimmer ?? 0;
  const random = createSeededRandom(options.seed ?? 1);
  const harmonics = rosenbergDerivativeHarmonics();

  const f0 = new Float64Array(frames);
  const voiced = new Uint8Array(frames);
  for (let n = 0; n < frames; n++) {
    const hz = options.f0(n / sampleRate);
    if (hz > 0) {
      f0[n] = hz;
      voiced[n] = 1;
    }
  }
  const env = voicingEnvelope(voiced, framesFor(sampleRate, options.rampSeconds ?? 0.01));

  // Noise level: aspiration RMS relative to the harmonic source's RMS at 150 Hz.
  let referencePower = 0;
  const referenceHarmonics = Math.floor((0.42 * sampleRate) / 150);
  for (let k = 1; k <= Math.min(referenceHarmonics, MAX_HARMONICS); k++) {
    referencePower += 0.5 * (harmonics.cos[k]! ** 2 + harmonics.sin[k]! ** 2);
  }
  const noiseStd = breathiness * 0.56 * Math.sqrt(referencePower);

  const source = new Float64Array(frames);
  let phase = 0; // cycles, wrapped to [0, 1)
  let cycleJitter = 0;
  let cycleShimmer = 0;
  const fadeStart = 0.42 * sampleRate;
  const fadeEnd = 0.48 * sampleRate;
  for (let n = 0; n < frames; n++) {
    if (voiced[n] === 0) continue;
    const hz = f0[n]! * (1 + cycleJitter);
    const angle = 2 * Math.PI * phase;
    const c1 = Math.cos(angle);
    const s1 = Math.sin(angle);
    let ck = c1;
    let sk = s1;
    let sum = 0;
    const kMax = Math.min(MAX_HARMONICS, Math.floor(fadeEnd / hz));
    for (let k = 1; k <= kMax; k++) {
      const fk = k * hz;
      let gain = 1;
      if (fk > fadeStart)
        gain = 0.5 + 0.5 * Math.cos((Math.PI * (fk - fadeStart)) / (fadeEnd - fadeStart));
      sum += gain * (harmonics.cos[k]! * ck + harmonics.sin[k]! * sk);
      const nextC = ck * c1 - sk * s1;
      sk = sk * c1 + ck * s1;
      ck = nextC;
    }
    let sample = sum * (1 + cycleShimmer);
    if (noiseStd > 0) {
      // Pitch-synchronous modulation: aspiration is strongest while the glottis is open.
      const modulation = phase < ROSENBERG_OPEN + ROSENBERG_CLOSE ? 1 : 0.35;
      sample += noiseStd * modulation * random.gaussian();
    }
    source[n] = sample * env[n]!;
    phase += hz / sampleRate;
    if (phase >= 1) {
      phase -= Math.floor(phase);
      // New glottal cycle: draw fresh perturbations.
      if (jitter > 0) cycleJitter = jitter * (2 * random() - 1);
      if (shimmer > 0) cycleShimmer = shimmer * (2 * random() - 1);
    }
  }
  applyFormants(source, sampleRate, formants);
  normalizePeak(source, options.amplitude ?? 0.5);
  return monoPcm(sampleRate, Float32Array.from(source));
}
