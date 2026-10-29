import { type VocalNoteSegment } from '@studio/domain';
import { fitLine, hzToMidi, median } from './internal/math';
import { type PitchTrack } from './types';

/**
 * Per-note expression: a robust centre, a linear drift trend and vibrato (rate/extent)
 * from least-squares sinusoid fits on a fixed 4–8 Hz grid over sliding windows
 * (research §3.4; acceptance rules adapted from Nakano et al.).
 */
export interface VocalNoteExpression {
  /** Median pitch over the stable portion, fractional MIDI (NaN without voiced frames). */
  readonly centreMidi: number;
  readonly voicedFrames: number;
  /** Linear trend across the whole note: end minus start, cents. */
  readonly driftCents: number;
  readonly driftCentsPerSecond: number;
  /** 0 when no vibrato was accepted. */
  readonly vibratoRateHz: number;
  /** Peak deviation (half the peak-to-peak extent), cents; 0 when none. */
  readonly vibratoDepthCents: number;
  /** Median fraction of detrended variance explained by the accepted vibrato fits. */
  readonly vibratoExplainedVariance: number;
  /** RMS deviation (cents) from the trend after removing the fitted vibrato. */
  readonly residualCents: number;
}

export const EXPRESSION_PARAMS = {
  /** Trimmed from the note for centre/trend estimation when the note is long enough. */
  attackFraction: 0.15,
  releaseFraction: 0.1,
  trimMinSeconds: 0.2,
  vibratoMinSeconds: 0.4,
  vibratoWindowSeconds: 0.5,
  vibratoHopSeconds: 0.1,
  vibratoMinHz: 4,
  vibratoMaxHz: 8,
  vibratoStepHz: 0.05,
  vibratoMinDepthCents: 15,
  vibratoMaxDepthCents: 150,
  vibratoMinExplained: 0.5,
  vibratoMinWindowShare: 0.5,
} as const;

export interface VoicedFrames {
  readonly times: Float64Array;
  readonly cents: Float64Array;
  readonly probability: Float64Array;
  /** Frames (voiced or not) whose centre lies in the range. */
  readonly totalFrames: number;
}

/** Frame index range [first, end) of frames whose centre lies in [startSeconds, endSeconds). */
export function frameRange(
  track: PitchTrack,
  startSeconds: number,
  endSeconds: number,
): [number, number] {
  const first = Math.max(
    0,
    Math.ceil((startSeconds - track.firstFrameSeconds) / track.hopSeconds - 1e-9),
  );
  const end = Math.min(
    track.frameCount,
    Math.max(first, Math.ceil((endSeconds - track.firstFrameSeconds) / track.hopSeconds - 1e-9)),
  );
  return [first, end];
}

export function voicedFramesIn(
  track: PitchTrack,
  startSeconds: number,
  endSeconds: number,
): VoicedFrames {
  const [first, end] = frameRange(track, startSeconds, endSeconds);
  let count = 0;
  for (let i = first; i < end; i++) if (track.f0Hz[i]! > 0) count++;
  const times = new Float64Array(count);
  const cents = new Float64Array(count);
  const probability = new Float64Array(count);
  let k = 0;
  for (let i = first; i < end; i++) {
    const hz = track.f0Hz[i]!;
    if (!(hz > 0)) continue;
    times[k] = track.firstFrameSeconds + i * track.hopSeconds;
    cents[k] = 100 * hzToMidi(hz);
    probability[k] = track.voicedProbability[i]!;
    k++;
  }
  return { times, cents, probability, totalFrames: end - first };
}

interface VibratoFit {
  readonly rateHz: number;
  readonly depthCents: number;
  readonly explained: number;
  readonly crossings: number;
}

let rateGrid: Float64Array | undefined;
function getRateGrid(): Float64Array {
  if (rateGrid !== undefined) return rateGrid;
  const { vibratoMinHz, vibratoMaxHz, vibratoStepHz } = EXPRESSION_PARAMS;
  const count = Math.round((vibratoMaxHz - vibratoMinHz) / vibratoStepHz) + 1;
  rateGrid = Float64Array.from({ length: count }, (_, i) => vibratoMinHz + i * vibratoStepHz);
  return rateGrid;
}

/** Least-squares fit r ≈ c + a·cos(ωt) + b·sin(ωt) over [lo, hi) for each grid rate. */
function fitVibratoWindow(
  residual: Float64Array,
  cosTable: Float64Array,
  sinTable: Float64Array,
  frameCount: number,
  lo: number,
  hi: number,
): VibratoFit | null {
  const grid = getRateGrid();
  const n = hi - lo;
  if (n < 8) return null;
  let mean = 0;
  for (let i = lo; i < hi; i++) mean += residual[i]!;
  mean /= n;
  let total = 0;
  for (let i = lo; i < hi; i++) total += (residual[i]! - mean) ** 2;
  if (total <= 1e-9) return null;
  let best: VibratoFit | null = null;
  let bestExplained = -Infinity;
  for (let g = 0; g < grid.length; g++) {
    const base = g * frameCount;
    // Normal equations for [1, cos, sin] on the mean-removed residual.
    let sc = 0;
    let ss = 0;
    let scc = 0;
    let sss = 0;
    let scs = 0;
    let rc = 0;
    let rs = 0;
    for (let i = lo; i < hi; i++) {
      const c = cosTable[base + i]!;
      const s = sinTable[base + i]!;
      const r = residual[i]! - mean;
      sc += c;
      ss += s;
      scc += c * c;
      sss += s * s;
      scs += c * s;
      rc += r * c;
      rs += r * s;
    }
    // Centre the regressors (equivalent to including the constant term).
    const ccc = scc - (sc * sc) / n;
    const css = sss - (ss * ss) / n;
    const ccs = scs - (sc * ss) / n;
    const det = ccc * css - ccs * ccs;
    if (Math.abs(det) < 1e-12) continue;
    const a = (rc * css - rs * ccs) / det;
    const b = (rs * ccc - rc * ccs) / det;
    const explainedSum = a * rc + b * rs;
    const explained = explainedSum / total;
    if (explained > bestExplained) {
      bestExplained = explained;
      best = { rateHz: grid[g]!, depthCents: Math.hypot(a, b), explained, crossings: 0 };
    }
  }
  if (best === null) return null;
  let crossings = 0;
  for (let i = lo + 1; i < hi; i++) {
    if (residual[i - 1]! - mean < 0 !== residual[i]! - mean < 0) crossings++;
  }
  return { ...best, crossings };
}

export function analyzeExpressionOfFrames(
  frames: VoicedFrames,
  startSeconds: number,
  endSeconds: number,
): VocalNoteExpression {
  const { times, cents } = frames;
  const duration = Math.max(1e-9, endSeconds - startSeconds);
  const none: VocalNoteExpression = {
    centreMidi: Number.NaN,
    voicedFrames: 0,
    driftCents: 0,
    driftCentsPerSecond: 0,
    vibratoRateHz: 0,
    vibratoDepthCents: 0,
    vibratoExplainedVariance: 0,
    residualCents: 0,
  };
  if (times.length === 0) return none;

  // Stable portion: trim the attack and release of long notes.
  let lo = 0;
  let hi = times.length;
  const p = EXPRESSION_PARAMS;
  if (duration >= p.trimMinSeconds) {
    const stableStart = startSeconds + p.attackFraction * duration;
    const stableEnd = endSeconds - p.releaseFraction * duration;
    while (lo < hi && times[lo]! < stableStart) lo++;
    while (hi > lo && times[hi - 1]! >= stableEnd) hi--;
    if (hi - lo < Math.max(3, times.length / 4)) {
      lo = 0;
      hi = times.length;
    }
  }
  const stableTimes = times.subarray(lo, hi);
  const stableCents = cents.subarray(lo, hi);
  const centre = median(stableCents);
  const line = fitLine(stableTimes, stableCents);
  const slope = stableTimes.length >= 3 ? line.slope : 0;

  // Detrended residual over the stable portion.
  const n = stableTimes.length;
  const residual = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    residual[i] = stableCents[i]! - (line.mean + slope * (stableTimes[i]! - line.xMean));
  }

  let vibratoRate = 0;
  let vibratoDepth = 0;
  let vibratoExplained = 0;
  let residualPower = 0;
  for (let i = 0; i < n; i++) residualPower += residual[i]! ** 2;
  const span = n > 1 ? stableTimes[n - 1]! - stableTimes[0]! : 0;
  if (span >= p.vibratoMinSeconds - 1e-9) {
    const grid = getRateGrid();
    const cosTable = new Float64Array(grid.length * n);
    const sinTable = new Float64Array(grid.length * n);
    for (let g = 0; g < grid.length; g++) {
      const omega = 2 * Math.PI * grid[g]!;
      for (let i = 0; i < n; i++) {
        const angle = omega * (stableTimes[i]! - stableTimes[0]!);
        cosTable[g * n + i] = Math.cos(angle);
        sinTable[g * n + i] = Math.sin(angle);
      }
    }
    const accepted: VibratoFit[] = [];
    let windows = 0;
    const windowSeconds = Math.min(p.vibratoWindowSeconds, span);
    for (let start = 0; start < n;) {
      const t0 = stableTimes[start]!;
      let end = start;
      while (end < n && stableTimes[end]! < t0 + windowSeconds + 1e-9) end++;
      if (stableTimes[end - 1]! - t0 < windowSeconds - 0.02 && windows > 0) break;
      windows++;
      const fit = fitVibratoWindow(residual, cosTable, sinTable, n, start, end);
      if (
        fit !== null &&
        fit.explained >= p.vibratoMinExplained &&
        fit.depthCents >= p.vibratoMinDepthCents &&
        fit.depthCents <= p.vibratoMaxDepthCents &&
        fit.crossings >= Math.max(3, Math.floor(1.2 * fit.rateHz * windowSeconds))
      ) {
        accepted.push(fit);
      }
      if (end >= n) break;
      let next = start;
      while (next < n && stableTimes[next]! < t0 + p.vibratoHopSeconds - 1e-9) next++;
      start = Math.max(start + 1, next);
    }
    if (windows > 0 && accepted.length >= p.vibratoMinWindowShare * windows) {
      vibratoRate = median(accepted.map((f) => f.rateHz));
      vibratoDepth = median(accepted.map((f) => f.depthCents));
      vibratoExplained = median(accepted.map((f) => f.explained));
    }
  }
  const residualCents = Math.sqrt(
    Math.max(0, residualPower / Math.max(1, n) - (vibratoDepth * vibratoDepth) / 2),
  );

  return {
    centreMidi: centre / 100,
    voicedFrames: times.length,
    driftCents: slope * duration,
    driftCentsPerSecond: slope,
    vibratoRateHz: vibratoRate,
    vibratoDepthCents: vibratoDepth,
    vibratoExplainedVariance: vibratoExplained,
    residualCents,
  };
}

/** Vibrato and drift of one note (re-estimated from the pitch track). */
export function analyzeNoteExpression(
  track: PitchTrack,
  segment: Pick<VocalNoteSegment, 'startSeconds' | 'endSeconds'>,
): VocalNoteExpression {
  return analyzeExpressionOfFrames(
    voicedFramesIn(track, segment.startSeconds, segment.endSeconds),
    segment.startSeconds,
    segment.endSeconds,
  );
}
