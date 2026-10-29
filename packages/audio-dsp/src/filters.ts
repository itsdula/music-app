/**
 * Small, allocation-free filter kernels used by the offline synthesis routines
 * (drums, impulse responses). Coefficients follow the RBJ "Audio EQ Cookbook" for
 * biquads and the standard exponential one-pole design. All processing is in-place on
 * float32 buffers with float64 state.
 */

export type BiquadKind = 'lowpass' | 'highpass' | 'bandpass';

export interface BiquadCoefficients {
  readonly b0: number;
  readonly b1: number;
  readonly b2: number;
  readonly a1: number;
  readonly a2: number;
}

/**
 * RBJ cookbook biquad coefficients (normalized by a0).
 *
 * - Units: `frequencyHz` in Hz (clamped to (0, 0.49·sampleRate)), `q` dimensionless.
 *   `bandpass` is the constant 0 dB peak-gain variant.
 * - Determinism: closed-form; float tolerance ~1e-12 when ported. Complexity O(1).
 */
export function biquadCoefficients(
  kind: BiquadKind,
  sampleRate: number,
  frequencyHz: number,
  q: number,
): BiquadCoefficients {
  const f = Math.min(Math.max(frequencyHz, 1), sampleRate * 0.49);
  const w0 = (2 * Math.PI * f) / sampleRate;
  const cos = Math.cos(w0);
  const alpha = Math.sin(w0) / (2 * Math.max(q, 1e-4));
  let b0: number;
  let b1: number;
  let b2: number;
  if (kind === 'lowpass') {
    b0 = (1 - cos) / 2;
    b1 = 1 - cos;
    b2 = (1 - cos) / 2;
  } else if (kind === 'highpass') {
    b0 = (1 + cos) / 2;
    b1 = -(1 + cos);
    b2 = (1 + cos) / 2;
  } else {
    b0 = alpha;
    b1 = 0;
    b2 = -alpha;
  }
  const a0 = 1 + alpha;
  return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: (-2 * cos) / a0, a2: (1 - alpha) / a0 };
}

/**
 * Filters `samples` in place with a direct-form-I biquad (zero initial state).
 * Ownership: mutates `samples`. Complexity O(n).
 */
export function applyBiquad(samples: Float32Array, c: BiquadCoefficients): void {
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  for (let i = 0; i < samples.length; i++) {
    const x = samples[i]!;
    const y = c.b0 * x + c.b1 * x1 + c.b2 * x2 - c.a1 * y1 - c.a2 * y2;
    x2 = x1;
    x1 = x;
    y2 = y1;
    y1 = y;
    samples[i] = y;
  }
}

/**
 * One-pole smoothing coefficient for a cutoff frequency: `exp(-2π·fc/fs)`.
 * Complexity O(1).
 */
export function onePoleCoefficient(sampleRate: number, cutoffHz: number): number {
  const fc = Math.min(Math.max(cutoffHz, 1), sampleRate * 0.49);
  return Math.exp((-2 * Math.PI * fc) / sampleRate);
}
