export const W = 64;
export const H = 40;
export const N = W * H;
export const SECTOR_SIZE = 8;

const SECTOR_ROWS = "ABCDE";

export const CellType = {
  Ground: 0,
  Wall: 1,
  Floor: 2,
  Paint: 3,
  Paper: 4,
  Scrub: 5,
  Base: 6,
  Door: 7,
} as const;
export type CellType = (typeof CellType)[keyof typeof CellType];

export const CellState = {
  Intact: 0,
  Burning: 1,
  Burned: 2,
  Extinguished: 3,
} as const;
export type CellState = (typeof CellState)[keyof typeof CellState];

export type BuildingId = "A" | "B" | "C";
const BUILDINGS: readonly (BuildingId | null)[] = [null, "A", "B", "C"];

/** Initial fuel per cell type (CONTEXT §4). */
export const FUEL: Record<CellType, number> = {
  [CellType.Ground]: 0.03,
  [CellType.Wall]: 0,
  [CellType.Floor]: 0.55,
  [CellType.Paint]: 1.0,
  [CellType.Paper]: 0.9,
  [CellType.Scrub]: 0.75,
  [CellType.Base]: 0,
  [CellType.Door]: 0.5,
};

/** Struct-of-arrays cell storage, indexed row-major by `idx(x, y)`. */
export interface Grid {
  type: Uint8Array;
  fuel: Float64Array;
  state: Uint8Array;
  intensity: Float64Array;
  smoke: Float64Array;
  /** 0 = outside, 1 = A, 2 = B, 3 = C. */
  building: Uint8Array;
}

export function createGrid(): Grid {
  const grid: Grid = {
    type: new Uint8Array(N),
    fuel: new Float64Array(N),
    state: new Uint8Array(N),
    intensity: new Float64Array(N),
    smoke: new Float64Array(N),
    building: new Uint8Array(N),
  };
  grid.fuel.fill(FUEL[CellType.Ground]);
  return grid;
}

export function idx(x: number, y: number): number {
  return y * W + x;
}

export function xy(i: number): [number, number] {
  return [i % W, Math.floor(i / W)];
}

export function inBounds(x: number, y: number): boolean {
  return x >= 0 && x < W && y >= 0 && y < H;
}

/** Operational sector name: rows A–E by y, columns 1–8 by x. */
export function sectorOf(x: number, y: number): string {
  return `${SECTOR_ROWS[Math.floor(y / SECTOR_SIZE)]}${Math.floor(x / SECTOR_SIZE) + 1}`;
}

/** Checked typed-array read. */
export function get(arr: ArrayLike<number>, i: number): number {
  const v = arr[i];
  if (v === undefined) throw new RangeError(`cell index ${i} out of range`);
  return v;
}

export function buildingOf(grid: Grid, i: number): BuildingId | null {
  return BUILDINGS[get(grid.building, i)] ?? null;
}

export function buildingCode(id: BuildingId | null): number {
  return BUILDINGS.indexOf(id);
}

/** Burnable in a meaningful way: excludes yard ground, walls and the base. */
export function isFlammable(grid: Grid, i: number): boolean {
  return get(grid.fuel, i) > 0.1;
}
