import { framesFor, monoPcm, normalizePeak, type FixturePcm } from './pcm';
import { createSeededRandom } from './random';
import { applyFormants, type FormantSet } from './vowel';

/**
 * Unvoiced sounds for non-pitched classification and "untouched region" tests.
 * - 'sibilant': /s/-like noise, energy concentrated in 3.5–9 kHz.
 * - 'breath': inhalation/exhalation noise shaped by wide formants (≈ 300–2500 Hz).
 * - 'plosive': a short broadband burst with fast exponential decay (/t/, /k/).
 */
export type ConsonantKind = 'sibilant' | 'breath' | 'plosive';

export interface ConsonantOptions {
  readonly sampleRate: number;
  readonly durationSeconds: number;
  readonly kind: ConsonantKind;
  readonly seed: number;
  /** Output RMS level in dBFS (default −30 for breath, −24 otherwise). */
  readonly rmsDb?: number;
}

const BREATH_FORMANTS: FormantSet = {
  frequenciesHz: [600, 1300, 2400, 3400, 4500],
  bandwidthsHz: [300, 400, 500, 600, 800],
};

export function synthesizeConsonantBurst(options: ConsonantOptions): FixturePcm {
  const { sampleRate, kind } = options;
  const frames = framesFor(sampleRate, options.durationSeconds);
  const random = createSeededRandom(options.seed);
  const signal = new Float64Array(frames);
  for (let i = 0; i < frames; i++) signal[i] = random.gaussian();

  if (kind === 'sibilant') {
    // Two second-difference high-pass stages, then a broad resonance near 6 kHz.
    for (let pass = 0; pass < 2; pass++) {
      let prev = 0;
      for (let i = 0; i < frames; i++) {
        const x = signal[i]!;
        signal[i] = x - prev;
        prev = x;
      }
    }
    if (sampleRate > 14000) {
      applyFormants(signal, sampleRate, {
        frequenciesHz: [5500, 7500, 1e9, 1e9, 1e9],
        bandwidthsHz: [3000, 3000, 1, 1, 1],
      });
    }
  } else if (kind === 'breath') {
    applyFormants(signal, sampleRate, BREATH_FORMANTS);
  }

  // Amplitude envelope.
  const attack = kind === 'plosive' ? framesFor(sampleRate, 0.001) : framesFor(sampleRate, 0.015);
  const decay = sampleRate * 0.008;
  for (let i = 0; i < frames; i++) {
    let env: number;
    if (kind === 'plosive') {
      env = i < attack ? i / Math.max(1, attack) : Math.exp(-(i - attack) / decay);
    } else {
      const ramp = Math.max(1, Math.min(attack, Math.floor(frames / 2)));
      env = Math.min(1, (i + 0.5) / ramp, (frames - i - 0.5) / ramp);
    }
    signal[i] = signal[i]! * env;
  }

  // Scale to the requested RMS.
  let power = 0;
  for (let i = 0; i < frames; i++) power += signal[i]! ** 2;
  const rms = Math.sqrt(power / Math.max(1, frames));
  const targetDb = options.rmsDb ?? (kind === 'breath' ? -30 : -24);
  if (rms > 0) {
    const gain = Math.pow(10, targetDb / 20) / rms;
    for (let i = 0; i < frames; i++) signal[i] = signal[i]! * gain;
  }
  // Guard against clipping for extreme settings.
  let peak = 0;
  for (let i = 0; i < frames; i++) peak = Math.max(peak, Math.abs(signal[i]!));
  if (peak > 0.99) normalizePeak(signal, 0.99);
  return monoPcm(sampleRate, Float32Array.from(signal));
}
