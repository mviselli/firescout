import type { Sample } from "../history";

/** Top of the burn curve's scale: the game's peak burned percent, in 10% steps, at least 20%. */
export function sparkTop(samples: readonly Sample[]): number {
  const peak = samples.reduce((m, s) => Math.max(m, s.burnedPct), 0);
  return Math.min(100, Math.max(20, Math.ceil(peak / 10) * 10));
}
