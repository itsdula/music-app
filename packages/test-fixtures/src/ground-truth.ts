import { type F0Curve } from './f0';

/** Frame grid of a constant-hop pitch track (frame i is centred at first + i·hop). */
export interface FrameGrid {
  readonly frameCount: number;
  readonly hopSeconds: number;
  readonly firstFrameSeconds: number;
}

/** Exact f0 (Hz, 0 = unvoiced) of an analytic curve at each frame centre. */
export function groundTruthF0(curve: F0Curve, grid: FrameGrid): Float32Array {
  const out = new Float32Array(grid.frameCount);
  for (let i = 0; i < grid.frameCount; i++) {
    const hz = curve(grid.firstFrameSeconds + i * grid.hopSeconds);
    out[i] = hz > 0 ? hz : 0;
  }
  return out;
}

/** Ground-truth voicing per frame (1 = voiced). */
export function groundTruthVoicing(curve: F0Curve, grid: FrameGrid): Uint8Array {
  const f0 = groundTruthF0(curve, grid);
  return Uint8Array.from(f0, (hz) => (hz > 0 ? 1 : 0));
}

export interface PitchMetrics {
  /** Frames voiced in the reference / unvoiced in the reference. */
  readonly referenceVoicedFrames: number;
  readonly referenceUnvoicedFrames: number;
  /** Fraction of reference-voiced frames estimated voiced and within 50 cents (mir_eval RPA). */
  readonly rawPitchAccuracy: number;
  /** As RPA but octave-folded (mir_eval RCA). */
  readonly rawChromaAccuracy: number;
  /** Fraction of frames voiced in both whose relative error exceeds 20 % (GPE). */
  readonly grossPitchError: number;
  /** Fraction of frames voiced in both whose error is within 50 cents of ±1 or ±2 octaves. */
  readonly octaveErrorRate: number;
  /** Fraction of reference-voiced frames estimated voiced. */
  readonly voicingRecall: number;
  /** Fraction of reference-unvoiced frames estimated voiced (NaN when there are none). */
  readonly voicingFalseAlarm: number;
  /** Median / 95th-percentile absolute error in cents over frames voiced in both. */
  readonly medianAbsCents: number;
  readonly p95AbsCents: number;
}

function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return Number.NaN;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.round(p * (sorted.length - 1))));
  return sorted[index]!;
}

/**
 * Frame-level pitch metrics (mir_eval melody conventions). `estimateHz` uses 0 for
 * unvoiced frames; both arrays must use the same frame grid.
 */
export function computePitchMetrics(
  estimateHz: ArrayLike<number>,
  referenceHz: ArrayLike<number>,
): PitchMetrics {
  const n = Math.min(estimateHz.length, referenceHz.length);
  let refVoiced = 0;
  let refUnvoiced = 0;
  let correct = 0;
  let chromaCorrect = 0;
  let bothVoiced = 0;
  let gross = 0;
  let octave = 0;
  let recalled = 0;
  let falseAlarms = 0;
  const errors: number[] = [];
  for (let i = 0; i < n; i++) {
    const ref = referenceHz[i]!;
    const est = estimateHz[i]!;
    if (ref > 0) {
      refVoiced++;
      if (est > 0) {
        recalled++;
        bothVoiced++;
        const cents = 1200 * Math.log2(est / ref);
        const abs = Math.abs(cents);
        errors.push(abs);
        if (abs <= 50) correct++;
        const folded = Math.abs(cents - 1200 * Math.round(cents / 1200));
        if (folded <= 50) chromaCorrect++;
        if (Math.abs(est / ref - 1) > 0.2) gross++;
        if (abs > 50 && folded <= 50) octave++;
      }
    } else {
      refUnvoiced++;
      if (est > 0) falseAlarms++;
    }
  }
  errors.sort((a, b) => a - b);
  return {
    referenceVoicedFrames: refVoiced,
    referenceUnvoicedFrames: refUnvoiced,
    rawPitchAccuracy: refVoiced > 0 ? correct / refVoiced : Number.NaN,
    rawChromaAccuracy: refVoiced > 0 ? chromaCorrect / refVoiced : Number.NaN,
    grossPitchError: bothVoiced > 0 ? gross / bothVoiced : 0,
    octaveErrorRate: bothVoiced > 0 ? octave / bothVoiced : 0,
    voicingRecall: refVoiced > 0 ? recalled / refVoiced : Number.NaN,
    voicingFalseAlarm: refUnvoiced > 0 ? falseAlarms / refUnvoiced : Number.NaN,
    medianAbsCents: percentile(errors, 0.5),
    p95AbsCents: percentile(errors, 0.95),
  };
}
