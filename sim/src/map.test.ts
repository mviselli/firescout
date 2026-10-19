import { describe, expect, it } from "vitest";
import {
  buildingOf,
  CellState,
  type CellType,
  CellType as CT,
  FUEL,
  get,
  H,
  idx,
  inBounds,
  N,
  W,
  xy,
} from "./grid";
import { buildYard, doorBlocks } from "./map";

const yard = buildYard();
const { grid } = yard;

describe("buildYard", () => {
  it("puts B5 inside the paint store", () => {
    expect(buildingOf(grid, idx(35, 10))).toBe("B");
  });

  it("gives each cell the fuel of its type", () => {
    for (let i = 0; i < N; i++) {
      expect(get(grid.fuel, i)).toBe(FUEL[get(grid.type, i) as CellType]);
    }
  });

  it("encloses every building: interiors are reachable from outside only through doors", () => {
    const seen = new Uint8Array(N);
    const stack = [idx(0, H - 1)];
    seen[idx(0, H - 1)] = 1;
    while (stack.length > 0) {
      const i = stack.pop() as number;
      expect(buildingOf(grid, i)).toBeNull();
      const [x, y] = xy(i);
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ] as const) {
        const nx = x + dx;
        const ny = y + dy;
        if (!inBounds(nx, ny)) continue;
        const n = idx(nx, ny);
        const t = get(grid.type, n);
        if (seen[n] || t === CT.Wall || t === CT.Door) continue;
        seen[n] = 1;
        stack.push(n);
      }
    }
  });

  it("defines the six doors at the specified cells", () => {
    expect(yard.doors.map((d) => d.id).sort()).toEqual([
      "A-inner",
      "A-south",
      "B-south",
      "B-west",
      "C-inner",
      "C-south",
    ]);
    const at = Object.fromEntries(yard.doors.map((d) => [d.id, [d.x, d.y]]));
    expect(at).toEqual({
      "A-inner": [12, 11],
      "A-south": [8, 18],
      "B-west": [26, 12],
      "B-south": [34, 18],
      "C-inner": [53, 11],
      "C-south": [53, 18],
    });
    for (const d of yard.doors) {
      expect(get(grid.type, idx(d.x, d.y))).toBe(CT.Door);
      expect(d.open).toBe(false);
      expect(buildingOf(grid, idx(d.x, d.y))).toBe(d.building);
    }
  });

  it("has paint only in B and paper only in A", () => {
    let paint = 0;
    let paper = 0;
    for (let i = 0; i < N; i++) {
      const t = get(grid.type, i);
      if (t === CT.Paint) {
        paint++;
        expect(buildingOf(grid, i)).toBe("B");
      }
      if (t === CT.Paper) {
        paper++;
        expect(buildingOf(grid, i)).toBe("A");
      }
    }
    expect(paint).toBeGreaterThan(0);
    expect(paper).toBeGreaterThan(0);
  });

  it("lays scrub along the north and west fence", () => {
    expect(get(grid.type, idx(40, 1))).toBe(CT.Scrub);
    expect(get(grid.type, idx(0, 30))).toBe(CT.Scrub);
    expect(get(grid.type, idx(40, 3))).toBe(CT.Ground);
  });

  it("spawns on the base", () => {
    expect(yard.baseCells).toHaveLength(6 * 4);
    expect(yard.baseCells).toContain(idx(...yard.spawn));
    for (const i of yard.baseCells) expect(get(grid.type, i)).toBe(CT.Base);
  });

  it("keeps the map within the grid", () => {
    expect(W * H).toBe(grid.type.length);
  });
});

describe("doorBlocks", () => {
  it("blocks while closed, not once opened or burned through", () => {
    const { grid, doors } = buildYard();
    const door = doors[0];
    if (!door) throw new Error("expected a door");
    expect(doorBlocks(grid, door)).toBe(true);
    grid.state[idx(door.x, door.y)] = CellState.Burning;
    expect(doorBlocks(grid, door)).toBe(true);
    grid.state[idx(door.x, door.y)] = CellState.Burned;
    expect(doorBlocks(grid, door)).toBe(false);
    grid.state[idx(door.x, door.y)] = CellState.Intact;
    door.open = true;
    expect(doorBlocks(grid, door)).toBe(false);
  });
});
