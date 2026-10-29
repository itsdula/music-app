import { frameLayout } from '../params';
import { runSteps, scaleSteps, type StageHooks, type Steps } from '../internal/steps';
import { type PitchTrack, type VocalAnalysisParams } from '../types';
import { analyzeYinFrame, createYinConfig, createYinWorkspace } from './yin';

/**
 * Probabilistic YIN (Mauch & Dixon 2014), clean-room from the paper and the ISC-licensed
 * librosa description:
 *  1. Every YIN trough is a pitch candidate. Its probability integrates a Beta(2, 18)
 *     prior over 100 YIN thresholds, with a Boltzmann (λ = 2) preference for shorter
 *     periods among troughs below each threshold; if no trough is below a threshold the
 *     global minimum receives `NO_TROUGH_PROB` of that threshold's mass.
 *  2. An HMM over 10-cent pitch bins × {voiced, unvoiced} with triangular local
 *     transitions (±2.5 semitones per 5 ms) and a 1 % voicing switch probability is
 *     decoded with Viterbi (log domain, lowest-index tie-break).
 *  3. Each voiced frame reports the exact (parabolically refined) YIN candidate of its
 *     decoded bin, not the bin centre.
 *
 * Deviation (documented in docs/vocal-dsp.md): the voicing evidence of a frame is a
 * logistic function of its smallest CMNDF value instead of the summed candidate mass,
 * and `voicingThreshold` is the neutral point of that evidence in the HMM.
 */

/** Pitch-bin resolution in cents. */
export const PITCH_BIN_CENTS = 10;
/** Fastest pitch change the HMM allows, in octaves per second (librosa default). */
export const MAX_TRANSITION_OCTAVES_PER_SECOND = 35.92;
export const VOICING_SWITCH_PROB = 0.01;
export const BETA_PRIOR_A = 2;
export const BETA_PRIOR_B = 18;
export const THRESHOLD_COUNT = 100;
export const BOLTZMANN_PARAMETER = 2;
export const NO_TROUGH_PROB = 0.01;
/** CMNDF minimum at which the voicing evidence is 0.5, and the logistic slope. */
export const VOICING_CMNDF_MIDPOINT = 0.32;
export const VOICING_CMNDF_SLOPE = 0.06;
/** Silence-gated runs at least this long split the Viterbi decode into chunks. */
export const CHUNK_SPLIT_SECONDS = 0.25;
/** Upper bound for one Viterbi chunk (bounds backpointer memory). */
export const MAX_CHUNK_SECONDS = 60;

const NEG_INF = Number.NEGATIVE_INFINITY;

/** Beta(2, b) CDF: 1 − (1−x)^(b+1) − (b+1)·x·(1−x)^b. */
function betaCdfA2(x: number, b: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  return 1 - Math.pow(1 - x, b + 1) - (b + 1) * x * Math.pow(1 - x, b);
}

let thresholdMass: Float64Array | undefined;
function getThresholdMass(): Float64Array {
  if (thresholdMass !== undefined) return thresholdMass;
  const mass = new Float64Array(THRESHOLD_COUNT);
  let previous = 0;
  for (let k = 0; k < THRESHOLD_COUNT; k++) {
    const cdf = betaCdfA2((k + 1) / THRESHOLD_COUNT, BETA_PRIOR_B);
    mass[k] = cdf - previous;
    previous = cdf;
  }
  thresholdMass = mass;
  return mass;
}

const boltzmannTables: Float64Array[] = [];
/** Boltzmann pmf over positions 0..n-1 (λ = 2). */
function boltzmann(n: number): Float64Array {
  const cached = boltzmannTables[n];
  if (cached !== undefined) return cached;
  const table = new Float64Array(n);
  const lambda = BOLTZMANN_PARAMETER;
  const norm = (1 - Math.exp(-lambda)) / (1 - Math.exp(-lambda * n));
  for (let k = 0; k < n; k++) table[k] = norm * Math.exp(-lambda * k);
  boltzmannTables[n] = table;
  return table;
}

export function voicingEvidence(minCmndf: number): number {
  return 1 / (1 + Math.exp((minCmndf - VOICING_CMNDF_MIDPOINT) / VOICING_CMNDF_SLOPE));
}

/** Per-frame observations shared by the decoder and diagnostics. */
export interface PyinObservations {
  readonly frameCount: number;
  readonly binCount: number;
  readonly minHz: number;
  /** Candidates of frame i are entries candStart[i] .. candStart[i+1]-1 (unique bins). */
  readonly candStart: Int32Array;
  readonly candBin: Int32Array;
  /** Normalised candidate distribution (sums to 1 per frame with candidates). */
  readonly candProb: Float64Array;
  readonly candHz: Float64Array;
  /** Voicing evidence 0..1 (0 for silence-gated frames). */
  readonly voicing: Float64Array;
  readonly rmsDb: Float32Array;
  readonly gated: Uint8Array;
}

export function binCountFor(minHz: number, maxHz: number): number {
  return Math.floor((1200 * Math.log2(maxHz / minHz)) / PITCH_BIN_CENTS) + 1;
}

export function binOfHz(hz: number, minHz: number, binCount: number): number {
  const bin = Math.round((1200 * Math.log2(hz / minHz)) / PITCH_BIN_CENTS);
  return bin < 0 ? 0 : bin >= binCount ? binCount - 1 : bin;
}

/** Stage 1: YIN candidates, probabilities, voicing evidence and frame RMS. */
export function* observePitch(
  mono: Float32Array,
  sampleRate: number,
  params: VocalAnalysisParams,
): Steps<PyinObservations> {
  const layout = frameLayout(sampleRate, params);
  const frameCount = layout.frameCountFor(mono.length);
  const config = createYinConfig(sampleRate, layout.frameSamples, params.minHz, params.maxHz);
  const ws = createYinWorkspace(config);
  const binCount = binCountFor(params.minHz, params.maxHz);
  const signal = Float64Array.from(mono);

  // Frame RMS over the analysis window N centred on the frame (zero padded).
  const prefix = new Float64Array(signal.length + 1);
  for (let i = 0; i < signal.length; i++) prefix[i + 1] = prefix[i]! + signal[i]! * signal[i]!;
  const rmsDb = new Float32Array(frameCount);
  const gated = new Uint8Array(frameCount);
  const halfN = layout.frameSamples >> 1;

  const voicing = new Float64Array(frameCount);
  const candStart = new Int32Array(frameCount + 1);
  let capacity = Math.max(64, frameCount * 4);
  let candBin = new Int32Array(capacity);
  let candProb = new Float64Array(capacity);
  let candHz = new Float64Array(capacity);
  let candCount = 0;

  const mass = getThresholdMass();
  const troughProb = new Float64Array(ws.troughPeriod.length);
  const eligible = new Int32Array(ws.troughPeriod.length);
  const halfSpan = config.span >> 1;
  const shortHalf = Math.max(layout.hopSamples, layout.frameSamples >> 3);
  const shortGateEnergy = 2 * shortHalf * Math.pow(10, params.silenceThresholdDb / 10);

  for (let i = 0; i < frameCount; i++) {
    if ((i & 255) === 255) yield i / frameCount;
    const centre = i * layout.hopSamples;
    const lo = Math.max(0, centre - halfN);
    const hi = Math.min(signal.length, centre + halfN);
    const energy = Math.max(0, prefix[hi]! - prefix[lo]!);
    const rms = Math.sqrt(energy / layout.frameSamples);
    const db = rms > 1e-6 ? 20 * Math.log10(rms) : -120;
    rmsDb[i] = db;
    candStart[i] = candCount;
    // Silence gate on the full window and on a short centred window (sharper voicing
    // boundaries: a frame centred in silence must not inherit a neighbouring vowel).
    const shortLo = Math.max(0, centre - shortHalf);
    const shortHi = Math.min(signal.length, centre + shortHalf);
    const shortEnergy = Math.max(0, prefix[shortHi]! - prefix[shortLo]!);
    if (db < params.silenceThresholdDb || shortEnergy < shortGateEnergy) {
      gated[i] = 1;
      continue;
    }
    const result = analyzeYinFrame(signal, centre - halfSpan, config, ws);
    const n = result.troughCount;
    if (n === 0) continue;
    voicing[i] = voicingEvidence(result.minHeight);

    // Candidate probabilities.
    let eligibleCount = 0;
    let globalMin = 0;
    for (let t = 0; t < n; t++) {
      troughProb[t] = 0;
      if (ws.troughHeight[t]! < ws.troughHeight[globalMin]!) globalMin = t;
      if (ws.troughHeight[t]! < 1) eligible[eligibleCount++] = t;
    }
    for (let k = 0; k < THRESHOLD_COUNT; k++) {
      const theta = (k + 1) / THRESHOLD_COUNT;
      let below = 0;
      for (let e = 0; e < eligibleCount; e++) if (ws.troughHeight[eligible[e]!]! < theta) below++;
      if (below === 0) {
        troughProb[globalMin] = troughProb[globalMin]! + NO_TROUGH_PROB * mass[k]!;
        continue;
      }
      const prior = boltzmann(below);
      let position = 0;
      for (let e = 0; e < eligibleCount; e++) {
        const t = eligible[e]!;
        if (ws.troughHeight[t]! < theta) {
          troughProb[t] = troughProb[t]! + mass[k]! * prior[position]!;
          position++;
        }
      }
    }

    // Aggregate per pitch bin (keep the most probable candidate's exact frequency).
    let total = 0;
    const frameStart = candCount;
    for (let t = 0; t < n; t++) {
      const p = troughProb[t]!;
      if (!(p > 0)) continue;
      const hz = sampleRate / ws.troughPeriod[t]!;
      const bin = binOfHz(hz, params.minHz, binCount);
      total += p;
      let found = -1;
      for (let c = frameStart; c < candCount; c++) {
        if (candBin[c] === bin) {
          found = c;
          break;
        }
      }
      if (found >= 0) {
        if (p > candProb[found]!) candHz[found] = hz;
        candProb[found] = candProb[found]! + p;
        continue;
      }
      if (candCount === capacity) {
        capacity *= 2;
        const nb = new Int32Array(capacity);
        nb.set(candBin);
        candBin = nb;
        const np = new Float64Array(capacity);
        np.set(candProb);
        candProb = np;
        const nh = new Float64Array(capacity);
        nh.set(candHz);
        candHz = nh;
      }
      candBin[candCount] = bin;
      candProb[candCount] = p;
      candHz[candCount] = hz;
      candCount++;
    }
    if (total > 0) {
      for (let c = frameStart; c < candCount; c++) candProb[c] = candProb[c]! / total;
    }
  }
  candStart[frameCount] = candCount;
  return {
    frameCount,
    binCount,
    minHz: params.minHz,
    candStart,
    candBin: candBin.subarray(0, candCount),
    candProb: candProb.subarray(0, candCount),
    candHz: candHz.subarray(0, candCount),
    voicing,
    rmsDb,
    gated,
  };
}

/** Chunk boundaries [start, end) for the Viterbi decode. */
export function decodeChunks(
  gated: Uint8Array,
  hopSeconds: number,
): { start: number; end: number }[] {
  const frameCount = gated.length;
  const splitRun = Math.max(1, Math.round(CHUNK_SPLIT_SECONDS / hopSeconds));
  const maxChunk = Math.max(splitRun * 4, Math.round(MAX_CHUNK_SECONDS / hopSeconds));
  const chunks: { start: number; end: number }[] = [];
  let i = 0;
  let chunkStart = 0;
  while (i < frameCount) {
    if (gated[i] === 1) {
      let j = i;
      while (j < frameCount && gated[j] === 1) j++;
      if (j - i >= splitRun) {
        if (i > chunkStart) chunks.push({ start: chunkStart, end: i });
        chunkStart = j;
      }
      i = j;
    } else {
      i++;
    }
  }
  if (frameCount > chunkStart) chunks.push({ start: chunkStart, end: frameCount });
  // Bound the memory of very long chunks by splitting at their most silent frame.
  const bounded: { start: number; end: number }[] = [];
  for (const chunk of chunks) {
    let start = chunk.start;
    while (chunk.end - start > maxChunk) {
      const end = start + maxChunk;
      bounded.push({ start, end });
      start = end;
    }
    bounded.push({ start, end: chunk.end });
  }
  return bounded;
}

interface DecodeResult {
  /** Decoded bin per frame and whether it is voiced. */
  readonly bin: Int32Array;
  readonly voiced: Uint8Array;
}

/** Stage 2: Viterbi decoding over pitch bins × voicing. */
export function* decodePitch(
  obs: PyinObservations,
  hopSeconds: number,
  voicingThreshold: number,
): Steps<DecodeResult> {
  const n = obs.binCount;
  const frameCount = obs.frameCount;
  const bin = new Int32Array(frameCount);
  const voiced = new Uint8Array(frameCount);
  const halfWidth = Math.min(
    63,
    Math.max(
      1,
      Math.round((MAX_TRANSITION_OCTAVES_PER_SECOND * 1200 * hopSeconds) / PITCH_BIN_CENTS),
    ),
  );
  // Triangular transition weights and per-row normalisation (rows truncated at the edges).
  const logTri = new Float64Array(halfWidth + 1);
  const tri = new Float64Array(halfWidth + 1);
  for (let d = 0; d <= halfWidth; d++) {
    tri[d] = 1 - d / (halfWidth + 1);
    logTri[d] = Math.log(tri[d]!);
  }
  const rowNorm = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let sum = 0;
    for (let d = -halfWidth; d <= halfWidth; d++) {
      const j = i + d;
      if (j >= 0 && j < n) sum += tri[Math.abs(d)]!;
    }
    rowNorm[i] = Math.log(sum);
  }
  const logStay = Math.log(1 - VOICING_SWITCH_PROB);
  const logSwitch = Math.log(VOICING_SWITCH_PROB);
  const unvoicedWeight = Math.log(voicingThreshold / (1 - voicingThreshold));

  let deltaV = new Float64Array(n);
  let deltaU = new Float64Array(n);
  let nextV = new Float64Array(n);
  let nextU = new Float64Array(n);
  const srcV = new Float64Array(n);
  const srcU = new Float64Array(n);
  const flagV = new Uint8Array(n);
  const flagU = new Uint8Array(n);
  const obsV = new Float64Array(n).fill(NEG_INF);

  const chunks = decodeChunks(obs.gated, hopSeconds);
  let processed = 0;
  for (const chunk of chunks) {
    const length = chunk.end - chunk.start;
    const back = new Uint8Array(length * 2 * n);
    for (let t = 0; t < length; t++) {
      const frame = chunk.start + t;
      if ((processed++ & 255) === 255) yield processed / frameCount;
      const v = obs.voicing[frame]!;
      const cs = obs.candStart[frame]!;
      const ce = obs.candStart[frame + 1]!;
      const logV = v > 0 ? Math.log(Math.min(v, 1 - 1e-9)) : NEG_INF;
      const logU = Math.log(Math.max(1 - v, 1e-9)) + unvoicedWeight;
      for (let c = cs; c < ce; c++) obsV[obs.candBin[c]!] = logV + Math.log(obs.candProb[c]!);

      if (t === 0) {
        const init = Math.log(0.5 / n);
        for (let j = 0; j < n; j++) {
          deltaV[j] = init + obsV[j]!;
          deltaU[j] = init + logU;
        }
      } else {
        // Best source per bin for voiced / unvoiced targets, folding in row normalisation.
        for (let i = 0; i < n; i++) {
          const fromV = deltaV[i]! + logStay;
          const fromU = deltaU[i]! + logSwitch;
          if (fromU > fromV) {
            srcV[i] = fromU - rowNorm[i]!;
            flagV[i] = 1;
          } else {
            srcV[i] = fromV - rowNorm[i]!;
            flagV[i] = 0;
          }
          const toUfromV = deltaV[i]! + logSwitch;
          const toUfromU = deltaU[i]! + logStay;
          if (toUfromV > toUfromU) {
            srcU[i] = toUfromV - rowNorm[i]!;
            flagU[i] = 1;
          } else {
            srcU[i] = toUfromU - rowNorm[i]!;
            flagU[i] = 0;
          }
        }
        const rowBase = t * 2 * n;
        nextV.fill(NEG_INF);
        for (let c = cs; c < ce; c++) {
          const j = obs.candBin[c]!;
          const lo = Math.max(0, j - halfWidth);
          const hi = Math.min(n - 1, j + halfWidth);
          let best = NEG_INF;
          let bestI = lo;
          for (let i = lo; i <= hi; i++) {
            const score = srcV[i]! + logTri[i > j ? i - j : j - i]!;
            if (score > best) {
              best = score;
              bestI = i;
            }
          }
          nextV[j] = best + obsV[j]!;
          back[rowBase + j] = (bestI - j + halfWidth) | (flagV[bestI]! << 7);
        }
        for (let j = 0; j < n; j++) {
          const lo = Math.max(0, j - halfWidth);
          const hi = Math.min(n - 1, j + halfWidth);
          let best = NEG_INF;
          let bestI = lo;
          for (let i = lo; i <= hi; i++) {
            const score = srcU[i]! + logTri[i > j ? i - j : j - i]!;
            if (score > best) {
              best = score;
              bestI = i;
            }
          }
          nextU[j] = best + logU;
          back[rowBase + n + j] = (bestI - j + halfWidth) | (flagU[bestI]! << 7);
        }
        const swapV = deltaV;
        deltaV = nextV;
        nextV = swapV;
        const swapU = deltaU;
        deltaU = nextU;
        nextU = swapU;
      }
      for (let c = cs; c < ce; c++) obsV[obs.candBin[c]!] = NEG_INF;
      // Renormalise to keep magnitudes small (does not change the argmax).
      let max = NEG_INF;
      for (let j = 0; j < n; j++) {
        if (deltaV[j]! > max) max = deltaV[j]!;
        if (deltaU[j]! > max) max = deltaU[j]!;
      }
      for (let j = 0; j < n; j++) {
        deltaV[j] = deltaV[j]! - max;
        deltaU[j] = deltaU[j]! - max;
      }
    }
    // Backtrack from the best final state (voiced bins first, lowest index wins ties).
    let state = 0;
    let isVoiced = true;
    let best = NEG_INF;
    for (let j = 0; j < n; j++) {
      if (deltaV[j]! > best) {
        best = deltaV[j]!;
        state = j;
        isVoiced = true;
      }
    }
    for (let j = 0; j < n; j++) {
      if (deltaU[j]! > best) {
        best = deltaU[j]!;
        state = j;
        isVoiced = false;
      }
    }
    for (let t = length - 1; t >= 0; t--) {
      const frame = chunk.start + t;
      bin[frame] = state;
      voiced[frame] = isVoiced ? 1 : 0;
      if (t === 0) break;
      const code = back[t * 2 * n + (isVoiced ? 0 : n) + state]!;
      const fromOther = (code & 0x80) !== 0;
      state = state + (code & 0x7f) - halfWidth;
      if (fromOther) isVoiced = !isVoiced;
    }
  }
  return { bin, voiced };
}

export function* trackPitchSteps(
  mono: Float32Array,
  sampleRate: number,
  params: VocalAnalysisParams,
): Steps<PitchTrack> {
  const layout = frameLayout(sampleRate, params);
  const obs = yield* scaleSteps(observePitch(mono, sampleRate, params), 0, 0.75);
  const decoded = yield* scaleSteps(
    decodePitch(obs, layout.hopSeconds, params.voicingThreshold),
    0.75,
    1,
  );
  const f0Hz = new Float32Array(obs.frameCount);
  for (let i = 0; i < obs.frameCount; i++) {
    if (decoded.voiced[i] !== 1 || obs.gated[i] === 1) continue;
    const bin = decoded.bin[i]!;
    // The decoded voiced bin always carries a candidate (other voiced bins are -∞).
    for (let c = obs.candStart[i]!; c < obs.candStart[i + 1]!; c++) {
      if (obs.candBin[c] === bin) {
        f0Hz[i] = obs.candHz[c]!;
        break;
      }
    }
  }
  return {
    sampleRate,
    hopSeconds: layout.hopSeconds,
    firstFrameSeconds: 0,
    frameCount: obs.frameCount,
    f0Hz,
    voicedProbability: Float32Array.from(obs.voicing),
    rmsDb: obs.rmsDb,
  };
}

/** pYIN pitch tracking of a mono signal (synchronous, deterministic). */
export function trackPitch(
  mono: Float32Array,
  sampleRate: number,
  params: VocalAnalysisParams,
  hooks?: StageHooks,
): PitchTrack {
  return runSteps(trackPitchSteps(mono, sampleRate, params), hooks);
}
