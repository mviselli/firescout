import { SIM } from "./config";
import { CellState, CellType, type Grid, get, H, idx, N, W } from "./grid";
import { type Door, doorBlocks } from "./map";

// Scratch buffers reused every tick (the sim is single-threaded).
const blocked = new Uint8Array(N);
const src = new Float64Array(N);

/** Cells smoke cannot occupy or cross: walls, and closed doors that have not burned through. */
function markBlocked(grid: Grid, doors: readonly Door[]): void {
  for (let i = 0; i < N; i++) blocked[i] = get(grid.type, i) === CellType.Wall ? 1 : 0;
  for (const d of doors) if (doorBlocks(grid, d)) blocked[idx(d.x, d.y)] = 1;
}

/** One tick of smoke: emission, 4-neighbour diffusion, indoor/outdoor decay (double-buffered). */
export function stepSmoke(grid: Grid, doors: readonly Door[]): void {
  markBlocked(grid, doors);
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
      // Neighbours in a fixed order (right, left, down, up), so the float sums never change.
      if (x < W - 1 && !blocked[i + 1]) {
        sum += get(src, i + 1);
        count++;
      }
      if (x > 0 && !blocked[i - 1]) {
        sum += get(src, i - 1);
        count++;
      }
      if (y < H - 1 && !blocked[i + W]) {
        sum += get(src, i + W);
        count++;
      }
      if (y > 0 && !blocked[i - W]) {
        sum += get(src, i - W);
        count++;
      }
      const diffused = count > 0 ? s + SIM.SMOKE_DIFFUSION * (sum / count - s) : s;
      const decay = get(grid.building, i) !== 0 ? SIM.SMOKE_DECAY_INDOOR : SIM.SMOKE_DECAY_OUTDOOR;
      grid.smoke[i] = Math.min(1, Math.max(0, diffused * (1 - decay)));
    }
  }
}
