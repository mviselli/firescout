import {
  type BuildingId,
  buildingCode,
  CellType,
  createGrid,
  FUEL,
  type Grid,
  H,
  idx,
  W,
} from "./grid";

export interface Door {
  id: string;
  x: number;
  y: number;
  building: BuildingId;
  open: boolean;
}

export interface Yard {
  grid: Grid;
  doors: Door[];
  baseCells: number[];
  spawn: [number, number];
}

interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

function setCell(grid: Grid, x: number, y: number, type: CellType): void {
  const i = idx(x, y);
  grid.type[i] = type;
  grid.fuel[i] = FUEL[type];
}

function fill(grid: Grid, r: Rect, type: (x: number, y: number) => CellType): void {
  for (let y = r.y0; y <= r.y1; y++) {
    for (let x = r.x0; x <= r.x1; x++) setCell(grid, x, y, type(x, y));
  }
}

/** Walls on the outline, `contents` inside, every cell tagged with the building id. */
function building(
  grid: Grid,
  id: BuildingId,
  r: Rect,
  contents: (x: number, y: number) => CellType,
): void {
  fill(grid, r, (x, y) =>
    x === r.x0 || x === r.x1 || y === r.y0 || y === r.y1 ? CellType.Wall : contents(x, y),
  );
  const code = buildingCode(id);
  for (let y = r.y0; y <= r.y1; y++) {
    for (let x = r.x0; x <= r.x1; x++) grid.building[idx(x, y)] = code;
  }
}

/** The industrial yard of CONTEXT §2 (layout table). */
export function buildYard(): Yard {
  const grid = createGrid();

  fill(grid, { x0: 0, y0: 0, x1: W - 1, y1: 2 }, () => CellType.Scrub);
  fill(grid, { x0: 0, y0: 0, x1: 1, y1: H - 1 }, () => CellType.Scrub);

  building(grid, "A", { x0: 3, y0: 5, x1: 20, y1: 18 }, (_x, y) =>
    y % 2 === 0 ? CellType.Paper : CellType.Floor,
  );
  fill(grid, { x0: 12, y0: 6, x1: 12, y1: 17 }, () => CellType.Wall);

  building(grid, "B", { x0: 26, y0: 5, x1: 41, y1: 18 }, (x, y) =>
    (x - 27) % 3 < 2 && (y - 6) % 3 < 2 ? CellType.Paint : CellType.Floor,
  );

  building(grid, "C", { x0: 46, y0: 5, x1: 60, y1: 18 }, () => CellType.Floor);
  fill(grid, { x0: 47, y0: 11, x1: 59, y1: 11 }, () => CellType.Wall);

  const doors: Door[] = [
    { id: "A-inner", x: 12, y: 11, building: "A", open: false },
    { id: "A-south", x: 8, y: 18, building: "A", open: false },
    { id: "B-west", x: 26, y: 12, building: "B", open: false },
    { id: "B-south", x: 34, y: 18, building: "B", open: false },
    { id: "C-inner", x: 53, y: 11, building: "C", open: false },
    { id: "C-south", x: 53, y: 18, building: "C", open: false },
  ];
  for (const d of doors) setCell(grid, d.x, d.y, CellType.Door);

  const baseRect = { x0: 29, y0: 34, x1: 34, y1: 37 };
  fill(grid, baseRect, () => CellType.Base);
  const baseCells: number[] = [];
  for (let y = baseRect.y0; y <= baseRect.y1; y++) {
    for (let x = baseRect.x0; x <= baseRect.x1; x++) baseCells.push(idx(x, y));
  }

  return { grid, doors, baseCells, spawn: [31, 35] };
}
