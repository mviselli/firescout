import { CellType, type Grid, get, idx } from "./grid";
import { type Door, doorBlocks } from "./map";

/** Walls and closed, unburned doors block sight (and the jet). */
export function blocksSight(grid: Grid, doors: readonly Door[], x: number, y: number): boolean {
  const i = idx(x, y);
  const type = get(grid.type, i);
  if (type === CellType.Wall) return true;
  if (type !== CellType.Door) return false;
  const door = doors.find((d) => d.x === x && d.y === y);
  return door === undefined || doorBlocks(grid, door);
}

/**
 * Bresenham line of sight between two cells; only cells strictly between the endpoints are
 * tested. Always traced from the lower-index endpoint so that A→B and B→A agree.
 */
export function lineOfSight(
  grid: Grid,
  doors: readonly Door[],
  ax: number,
  ay: number,
  bx: number,
  by: number,
): boolean {
  if (idx(ax, ay) > idx(bx, by)) return lineOfSight(grid, doors, bx, by, ax, ay);
  const dx = Math.abs(bx - ax);
  const dy = -Math.abs(by - ay);
  const sx = ax < bx ? 1 : -1;
  const sy = ay < by ? 1 : -1;
  let err = dx + dy;
  let x = ax;
  let y = ay;
  for (;;) {
    if (x === bx && y === by) return true;
    if ((x !== ax || y !== ay) && blocksSight(grid, doors, x, y)) return false;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y += sy;
    }
  }
}
