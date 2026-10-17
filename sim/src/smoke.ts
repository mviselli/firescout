import { SIM } from "./config";
import { CellState, CellType, type Grid, get, H, idx, N, W } from "./grid";
import type { Door } from "./map";

const NEIGHBOURS_4 = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
] as const;

/** Cells smoke cannot occupy or cross: walls, and closed doors that have not burned through. */
function blockedCells(grid: Grid, doors: readonly Door[]): Uint8Array {
  const blocked = new Uint8Array(N);
  for (let i = 0; i < N; i++) if (get(grid.type, i) === CellType.Wall) blocked[i] = 1;
  for (const d of doors) {
    const i = idx(d.x, d.y);
    if (!d.open && get(grid.state, i) !== CellState.Burned) blocked[i] = 1;
  }
  return blocked;
}

/** One tick of smoke: emission, 4-neighbour diffusion, indoor/outdoor decay (double-buffered). */
export function stepSmoke(grid: Grid, doors: readonly Door[]): void {
  const blocked = blockedCells(grid, doors);
  const src = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    const burning = get(grid.state, i) === CellState.Burning;
    src[i] = get(grid.smoke, i) + (burning ? SIM.SMOKE_EMIT * get(grid.intensity, i) : 0);
  }

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (blocked[i]) {
        grid.smoke[i] = 0;
        continue;
      }
      const s = get(src, i);
      let sum = 0;
      let count = 0;
      for (const [dx, dy] of NEIGHBOURS_4) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || nx >= W || ny < 0 || ny >= H) continue;
        const n = ny * W + nx;
        if (blocked[n]) continue;
        sum += get(src, n);
        count++;
      }
      const diffused = count > 0 ? s + SIM.SMOKE_DIFFUSION * (sum / count - s) : s;
      const decay = get(grid.building, i) !== 0 ? SIM.SMOKE_DECAY_INDOOR : SIM.SMOKE_DECAY_OUTDOOR;
      grid.smoke[i] = Math.min(1, Math.max(0, diffused * (1 - decay)));
    }
  }
}
