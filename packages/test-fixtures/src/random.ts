/**
 * Seeded pseudo-random numbers (mulberry32). Fixtures must never use `Math.random`:
 * the same seed always yields the same sequence, in every JS engine and in a Rust port
 * (the generator uses only 32-bit integer arithmetic).
 */
export interface SeededRandom {
  /** Uniform float in [0, 1). */
  (): number;
  /** Standard normal deviate (Box–Muller, consumes two uniforms). */
  gaussian(): number;
  /** Uniform integer in [0, maxExclusive). */
  int(maxExclusive: number): number;
}

export function createSeededRandom(seed: number): SeededRandom {
  let state = seed >>> 0;
  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const random = next as SeededRandom;
  random.gaussian = (): number => {
    // 1 - u keeps the argument of log strictly positive.
    const u = 1 - next();
    const v = next();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };
  random.int = (maxExclusive: number): number => Math.floor(next() * maxExclusive);
  return random;
}
