import { SIM } from "./config";
import { CellState, type CellType, FUEL, type Grid, get, H, isFlammable, N, W } from "./grid";
import type { Rng } from "./rng";
import type { Wind } from "./world";

const NEIGHBOURS: readonly (readonly [number, number])[] = [
  [-1, -1],
  [0, -1],
  [1, -1],
  [-1, 0],
  [1, 0],
  [-1, 1],
  [0, 1],
  [1, 1],
];

/** Cells already set to ignite this tick; a scratch buffer reused every tick. */
const pending = new Uint8Array(N);

/** Sets an intact, flammable cell burning. */
export function ignite(grid: Grid, i: number, intensity: number): void {
  if (get(grid.state, i) !== CellState.Intact || !isFlammable(grid, i)) return;
  grid.state[i] = CellState.Burning;
  grid.intensity[i] = intensity;
}

/**
 * One tick of the fire automaton. Spread is decided for every burning cell before any
 * state changes (double-buffered), always in row-major order with one rng draw per
 * candidate neighbour, so a seed fully determines the outcome.
 * Returns the indices ignited this tick.
 */
export function stepFire(grid: Grid, wind: Wind, rng: Rng): number[] {
  const windStrength = Math.min(1, wind.speedKmh / SIM.WIND_REF_KMH);
  const ignited: number[] = [];
  pending.fill(0);

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (get(grid.state, i) !== CellState.Burning) continue;
      const intensity = get(grid.intensity, i);
      for (const [dx, dy] of NEIGHBOURS) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || nx >= W || ny < 0 || ny >= H) continue;
        const n = ny * W + nx;
        // Same rule as ignite(): yard ground, walls and the base never catch.
        if (get(grid.state, n) !== CellState.Intact || !isFlammable(grid, n) || pending[n])
          continue;
        const fuel = get(grid.fuel, n);
        const diagonal = dx !== 0 && dy !== 0;
        const len = diagonal ? Math.SQRT2 : 1;
        const align = ((dx * wind.dx + dy * wind.dy) / len) * windStrength;
        const p =
          SIM.SPREAD_BASE *
          fuel *
          intensity *
          (1 + SIM.WIND_K * align) *
          (diagonal ? SIM.DIAGONAL_WEIGHT : 1);
        if (rng.next() < Math.min(1, Math.max(0, p))) {
          pending[n] = 1;
          ignited.push(n);
        }
      }
    }
  }

  for (let i = 0; i < grid.state.length; i++) {
    if (get(grid.state, i) !== CellState.Burning) continue;
    const growth = SIM.GROWTH * FUEL[get(grid.type, i) as CellType];
    const intensity = Math.min(1, get(grid.intensity, i) + growth);
    const fuel = get(grid.fuel, i) - SIM.BURN_RATE * intensity;
    if (fuel <= 0) {
      grid.fuel[i] = 0;
      grid.intensity[i] = 0;
      grid.state[i] = CellState.Burned;
    } else {
      grid.fuel[i] = fuel;
      grid.intensity[i] = intensity;
    }
  }

  for (const n of ignited) {
    grid.state[n] = CellState.Burning;
    grid.intensity[n] = SIM.IGNITION_INTENSITY;
  }
  return ignited;
}
