import type { DecisionRequest } from "@firescout/sim";
import { describe, expect, it } from "vitest";
import type { TimelineEntry } from "../history";
import { burnPath, nearestEntry, timelineSpan, timeScale } from "./timeline-scale";

describe("timelineSpan", () => {
  it("grows the live span in 30 s steps from 60 s", () => {
    expect(timelineSpan(0, null)).toBe(60);
    expect(timelineSpan(59.9, null)).toBe(60);
    expect(timelineSpan(60, null)).toBe(90);
    expect(timelineSpan(61, null)).toBe(90);
    expect(timelineSpan(149.5, null)).toBe(150);
  });

  it("is the recording's end time in a replay", () => {
    expect(timelineSpan(12, 213.4)).toBe(213.4);
  });
});

describe("timeScale", () => {
  it("maps time to x and back, clamped", () => {
    const s = timeScale(60, 600);
    expect(s.x(0)).toBe(0);
    expect(s.x(30)).toBe(300);
    expect(s.x(90)).toBe(600);
    expect(s.x(-5)).toBe(0);
    expect(s.t(150)).toBe(15);
    expect(s.t(700)).toBe(60);
    expect(s.t(-1)).toBe(0);
  });

  it("puts everything at 0 when there is no width", () => {
    const s = timeScale(60, 0);
    expect(s.x(30)).toBe(0);
    expect(s.t(10)).toBe(0);
  });
});

const at = (t: number): TimelineEntry => ({
  req: { t } as DecisionRequest,
  answers: {},
  source: { backend: "baseline" },
});

describe("nearestEntry", () => {
  const entries = [at(0), at(0.8), at(1.6), at(5)];

  it("finds the nearest entry within maxDt", () => {
    expect(nearestEntry(entries, 1.5, 0.5)).toBe(2);
    expect(nearestEntry(entries, 4.6, 0.5)).toBe(3);
    expect(nearestEntry(entries, 0.3, 0.5)).toBe(0);
  });

  it("returns null when nothing is that close", () => {
    expect(nearestEntry(entries, 3.2, 0.5)).toBeNull();
    expect(nearestEntry([], 1, 10)).toBeNull();
  });

  it("prefers the earlier of two entries at the same distance", () => {
    expect(nearestEntry(entries, 0.4, 0.5)).toBe(0);
  });
});

describe("burnPath", () => {
  it("draws burned percent on the time scale, top% at the top", () => {
    const samples = [
      { t: 0, burnedPct: 0, burning: 1 },
      { t: 30, burnedPct: 10, burning: 9 },
    ];
    expect(burnPath(samples, timeScale(60, 120), 40, 20)).toBe("M0,40L60,20");
  });

  it("is empty with fewer than two samples", () => {
    expect(burnPath([{ t: 0, burnedPct: 3, burning: 1 }], timeScale(60, 120), 40, 20)).toBe("");
  });
});
