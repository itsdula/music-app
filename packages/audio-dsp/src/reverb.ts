/**
 * Synthetic room impulse responses for convolution reverb.
 */
import { onePoleCoefficient } from './filters';
import { createSeededRandom, deriveSeed } from './random';
import { type PcmAudio } from './pcm';

/** RT60 → amplitude decay: exp(-ln(1000) · t / RT60) reaches −60 dB at RT60. */
const LN_1000 = Math.log(1000);

/**
 * Generates a decorrelated stereo impulse response: seeded white noise shaped by an
 * exponential envelope (−60 dB at `decaySeconds`) and a time-varying one-pole lowpass
 * whose cutoff starts at `dampingHz` and falls three octaves over the decay, so high
 * frequencies die away faster (air/wall absorption). Each channel is normalized to unit
 * energy (Σh² = 1), making the wet level roughly independent of the decay time for
 * broadband input. The last 5 ms fade linearly to zero.
 *
 * - Units: Hz, seconds. Length = ceil(decaySeconds · sampleRate) frames (min 1 ms).
 * - Determinism: depends only on the arguments (left/right use derived seeds).
 * - Ownership: returns new buffers owned by the caller.
 * - Complexity: O(length).
 */
export function generateReverbImpulse(
  sampleRate: number,
  decaySeconds: number,
  dampingHz: number,
  seed: number,
): PcmAudio {
  const decay = Math.max(0.001, decaySeconds);
  const frames = Math.max(1, Math.ceil(decay * sampleRate));
  const fade = Math.min(frames, Math.ceil(0.005 * sampleRate));
  const channels: Float32Array<ArrayBuffer>[] = [];
  for (let c = 0; c < 2; c++) {
    const random = createSeededRandom(deriveSeed(seed, c));
    const out = new Float32Array(frames);
    let state = 0;
    let energy = 0;
    for (let i = 0; i < frames; i++) {
      const t = i / sampleRate;
      const cutoff = Math.max(200, dampingHz * Math.pow(2, (-3 * t) / decay));
      const a = onePoleCoefficient(sampleRate, cutoff);
      state = (1 - a) * (random() * 2 - 1) + a * state;
      const fromEnd = frames - 1 - i;
      const tail = fromEnd < fade ? fromEnd / fade : 1;
      const v = state * Math.exp((-LN_1000 * t) / decay) * tail;
      out[i] = v;
      energy += v * v;
    }
    const norm = energy > 0 ? 1 / Math.sqrt(energy) : 0;
    for (let i = 0; i < frames - 1; i++) out[i] = out[i]! * norm;
    out[frames - 1] = 0;
    channels.push(out);
  }
  return { sampleRate, channels };
}
