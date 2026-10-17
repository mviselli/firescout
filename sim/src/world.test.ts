import { describe, expect, it } from "vitest";
import { CellState, get, idx, N } from "./grid";
import { createWorld, simTime } from "./world";

function burningCells(w: ReturnType<typeof createWorld>): number[] {
  const out: number[] = [];
  for (let i = 0; i < N; i++) if (get(w.grid.state, i) === CellState.Burning) out.push(i);
  return out;
}

describe("createWorld", () => {
  it("creates the same world for the same seed", () => {
    const a = createWorld(7);
    const b = createWorld(7);
    expect(a.wind).toEqual(b.wind);
    expect(burningCells(a)).toEqual(burningCells(b));
    expect([a.robot.x, a.robot.y]).toEqual([b.robot.x, b.robot.y]);
  });

  it("differs across seeds", () => {
    const worlds = [1, 2, 3, 4, 5].map((s) => burningCells(createWorld(s)).join());
    expect(new Set(worlds).size).toBeGreaterThan(1);
  });

  it("respects explicit wind", () => {
    const wind = { dx: 0, dy: 1, speedKmh: 12 };
    expect(createWorld(7, { wind }).wind).toEqual(wind);
  });

  it("draws a compass wind of 5–30 km/h by default", () => {
    for (let s = 1; s <= 20; s++) {
      const { wind } = createWorld(s);
      expect(Math.hypot(wind.dx, wind.dy)).toBeCloseTo(1, 10);
      expect(wind.speedKmh).toBeGreaterThanOrEqual(5);
      expect(wind.speedKmh).toBeLessThanOrEqual(30);
    }
  });

  it("starts the requested number of fires on fuel ≥ 0.5, never on a door", () => {
    const w = createWorld(3, { ignitions: 3 });
    const fires = burningCells(w);
    expect(fires.length).toBeGreaterThanOrEqual(1);
    expect(fires.length).toBeLessThanOrEqual(3);
    for (const i of fires) expect(get(w.grid.fuel, i)).toBeGreaterThanOrEqual(0.5);
    for (const d of w.doors) expect(fires).not.toContain(idx(d.x, d.y));
  });

  it("puts a full robot on the spawn cell at t = 0", () => {
    const w = createWorld(1);
    expect([w.robot.x, w.robot.y]).toEqual([31, 35]);
    expect([w.robot.water, w.robot.foam]).toEqual([100, 100]);
    expect(w.robot.task).toEqual({ kind: "wait" });
    expect(simTime(w)).toBe(0);
    expect(w.initialFlammable).toBeGreaterThan(500);
    expect(w.stats).toEqual({ wrongAgent: 0, riskyDoors: 0, backdrafts: 0 });
  });
});
