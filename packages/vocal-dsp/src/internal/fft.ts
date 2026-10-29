/**
 * In-place iterative radix-2 complex FFT on float64 arrays (no allocation per call).
 * Twiddle factors and the bit-reversal permutation are computed once per size and
 * cached; `Math.cos/sin` are only evaluated at table construction.
 */
export interface FftPlan {
  readonly size: number;
  readonly cos: Float64Array;
  readonly sin: Float64Array;
  readonly bitReverse: Uint32Array;
}

const plans = new Map<number, FftPlan>();

export function isPowerOfTwo(n: number): boolean {
  return n > 0 && (n & (n - 1)) === 0;
}

export function nextPowerOfTwo(n: number): number {
  let size = 1;
  while (size < n) size *= 2;
  return size;
}

export function getFftPlan(size: number): FftPlan {
  const cached = plans.get(size);
  if (cached !== undefined) return cached;
  if (!isPowerOfTwo(size)) throw new RangeError(`FFT size must be a power of two, got ${size}`);
  const half = size >> 1;
  const cos = new Float64Array(half);
  const sin = new Float64Array(half);
  for (let i = 0; i < half; i++) {
    cos[i] = Math.cos((2 * Math.PI * i) / size);
    sin[i] = -Math.sin((2 * Math.PI * i) / size);
  }
  const bits = Math.round(Math.log2(size));
  const bitReverse = new Uint32Array(size);
  for (let i = 0; i < size; i++) {
    let r = 0;
    let x = i;
    for (let b = 0; b < bits; b++) {
      r = (r << 1) | (x & 1);
      x >>= 1;
    }
    bitReverse[i] = r;
  }
  const plan: FftPlan = { size, cos, sin, bitReverse };
  plans.set(size, plan);
  return plan;
}

/**
 * Forward transform (e^{-i2πkn/N}) when `inverse` is false. The inverse is unscaled;
 * divide by N afterwards.
 */
export function fft(plan: FftPlan, re: Float64Array, im: Float64Array, inverse = false): void {
  const n = plan.size;
  const rev = plan.bitReverse;
  for (let i = 0; i < n; i++) {
    const j = rev[i]!;
    if (j > i) {
      const tr = re[i]!;
      re[i] = re[j]!;
      re[j] = tr;
      const ti = im[i]!;
      im[i] = im[j]!;
      im[j] = ti;
    }
  }
  const cosTable = plan.cos;
  const sinTable = plan.sin;
  const sign = inverse ? -1 : 1;
  for (let len = 2; len <= n; len <<= 1) {
    const halfLen = len >> 1;
    const step = n / len;
    for (let start = 0; start < n; start += len) {
      let t = 0;
      for (let k = 0; k < halfLen; k++) {
        const wr = cosTable[t]!;
        const wi = sign * sinTable[t]!;
        const a = start + k;
        const b = a + halfLen;
        const br = re[b]!;
        const bi = im[b]!;
        const xr = br * wr - bi * wi;
        const xi = br * wi + bi * wr;
        const ar = re[a]!;
        const ai = im[a]!;
        re[a] = ar + xr;
        im[a] = ai + xi;
        re[b] = ar - xr;
        im[b] = ai - xi;
        t += step;
      }
    }
  }
}
