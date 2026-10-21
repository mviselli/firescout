import type { Sample } from "../history";

const r1 = (v: number) => Math.round(v * 10) / 10;

/** Top of the sparkline's scale: the game's peak burned percent, in 10% steps, at least 20%. */
export function sparkTop(samples: readonly Sample[]): number {
  const peak = samples.reduce((m, s) => Math.max(m, s.burnedPct), 0);
  return Math.min(100, Math.max(20, Math.ceil(peak / 10) * 10));
}

/** SVG path of burned percent over the samples, spread across `w` × `h`, `top`% at the top. */
export function sparkPath(samples: readonly Sample[], w: number, h: number, top = 100): string {
  if (samples.length < 2) return "";
  const t0 = samples[0]?.t ?? 0;
  const span = Math.max(1e-9, (samples.at(-1)?.t ?? 0) - t0);
  return samples
    .map((s, k) => {
      const x = ((s.t - t0) / span) * w;
      const y = h - (Math.min(s.burnedPct, top) / top) * h;
      return `${k === 0 ? "M" : "L"}${r1(x)},${r1(y)}`;
    })
    .join("");
}
