import { describe, expect, it } from "vitest";
import { ignite, stepFire } from "./fire";
import { CellState, CellType, createGrid, FUEL, type Grid, get, H, idx, N, W } from "./grid";
import { buildYard } from "./map";
import { createRng } from "./rng";
import type { Wind } from "./world";

const CALM: Wind = { dx: 1, dy: 0, speedKmh: 0 };

function scrubField(): Grid {
  const grid = createGrid();
  grid.type.fill(CellType.Scrub);
  grid.fuel.fill(FUEL[CellType.Scrub]);
  return grid;
}

function run(grid: Grid, wind: Wind, seed: number, ticks: number): void {
  const rng = createRng(seed);
  for (let t = 0; t < ticks; t++) stepFire(grid, wind, rng);
}

function touched(grid: Grid, i: number): boolean {
  return get(grid.state, i) !== CellState.Intact;
}

describe("ignite", () => {
  it("only lights intact flammable cells", () => {
    const grid = scrubField();
    grid.type[idx(1, 1)] = CellType.Wall;
    grid.fuel[idx(1, 1)] = 0;
    ignite(grid, idx(1, 1), 0.5);
    expect(get(grid.state, idx(1, 1))).toBe(CellState.Intact);

    ignite(grid, idx(2, 2), 0.5);
    expect(get(grid.state, idx(2, 2))).toBe(CellState.Burning);
    expect(get(grid.intensity, idx(2, 2))).toBe(0.5);

    grid.state[idx(3, 3)] = CellState.Extinguished;
    ignite(grid, idx(3, 3), 0.5);
    expect(get(grid.state, idx(3, 3))).toBe(CellState.Extinguished);
  });
});

describe("stepFire", () => {
  it("never ignites walls", () => {
    const grid = scrubField();
    const c = idx(10, 10);
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const i = idx(10 + dx, 10 + dy);
        grid.type[i] = CellType.Wall;
        grid.fuel[i] = 0;
      }
    }
    ignite(grid, c, 1);
    run(grid, CALM, 1, 500);
    for (let i = 0; i < N; i++) {
      if (i !== c) expect(get(grid.state, i)).toBe(CellState.Intact);
    }
  });

  it("burns out: a lone burning cell ends burned with no fuel", () => {
    const grid = createGrid(); // ground: fuel 0.03, neighbours almost never ignite
    grid.fuel.fill(0);
    const c = idx(5, 5);
    grid.type[c] = CellType.Paper;
    grid.fuel[c] = FUEL[CellType.Paper];
    ignite(grid, c, 0.5);
    run(grid, CALM, 1, 1000);
    expect(get(grid.state, c)).toBe(CellState.Burned);
    expect(get(grid.fuel, c)).toBe(0);
    expect(get(grid.intensity, c)).toBe(0);
  });

  it("returns the cells it ignited this tick", () => {
    const grid = scrubField();
    ignite(grid, idx(30, 20), 1);
    const rng = createRng(3);
    let all: number[] = [];
    for (let t = 0; t < 20; t++) all = all.concat(stepFire(grid, CALM, rng));
    expect(all.length).toBeGreaterThan(0);
    for (const i of all) expect(get(grid.state, i)).not.toBe(CellState.Intact);
  });

  it("is deterministic for the same seed", () => {
    const a = buildYard().grid;
    const b = buildYard().grid;
    ignite(a, idx(35, 10), 0.5);
    ignite(b, idx(35, 10), 0.5);
    const wind = { dx: 1, dy: 0, speedKmh: 18 };
    run(a, wind, 42, 100);
    run(b, wind, 42, 100);
    expect(Array.from(a.state)).toEqual(Array.from(b.state));
    expect(Array.from(a.intensity)).toEqual(Array.from(b.intensity));
    expect(Array.from(a.fuel)).toEqual(Array.from(b.fuel));
  });

  it("spreads faster downwind", () => {
    const cx = 32;
    const cy = 20;
    let down = 0;
    let up = 0;
    for (let seed = 1; seed <= 20; seed++) {
      const grid = scrubField();
      ignite(grid, idx(cx, cy), 0.5);
      run(grid, { dx: 1, dy: 0, speedKmh: 30 }, seed, 40);
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          if (!touched(grid, idx(x, y))) continue;
          if (x > cx) down++;
          if (x < cx) up++;
        }
      }
    }
    expect(down).toBeGreaterThan(up * 1.5);
  });

  it("handles edges and corners", () => {
    const grid = scrubField();
    ignite(grid, idx(0, 0), 1);
    ignite(grid, idx(W - 1, H - 1), 1);
    expect(() => run(grid, { dx: -1, dy: -1, speedKmh: 30 }, 7, 50)).not.toThrow();
  });

  it("spreads paper fire to the next room through the internal door", () => {
    const { grid } = buildYard();
    ignite(grid, idx(8, 10), 0.5); // west room of warehouse A
    run(grid, CALM, 1, 2000);
    expect(touched(grid, idx(12, 11))).toBe(true); // door A-inner
    let eastRoom = 0;
    for (let y = 6; y <= 17; y++) {
      for (let x = 13; x <= 19; x++) if (touched(grid, idx(x, y))) eastRoom++;
    }
    expect(eastRoom).toBeGreaterThan(0);
  });
});
