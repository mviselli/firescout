import { describe, expect, it } from "vitest";
import { createRng } from "./rng";

describe("createRng", () => {
  it("produces the same sequence for the same seed", () => {
    const a = createRng(42);
    const b = createRng(42);
    const seqA = Array.from({ length: 100 }, () => a.next());
    const seqB = Array.from({ length: 100 }, () => b.next());
    expect(seqA).toEqual(seqB);
  });

  it("produces different sequences for different seeds", () => {
    const a = createRng(1);
    const b = createRng(2);
    expect(a.next()).not.toBe(b.next());
  });

  it("returns floats in [0, 1)", () => {
    const rng = createRng(7);
    for (let i = 0; i < 10_000; i++) {
      const x = rng.next();
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
    }
  });

  it("matches the reference mulberry32 output", () => {
    const rng = createRng(0);
    expect(rng.next()).toBeCloseTo(0.26642920868471265, 15);
  });

  it("can snapshot and restore its state", () => {
    const rng = createRng(99);
    rng.next();
    const saved = rng.state();
    const expected = [rng.next(), rng.next()];
    const restored = createRng(saved);
    expect([restored.next(), restored.next()]).toEqual(expected);
  });
});
