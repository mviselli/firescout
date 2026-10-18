import { SIM } from "./config";
import { ignite } from "./fire";
import {
  buildingCode,
  CellState,
  CellType,
  get,
  idx,
  inBounds,
  isFlammable,
  N,
  sectorOf,
  xy,
} from "./grid";
import { lineOfSight } from "./los";
import type { Door } from "./map";
import { findPath } from "./pathfinding";
import type { World } from "./world";

export type Agent = "water" | "foam";

export type Task =
  | { kind: "attack"; sector: string; agent: Agent }
  | { kind: "refill" }
  | { kind: "wait" };

export type RobotEvent = "task_done" | "tank_empty" | "door" | "blocked" | "refilled";

export interface Robot {
  x: number;
  y: number;
  water: number;
  foam: number;
  task: Task;
  /** Planned cells ahead (for rendering); recomputed every tick while moving. */
  path: number[];
  sprayTarget: number | null;
  moveCooldown: number;
  /** Ticks left without acting after a backdraft. */
  stunned: number;
  /** Closed door the robot is waiting in front of. */
  doorAhead: string | null;
  /** Door id → tick until which it is ignored by planning. */
  doorHold: Record<string, number>;
  /** Events already reported for the current task, so each fires once (not every tick). */
  reported: RobotEvent[];
}

export function createRobot(x: number, y: number): Robot {
  return {
    x,
    y,
    water: SIM.TANK,
    foam: SIM.TANK,
    task: { kind: "wait" },
    path: [],
    sprayTarget: null,
    moveCooldown: 0,
    stunned: 0,
    doorAhead: null,
    doorHold: {},
    reported: [],
  };
}

function chebyshev(a: number, b: number): number {
  const [ax, ay] = xy(a);
  const [bx, by] = xy(b);
  return Math.max(Math.abs(ax - bx), Math.abs(ay - by));
}

function doorAt(world: World, i: number): Door | undefined {
  const [x, y] = xy(i);
  return world.doors.find((d) => d.x === x && d.y === y);
}

function findDoor(world: World, id: string): Door {
  const door = world.doors.find((d) => d.id === id);
  if (!door) throw new Error(`unknown door ${id}`);
  return door;
}

function isClosedDoor(world: World, i: number): boolean {
  const door = doorAt(world, i);
  return door !== undefined && !door.open && get(world.grid.state, i) !== CellState.Burned;
}

/** Cells the robot may plan through: no walls, no fire, closed doors only when not held. */
function plannable(world: World, i: number): boolean {
  const { grid } = world;
  if (get(grid.type, i) === CellType.Wall || get(grid.state, i) === CellState.Burning) return false;
  if (!isClosedDoor(world, i)) return true;
  const door = doorAt(world, i);
  return door !== undefined && (world.robot.doorHold[door.id] ?? -1) <= world.tick;
}

function report(robot: Robot, event: RobotEvent, out: RobotEvent[]): void {
  if (robot.reported.includes(event)) return;
  robot.reported.push(event);
  out.push(event);
}

function forget(robot: Robot, event: RobotEvent): void {
  robot.reported = robot.reported.filter((e) => e !== event);
}

function burningInSector(world: World, sector: string): number[] {
  const out: number[] = [];
  for (let i = 0; i < N; i++) {
    if (get(world.grid.state, i) !== CellState.Burning) continue;
    const [x, y] = xy(i);
    if (sectorOf(x, y) === sector) out.push(i);
  }
  return out;
}

export function setTask(world: World, task: Task): void {
  const { robot } = world;
  robot.task = task;
  robot.path = [];
  robot.sprayTarget = null;
  robot.doorAhead = null;
  robot.reported = [];
  if (task.kind === "attack" && task.agent === "water") {
    const cells = burningInSector(world, task.sector);
    const paint = cells.filter((i) => get(world.grid.type, i) === CellType.Paint).length;
    if (cells.length > 0 && paint * 2 > cells.length) world.stats.wrongAgent++;
  }
}

/** Highest smoke on the building side of a door. */
export function doorInnerSmoke(world: World, door: Door): number {
  const code = buildingCode(door.building);
  let max = 0;
  for (const [dx, dy] of [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ] as const) {
    const x = door.x + dx;
    const y = door.y + dy;
    if (!inBounds(x, y)) continue;
    const i = idx(x, y);
    if (get(world.grid.building, i) !== code || get(world.grid.type, i) === CellType.Wall) continue;
    max = Math.max(max, get(world.grid.smoke, i));
  }
  return max;
}

export function openDoor(world: World, doorId: string): { backdraft: boolean } {
  const door = findDoor(world, doorId);
  const { robot } = world;
  door.open = true;
  robot.doorAhead = null;
  forget(robot, "door");
  if (doorInnerSmoke(world, door) < SIM.DOOR_SMOKE_THRESHOLD) return { backdraft: false };

  const r = SIM.BACKDRAFT_RADIUS;
  for (let y = door.y - r; y <= door.y + r; y++) {
    for (let x = door.x - r; x <= door.x + r; x++) {
      if (inBounds(x, y)) ignite(world.grid, idx(x, y), SIM.BACKDRAFT_INTENSITY);
    }
  }
  world.stats.riskyDoors++;
  world.stats.backdrafts++;
  if (Math.max(Math.abs(robot.x - door.x), Math.abs(robot.y - door.y)) <= r) {
    robot.stunned = SIM.BACKDRAFT_STUN_TICKS;
    robot.water = Math.max(0, robot.water - SIM.BACKDRAFT_WATER_LOSS);
  }
  return { backdraft: true };
}

/** Leave a door closed for a while: planning routes around it until the hold expires. */
export function holdDoor(world: World, doorId: string): void {
  findDoor(world, doorId);
  world.robot.doorHold[doorId] = world.tick + SIM.DOOR_HOLD_TICKS;
  world.robot.doorAhead = null;
  forget(world.robot, "door");
}

/** Plan toward any goal cell and take one step when the move cooldown allows. */
function moveToward(
  world: World,
  isGoal: (i: number) => boolean,
  heuristic: (i: number) => number,
  events: RobotEvent[],
): void {
  const { robot } = world;
  const here = idx(robot.x, robot.y);
  const path = findPath(here, isGoal, (i) => plannable(world, i), heuristic);
  if (path === null) {
    robot.path = [];
    report(robot, "blocked", events);
    return;
  }
  forget(robot, "blocked");
  robot.path = path;
  const next = path[0];
  if (next === undefined) return;
  if (isClosedDoor(world, next)) {
    robot.doorAhead = doorAt(world, next)?.id ?? null;
    report(robot, "door", events);
    return;
  }
  robot.doorAhead = null;
  if (robot.moveCooldown > 0) {
    robot.moveCooldown--;
    return;
  }
  [robot.x, robot.y] = xy(next);
  robot.path = path.slice(1);
  robot.moveCooldown = SIM.ROBOT_MOVE_TICKS - 1;
}

function fireClass(world: World, i: number): "A" | "B" {
  return get(world.grid.type, i) === CellType.Paint ? "B" : "A";
}

function spray(world: World, target: number, agent: Agent, events: RobotEvent[]): void {
  const { robot, grid } = world;
  if (robot[agent] <= 0) {
    robot.sprayTarget = null;
    report(robot, "tank_empty", events);
    return;
  }
  robot[agent] = Math.max(0, robot[agent] - SIM.SPRAY_USE);
  robot.sprayTarget = target;

  const [tx, ty] = xy(target);
  for (let y = ty - 1; y <= ty + 1; y++) {
    for (let x = tx - 1; x <= tx + 1; x++) {
      if (!inBounds(x, y)) continue;
      const i = idx(x, y);
      if (get(grid.state, i) !== CellState.Burning) continue;
      if (i !== target && !lineOfSight(grid, world.doors, robot.x, robot.y, x, y)) continue;
      const left =
        get(grid.intensity, i) - SIM.SPRAY_POWER * SIM.EFFECTIVENESS[agent][fireClass(world, i)];
      if (left <= 0) {
        grid.state[i] = CellState.Extinguished;
        grid.intensity[i] = 0;
      } else {
        grid.intensity[i] = left;
      }
    }
  }

  if (agent === "water" && get(grid.type, target) === CellType.Paint) {
    const splash: number[] = [];
    for (let y = ty - 1; y <= ty + 1; y++) {
      for (let x = tx - 1; x <= tx + 1; x++) {
        if (!inBounds(x, y)) continue;
        const i = idx(x, y);
        if (get(grid.state, i) === CellState.Intact && isFlammable(grid, i)) splash.push(i);
      }
    }
    if (splash.length > 0 && world.rng.next() < SIM.WATER_ON_PAINT_SPREAD) {
      const i = splash[Math.floor(world.rng.next() * splash.length)];
      if (i !== undefined) ignite(grid, i, SIM.IGNITION_INTENSITY);
    }
  }

  if (robot[agent] <= 0) report(robot, "tank_empty", events);
}

function tickAttack(
  world: World,
  task: Extract<Task, { kind: "attack" }>,
  events: RobotEvent[],
): void {
  const { robot, grid } = world;
  let target = -1;
  for (const i of burningInSector(world, task.sector)) {
    if (target < 0 || get(grid.intensity, i) > get(grid.intensity, target)) target = i;
  }
  if (target < 0) {
    robot.sprayTarget = null;
    robot.path = [];
    report(robot, "task_done", events);
    return;
  }
  const [tx, ty] = xy(target);
  const canSpray = (i: number) => {
    const [x, y] = xy(i);
    return chebyshev(i, target) <= SIM.SPRAY_RANGE && lineOfSight(grid, world.doors, x, y, tx, ty);
  };
  if (canSpray(idx(robot.x, robot.y))) {
    robot.path = [];
    spray(world, target, task.agent, events);
    return;
  }
  robot.sprayTarget = null;
  moveToward(world, canSpray, (i) => Math.max(0, chebyshev(i, target) - SIM.SPRAY_RANGE), events);
}

function tickRefill(world: World, events: RobotEvent[]): void {
  const { robot } = world;
  robot.sprayTarget = null;
  if (world.baseCells.includes(idx(robot.x, robot.y))) {
    robot.path = [];
    robot.water = Math.min(SIM.TANK, robot.water + SIM.REFILL_RATE);
    robot.foam = Math.min(SIM.TANK, robot.foam + SIM.REFILL_RATE);
    if (robot.water >= SIM.TANK && robot.foam >= SIM.TANK) report(robot, "refilled", events);
    return;
  }
  const base = new Set(world.baseCells);
  moveToward(
    world,
    (i) => base.has(i),
    (i) => {
      let best = Number.POSITIVE_INFINITY;
      for (const b of world.baseCells) best = Math.min(best, chebyshev(i, b));
      return best;
    },
    events,
  );
}

/** One tick of R1's controller. Returns the events worth a decision, each once per task. */
export function tickRobot(world: World): RobotEvent[] {
  const { robot } = world;
  const events: RobotEvent[] = [];
  if (robot.stunned > 0) {
    robot.stunned--;
    robot.sprayTarget = null;
    return events;
  }
  const { task } = robot;
  if (task.kind === "attack") tickAttack(world, task, events);
  else if (task.kind === "refill") tickRefill(world, events);
  else robot.sprayTarget = null;
  return events;
}
