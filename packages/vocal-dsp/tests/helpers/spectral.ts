/**
 * Test-only spectral-envelope measurement: LPC (autocorrelation method) on a signal
 * decimated to ≈12 kHz, with the autocorrelation averaged over 30 ms Hamming frames so
 * the estimate reflects the vocal-tract envelope rather than individual harmonics.
 */
function lowpassDecimate(x: Float32Array, factor: number): Float64Array {
  const taps = 8 * factor + 1;
  const cutoff = 0.45 / factor;
  const h = new Float64Array(taps);
  const mid = (taps - 1) / 2;
  let sum = 0;
  for (let i = 0; i < taps; i++) {
    const t = i - mid;
    const sinc = t === 0 ? 2 * cutoff : Math.sin(2 * Math.PI * cutoff * t) / (Math.PI * t);
    h[i] = sinc * (0.54 - 0.46 * Math.cos((2 * Math.PI * i) / (taps - 1)));
    sum += h[i]!;
  }
  const out = new Float64Array(Math.floor(x.length / factor));
  for (let n = 0; n < out.length; n++) {
    let acc = 0;
    const centre = n * factor;
    for (let i = 0; i < taps; i++) {
      const j = centre + i - mid;
      if (j >= 0 && j < x.length) acc += h[i]! * x[j]!;
    }
    out[n] = acc / sum;
  }
  return out;
}

function levinson(r: Float64Array, order: number): Float64Array {
  const a = new Float64Array(order + 1);
  a[0] = 1;
  let error = r[0]!;
  for (let i = 1; i <= order; i++) {
    let acc = r[i]!;
    for (let j = 1; j < i; j++) acc += a[j]! * r[i - j]!;
    const k = -acc / error;
    const previous = a.slice();
    for (let j = 1; j < i; j++) a[j] = previous[j]! + k * previous[i - j]!;
    a[i] = k;
    error *= 1 - k * k;
  }
  return a;
}

export interface EnvelopePeak {
  readonly hz: number;
  readonly db: number;
}

/** Peaks of the LPC envelope of x[startSeconds, startSeconds + durationSeconds). */
export function lpcEnvelopePeaks(
  x: Float32Array,
  sampleRate: number,
  startSeconds: number,
  durationSeconds: number,
  order = 14,
): EnvelopePeak[] {
  const factor = Math.max(1, Math.round(sampleRate / 12000));
  const start = Math.round(startSeconds * sampleRate);
  const end = Math.round((startSeconds + durationSeconds) * sampleRate);
  const y = lowpassDecimate(x.subarray(start, end), factor);
  const rate = sampleRate / factor;
  const frame = Math.round(0.03 * rate);
  const hop = Math.round(0.01 * rate);
  const r = new Float64Array(order + 1);
  const seg = new Float64Array(frame);
  for (let s = 0; s + frame <= y.length; s += hop) {
    for (let i = 0; i < frame; i++) {
      const pre = y[s + i]! - (s + i > 0 ? 0.9 * y[s + i - 1]! : 0);
      seg[i] = pre * (0.54 - 0.46 * Math.cos((2 * Math.PI * i) / (frame - 1)));
    }
    for (let k = 0; k <= order; k++) {
      let acc = 0;
      for (let i = k; i < frame; i++) acc += seg[i]! * seg[i - k]!;
      r[k] = r[k]! + acc;
    }
  }
  r[0] = r[0]! * (1 + 1e-6);
  const a = levinson(r, order);
  const bins = 4096;
  const db = new Float64Array(bins);
  for (let b = 0; b < bins; b++) {
    const w = (Math.PI * b) / bins;
    let re = 0;
    let im = 0;
    for (let j = 0; j <= order; j++) {
      re += a[j]! * Math.cos(w * j);
      im -= a[j]! * Math.sin(w * j);
    }
    db[b] = -10 * Math.log10(re * re + im * im);
  }
  const peaks: EnvelopePeak[] = [];
  for (let b = 1; b < bins - 1; b++) {
    if (db[b]! > db[b - 1]! && db[b]! >= db[b + 1]!) {
      peaks.push({ hz: (b * rate) / 2 / bins, db: db[b]! });
    }
  }
  return peaks;
}

/** Frequency of the strongest envelope peak inside [loHz, hiHz] (NaN if none). */
export function strongestPeakIn(
  peaks: readonly EnvelopePeak[],
  loHz: number,
  hiHz: number,
): number {
  let best: EnvelopePeak | undefined;
  for (const p of peaks) {
    if (p.hz < loHz || p.hz > hiHz) continue;
    if (best === undefined || p.db > best.db) best = p;
  }
  return best?.hz ?? Number.NaN;
}
