/**
 * Deterministic pseudo-random numbers for DSP (dither, noise, impulse responses).
 *
 * The generator is mulberry32: a 32-bit state, one multiply-xorshift round per draw.
 * It is not cryptographic. It is chosen because it is tiny, fast, has a full 2^32
 * period over its state and is trivially portable to Rust (`u32` wrapping arithmetic).
 */

/**
 * Creates a seeded uniform generator returning floats in [0, 1).
 *
 * - Units: dimensionless.
 * - Determinism: the sequence depends only on `seed` (coerced to an unsigned 32-bit
 *   integer, so `seed` and `seed + 2^32` produce the same sequence). Identical across
 *   JS engines because only 32-bit integer operations (`Math.imul`, shifts) are used.
 * - Ownership: the returned closure owns its 32-bit state; nothing is shared.
 * - Complexity: O(1) per draw, no allocation.
 */
export function createSeededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Derives a well-mixed 32-bit seed from a base seed and a stream index, so independent
 * noise streams (e.g. left/right channel, drum voice kinds) do not correlate.
 *
 * - Determinism: pure integer hash (murmur3 finalizer). Complexity O(1).
 */
export function deriveSeed(seed: number, stream: number): number {
  let h = (seed ^ Math.imul(stream + 1, 0x9e3779b1)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}
