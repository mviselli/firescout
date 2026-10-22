import { describe, expect, it } from "vitest";
import { parseTheme } from "../theme";
import { sparkTop } from "./spark";

describe("sparkTop", () => {
  it("scales to the game's peak in steps of 10%, never below 20%", () => {
    const at = (pct: number) => [{ t: 0, burnedPct: pct, burning: 0 }];
    expect(sparkTop([])).toBe(20);
    expect(sparkTop(at(6))).toBe(20);
    expect(sparkTop(at(23))).toBe(30);
    expect(sparkTop(at(100))).toBe(100);
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
