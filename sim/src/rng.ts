/**
 * Seeded PRNG (mulberry32). The whole simulation draws randomness from one of
 * these so that a seed plus a decision stream fully determines a game.
 */
export interface Rng {
  /** Uniform float in [0, 1). */
  next(): number;
  /** Internal 32-bit state; pass it back to `createRng` to resume the sequence. */
  state(): number;
}

export function createRng(seed: number): Rng {
  let s = seed >>> 0;
  return {
    next() {
      s = (s + 0x6d2b79f5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
    state() {
      return s;
    },
  };
}
