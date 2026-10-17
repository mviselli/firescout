import { describe, expect, it } from "vitest";
import { CellState, get, idx, N } from "./grid";
import { buildYard, type Yard } from "./map";
import { stepSmoke } from "./smoke";

/** A fixed burning cell (no fire step), so only smoke behaviour is under test. */
function smoulder(yard: Yard, x: number, y: number): void {
  const i = idx(x, y);
  yard.grid.state[i] = CellState.Burning;
  yard.grid.intensity[i] = 1;
}

function run(yard: Yard, ticks: number): void {
  for (let t = 0; t < ticks; t++) stepSmoke(yard.grid, yard.doors);
}

function door(yard: Yard, id: string) {
  const d = yard.doors.find((d) => d.id === id);
  if (!d) throw new Error(id);
  return d;
}

describe("stepSmoke", () => {
  it("is produced by burning cells", () => {
    const yard = buildYard();
    smoulder(yard, 35, 10);
    run(yard, 10);
    expect(get(yard.grid.smoke, idx(35, 10))).toBeGreaterThan(0.1);
    expect(get(yard.grid.smoke, idx(36, 10))).toBeGreaterThan(0);
  });

  it("stays inside a building while its doors are closed", () => {
    const yard = buildYard();
    smoulder(yard, 27, 12); // right behind B-west
    run(yard, 200);
    for (let i = 0; i < N; i++) {
      if (get(yard.grid.building, i) === 0) expect(get(yard.grid.smoke, i)).toBeLessThan(1e-9);
    }
    const bWest = door(yard, "B-west");
    expect(get(yard.grid.smoke, idx(bWest.x, bWest.y))).toBe(0);
  });

  it("leaks out once a door opens", () => {
    const yard = buildYard();
    smoulder(yard, 27, 12);
    door(yard, "B-west").open = true;
    run(yard, 100);
    expect(get(yard.grid.smoke, idx(25, 12))).toBeGreaterThan(0.001);
  });

  it("passes through a burned-out door", () => {
    const yard = buildYard();
    smoulder(yard, 27, 12);
    yard.grid.state[idx(26, 12)] = CellState.Burned;
    run(yard, 100);
    expect(get(yard.grid.smoke, idx(25, 12))).toBeGreaterThan(0.001);
  });

  it("never enters walls", () => {
    const yard = buildYard();
    smoulder(yard, 27, 6);
    run(yard, 100);
    expect(get(yard.grid.smoke, idx(26, 6))).toBe(0);
    expect(get(yard.grid.smoke, idx(27, 5))).toBe(0);
  });

  it("decays faster outdoors than indoors", () => {
    const yard = buildYard();
    yard.grid.smoke.fill(0.5);
    run(yard, 50);
    expect(get(yard.grid.smoke, idx(35, 10))).toBeGreaterThan(get(yard.grid.smoke, idx(40, 28)));
  });

  it("stays within [0, 1]", () => {
    const yard = buildYard();
    for (let x = 27; x <= 40; x++) smoulder(yard, x, 10);
    run(yard, 500);
    for (let i = 0; i < N; i++) {
      const s = get(yard.grid.smoke, i);
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThanOrEqual(1);
    }
  });
});
