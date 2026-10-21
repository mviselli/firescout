import { describe, expect, it } from "vitest";
import { parseTheme } from "../theme";
import { sparkPath, sparkTop } from "./spark";

describe("sparkPath", () => {
  it("draws burned percent over time, 0% at the bottom and 100% at the top", () => {
    const samples = [
      { t: 0, burnedPct: 0, burning: 1 },
      { t: 1, burnedPct: 50, burning: 9 },
      { t: 2, burnedPct: 100, burning: 0 },
    ];
    expect(sparkPath(samples, 100, 20)).toBe("M0,20L50,10L100,0");
  });

  it("is empty with fewer than two samples", () => {
    expect(sparkPath([], 100, 20)).toBe("");
    expect(sparkPath([{ t: 0, burnedPct: 3, burning: 1 }], 100, 20)).toBe("");
  });

  it("rounds to one decimal", () => {
    const s = [0, 1, 2].map((t) => ({ t, burnedPct: t === 1 ? 33.333 : 0, burning: 0 }));
    expect(sparkPath(s, 30, 10)).toBe("M0,10L15,6.7L30,10");
  });
});

describe("sparkTop", () => {
  it("scales to the game's peak in steps of 10%, never below 20%", () => {
    const at = (pct: number) => [{ t: 0, burnedPct: pct, burning: 0 }];
    expect(sparkTop([])).toBe(20);
    expect(sparkTop(at(6))).toBe(20);
    expect(sparkTop(at(23))).toBe(30);
    expect(sparkTop(at(100))).toBe(100);
  });

  it("puts the top of the scale at the top of the box", () => {
    const s = [0, 1].map((t) => ({ t, burnedPct: t * 20, burning: 0 }));
    expect(sparkPath(s, 10, 10, 20)).toBe("M0,10L10,0");
  });
});

describe("parseTheme", () => {
  it("defaults to dark and keeps a saved light", () => {
    expect(parseTheme(null)).toBe("dark");
    expect(parseTheme("nonsense")).toBe("dark");
    expect(parseTheme("light")).toBe("light");
    expect(parseTheme("dark")).toBe("dark");
  });
});
