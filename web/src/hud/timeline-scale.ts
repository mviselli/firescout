import type { Sample, TimelineEntry } from "../history";

const STEP = 30;
const MIN_SPAN = 60;

/** Live: max(60, next multiple of 30 above t); replay: the recording's end time. */
export function timelineSpan(t: number, replayEnd: number | null): number {
  if (replayEnd !== null) return replayEnd;
  return Math.max(MIN_SPAN, (Math.floor(t / STEP) + 1) * STEP);
}

export interface TimeScale {
  x(t: number): number;
  t(x: number): number;
}

const clamp = (v: number, hi: number) => Math.min(hi, Math.max(0, v));

/** Seconds [0, span] onto pixels [0, width], clamped both ways. */
export function timeScale(span: number, width: number): TimeScale {
  const k = span > 0 && width > 0 ? width / span : 0;
  return {
    x: (t) => clamp(t, span) * k,
    t: (x) => (k === 0 ? 0 : clamp(x, width) / k),
  };
}

/** Index of the entry nearest to t within maxDt seconds, or null. Ties go to the earlier one. */
export function nearestEntry(
  entries: readonly TimelineEntry[],
  t: number,
  maxDt: number,
): number | null {
  let best: number | null = null;
  let bestDt = maxDt;
  entries.forEach((e, k) => {
    const dt = Math.abs(e.req.t - t);
    if (dt < bestDt || (dt === bestDt && best === null)) {
      best = k;
      bestDt = dt;
    }
  });
  return best;
}

const r1 = (v: number) => Math.round(v * 10) / 10;

/** SVG path of burned percent over time on `scale`, `h` tall, `top`% at the top. */
export function burnPath(
  samples: readonly Sample[],
  scale: TimeScale,
  h: number,
  top: number,
): string {
  if (samples.length < 2) return "";
  return samples
    .map((s, k) => {
      const y = h - (Math.min(s.burnedPct, top) / top) * h;
      return `${k === 0 ? "M" : "L"}${r1(scale.x(s.t))},${r1(y)}`;
    })
    .join("");
}
