/**
 * Multi-resolution waveform peaks ("peak pyramid") for zoomable waveform drawing.
 *
 * Level 0 stores, for each block of `baseBlockSize` frames, the minimum and maximum
 * sample across all channels. Each further level merges `factor` bins of the level
 * below, until a level has a single bin. A pyramid of N frames costs about
 * `2 · N / baseBlockSize · factor / (factor - 1)` floats.
 *
 * Everything is plain typed arrays and numbers, so a pyramid is structured-clone and
 * JSON-friendly (after `Array.from`) and can be cached by asset content hash.
 */
import { type PcmAudio } from './pcm';

export interface PeakLevel {
  /** Frames covered by one bin at this level. */
  readonly blockSize: number;
  /** Per-bin minimum / maximum sample (across channels). Equal lengths. */
  readonly min: Float32Array;
  readonly max: Float32Array;
}

export interface PeakPyramid {
  readonly sampleRate: number;
  readonly frames: number;
  readonly channelCount: number;
  readonly baseBlockSize: number;
  readonly factor: number;
  /** Finest first (`levels[0].blockSize === baseBlockSize`). */
  readonly levels: readonly PeakLevel[];
}

export interface PeakPyramidOptions {
  /** Frames per level-0 bin (integer >= 1). Default 256. */
  readonly baseBlockSize?: number;
  /** Bins merged per level (integer >= 2). Default 4. */
  readonly factor?: number;
}

/** Port for computing peaks off the main thread or natively (Worker, Rust). */
export interface WaveformAnalyzer {
  buildPeaks(pcm: PcmAudio, options?: PeakPyramidOptions): Promise<PeakPyramid>;
}

/**
 * Builds a peak pyramid.
 *
 * - Units: frames; values are raw sample amplitudes.
 * - Determinism: exact (min/max only, no arithmetic on samples).
 * - Ownership: reads `pcm`; the returned arrays are new and owned by the caller.
 * - Complexity: O(channels · frames) time, O(frames / baseBlockSize) memory.
 * - Empty audio yields a single level with one zero bin.
 */
export function buildPeakPyramid(pcm: PcmAudio, options: PeakPyramidOptions = {}): PeakPyramid {
  const baseBlockSize = Math.max(1, Math.floor(options.baseBlockSize ?? 256));
  const factor = Math.max(2, Math.floor(options.factor ?? 4));
  const frames = pcm.channels[0]?.length ?? 0;
  const bins = Math.max(1, Math.ceil(frames / baseBlockSize));
  const min = new Float32Array(bins);
  const max = new Float32Array(bins);
  if (frames > 0) {
    min.fill(Number.POSITIVE_INFINITY);
    max.fill(Number.NEGATIVE_INFINITY);
    for (const channel of pcm.channels) {
      for (let b = 0; b < bins; b++) {
        const from = b * baseBlockSize;
        const to = Math.min(frames, from + baseBlockSize);
        let lo = min[b]!;
        let hi = max[b]!;
        for (let i = from; i < to; i++) {
          const v = channel[i]!;
          if (v < lo) lo = v;
          if (v > hi) hi = v;
        }
        min[b] = lo;
        max[b] = hi;
      }
    }
  }
  const levels: PeakLevel[] = [{ blockSize: baseBlockSize, min, max }];
  let current = levels[0]!;
  while (current.min.length > 1) {
    const count = Math.ceil(current.min.length / factor);
    const nextMin = new Float32Array(count);
    const nextMax = new Float32Array(count);
    for (let b = 0; b < count; b++) {
      let lo = Number.POSITIVE_INFINITY;
      let hi = Number.NEGATIVE_INFINITY;
      const to = Math.min(current.min.length, (b + 1) * factor);
      for (let i = b * factor; i < to; i++) {
        if (current.min[i]! < lo) lo = current.min[i]!;
        if (current.max[i]! > hi) hi = current.max[i]!;
      }
      nextMin[b] = lo;
      nextMax[b] = hi;
    }
    current = { blockSize: current.blockSize * factor, min: nextMin, max: nextMax };
    levels.push(current);
  }
  return {
    sampleRate: pcm.sampleRate,
    frames,
    channelCount: pcm.channels.length,
    baseBlockSize,
    factor,
    levels,
  };
}

/**
 * Picks the level used for drawing `framesPerColumn` frames per column: the coarsest
 * level whose bins are no larger than a column (falls back to level 0 when zoomed in
 * beyond the base resolution). Complexity O(levels).
 */
export function selectPeakLevel(pyramid: PeakPyramid, framesPerColumn: number): number {
  let chosen = 0;
  for (let i = 0; i < pyramid.levels.length; i++) {
    if (pyramid.levels[i]!.blockSize <= framesPerColumn) chosen = i;
    else break;
  }
  return chosen;
}

/**
 * Reads `columns` min/max pairs covering frames [startFrame, endFrame).
 *
 * Column `c` covers frames [startFrame + c·w, startFrame + (c+1)·w) with
 * w = (endFrame − startFrame) / columns, and reports the min/max over every bin of the
 * selected level that overlaps that span (so the envelope is conservative: it never
 * under-reports a peak). Columns entirely outside the audio are 0.
 *
 * - Output: interleaved `[min0, max0, min1, max1, …]`, length `2 · columns`, new array.
 * - Complexity: O(columns + bins touched) — independent of the audio length thanks to
 *   level selection.
 */
export function readPeaks(
  pyramid: PeakPyramid,
  startFrame: number,
  endFrame: number,
  columns: number,
): Float32Array<ArrayBuffer> {
  const count = Math.max(0, Math.floor(columns));
  const out = new Float32Array(count * 2);
  if (count === 0 || !(endFrame > startFrame) || pyramid.frames === 0) return out;
  const width = (endFrame - startFrame) / count;
  const levelIndex = selectPeakLevel(pyramid, width);
  const level = pyramid.levels[levelIndex]!;
  const bins = level.min.length;
  for (let c = 0; c < count; c++) {
    const from = Math.max(0, startFrame + c * width);
    const to = Math.min(pyramid.frames, startFrame + (c + 1) * width);
    if (to <= from) continue;
    const firstBin = Math.floor(from / level.blockSize);
    const lastBin = Math.min(bins - 1, Math.ceil(to / level.blockSize) - 1);
    let lo = Number.POSITIVE_INFINITY;
    let hi = Number.NEGATIVE_INFINITY;
    for (let b = firstBin; b <= lastBin; b++) {
      if (level.min[b]! < lo) lo = level.min[b]!;
      if (level.max[b]! > hi) hi = level.max[b]!;
    }
    if (lo <= hi) {
      out[c * 2] = lo;
      out[c * 2 + 1] = hi;
    }
  }
  return out;
}
