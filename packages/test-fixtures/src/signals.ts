import { framesFor, monoPcm, type FixturePcm } from './pcm';
import { createSeededRandom } from './random';

export interface SineOptions {
  readonly sampleRate: number;
  readonly frequencyHz: number;
  readonly durationSeconds: number;
  readonly amplitude?: number;
  /** Start phase in cycles (0..1). */
  readonly phase?: number;
}

export function sine(options: SineOptions): FixturePcm {
  const { sampleRate, frequencyHz, durationSeconds } = options;
  const amplitude = options.amplitude ?? 0.5;
  const frames = framesFor(sampleRate, durationSeconds);
  const out = new Float32Array(frames);
  const phase0 = options.phase ?? 0;
  for (let i = 0; i < frames; i++) {
    out[i] = amplitude * Math.sin(2 * Math.PI * (phase0 + (frequencyHz * i) / sampleRate));
  }
  return monoPcm(sampleRate, out);
}

export interface SweepOptions {
  readonly sampleRate: number;
  readonly fromHz: number;
  readonly toHz: number;
  readonly durationSeconds: number;
  readonly amplitude?: number;
  /** 'log' (default) sweeps at constant octaves per second; 'linear' at constant Hz/s. */
  readonly curve?: 'log' | 'linear';
}

/** Phase-continuous sine sweep. `sweepFrequencyAt` gives its exact instantaneous frequency. */
export function sweep(options: SweepOptions): FixturePcm {
  const { sampleRate, durationSeconds } = options;
  const amplitude = options.amplitude ?? 0.5;
  const frames = framesFor(sampleRate, durationSeconds);
  const out = new Float32Array(frames);
  let phase = 0;
  for (let i = 0; i < frames; i++) {
    out[i] = amplitude * Math.sin(2 * Math.PI * phase);
    phase += sweepFrequencyAt(options, i / sampleRate) / sampleRate;
    phase -= Math.floor(phase);
  }
  return monoPcm(sampleRate, out);
}

export function sweepFrequencyAt(options: SweepOptions, tSeconds: number): number {
  const u = Math.min(1, Math.max(0, tSeconds / options.durationSeconds));
  if (options.curve === 'linear') return options.fromHz + (options.toHz - options.fromHz) * u;
  return options.fromHz * Math.pow(options.toHz / options.fromHz, u);
}

export interface NoiseOptions {
  readonly sampleRate: number;
  readonly durationSeconds: number;
  readonly seed: number;
  /** Peak of the uniform distribution (default 0.25). */
  readonly amplitude?: number;
}

/** Uniform white noise in [-amplitude, amplitude). */
export function whiteNoise(options: NoiseOptions): FixturePcm {
  const frames = framesFor(options.sampleRate, options.durationSeconds);
  const amplitude = options.amplitude ?? 0.25;
  const random = createSeededRandom(options.seed);
  const out = new Float32Array(frames);
  for (let i = 0; i < frames; i++) out[i] = amplitude * (2 * random() - 1);
  return monoPcm(options.sampleRate, out);
}
