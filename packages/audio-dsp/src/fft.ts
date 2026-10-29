/**
 * Radix-2 FFT and spectrum helpers (analysis, tests, spectrum displays).
 */

/**
 * In-place iterative radix-2 complex FFT (decimation in time, forward transform,
 * no scaling).
 *
 * - `re`/`im` must have the same power-of-two length (throws otherwise).
 * - Ownership: mutates both arrays. Determinism: fixed operation order.
 * - Complexity: O(n log n), no allocation besides loop variables.
 */
export function fftInPlace(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  if (n !== im.length || n === 0 || (n & (n - 1)) !== 0) {
    throw new Error('fftInPlace: length must be a power of two and equal for re/im');
  }
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const tr = re[i]!;
      re[i] = re[j]!;
      re[j] = tr;
      const ti = im[i]!;
      im[i] = im[j]!;
      im[j] = ti;
    }
  }
  for (let size = 2; size <= n; size <<= 1) {
    const half = size >> 1;
    const step = (-2 * Math.PI) / size;
    for (let start = 0; start < n; start += size) {
      for (let k = 0; k < half; k++) {
        const angle = step * k;
        const wr = Math.cos(angle);
        const wi = Math.sin(angle);
        const a = start + k;
        const b = a + half;
        const xr = re[b]! * wr - im[b]! * wi;
        const xi = re[b]! * wi + im[b]! * wr;
        re[b] = re[a]! - xr;
        im[b] = im[a]! - xi;
        re[a] = re[a]! + xr;
        im[a] = im[a]! + xi;
      }
    }
  }
}

/** Smallest power of two ≥ n (n ≥ 1). O(log n). */
export function nextPowerOfTwo(n: number): number {
  let p = 1;
  while (p < n) p <<= 1;
  return p;
}

/**
 * Magnitude spectrum of a real signal with a Hann window, zero-padded to `fftSize`
 * (default: next power of two ≥ samples.length). Returns `fftSize / 2 + 1` bins; bin k
 * is at `k · sampleRate / fftSize` Hz.
 *
 * - Ownership: reads `samples`; returns a new array. Complexity O(N log N).
 */
export function magnitudeSpectrum(samples: ArrayLike<number>, fftSize?: number): Float64Array {
  const size = nextPowerOfTwo(Math.max(fftSize ?? samples.length, samples.length, 2));
  const re = new Float64Array(size);
  const im = new Float64Array(size);
  const n = samples.length;
  for (let i = 0; i < n; i++) {
    const w = n > 1 ? 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1)) : 1;
    re[i] = samples[i]! * w;
  }
  fftInPlace(re, im);
  const out = new Float64Array(size / 2 + 1);
  for (let k = 0; k < out.length; k++) out[k] = Math.hypot(re[k]!, im[k]!);
  return out;
}

/**
 * Frequency (Hz) of the strongest spectral peak in [minHz, maxHz], refined by parabolic
 * interpolation of log magnitudes around the peak bin. Returns 0 for silence.
 *
 * - Accuracy: for a stationary sinusoid, well under one bin (sampleRate / fftSize).
 * - Complexity: O(N log N) with N = fftSize (default next power of two ≥ 4·length).
 */
export function dominantFrequency(
  samples: ArrayLike<number>,
  sampleRate: number,
  minHz = 20,
  maxHz = sampleRate / 2,
  fftSize?: number,
): number {
  const size = fftSize ?? nextPowerOfTwo(samples.length * 4);
  const spectrum = magnitudeSpectrum(samples, size);
  const binHz = sampleRate / nextPowerOfTwo(Math.max(size, samples.length, 2));
  const lo = Math.max(1, Math.floor(minHz / binHz));
  const hi = Math.min(spectrum.length - 2, Math.ceil(maxHz / binHz));
  let best = -1;
  let bestMag = 0;
  for (let k = lo; k <= hi; k++) {
    if (spectrum[k]! > bestMag) {
      bestMag = spectrum[k]!;
      best = k;
    }
  }
  if (best < 0 || bestMag === 0) return 0;
  const a = Math.log(spectrum[best - 1]! + 1e-30);
  const b = Math.log(spectrum[best]! + 1e-30);
  const c = Math.log(spectrum[best + 1]! + 1e-30);
  const denom = a - 2 * b + c;
  const offset = denom !== 0 ? (0.5 * (a - c)) / denom : 0;
  return (best + Math.max(-0.5, Math.min(0.5, offset))) * binHz;
}
