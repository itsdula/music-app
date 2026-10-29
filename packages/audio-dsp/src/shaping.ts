/**
 * Waveshaping curves and short synthesized utility sounds.
 */

/**
 * Builds a symmetric soft-clipping transfer curve for a WaveShaper-style lookup table:
 * `y = tanh(k·x) / tanh(k)` over x ∈ [−1, 1] with k = 1 + 19·drive.
 *
 * - `drive` 0..1 (clamped): 0 is a gentle curve (k = 1), 1 a hard knee (k = 20).
 *   The curve always maps ±1 → ±1 and 0 → 0 and is monotonic.
 * - `length` ≥ 2 samples (odd lengths put an exact zero in the middle).
 * - Determinism: closed form (`Math.tanh`). Ownership: new array. Complexity O(length).
 */
export function makeDistortionCurve(drive: number, length = 2048): Float32Array<ArrayBuffer> {
  const n = Math.max(2, Math.floor(length));
  const d = Number.isFinite(drive) ? Math.min(1, Math.max(0, drive)) : 0;
  const k = 1 + 19 * d;
  const norm = Math.tanh(k);
  const curve = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i * 2) / (n - 1) - 1;
    curve[i] = Math.tanh(k * x) / norm;
  }
  return curve;
}

/**
 * Synthesizes a metronome click: a sine burst (accent 1760 Hz, normal 1320 Hz) with a
 * 1 ms linear attack and an exponential decay (τ = 9 ms), 60 ms long, ending at zero.
 * Peak amplitude ≈ 1.0 for accents and ≈ 0.7 otherwise.
 *
 * - Determinism: closed form. Ownership: new array. Complexity O(0.06 · sampleRate).
 */
export function synthesizeMetronomeClick(
  sampleRate: number,
  accent: boolean,
): Float32Array<ArrayBuffer> {
  const frames = Math.ceil(0.06 * sampleRate);
  const out = new Float32Array(frames);
  const frequency = accent ? 1760 : 1320;
  const level = accent ? 1 : 0.7;
  const attack = 0.001 * sampleRate;
  for (let i = 0; i < frames; i++) {
    const t = i / sampleRate;
    const env = Math.min(1, i / attack) * Math.exp(-t / 0.009) * ((frames - 1 - i) / (frames - 1));
    out[i] = level * env * Math.sin(2 * Math.PI * frequency * t);
  }
  return out;
}
