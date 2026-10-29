import { frameLayout } from './params';
import {
  type NonPitchedKind,
  type NonPitchedRegion,
  type PitchTrack,
  type VocalAnalysisParams,
} from './types';

/**
 * Labels every unvoiced frame and groups the labels into regions.
 *
 * Per frame (analysis window N centred on the frame):
 *  - silence:  frame RMS (full window or the short centred window used by the pitch
 *              tracker's gate) below `silenceThresholdDb`;
 *  - sibilant: noise whose "RMS frequency" is at least `SIBILANT_MIN_HZ` — estimated from
 *              the energy ratio of the first difference, f = fs/π·asin(√(E_diff/E)/2),
 *              which is exact for a sinusoid and tracks the spectral centroid of noise;
 *  - breath:   other noise lasting at least `BREATH_MIN_SECONDS`;
 *  - unvoiced: short unvoiced events (plosive bursts shorter than `SIBILANT_MIN_SECONDS`,
 *              transitions) and leftovers.
 * Labels shorter than `MIN_RUN_SECONDS` are absorbed by their longer neighbour.
 */
export const SIBILANT_MIN_HZ = 3000;
export const BREATH_MIN_SECONDS = 0.06;
/** Shorter high-frequency noise is a plosive burst ('unvoiced'), not a sibilant. */
export const SIBILANT_MIN_SECONDS = 0.05;
export const MIN_RUN_SECONDS = 0.02;

const KIND_CODES: readonly NonPitchedKind[] = ['silence', 'unvoiced', 'breath', 'sibilant'];
const PITCHED = 255;

export function classifyNonPitched(
  mono: Float32Array,
  sampleRate: number,
  track: PitchTrack,
  params: VocalAnalysisParams,
): NonPitchedRegion[] {
  const layout = frameLayout(sampleRate, params);
  const frames = track.frameCount;
  const hop = track.hopSeconds;
  const durationSeconds = mono.length / sampleRate;

  // Prefix sums of x² and of (x[n] - x[n-1])².
  const energy = new Float64Array(mono.length + 1);
  const diffEnergy = new Float64Array(mono.length + 1);
  let previous = 0;
  for (let i = 0; i < mono.length; i++) {
    const x = mono[i]!;
    energy[i + 1] = energy[i]! + x * x;
    const d = x - previous;
    diffEnergy[i + 1] = diffEnergy[i]! + d * d;
    previous = x;
  }

  const labels = new Uint8Array(frames);
  const halfN = layout.frameSamples >> 1;
  // Same short-window silence gate as the pitch tracker.
  const shortHalf = Math.max(layout.hopSamples, layout.frameSamples >> 3);
  const shortGateEnergy = 2 * shortHalf * Math.pow(10, params.silenceThresholdDb / 10);
  for (let i = 0; i < frames; i++) {
    if (track.f0Hz[i]! > 0) {
      labels[i] = PITCHED;
      continue;
    }
    const centre = Math.round((track.firstFrameSeconds + i * hop) * sampleRate);
    const shortEnergy =
      energy[Math.min(mono.length, centre + shortHalf)]! - energy[Math.max(0, centre - shortHalf)]!;
    if (track.rmsDb[i]! < params.silenceThresholdDb || shortEnergy < shortGateEnergy) {
      labels[i] = 0;
      continue;
    }
    const lo = Math.max(0, centre - halfN);
    const hi = Math.min(mono.length, centre + halfN);
    const e = energy[hi]! - energy[lo]!;
    const ed = diffEnergy[hi]! - diffEnergy[lo]!;
    const ratio = e > 0 ? Math.min(1, Math.sqrt(ed / e) / 2) : 0;
    const rmsFrequency = (sampleRate / Math.PI) * Math.asin(ratio);
    labels[i] = rmsFrequency >= SIBILANT_MIN_HZ ? 3 : 2;
  }

  // Absorb short label runs (within unvoiced stretches) into the longer neighbour.
  const minRun = Math.max(1, Math.round(MIN_RUN_SECONDS / hop));
  const runs = toRuns(labels);
  for (let r = 0; r < runs.length; r++) {
    const run = runs[r]!;
    if (run.label === PITCHED || run.end - run.start >= minRun) continue;
    const left = runs[r - 1];
    const right = runs[r + 1];
    const leftOk = left !== undefined && left.label !== PITCHED;
    const rightOk = right !== undefined && right.label !== PITCHED;
    let label = run.label;
    if (leftOk && rightOk) {
      label = left.end - left.start >= right.end - right.start ? left.label : right.label;
    } else if (leftOk) label = left.label;
    else if (rightOk) label = right.label;
    run.label = label;
  }
  const merged = mergeRuns(runs);
  const breathMin = Math.max(1, Math.round(BREATH_MIN_SECONDS / hop));
  const sibilantMin = Math.max(1, Math.round(SIBILANT_MIN_SECONDS / hop));
  for (const run of merged) {
    if (run.label === 2 && run.end - run.start < breathMin) run.label = 1;
    if (run.label === 3 && run.end - run.start < sibilantMin) run.label = 1;
  }

  const regions: NonPitchedRegion[] = [];
  for (const run of mergeRuns(merged)) {
    if (run.label === PITCHED) continue;
    const startSeconds = Math.max(0, track.firstFrameSeconds + (run.start - 0.5) * hop);
    const endSeconds = Math.min(durationSeconds, track.firstFrameSeconds + (run.end - 0.5) * hop);
    if (endSeconds <= startSeconds) continue;
    regions.push({ startSeconds, endSeconds, kind: KIND_CODES[run.label]! });
  }
  return regions;
}

interface Run {
  label: number;
  readonly start: number;
  end: number;
}

function toRuns(labels: Uint8Array): Run[] {
  const runs: Run[] = [];
  let i = 0;
  while (i < labels.length) {
    let j = i + 1;
    while (j < labels.length && labels[j] === labels[i]) j++;
    runs.push({ label: labels[i]!, start: i, end: j });
    i = j;
  }
  return runs;
}

function mergeRuns(runs: readonly Run[]): Run[] {
  const out: Run[] = [];
  for (const run of runs) {
    const last = out[out.length - 1];
    if (last !== undefined && last.label === run.label) last.end = run.end;
    else out.push({ label: run.label, start: run.start, end: run.end });
  }
  return out;
}
