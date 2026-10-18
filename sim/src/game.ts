import type { Policy } from "./decision";
import { Engine, type EngineOptions } from "./engine";
import { CellState, type CellType, FUEL, get, N } from "./grid";
import { simTime, type World } from "./world";

export interface GameResult {
  seed: number;
  policy: string;
  /** Sim seconds when the game ended. */
  t: number;
  /** Initially flammable cells neither burned nor burning at the end, over all of them. */
  savedFraction: number;
  burnedCells: number;
  wrongAgent: number;
  riskyDoors: number;
  decisions: number;
  hash: string;
}

/** Play one game to the end, awaiting the policy at every decision. */
export async function runGame(opts: EngineOptions, policy: Policy): Promise<GameResult> {
  const engine = new Engine(opts);
  for (;;) {
    const r = engine.step();
    if (r.kind === "ended") break;
    if (r.kind === "pending") engine.resolve(r.request.id, await policy.decide(r.request));
  }

  const { world } = engine;
  let burned = 0;
  for (let i = 0; i < N; i++) if (get(world.grid.state, i) === CellState.Burned) burned++;

  return {
    seed: opts.seed,
    policy: policy.name,
    t: simTime(world),
    savedFraction: savedFraction(world),
    burnedCells: burned,
    wrongAgent: world.stats.wrongAgent,
    riskyDoors: world.stats.riskyDoors,
    decisions: engine.log.length,
    hash: hashWorld(world),
  };
}

/** Initially flammable cells neither burned nor burning, over all of them. */
export function savedFraction(world: World): number {
  let saved = 0;
  for (let i = 0; i < N; i++) {
    // A cell's type never changes, so its initial fuel tells whether it started flammable.
    if (FUEL[get(world.grid.type, i) as CellType] <= 0.1) continue;
    const state = get(world.grid.state, i);
    if (state !== CellState.Burned && state !== CellState.Burning) saved++;
  }
  return saved / world.initialFlammable;
}

const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

function fnv(h: number, value: number): number {
  let v = value | 0;
  for (let b = 0; b < 4; b++) {
    h = Math.imul(h ^ (v & 0xff), FNV_PRIME);
    v >>>= 8;
  }
  return h;
}

const TASK_KINDS = ["wait", "attack", "refill"] as const;

function fnvString(h: number, s: string): number {
  for (let k = 0; k < s.length; k++) h = fnv(h, s.charCodeAt(k));
  return fnv(h, 0);
}

/**
 * FNV-1a 32-bit over everything that shapes the rest of the game: per cell state, fuel, intensity
 * and smoke; doors and holds; the robot's position, tanks, task and stun; the stats; the tick.
 */
export function hashWorld(world: World): string {
  const { grid, robot, stats } = world;
  let h = FNV_OFFSET;
  for (let i = 0; i < N; i++) {
    h = fnv(h, get(grid.state, i));
    h = fnv(h, Math.round(get(grid.fuel, i) * 1000));
    h = fnv(h, Math.round(get(grid.intensity, i) * 1000));
    h = fnv(h, Math.round(get(grid.smoke, i) * 1000));
  }
  for (const d of world.doors) {
    h = fnv(h, d.open ? 1 : 0);
    h = fnv(h, robot.doorHold[d.id] ?? -1);
  }
  const { task } = robot;
  h = fnv(h, TASK_KINDS.indexOf(task.kind));
  if (task.kind === "attack") h = fnvString(fnvString(h, task.sector), task.agent);
  for (const v of [
    robot.x,
    robot.y,
    Math.round(robot.water),
    Math.round(robot.foam),
    robot.stunned,
    stats.wrongAgent,
    stats.riskyDoors,
    stats.backdrafts,
    world.tick,
  ]) {
    h = fnv(h, v);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}
