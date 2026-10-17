import { SIM } from "./config";
import { ignite } from "./fire";
import { CellType, type Grid, get, isFlammable, N } from "./grid";
import { buildYard, type Door } from "./map";
import { createRng, type Rng } from "./rng";
import { createRobot, type Robot } from "./robot";

/** Wind blowing toward (dx, dy), a unit vector; W→E is { dx: 1, dy: 0 }. */
export interface Wind {
  dx: number;
  dy: number;
  speedKmh: number;
}

export interface Stats {
  /** Attack decisions that sent water onto a mostly-paint sector. */
  wrongAgent: number;
  /** Doors opened with smoke above the threshold behind them. */
  riskyDoors: number;
  backdrafts: number;
}

export interface World {
  grid: Grid;
  doors: Door[];
  baseCells: number[];
  wind: Wind;
  rng: Rng;
  tick: number;
  robot: Robot;
  stats: Stats;
  /** Flammable cells at the start, the denominator of "area saved". */
  initialFlammable: number;
}

export interface WorldOptions {
  wind?: Wind;
  /** Number of starting fires (default 1). */
  ignitions?: number;
}

/** Compass directions the wind blows toward, clockwise from east. */
const COMPASS: readonly (readonly [number, number])[] = [
  [1, 0],
  [1, 1],
  [0, 1],
  [-1, 1],
  [-1, 0],
  [-1, -1],
  [0, -1],
  [1, -1],
];

/** A new game: the yard, seeded wind and ignition points, R1 on the base. */
export function createWorld(seed: number, opts: WorldOptions = {}): World {
  const rng = createRng(seed);
  const yard = buildYard();
  const { grid } = yard;

  let wind = opts.wind;
  if (!wind) {
    const [dx, dy] = COMPASS[Math.floor(rng.next() * COMPASS.length)] ?? [1, 0];
    const len = Math.hypot(dx, dy);
    wind = { dx: dx / len, dy: dy / len, speedKmh: 5 + Math.floor(rng.next() * 26) };
  }

  const candidates: number[] = [];
  let initialFlammable = 0;
  for (let i = 0; i < N; i++) {
    if (!isFlammable(grid, i)) continue;
    initialFlammable++;
    if (get(grid.fuel, i) >= 0.5 && get(grid.type, i) !== CellType.Door) candidates.push(i);
  }
  for (let k = 0; k < (opts.ignitions ?? 1); k++) {
    const i = candidates[Math.floor(rng.next() * candidates.length)];
    if (i !== undefined) ignite(grid, i, 0.5);
  }

  return {
    grid,
    doors: yard.doors,
    baseCells: yard.baseCells,
    wind,
    rng,
    tick: 0,
    robot: createRobot(...yard.spawn),
    stats: { wrongAgent: 0, riskyDoors: 0, backdrafts: 0 },
    initialFlammable,
  };
}

export function simTime(world: World): number {
  return world.tick * SIM.TICK;
}
