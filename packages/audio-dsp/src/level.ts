/**
 * Level conversions and measurements.
 *
 * Linear gain 1.0 = 0 dB; amplitude 1.0 = 0 dBFS. All functions are pure and
 * deterministic; none retain or mutate their inputs.
 */
import { type PcmAudio } from './pcm';

/**
 * Decibels to linear amplitude gain: `10^(db/20)`.
 *
 * - Units: dB in, linear gain out. `-Infinity` maps to exactly 0.
 * - Determinism: IEEE-754 `Math.pow`; reproducible to ~1 ulp across engines (use a
 *   numeric tolerance of 1e-12 relative when porting).
 * - Complexity: O(1).
 */
export function dbToGain(db: number): number {
  if (db === Number.NEGATIVE_INFINITY) return 0;
  return Math.pow(10, db / 20);
}

/**
 * Linear amplitude gain to decibels: `20·log10(|gain|)`.
 *
 * - Units: linear gain in, dB out. 0 maps to `-Infinity`; the sign of `gain` is ignored.
 * - Complexity: O(1).
 */
export function gainToDb(gain: number): number {
  const magnitude = Math.abs(gain);
  if (magnitude === 0) return Number.NEGATIVE_INFINITY;
  return 20 * Math.log10(magnitude);
}

/**
 * Largest absolute sample value across all channels (linear, 1.0 = 0 dBFS).
 *
 * - Ownership: reads `pcm` only. Complexity: O(channels · frames).
 * - Returns 0 for empty audio. NaN samples are ignored.
 */
export function peakAmplitude(pcm: PcmAudio): number {
  let peak = 0;
  for (const channel of pcm.channels) {
    for (let i = 0; i < channel.length; i++) {
      const v = Math.abs(channel[i]!);
      if (v > peak) peak = v;
    }
  }
  return peak;
}

/**
 * Root-mean-square level over all channels and frames (linear).
 *
 * Optional `startFrame`/`endFrame` (half-open, clamped to the buffer) restrict the
 * measured range. Accumulates in float64.
 *
 * - Ownership: reads `pcm` only. Complexity: O(channels · frames in range).
 * - Returns 0 for an empty range.
 */
export function rmsLevel(pcm: PcmAudio, startFrame = 0, endFrame?: number): number {
  let sum = 0;
  let count = 0;
  for (const channel of pcm.channels) {
    const from = Math.max(0, Math.floor(startFrame));
    const to = Math.min(channel.length, Math.floor(endFrame ?? channel.length));
    for (let i = from; i < to; i++) {
      const v = channel[i]!;
      sum += v * v;
    }
    count += Math.max(0, to - from);
  }
  return count === 0 ? 0 : Math.sqrt(sum / count);
}

/**
 * RMS of a single mono buffer range (linear). Same semantics as {@link rmsLevel}.
 * Complexity: O(range length).
 */
export function rmsOfSamples(
  samples: ArrayLike<number>,
  startFrame = 0,
  endFrame?: number,
): number {
  const from = Math.max(0, Math.floor(startFrame));
  const to = Math.min(samples.length, Math.floor(endFrame ?? samples.length));
  let sum = 0;
  for (let i = from; i < to; i++) {
    const v = samples[i]!;
    sum += v * v;
  }
  return to > from ? Math.sqrt(sum / (to - from)) : 0;
}
