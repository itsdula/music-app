import { asVocalNoteId, type VocalNoteSegment } from '@studio/domain';
import { clampedMovingAverage, fitLine, hzToMidi, median, medianFilter } from './internal/math';
import { describeSegment } from './segment-edit';
import { type PitchTrack, type VocalAnalysisParams } from './types';

/**
 * Note segmentation: optimal change-point partitioning (PELT, Killick et al. 2012) of
 * the vibrato-suppressed pitch curve of every voiced run, followed by deterministic
 * post-rules. This is the "PELT alternative" from the research dossier (§3.3, §4.1);
 * see docs/vocal-dsp.md for why it was chosen over the Tony note HMM.
 *
 *  1. Voiced runs: voiced frames, bridging unvoiced gaps shorter than `gapBridgeSeconds`.
 *  2. Per run: cents → 5-frame running median (outliers) = z. A vibrato-suppressed copy
 *     y (two cascaded moving averages of 1/5 s and 1/6.5 s: nulls at 5 and 6.5 Hz, all
 *     4–8 Hz vibrato attenuated to ≤ 11 %, windows shifted inwards at run edges) gives the
 *     run's within-note deviation scale σ = max(40 c, 1.25·1.4826·MAD(z − y)).
 *  3. PELT on z with Gaussian mean-change cost Σ(z−z̄)²/σ², penalty `changePenalty` per
 *     note and minimum length `minNoteSeconds`. Because σ scales with the vibrato extent,
 *     splitting a vibrato into half-cycles never pays (saving ≲ 6 < penalty), while
 *     steps between notes stay sharp (no smoothing of the change-point signal).
 *  4. Post-rules: merge neighbours closer than `mergeCents`, or closer than
 *     `driftMergeCents` when the pitch is continuous across their boundary or one of them
 *     is a short piece at the run edge (attack/release half-cycle); short steep segments
 *     (|slope| ≥ `glideSlopeCentsPerSecond`, ≤ `maxTransitionSeconds`) next to a stable
 *     note are portamento transitions and are left unsegmented; runs made only of such
 *     ramps become one glide note; notes shorter than `minNoteSeconds` merge into the
 *     closer-pitched contiguous neighbour or are dropped.
 */
export const SEGMENTATION_PARAMS = {
  gapBridgeSeconds: 0.03,
  medianFrames: 5,
  /** Cascaded smoothing windows (seconds) that suppress 4–8 Hz vibrato. */
  vibratoSmoothingSeconds: [1 / 5, 1 / 6.5],
  /** Floor of the per-run within-note deviation scale σ (cents). */
  minSigmaCents: 40,
  /** σ = max(minSigmaCents, sigmaScale · 1.4826 · MAD(z − smoothed z)). */
  sigmaScale: 1.25,
  /** Neighbours closer than this whose shared boundary is continuous are one drifting note. */
  driftMergeCents: 80,
  /** Maximum pitch jump across a boundary (25 ms medians each side) to count as continuous. */
  continuityCents: 20,
  /** Run-edge pieces shorter than this (one 4 Hz vibrato cycle) within driftMergeCents merge. */
  edgePieceSeconds: 0.25,
  changePenalty: 10,
  mergeCents: 35,
  glideSlopeCentsPerSecond: 500,
  maxTransitionSeconds: 0.3,
} as const;

interface FrameSegment {
  /** Indices into the run's voiced-frame arrays, [start, end). */
  start: number;
  end: number;
  ramp: boolean;
}

/** Gaussian mean-change cost via prefix sums. */
class MeanCost {
  private readonly s1: Float64Array;
  private readonly s2: Float64Array;
  constructor(
    values: Float64Array,
    private readonly invVariance: number,
  ) {
    this.s1 = new Float64Array(values.length + 1);
    this.s2 = new Float64Array(values.length + 1);
    for (let i = 0; i < values.length; i++) {
      this.s1[i + 1] = this.s1[i]! + values[i]!;
      this.s2[i + 1] = this.s2[i]! + values[i]! * values[i]!;
    }
  }
  cost(a: number, b: number): number {
    const n = b - a;
    if (n <= 0) return 0;
    const sum = this.s1[b]! - this.s1[a]!;
    const sq = this.s2[b]! - this.s2[a]!;
    return Math.max(0, sq - (sum * sum) / n) * this.invVariance;
  }
}

/**
 * PELT optimal partitioning with a minimum segment length. Returns the interior change
 * points (sorted). Pruning keeps τ while F(τ) + C(τ, t) ≤ F(t) + β (conservative with
 * respect to the minimum-length constraint). Exported for equivalence tests.
 */
export function peltChangePoints(
  values: Float64Array,
  sigma: number,
  penalty: number,
  minLength: number,
): number[] {
  const n = values.length;
  const m = Math.max(1, minLength);
  if (n < 2 * m) return [];
  const cost = new MeanCost(values, 1 / (sigma * sigma));
  const best = new Float64Array(n + 1).fill(Number.POSITIVE_INFINITY);
  const last = new Int32Array(n + 1);
  best[0] = -penalty;
  let admissible: number[] = [];
  for (let t = m; t <= n; t++) {
    admissible.push(t - m);
    let bestValue = Number.POSITIVE_INFINITY;
    let bestTau = 0;
    const scores = new Float64Array(admissible.length);
    for (let k = 0; k < admissible.length; k++) {
      const tau = admissible[k]!;
      const prior = best[tau]!;
      const score =
        prior === Number.POSITIVE_INFINITY ? prior : prior + cost.cost(tau, t) + penalty;
      scores[k] = score;
      if (score < bestValue) {
        bestValue = score;
        bestTau = tau;
      }
    }
    best[t] = bestValue;
    last[t] = bestTau;
    const kept: number[] = [];
    for (let k = 0; k < admissible.length; k++) {
      if (
        scores[k]! - penalty <= bestValue + penalty ||
        best[admissible[k]!] === Number.POSITIVE_INFINITY
      ) {
        kept.push(admissible[k]!);
      }
    }
    admissible = kept;
  }
  const points: number[] = [];
  let t = n;
  while (t > 0) {
    const tau = last[t]!;
    if (tau > 0) points.push(tau);
    t = tau;
  }
  return points.reverse();
}

/** Voiced runs as lists of frame indices (short unvoiced gaps bridged). */
function voicedRuns(track: PitchTrack, bridgeFrames: number): number[][] {
  const runs: number[][] = [];
  let current: number[] = [];
  let gap = 0;
  for (let i = 0; i < track.frameCount; i++) {
    if (track.f0Hz[i]! > 0) {
      current.push(i);
      gap = 0;
    } else if (current.length > 0) {
      gap++;
      if (gap > bridgeFrames) {
        runs.push(current);
        current = [];
        gap = 0;
      }
    }
  }
  if (current.length > 0) runs.push(current);
  return runs;
}

function segmentCentre(values: Float64Array, s: FrameSegment): number {
  return median(values.subarray(s.start, s.end));
}

/** Segments one voiced run; returns frame-index segments (into the run). */
function segmentRun(
  frames: readonly number[],
  cents: Float64Array,
  hopSeconds: number,
  minFrames: number,
): FrameSegment[] {
  const p = SEGMENTATION_PARAMS;
  const n = frames.length;
  const z = medianFilter(cents, p.medianFrames);
  // Within-note deviation scale: robust (MAD) spread of z around its vibrato-suppressed
  // version. A sinusoid of peak A gives ≈1.05·A, so vibrato never pays for a split.
  let y = z;
  for (const seconds of p.vibratoSmoothingSeconds) {
    y = clampedMovingAverage(y, Math.max(1, Math.round(seconds / hopSeconds)));
  }
  const deviation = new Float64Array(n);
  for (let i = 0; i < n; i++) deviation[i] = Math.abs(z[i]! - y[i]!);
  const sigma = Math.max(p.minSigmaCents, p.sigmaScale * 1.4826 * median(deviation));
  const points = peltChangePoints(z, sigma, p.changePenalty, minFrames);

  let segments: FrameSegment[] = [];
  let start = 0;
  for (const point of [...points, n]) {
    if (point > start) segments.push({ start, end: point, ramp: false });
    start = point;
  }

  // Merge near-unison neighbours, and drifting notes cut where the pitch is continuous
  // (closest pair first, repeatedly).
  const edge = Math.max(2, Math.round(0.025 / hopSeconds));
  const edgeFrames = Math.round(p.edgePieceSeconds / hopSeconds);
  const continuous = (a: FrameSegment, b: FrameSegment): boolean => {
    if (a.end !== b.start) return false;
    const before = median(z.subarray(Math.max(a.start, a.end - edge), a.end));
    const after = median(z.subarray(b.start, Math.min(b.end, b.start + edge)));
    return Math.abs(after - before) < p.continuityCents;
  };
  for (;;) {
    let bestIndex = -1;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (let k = 0; k + 1 < segments.length; k++) {
      const a = segments[k]!;
      const b = segments[k + 1]!;
      const d = Math.abs(segmentCentre(z, a) - segmentCentre(z, b));
      const edgePiece =
        (k === 0 && a.end - a.start < edgeFrames) ||
        (k + 2 === segments.length && b.end - b.start < edgeFrames);
      const mergeable =
        d < p.mergeCents || (d < p.driftMergeCents && (edgePiece || continuous(a, b)));
      if (mergeable && d < bestDistance) {
        bestDistance = d;
        bestIndex = k;
      }
    }
    if (bestIndex < 0) break;
    const a = segments[bestIndex]!;
    const b = segments[bestIndex + 1]!;
    segments.splice(bestIndex, 2, { start: a.start, end: b.end, ramp: false });
  }

  // Portamento detection.
  const times = Float64Array.from(frames, (f) => f * hopSeconds);
  const maxTransitionFrames = Math.round(p.maxTransitionSeconds / hopSeconds);
  for (const s of segments) {
    const fit = fitLine(times.subarray(s.start, s.end), z.subarray(s.start, s.end));
    s.ramp =
      s.end - s.start <= maxTransitionFrames && Math.abs(fit.slope) >= p.glideSlopeCentsPerSecond;
  }
  // Merge consecutive ramps moving in the same direction.
  const merged: FrameSegment[] = [];
  for (const s of segments) {
    const prev = merged[merged.length - 1];
    if (
      prev !== undefined &&
      prev.ramp &&
      s.ramp &&
      Math.sign(segmentCentre(z, s) - segmentCentre(z, prev)) ===
        Math.sign(z[prev.end - 1]! - z[prev.start]!)
    ) {
      prev.end = s.end;
    } else {
      merged.push({ ...s });
    }
  }
  segments = merged;
  const hasStable = segments.some((s) => !s.ramp);
  if (hasStable) {
    segments = segments.filter((s) => !s.ramp);
  } else if (segments.length > 0) {
    segments = [
      { start: segments[0]!.start, end: segments[segments.length - 1]!.end, ramp: false },
    ];
  }

  // Minimum duration: absorb into a contiguous neighbour with the closer centre, else drop.
  for (;;) {
    const index = segments.findIndex((s) => s.end - s.start < minFrames);
    if (index < 0) break;
    const s = segments[index]!;
    const prev = segments[index - 1];
    const next = segments[index + 1];
    const centre = segmentCentre(z, s);
    const prevOk = prev !== undefined && prev.end === s.start;
    const nextOk = next !== undefined && next.start === s.end;
    if (!prevOk && !nextOk) {
      segments.splice(index, 1);
      continue;
    }
    const usePrev =
      prevOk &&
      (!nextOk ||
        Math.abs(segmentCentre(z, prev) - centre) <= Math.abs(segmentCentre(z, next!) - centre));
    if (usePrev) {
      prev.end = s.end;
      segments.splice(index, 1);
    } else {
      next!.start = s.start;
      segments.splice(index, 1);
    }
  }
  return segments;
}

/**
 * Note segmentation of a pitch track. Segment ids are deterministic:
 * `vn_<index>_<startFrame>`.
 */
export function segmentNotes(track: PitchTrack, params: VocalAnalysisParams): VocalNoteSegment[] {
  const p = SEGMENTATION_PARAMS;
  const hop = track.hopSeconds;
  const bridge = Math.max(0, Math.round(p.gapBridgeSeconds / hop));
  const minFrames = Math.max(2, Math.round(params.minNoteSeconds / hop));
  const segments: VocalNoteSegment[] = [];
  for (const run of voicedRuns(track, bridge)) {
    const cents = Float64Array.from(run, (i) => 100 * hzToMidi(track.f0Hz[i]!));
    for (const s of segmentRun(run, cents, hop, minFrames)) {
      const firstFrame = run[s.start]!;
      const lastFrame = run[s.end - 1]!;
      const startSeconds = Math.max(0, track.firstFrameSeconds + (firstFrame - 0.5) * hop);
      const endSeconds = track.firstFrameSeconds + (lastFrame + 0.5) * hop;
      const id = asVocalNoteId(`vn_${segments.length}_${firstFrame}`);
      const fallback = median(cents.subarray(s.start, s.end)) / 100;
      segments.push(describeSegment(track, id, startSeconds, endSeconds, fallback));
    }
  }
  return segments;
}
