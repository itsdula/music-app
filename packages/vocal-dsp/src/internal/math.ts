/** Small deterministic numeric helpers shared by the analysis and rendering stages. */

export function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

/** Median of a numeric list (copies; NaN for empty input). Average of the two middle values. */
export function median(values: ArrayLike<number>): number {
  const n = values.length;
  if (n === 0) return Number.NaN;
  const sorted = Float64Array.from(values).sort();
  const mid = n >> 1;
  return n % 2 === 1 ? sorted[mid]! : 0.5 * (sorted[mid - 1]! + sorted[mid]!);
}

/** Running median with an odd window, shrinking at the edges. */
export function medianFilter(values: Float64Array, window: number): Float64Array {
  const half = Math.max(0, Math.floor(window / 2));
  const out = new Float64Array(values.length);
  if (half === 0) {
    out.set(values);
    return out;
  }
  const scratch = new Float64Array(2 * half + 1);
  for (let i = 0; i < values.length; i++) {
    const lo = Math.max(0, i - half);
    const hi = Math.min(values.length - 1, i + half);
    const count = hi - lo + 1;
    for (let j = 0; j < count; j++) scratch[j] = values[lo + j]!;
    const view = scratch.subarray(0, count).sort();
    const mid = count >> 1;
    out[i] = count % 2 === 1 ? view[mid]! : 0.5 * (view[mid - 1]! + view[mid]!);
  }
  return out;
}

/** Centred moving average over `window` samples (odd), shrinking at the edges. */
export function movingAverage(values: Float64Array, window: number): Float64Array {
  const half = Math.max(0, Math.floor(window / 2));
  const out = new Float64Array(values.length);
  const prefix = new Float64Array(values.length + 1);
  for (let i = 0; i < values.length; i++) prefix[i + 1] = prefix[i]! + values[i]!;
  for (let i = 0; i < values.length; i++) {
    const lo = Math.max(0, i - half);
    const hi = Math.min(values.length, i + half + 1);
    out[i] = (prefix[hi]! - prefix[lo]!) / (hi - lo);
  }
  return out;
}

/**
 * Moving average whose window (`window` samples) is shifted inwards at the edges rather
 * than truncated, so every output averages exactly `window` samples (or all of them
 * when the input is shorter). Avoids edge artefacts when smoothing out oscillations.
 */
export function clampedMovingAverage(values: Float64Array, window: number): Float64Array {
  const n = values.length;
  const w = Math.max(1, Math.min(n, Math.round(window)));
  const out = new Float64Array(n);
  const prefix = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) prefix[i + 1] = prefix[i]! + values[i]!;
  const half = Math.floor(w / 2);
  for (let i = 0; i < n; i++) {
    const lo = Math.min(Math.max(0, i - half), n - w);
    out[i] = (prefix[lo + w]! - prefix[lo]!) / w;
  }
  return out;
}

/** Raised-cosine ramp: 0 at x ≤ 0, 1 at x ≥ 1. */
export function smoothRamp(x: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  return 0.5 - 0.5 * Math.cos(Math.PI * x);
}

export function hzToMidi(hz: number): number {
  return 69 + 12 * Math.log2(hz / 440);
}

export function midiToHz(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

/** Least-squares line y = a + b·(x - x̄); returns intercept at x̄, slope and x̄. */
export function fitLine(
  x: ArrayLike<number>,
  y: ArrayLike<number>,
): { readonly mean: number; readonly slope: number; readonly xMean: number } {
  const n = Math.min(x.length, y.length);
  if (n === 0) return { mean: Number.NaN, slope: 0, xMean: 0 };
  let sx = 0;
  let sy = 0;
  for (let i = 0; i < n; i++) {
    sx += x[i]!;
    sy += y[i]!;
  }
  const xMean = sx / n;
  const yMean = sy / n;
  let sxx = 0;
  let sxy = 0;
  for (let i = 0; i < n; i++) {
    const dx = x[i]! - xMean;
    sxx += dx * dx;
    sxy += dx * (y[i]! - yMean);
  }
  return { mean: yMean, slope: sxx > 0 ? sxy / sxx : 0, xMean };
}
