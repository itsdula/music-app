import { describe, expect, it } from 'vitest';
import { fft, getFftPlan, isPowerOfTwo, nextPowerOfTwo } from '../src/internal/fft';
import {
  clamp,
  clampedMovingAverage,
  fitLine,
  median,
  medianFilter,
  movingAverage,
  smoothRamp,
} from '../src/internal/math';
import { runSteps, runStepsAsync, scaleSteps, yieldToEventLoop } from '../src/internal/steps';
import {
  DEFAULT_VOCAL_ANALYSIS_PARAMS,
  frameLayout,
  resolveVocalAnalysisParams,
  VocalJobCancelledError,
} from '../src/index';
import { createSeededRandom } from '../../test-fixtures/src/index';

describe('fft', () => {
  it('matches a direct DFT', () => {
    const n = 64;
    const random = createSeededRandom(3);
    const re = Float64Array.from({ length: n }, () => random() - 0.5);
    const im = Float64Array.from({ length: n }, () => random() - 0.5);
    const expectRe = new Float64Array(n);
    const expectIm = new Float64Array(n);
    for (let k = 0; k < n; k++) {
      for (let t = 0; t < n; t++) {
        const angle = (-2 * Math.PI * k * t) / n;
        expectRe[k] = expectRe[k]! + re[t]! * Math.cos(angle) - im[t]! * Math.sin(angle);
        expectIm[k] = expectIm[k]! + re[t]! * Math.sin(angle) + im[t]! * Math.cos(angle);
      }
    }
    const plan = getFftPlan(n);
    const r = re.slice();
    const i = im.slice();
    fft(plan, r, i);
    for (let k = 0; k < n; k++) {
      expect(r[k]).toBeCloseTo(expectRe[k]!, 10);
      expect(i[k]).toBeCloseTo(expectIm[k]!, 10);
    }
    // Inverse (unscaled) restores the input times n.
    fft(plan, r, i, true);
    for (let t = 0; t < n; t++) {
      expect(r[t]! / n).toBeCloseTo(re[t]!, 10);
      expect(i[t]! / n).toBeCloseTo(im[t]!, 10);
    }
  });

  it('caches plans and rejects non powers of two', () => {
    expect(getFftPlan(128)).toBe(getFftPlan(128));
    expect(() => getFftPlan(100)).toThrow(RangeError);
    expect(isPowerOfTwo(256)).toBe(true);
    expect(isPowerOfTwo(0)).toBe(false);
    expect(nextPowerOfTwo(1845)).toBe(2048);
    expect(nextPowerOfTwo(1)).toBe(1);
  });
});

describe('math helpers', () => {
  it('computes medians and filters', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([])).toBeNaN();
    expect(Array.from(medianFilter(Float64Array.from([1, 9, 1, 1, 1]), 3))).toEqual([
      5, 1, 1, 1, 1,
    ]);
    expect(Array.from(medianFilter(Float64Array.from([1, 2]), 1))).toEqual([1, 2]);
    expect(Array.from(medianFilter(Float64Array.from([5, 1, 3, 2]), 5))).toEqual([3, 2.5, 2.5, 2]);
    expect(Array.from(movingAverage(Float64Array.from([0, 3, 6]), 3))).toEqual([1.5, 3, 4.5]);
    expect(Array.from(clampedMovingAverage(Float64Array.from([0, 3, 6, 9]), 3))).toEqual([
      3, 3, 6, 6,
    ]);
    expect(Array.from(clampedMovingAverage(Float64Array.from([2, 4]), 5))).toEqual([3, 3]);
  });

  it('fits lines and ramps', () => {
    const line = fitLine([0, 1, 2, 3], [1, 3, 5, 7]);
    expect(line.slope).toBeCloseTo(2, 12);
    expect(line.mean).toBeCloseTo(4, 12);
    expect(line.xMean).toBeCloseTo(1.5, 12);
    expect(fitLine([], []).mean).toBeNaN();
    expect(fitLine([1, 1], [2, 4]).slope).toBe(0);
    expect(smoothRamp(-1)).toBe(0);
    expect(smoothRamp(0.5)).toBeCloseTo(0.5, 12);
    expect(smoothRamp(2)).toBe(1);
    expect(clamp(5, 0, 1)).toBe(1);
    expect(clamp(-5, 0, 1)).toBe(0);
  });
});

describe('analysis parameters', () => {
  it('merges defaults and validates', () => {
    expect(resolveVocalAnalysisParams()).toEqual(DEFAULT_VOCAL_ANALYSIS_PARAMS);
    expect(resolveVocalAnalysisParams({ minHz: 80 }).minHz).toBe(80);
    const bad: Partial<typeof DEFAULT_VOCAL_ANALYSIS_PARAMS>[] = [
      { minHz: 10 },
      { maxHz: 70 },
      { frameSeconds: 0.5 },
      { hopSeconds: 0 },
      { hopSeconds: 0.1 },
      { voicingThreshold: 1 },
      { minNoteSeconds: -1 },
      { minHz: Number.NaN },
    ];
    for (const params of bad) expect(() => resolveVocalAnalysisParams(params)).toThrow(RangeError);
  });

  it('derives an integer hop and frame counts', () => {
    const layout = frameLayout(44100, DEFAULT_VOCAL_ANALYSIS_PARAMS);
    expect(layout.hopSamples).toBe(221);
    expect(layout.hopSeconds).toBeCloseTo(221 / 44100, 15);
    expect(layout.frameCountFor(0)).toBe(0);
    expect(layout.frameCountFor(1)).toBe(1);
    expect(layout.frameCountFor(222)).toBe(2);
  });
});

describe('stage runner', () => {
  function* steps(): Generator<number, string, void> {
    yield 0.25;
    yield 0.5;
    return 'done';
  }

  it('reports progress, scales and completes', () => {
    const seen: number[] = [];
    expect(runSteps(scaleSteps(steps(), 0.5, 1), { onProgress: (f) => seen.push(f) })).toBe('done');
    expect(seen).toEqual([0.625, 0.75, 1]);
  });

  it('cancels synchronously and asynchronously', async () => {
    expect(() => runSteps(steps(), { shouldCancel: () => true })).toThrow(VocalJobCancelledError);
    const signal = { aborted: true, addEventListener: () => {}, removeEventListener: () => {} };
    await expect(runStepsAsync(steps(), { signal })).rejects.toBeInstanceOf(VocalJobCancelledError);
    const seen: number[] = [];
    await expect(
      runStepsAsync(steps(), { onProgress: (f) => seen.push(f), yieldEvery: 1 }),
    ).resolves.toBe('done');
    expect(seen).toEqual([0.25, 0.5, 1]);
  });

  it('yields even without timers', async () => {
    const host = globalThis as { setTimeout?: unknown };
    const original = host.setTimeout;
    host.setTimeout = undefined;
    try {
      await expect(yieldToEventLoop()).resolves.toBeUndefined();
    } finally {
      host.setTimeout = original;
    }
  });
});
