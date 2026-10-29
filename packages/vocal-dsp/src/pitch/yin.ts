import { fft, getFftPlan, nextPowerOfTwo, type FftPlan } from '../internal/fft';

/**
 * YIN front end (de Cheveigné & Kawahara 2002): squared-difference function computed
 * through an FFT cross-correlation, cumulative-mean normalisation (CMNDF), trough
 * picking and parabolic refinement. Clean-room implementation from the paper.
 */
export interface YinConfig {
  readonly sampleRate: number;
  /** Integration window W in samples. */
  readonly window: number;
  /** Lag search range in samples (inclusive). */
  readonly tauMin: number;
  readonly tauMax: number;
  /** Samples read per frame: W + τmax + 2. */
  readonly span: number;
  readonly fftSize: number;
}

export function createYinConfig(
  sampleRate: number,
  frameSamples: number,
  minHz: number,
  maxHz: number,
): YinConfig {
  const tauMin = Math.max(2, Math.floor(sampleRate / maxHz));
  const tauMax = Math.max(tauMin + 2, Math.ceil(sampleRate / minHz));
  const window = Math.max(tauMin * 2, Math.floor(frameSamples / 2));
  const span = window + tauMax + 2;
  return { sampleRate, window, tauMin, tauMax, span, fftSize: nextPowerOfTwo(span) };
}

/** Reusable per-thread scratch buffers. */
export interface YinWorkspace {
  readonly plan: FftPlan;
  readonly re: Float64Array;
  readonly im: Float64Array;
  readonly frame: Float64Array;
  readonly energy: Float64Array;
  readonly cmndf: Float64Array;
  /** Refined trough periods (samples) and CMNDF heights, in increasing period order. */
  readonly troughPeriod: Float64Array;
  readonly troughHeight: Float64Array;
}

export function createYinWorkspace(config: YinConfig): YinWorkspace {
  const maxTroughs = Math.ceil((config.tauMax - config.tauMin) / 2) + 2;
  return {
    plan: getFftPlan(config.fftSize),
    re: new Float64Array(config.fftSize),
    im: new Float64Array(config.fftSize),
    frame: new Float64Array(config.span),
    energy: new Float64Array(config.span + 1),
    cmndf: new Float64Array(config.tauMax + 2),
    troughPeriod: new Float64Array(maxTroughs),
    troughHeight: new Float64Array(maxTroughs),
  };
}

export interface YinFrameResult {
  readonly troughCount: number;
  /** Smallest refined CMNDF value within the lag range (1 for silence). */
  readonly minHeight: number;
}

/**
 * Analyses the frame whose span starts at sample `start` (samples outside the signal
 * read as zero). Results are written into the workspace trough arrays.
 */
export function analyzeYinFrame(
  signal: Float64Array,
  start: number,
  config: YinConfig,
  ws: YinWorkspace,
): YinFrameResult {
  const { window: W, tauMin, tauMax, span, fftSize: M } = config;
  const { re, im, frame, energy, cmndf } = ws;

  // 1. Copy the span (zero padded at the signal edges) and its energy prefix sums.
  energy[0] = 0;
  for (let j = 0; j < span; j++) {
    const index = start + j;
    const x = index >= 0 && index < signal.length ? signal[index]! : 0;
    frame[j] = x;
    energy[j + 1] = energy[j]! + x * x;
  }
  if (energy[span]! <= 1e-20) return { troughCount: 0, minHeight: 1 };

  // 2. Cross-correlation r(τ) = Σ_{j<W} x_j·x_{j+τ}: pack a = x[0..W) (real part) and
  //    b = x[0..span) (imaginary part) into one complex FFT.
  for (let j = 0; j < M; j++) {
    re[j] = j < W ? frame[j]! : 0;
    im[j] = j < span ? frame[j]! : 0;
  }
  fft(ws.plan, re, im, false);
  // conj(A_k)·B_k with A = (Z_k + conj Z_{M-k})/2, B = (Z_k - conj Z_{M-k})/(2i).
  // Computed for k and M-k together, in place.
  for (let k = 0; k <= M >> 1; k++) {
    const k2 = (M - k) & (M - 1);
    const zr = re[k]!;
    const zi = im[k]!;
    const wr = re[k2]!;
    const wi = -im[k2]!; // conj(Z_{M-k})
    const ar = 0.5 * (zr + wr);
    const ai = 0.5 * (zi + wi);
    // B = (Z - W)/(2i) = ((zi - wi) - i(zr - wr))/2
    const br = 0.5 * (zi - wi);
    const bi = -0.5 * (zr - wr);
    // P_k = conj(A)·B
    const pr = ar * br + ai * bi;
    const pi = ar * bi - ai * br;
    re[k] = pr;
    im[k] = pi;
    if (k2 !== k) {
      // P_{M-k} = conj(P_k) because r is real.
      re[k2] = pr;
      im[k2] = -pi;
    }
  }
  fft(ws.plan, re, im, true);
  const scale = 1 / M;

  // 3. Difference function d(τ) = E_a + E_b(τ) - 2r(τ) and its cumulative-mean normalisation.
  const energyA = energy[W]!;
  cmndf[0] = 1;
  let running = 0;
  const last = tauMax + 1;
  for (let tau = 1; tau <= last; tau++) {
    const energyB = energy[tau + W]! - energy[tau]!;
    let d = energyA + energyB - 2 * re[tau]! * scale;
    if (d < 0) d = 0;
    running += d;
    cmndf[tau] = running > 0 ? (d * tau) / running : 1;
  }

  // 4. Troughs in [τmin, τmax] with parabolic refinement.
  let count = 0;
  let minHeight = 1;
  for (let tau = tauMin; tau <= tauMax; tau++) {
    const c = cmndf[tau]!;
    const right = cmndf[tau + 1]!;
    const isTrough = tau === tauMin ? c < right : c < cmndf[tau - 1]! && c <= right;
    if (!isTrough) continue;
    const left = cmndf[tau - 1]!;
    const denominator = left - 2 * c + right;
    let shift = denominator > 0 ? (0.5 * (left - right)) / denominator : 0;
    if (shift > 1) shift = 1;
    else if (shift < -1) shift = -1;
    let height = c - 0.25 * (left - right) * shift;
    if (height < 0) height = 0;
    if (height > c) height = c;
    ws.troughPeriod[count] = tau + shift;
    ws.troughHeight[count] = height;
    count++;
    if (height < minHeight) minHeight = height;
  }
  return { troughCount: count, minHeight };
}
