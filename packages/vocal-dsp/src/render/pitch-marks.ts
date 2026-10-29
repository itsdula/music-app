import { type PitchTrack } from '../types';

/**
 * Pitch marks (one analysis epoch per glottal period) for TD-PSOLA.
 *
 * Marks are placed inside voiced runs only. The first mark of a run is the largest
 * |x| within its first period; each next mark is predicted one period ahead (period from
 * the pitch track at the midpoint), then refined by maximising the normalised
 * cross-correlation between the previous period and the candidate period within
 * ±12 % of a period, and finally snapped to the largest |x| within ±4 % of a period.
 * Marking stops where a period keeps less than 20 % of the previous period's energy
 * (decaying resonance after the voice stops) or its window would leave the run.
 * Correlation tracking keeps marks at the same waveform feature from period to period,
 * which is what keeps PSOLA grains coherent.
 */
export const PITCH_MARK_PARAMS = {
  /** Unvoiced gaps up to this many frames between pitch-continuous frames are bridged. */
  bridgeFrames: 2,
  /** Maximum pitch difference across a bridged gap, semitones. */
  bridgeMaxSemitones: 1,
  searchFraction: 0.12,
  snapFraction: 0.04,
  /** Energy of the next period relative to the previous one below which marking stops. */
  minEnergyRatio: 0.2,
} as const;

export interface VoicedRun {
  /** Frame range [firstFrame, endFrame). */
  readonly firstFrame: number;
  readonly endFrame: number;
  /** Sample range [startSample, endSample) covered by the run's frames. */
  readonly startSample: number;
  readonly endSample: number;
}

/** Voiced runs with short pitch-continuous gaps bridged (shared by marks and renderer). */
export function voicedRunsForRendering(track: PitchTrack, length: number): VoicedRun[] {
  const runs: VoicedRun[] = [];
  const f0 = track.f0Hz;
  const sr = track.sampleRate;
  const hop = track.hopSeconds;
  const toSample = (frameEdge: number): number =>
    Math.min(length, Math.max(0, Math.round((track.firstFrameSeconds + frameEdge * hop) * sr)));
  let i = 0;
  while (i < track.frameCount) {
    if (!(f0[i]! > 0)) {
      i++;
      continue;
    }
    const first = i;
    let end = i + 1;
    for (;;) {
      while (end < track.frameCount && f0[end]! > 0) end++;
      // Try to bridge a short gap.
      let next = end;
      while (
        next < track.frameCount &&
        !(f0[next]! > 0) &&
        next - end < PITCH_MARK_PARAMS.bridgeFrames + 1
      ) {
        next++;
      }
      if (
        next > end &&
        next < track.frameCount &&
        next - end <= PITCH_MARK_PARAMS.bridgeFrames &&
        f0[next]! > 0 &&
        Math.abs(12 * Math.log2(f0[next]! / f0[end - 1]!)) <= PITCH_MARK_PARAMS.bridgeMaxSemitones
      ) {
        end = next;
        continue;
      }
      break;
    }
    runs.push({
      firstFrame: first,
      endFrame: end,
      startSample: toSample(first - 0.5),
      endSample: toSample(end - 0.5),
    });
    i = end;
  }
  return runs;
}

/** f0 per frame with bridged gaps inside runs filled by linear interpolation. */
export function filledF0(track: PitchTrack, runs: readonly VoicedRun[]): Float64Array {
  const out = new Float64Array(track.frameCount);
  for (const run of runs) {
    let lastVoiced = -1;
    for (let i = run.firstFrame; i < run.endFrame; i++) {
      const hz = track.f0Hz[i]!;
      if (hz > 0) {
        if (lastVoiced >= 0 && i - lastVoiced > 1) {
          const a = track.f0Hz[lastVoiced]!;
          for (let g = lastVoiced + 1; g < i; g++) {
            out[g] = a + ((hz - a) * (g - lastVoiced)) / (i - lastVoiced);
          }
        }
        out[i] = hz;
        lastVoiced = i;
      }
    }
  }
  return out;
}

/** Linear interpolation of a per-frame curve at a sample position. */
export function frameValueAt(
  curve: ArrayLike<number>,
  track: PitchTrack,
  sample: number,
  firstFrame: number,
  endFrame: number,
): number {
  const position = (sample / track.sampleRate - track.firstFrameSeconds) / track.hopSeconds;
  if (position <= firstFrame) return curve[firstFrame]!;
  if (position >= endFrame - 1) return curve[endFrame - 1]!;
  const i = Math.floor(position);
  const frac = position - i;
  return curve[i]! + (curve[i + 1]! - curve[i]!) * frac;
}

function windowEnergy(x: Float32Array, centre: number, half: number): number {
  let sum = 0;
  for (let n = Math.max(0, centre - half); n < Math.min(x.length, centre + half); n++) {
    sum += x[n]! * x[n]!;
  }
  return sum;
}

function normalisedCorrelation(
  x: Float32Array,
  centreA: number,
  centreB: number,
  half: number,
): number {
  let ab = 0;
  let aa = 0;
  let bb = 0;
  const n = x.length;
  for (let k = -half; k < half; k++) {
    const ia = centreA + k;
    const ib = centreB + k;
    const a = ia >= 0 && ia < n ? x[ia]! : 0;
    const b = ib >= 0 && ib < n ? x[ib]! : 0;
    ab += a * b;
    aa += a * a;
    bb += b * b;
  }
  return aa > 0 && bb > 0 ? ab / Math.sqrt(aa * bb) : 0;
}

/** Analysis pitch marks (ascending sample indices) for all voiced runs. */
export function detectPitchMarks(
  mono: Float32Array,
  sampleRate: number,
  track: PitchTrack,
): Int32Array {
  const scaled: PitchTrack = track.sampleRate === sampleRate ? track : { ...track, sampleRate };
  const runs = voicedRunsForRendering(scaled, mono.length);
  const f0 = filledF0(scaled, runs);
  const marks: number[] = [];
  for (const run of runs) {
    const periodAt = (sample: number): number =>
      sampleRate / frameValueAt(f0, scaled, sample, run.firstFrame, run.endFrame);
    if (run.endSample - run.startSample < 2 * periodAt(run.startSample)) continue;
    // First mark: largest |x| in the first period.
    const firstPeriod = Math.max(2, Math.round(periodAt(run.startSample)));
    let mark = run.startSample;
    let peak = -1;
    for (let n = run.startSample; n < Math.min(run.endSample, run.startSample + firstPeriod); n++) {
      const v = Math.abs(mono[n]!);
      if (v > peak) {
        peak = v;
        mark = n;
      }
    }
    marks.push(mark);
    for (;;) {
      const period = periodAt(mark + 0.5 * periodAt(mark));
      const predicted = Math.round(mark + period);
      const half = Math.max(2, Math.round(period / 2));
      // The comparison window must stay inside the voiced run (decaying tails mislead it).
      if (predicted + half >= run.endSample) break;
      const radius = Math.max(1, Math.round(PITCH_MARK_PARAMS.searchFraction * period));
      let best = predicted;
      let bestScore = Number.NEGATIVE_INFINITY;
      for (let d = -radius; d <= radius; d++) {
        const candidate = predicted + d;
        if (candidate <= mark) continue;
        const score = normalisedCorrelation(mono, mark, candidate, half);
        if (score > bestScore + 1e-12) {
          bestScore = score;
          best = candidate;
        }
      }
      // Stop in decaying tails: the candidate period must keep a fifth of the energy.
      if (
        windowEnergy(mono, best, half) <
        PITCH_MARK_PARAMS.minEnergyRatio * windowEnergy(mono, mark, half)
      ) {
        break;
      }
      const snap = Math.max(1, Math.round(PITCH_MARK_PARAMS.snapFraction * period));
      let snapped = best;
      let snapPeak = Math.abs(mono[best] ?? 0);
      for (
        let n = Math.max(mark + 1, best - snap);
        n <= Math.min(mono.length - 1, best + snap);
        n++
      ) {
        const v = Math.abs(mono[n]!);
        if (v > snapPeak + 1e-12) {
          snapPeak = v;
          snapped = n;
        }
      }
      if (snapped >= run.endSample) break;
      marks.push(snapped);
      mark = snapped;
    }
  }
  return Int32Array.from(marks);
}
