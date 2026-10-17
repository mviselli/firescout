import { describe, expect, it } from "vitest";
import { createGrid, get, H, idx, inBounds, N, sectorOf, W, xy } from "./grid";

describe("grid", () => {
  it("is 64 × 40", () => {
    expect([W, H, N]).toEqual([64, 40, 2560]);
  });

  it("maps cells to operational sectors", () => {
    expect(sectorOf(0, 0)).toBe("A1");
    expect(sectorOf(35, 10)).toBe("B5");
    expect(sectorOf(63, 39)).toBe("E8");
  });

  it("round-trips idx and xy", () => {
    expect(xy(idx(17, 23))).toEqual([17, 23]);
  });

  it("knows its bounds", () => {
    expect(inBounds(0, 0)).toBe(true);
    expect(inBounds(63, 39)).toBe(true);
    expect(inBounds(-1, 0)).toBe(false);
    expect(inBounds(64, 0)).toBe(false);
    expect(inBounds(0, 40)).toBe(false);
  });

  it("get throws out of range", () => {
    expect(() => get(createGrid().fuel, N)).toThrow();
  });
});
