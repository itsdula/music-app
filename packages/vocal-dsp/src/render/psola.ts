import { downmixToMono, pcmFrames, type PcmAudio } from '@studio/audio-dsp';
import { type VocalEditDoc } from '@studio/domain';
import { assertValidPcm } from '../analyze';
import { computePitchRatioCurve, computeTargetPitchCurve } from '../correction';
import { smoothRamp } from '../internal/math';
import { runSteps, type StageHooks, type Steps } from '../internal/steps';
import { type PitchTrack, type VocalAnalysis, type VocalRenderQuality } from '../types';
import {
  detectPitchMarks,
  filledF0,
  frameValueAt,
  voicedRunsForRendering,
  type VoicedRun,
} from './pitch-marks';

/**
 * TD-PSOLA pitch correction (Moulines & Charpentier 1990), implemented from the
 * literature (no third-party code).
 *
 * For every voiced run whose ratio curve departs from 1 (plus a one-period margin):
 *  - analysis grains: two-period asymmetric Hann windows centred on each pitch mark
 *    (rising half over the previous period, falling half over the next one);
 *  - synthesis marks: s₀ = first analysis mark, s_{j+1} = s_j + P(s_j)/β(s_j), where P
 *    is the local analysis period (interpolated from mark spacing) and β the ratio;
 *  - each synthesis mark copies the grain of the nearest analysis mark (time scale 1:
 *    durations are preserved exactly);
 *  - overlap-add with window-sum normalisation out = Σg / max(Σw, WINDOW_FLOOR), which
 *    is exact reconstruction for β = 1 and keeps the level constant for β > 1;
 *  - a short-time gain (30 ms energy windows) matches the output level to the original;
 *  - the processed span starts at an analysis mark (seamless) and is cross-faded back
 *    to the original over one period after the last synthesis mark.
 * Formants are preserved intrinsically (grains are not resampled). Optional formant
 * shift resamples each grain by γ = 2^(formantShift/12) (γ = β·2^(shift/12) when
 * formant preservation is off, which reproduces "chipmunk" resampling).
 * Everything outside processed spans (unvoiced/non-pitched audio, bypassed notes,
 * unedited notes) is copied sample-for-sample.
 *
 * Quality: 'final' places grains at fractional positions with 4-point Catmull-Rom
 * interpolation; 'preview' rounds synthesis marks to whole samples (linear
 * interpolation only when grains are resampled). Musical edits are identical.
 */
export const PSOLA_PARAMS = {
  windowFloor: 0.5,
  /** Window of the short-time level matching (at least two periods). */
  levelWindowSeconds: 0.03,
  /** Ratio departures smaller than this are treated as 1. */
  ratioEpsilon: 1e-6,
} as const;

interface Span {
  readonly run: VoicedRun;
  readonly startSample: number;
  readonly endSample: number;
}

function catmullRom(x: Float32Array, position: number): number {
  const i = Math.floor(position);
  const t = position - i;
  const n = x.length;
  const p0 = i - 1 >= 0 && i - 1 < n ? x[i - 1]! : 0;
  const p1 = i >= 0 && i < n ? x[i]! : 0;
  const p2 = i + 1 >= 0 && i + 1 < n ? x[i + 1]! : 0;
  const p3 = i + 2 >= 0 && i + 2 < n ? x[i + 2]! : 0;
  return (
    p1 + 0.5 * t * (p2 - p0 + t * (2 * p0 - 5 * p1 + 4 * p2 - p3 + t * (3 * (p1 - p2) + p3 - p0)))
  );
}

function linear(x: Float32Array, position: number): number {
  const i = Math.floor(position);
  const t = position - i;
  const n = x.length;
  const a = i >= 0 && i < n ? x[i]! : 0;
  const b = i + 1 >= 0 && i + 1 < n ? x[i + 1]! : 0;
  return a + (b - a) * t;
}

/**
 * Per-sample gain that matches the short-time energy (summed over channels, window
 * `window` samples shifted inwards at the span edges) of the normalised OLA output to
 * the original. Normalised PSOLA keeps harmonic amplitudes but changes harmonic density
 * (≈ −10·log10 β dB) and overlapping grains interfere; matching restores the original
 * loudness contour. Clamped to [1/4, 4].
 */
function levelMatchingGain(
  original: readonly Float32Array[],
  acc: readonly Float64Array[],
  wsum: Float64Array,
  regionStart: number,
  from: number,
  to: number,
  window: number,
): Float64Array {
  const length = Math.max(0, to - from);
  const floor = PSOLA_PARAMS.windowFloor;
  const origPrefix = new Float64Array(length + 1);
  const procPrefix = new Float64Array(length + 1);
  for (let i = 0; i < length; i++) {
    const n = from + i;
    const index = n - regionStart;
    const norm = 1 / Math.max(wsum[index]!, floor);
    let eo = 0;
    let ep = 0;
    for (let c = 0; c < original.length; c++) {
      eo += original[c]![n]! ** 2;
      ep += (acc[c]![index]! * norm) ** 2;
    }
    origPrefix[i + 1] = origPrefix[i]! + eo;
    procPrefix[i + 1] = procPrefix[i]! + ep;
  }
  const w = Math.max(1, Math.min(length, window));
  const half = w >> 1;
  const gain = new Float64Array(length);
  const epsilon = 1e-12 * w;
  for (let i = 0; i < length; i++) {
    const lo = Math.min(Math.max(0, i - half), length - w);
    const eo = origPrefix[lo + w]! - origPrefix[lo]!;
    const ep = procPrefix[lo + w]! - procPrefix[lo]!;
    const g = Math.sqrt((eo + epsilon) / (ep + epsilon));
    gain[i] = g < 0.25 ? 0.25 : g > 4 ? 4 : g;
  }
  return gain;
}

/** Ratio per frame with bridged unvoiced gaps inside runs interpolated. */
function filledRatio(
  ratio: Float32Array,
  track: PitchTrack,
  runs: readonly VoicedRun[],
): Float64Array {
  const out = Float64Array.from(ratio);
  for (const run of runs) {
    let last = -1;
    for (let i = run.firstFrame; i < run.endFrame; i++) {
      if (track.f0Hz[i]! > 0) {
        if (last >= 0 && i - last > 1) {
          for (let g = last + 1; g < i; g++) {
            out[g] = out[last]! + ((out[i]! - out[last]!) * (g - last)) / (i - last);
          }
        }
        last = i;
      }
    }
  }
  return out;
}

function activeSpans(
  runs: readonly VoicedRun[],
  ratio: Float64Array,
  track: PitchTrack,
  formantActive: boolean,
  f0: Float64Array,
): Span[] {
  const spans: Span[] = [];
  const sr = track.sampleRate;
  const hop = track.hopSeconds;
  for (const run of runs) {
    if (formantActive) {
      spans.push({ run, startSample: run.startSample, endSample: run.endSample });
      continue;
    }
    let current: { start: number; end: number } | null = null;
    const runSpans: { start: number; end: number }[] = [];
    for (let i = run.firstFrame; i < run.endFrame; i++) {
      if (Math.abs(ratio[i]! - 1) <= PSOLA_PARAMS.ratioEpsilon) continue;
      const period = f0[i]! > 0 ? sr / f0[i]! : 0;
      const start = Math.round((track.firstFrameSeconds + (i - 0.5) * hop) * sr - 2 * period);
      const end = Math.round((track.firstFrameSeconds + (i + 0.5) * hop) * sr + 2 * period);
      // Merge spans whose fades would overlap (closer than four periods).
      if (current !== null && start <= current.end + 4 * period) {
        current.end = Math.max(current.end, end);
      } else {
        current = { start, end };
        runSpans.push(current);
      }
    }
    for (const s of runSpans) {
      spans.push({
        run,
        startSample: Math.max(run.startSample, s.start),
        endSample: Math.min(run.endSample, s.end),
      });
    }
  }
  return spans;
}

export function* renderPitchCorrectionSteps(
  source: PcmAudio,
  analysis: VocalAnalysis,
  doc: VocalEditDoc,
  quality: VocalRenderQuality,
): Steps<PcmAudio> {
  assertValidPcm(source);
  const frames = pcmFrames(source);
  const output = source.channels.map((c) => c.slice());
  const result: PcmAudio = { sampleRate: source.sampleRate, channels: output };
  if (!doc.enabled) return result;

  const sr = source.sampleRate;
  const track: PitchTrack =
    analysis.pitchTrack.sampleRate === sr
      ? analysis.pitchTrack
      : { ...analysis.pitchTrack, sampleRate: sr };
  const target = computeTargetPitchCurve(track, doc.segments, doc);
  const rawRatio = computePitchRatioCurve(track, target);
  const formantShift = Number.isFinite(doc.correction.formantShiftSemitones)
    ? doc.correction.formantShiftSemitones
    : 0;
  const preserve = doc.correction.formantPreservation;
  const formantActive = formantShift !== 0;
  let anyRatio = false;
  for (let i = 0; i < rawRatio.length; i++) {
    if (Math.abs(rawRatio[i]! - 1) > PSOLA_PARAMS.ratioEpsilon) {
      anyRatio = true;
      break;
    }
  }
  if (!anyRatio && !formantActive) return result;
  yield 0.05;

  const mono = downmixToMono(source);
  const runs = voicedRunsForRendering(track, frames);
  const f0 = filledF0(track, runs);
  const ratio = filledRatio(rawRatio, track, runs);
  const marks = detectPitchMarks(mono, sr, track);
  yield 0.2;
  const spans = activeSpans(runs, ratio, track, formantActive, f0);
  const formantFactor = Math.pow(2, formantShift / 12);
  const final = quality === 'final';
  const channelCount = source.channels.length;

  for (let s = 0; s < spans.length; s++) {
    yield 0.2 + (0.8 * s) / spans.length;
    const span = spans[s]!;
    // Analysis marks of this run.
    let lo = 0;
    while (lo < marks.length && marks[lo]! < span.run.startSample) lo++;
    let hi = lo;
    while (hi < marks.length && marks[hi]! < span.run.endSample) hi++;
    if (hi - lo < 3) continue;
    const runMarks = marks.subarray(lo, hi);
    // First mark at or before the span start, last mark at or after the span end.
    let kStart = 0;
    while (kStart + 1 < runMarks.length && runMarks[kStart + 1]! <= span.startSample) kStart++;
    let kEnd = runMarks.length - 1;
    while (kEnd - 1 > kStart && runMarks[kEnd - 1]! >= span.endSample) kEnd--;
    if (kEnd - kStart < 2) continue;

    const markAt = (k: number): number => runMarks[Math.min(Math.max(k, 0), runMarks.length - 1)]!;
    const spacing = (k: number): number => {
      // Distance to the next mark (clamped at the run edges).
      if (k + 1 < runMarks.length) return markAt(k + 1) - markAt(k);
      return markAt(k) - markAt(k - 1);
    };
    const periodAtMark = (k: number): number =>
      k <= 0
        ? spacing(0)
        : k >= runMarks.length - 1
          ? spacing(k - 1)
          : 0.5 * (spacing(k - 1) + spacing(k));

    const first = markAt(kStart);
    const last = markAt(kEnd);
    // Grains reach at most one period / γ either side of their synthesis mark.
    let maxSpacing = 1;
    for (let m = 1; m < runMarks.length; m++)
      maxSpacing = Math.max(maxSpacing, markAt(m) - markAt(m - 1));
    const minGamma = Math.min(1, formantFactor) * (preserve ? 1 : 0.5);
    const pad = Math.ceil((2 * maxSpacing) / minGamma) + 4;
    const regionStart = Math.max(0, first - pad);
    const regionEnd = Math.min(frames, last + pad);
    const regionLength = regionEnd - regionStart;
    const acc = Array.from({ length: channelCount }, () => new Float64Array(regionLength));
    const wsum = new Float64Array(regionLength);

    let synth = first;
    let k = kStart; // analysis mark at or before `synth`
    let lastSynth = first;
    let lastRight = spacing(kStart);
    while (synth < last) {
      while (k + 1 <= kEnd && markAt(k + 1) <= synth) k++;
      // Nearest analysis mark.
      const nearest = k + 1 <= kEnd && markAt(k + 1) - synth < synth - markAt(k) ? k + 1 : k;
      const beta = frameValueAt(ratio, track, synth, span.run.firstFrame, span.run.endFrame);
      const gamma = (preserve ? 1 : beta) * formantFactor;
      const centre = markAt(nearest);
      const left = nearest > 0 ? centre - markAt(nearest - 1) : spacing(nearest);
      const right =
        nearest + 1 < runMarks.length ? markAt(nearest + 1) - centre : spacing(nearest - 1);
      const position = final ? synth : Math.round(synth);
      const resample = Math.abs(gamma - 1) > 1e-9;
      const nFrom = Math.ceil(position - left / gamma);
      const nTo = Math.floor(position + right / gamma);
      for (let n = Math.max(regionStart, nFrom); n <= Math.min(regionEnd - 1, nTo); n++) {
        const u = (n - position) * gamma;
        let w: number;
        if (u < 0) w = 0.5 - 0.5 * Math.cos((Math.PI * (u + left)) / left);
        else w = 0.5 + 0.5 * Math.cos((Math.PI * u) / right);
        if (w <= 0) continue;
        const index = n - regionStart;
        wsum[index] = wsum[index]! + w;
        const srcPos = centre + u;
        const integral = !resample && !final;
        for (let c = 0; c < channelCount; c++) {
          const x = source.channels[c]!;
          let value: number;
          if (integral) {
            const si = centre + (n - position);
            value = si >= 0 && si < frames ? x[si]! : 0;
          } else if (final) value = catmullRom(x, srcPos);
          else value = linear(x, srcPos);
          acc[c]![index] = acc[c]![index]! + w * value;
        }
      }
      lastSynth = position;
      lastRight = right / gamma;
      // Advance by the local analysis period divided by the ratio.
      const kk = Math.min(k, kEnd - 1);
      const frac = (synth - markAt(kk)) / Math.max(1, markAt(kk + 1) - markAt(kk));
      const period =
        periodAtMark(kk) +
        (periodAtMark(kk + 1) - periodAtMark(kk)) * Math.min(1, Math.max(0, frac));
      synth += Math.max(1, period / Math.max(0.5, Math.min(2, beta)));
    }

    // Write back: fade in over the period before the first mark, fade out over one
    // period after the last synthesis grain.
    const fadeInStart = Math.max(regionStart, Math.round(first - spacing(Math.max(0, kStart - 1))));
    const fadeOutStart = Math.ceil(lastSynth);
    const fadeOutEnd = Math.min(regionEnd, Math.floor(lastSynth + lastRight));
    const floor = PSOLA_PARAMS.windowFloor;
    const gain = levelMatchingGain(
      source.channels,
      acc,
      wsum,
      regionStart,
      fadeInStart,
      fadeOutEnd,
      Math.max(2 * maxSpacing, Math.round(PSOLA_PARAMS.levelWindowSeconds * sr)),
    );
    for (let c = 0; c < channelCount; c++) {
      const out = output[c]!;
      const x = source.channels[c]!;
      const a = acc[c]!;
      for (let n = fadeInStart; n < fadeOutEnd; n++) {
        const index = n - regionStart;
        const processed = (gain[n - fadeInStart]! * a[index]!) / Math.max(wsum[index]!, floor);
        let mix = 1;
        if (n < first) mix = smoothRamp((n - fadeInStart) / Math.max(1, first - fadeInStart));
        else if (n >= fadeOutStart)
          mix = 1 - smoothRamp((n - fadeOutStart) / Math.max(1, fadeOutEnd - fadeOutStart));
        out[n] = mix * processed + (1 - mix) * x[n]!;
      }
    }
  }
  return result;
}

/**
 * Renders pitch correction with TD-PSOLA. The output has exactly the input's length and
 * channel count; untouched regions are copied sample-for-sample. Deterministic.
 */
export function renderPitchCorrection(
  source: PcmAudio,
  analysis: VocalAnalysis,
  doc: VocalEditDoc,
  quality: VocalRenderQuality,
  hooks?: StageHooks,
): PcmAudio {
  return runSteps(renderPitchCorrectionSteps(source, analysis, doc, quality), hooks);
}
