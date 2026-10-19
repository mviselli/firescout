import { SIM } from "./config";
import type { DecisionReason, Question } from "./decision";
import {
  type BuildingId,
  buildingOf,
  CellState,
  CellType,
  get,
  idx,
  N,
  sectorOf,
  xy,
} from "./grid";
import { doorBlocks } from "./map";
import { costMap } from "./pathfinding";
import { doorInnerSmoke, type Task } from "./robot";
import { simTime, type Wind, type World } from "./world";

export type Content = "paint" | "paper" | "floor" | "scrub" | "door" | "ground";

export interface FireSector {
  sector: string;
  building: BuildingId | null;
  content: Content;
  burning: number;
  meanIntensity: number;
  maxIntensity: number;
  /** Manhattan distance from the robot to the sector's nearest burning cell. */
  dist: number;
  /** Closed doors on the way to the fire, in walking order; the route crosses as few as possible. */
  doors: string[];
}

export interface DecisionContext {
  t: number;
  reason: DecisionReason;
  /** Tank levels in percent. */
  robot: { sector: string; water: number; foam: number; task: Task["kind"] };
  fires: FireSector[];
  wind: Wind;
  /** The closed door the robot is waiting in front of. */
  door: { id: string; smoke: number } | null;
}

/** Tie-break order when two contents or buildings have the same cell count. */
const CONTENTS: readonly Content[] = ["paint", "paper", "floor", "scrub", "door", "ground"];
const BUILDINGS: readonly (BuildingId | null)[] = [null, "A", "B", "C"];

function contentOf(type: number): Content {
  switch (type) {
    case CellType.Paint:
      return "paint";
    case CellType.Paper:
      return "paper";
    case CellType.Floor:
      return "floor";
    case CellType.Scrub:
      return "scrub";
    case CellType.Door:
      return "door";
    default:
      return "ground";
  }
}

const CONTENT_DESCRIPTION: Record<Content, string> = {
  paint: "paint and solvents, a flammable liquid",
  paper: "paper and cardboard, a solid fuel",
  floor: "wooden fittings, a solid fuel",
  scrub: "dry vegetation, a solid fuel",
  door: "a wooden door, a solid fuel",
  ground: "yard debris, a solid fuel",
};

/** Most frequent key, ties broken by the order of `keys`. */
function mostFrequent<K>(counts: Map<K, number>, keys: readonly K[]): K {
  let best = keys[0] as K;
  let bestCount = -1;
  for (const k of keys) {
    const c = counts.get(k) ?? 0;
    if (c > bestCount) {
      best = k;
      bestCount = c;
    }
  }
  return best;
}

/** Closed doors crossed on the cheapest route to `target`, in walking order (not the target). */
function doorsTo(from: Int32Array, blocking: Map<number, string>, target: number): string[] {
  const doors: string[] = [];
  for (let c = from[target] as number; c >= 0; c = from[c] as number) {
    const id = blocking.get(c);
    if (id !== undefined) doors.push(id);
  }
  return doors.reverse();
}

interface SectorAcc {
  cells: number;
  intensity: number;
  max: number;
  dist: number;
  /** Burning cell that is cheapest to reach; the route to it decides `doors`. */
  entry: number;
  contents: Map<Content, number>;
  buildings: Map<BuildingId | null, number>;
}

export function buildContext(world: World, reason: DecisionReason): DecisionContext {
  const { grid, robot } = world;
  const blocking = new Map<number, string>();
  for (const d of world.doors) if (doorBlocks(grid, d)) blocking.set(idx(d.x, d.y), d.id);
  // Same closed-door cost as R1's planner, so the doors named here are the ones R1 will open.
  const route = costMap(
    idx(robot.x, robot.y),
    (i) => get(grid.type, i) !== CellType.Wall,
    (i) => (blocking.has(i) ? SIM.CLOSED_DOOR_COST : 1),
  );

  const acc = new Map<string, SectorAcc>();
  for (let i = 0; i < N; i++) {
    if (get(grid.state, i) !== CellState.Burning) continue;
    const [x, y] = xy(i);
    const sector = sectorOf(x, y);
    let s = acc.get(sector);
    if (!s) {
      s = {
        cells: 0,
        intensity: 0,
        max: 0,
        dist: Infinity,
        entry: i,
        contents: new Map(),
        buildings: new Map(),
      };
      acc.set(sector, s);
    }
    const intensity = get(grid.intensity, i);
    const content = contentOf(get(grid.type, i));
    const building = buildingOf(grid, i);
    s.cells++;
    s.intensity += intensity;
    s.max = Math.max(s.max, intensity);
    s.dist = Math.min(s.dist, Math.abs(x - robot.x) + Math.abs(y - robot.y));
    if (get(route.dist, i) < get(route.dist, s.entry)) s.entry = i;
    s.contents.set(content, (s.contents.get(content) ?? 0) + 1);
    s.buildings.set(building, (s.buildings.get(building) ?? 0) + 1);
  }

  const fires: FireSector[] = [];
  for (const [sector, s] of acc) {
    const building = mostFrequent(s.buildings, BUILDINGS);
    fires.push({
      sector,
      building,
      content: mostFrequent(s.contents, CONTENTS),
      burning: s.cells,
      meanIntensity: s.intensity / s.cells,
      maxIntensity: s.max,
      dist: s.dist,
      doors: doorsTo(route.from, blocking, s.entry),
    });
  }
  fires.sort(
    (a, b) => priority(b) - priority(a) || (a.sector < b.sector ? -1 : a.sector > b.sector ? 1 : 0),
  );

  const doorAhead = world.doors.find((d) => d.id === robot.doorAhead);
  return {
    t: simTime(world),
    reason,
    robot: {
      sector: sectorOf(robot.x, robot.y),
      water: Math.round((robot.water / SIM.TANK) * 100),
      foam: Math.round((robot.foam / SIM.TANK) * 100),
      task: robot.task.kind,
    },
    fires,
    wind: { ...world.wind },
    door: doorAhead ? { id: doorAhead.id, smoke: doorInnerSmoke(world, doorAhead) } : null,
  };
}

/** How urgent a sector is: big, intense and close fires first. */
export function priority(f: FireSector): number {
  return (f.burning * f.meanIntensity) / (1 + f.dist / SIM.PRIORITY_DIST_SCALE);
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** ", behind closed doors A-south and A-inner", or "" with no doors. */
function behindDoors(doors: readonly string[]): string {
  if (doors.length === 0) return "";
  if (doors.length === 1) return `, behind closed door ${doors[0]}`;
  return `, behind closed doors ${doors.slice(0, -1).join(", ")} and ${doors.at(-1)}`;
}

export function buildQuestions(ctx: DecisionContext): Record<string, Question> {
  if (ctx.reason === "door" && ctx.door) {
    return {
      door_safe: { type: "noul", instructions: `Opening door ${ctx.door.id} now is safe.` },
    };
  }

  const top = ctx.fires.slice(0, SIM.TOP_FIRES);
  const criteria: Record<string, string> = {};
  for (const f of top) {
    criteria[`attack_${f.sector}`] =
      `${capitalize(f.content)} fire in ${f.sector}: ${f.burning} cells, ` +
      `intensity ${f.meanIntensity.toFixed(2)}, distance ${f.dist}${behindDoors(f.doors)}.`;
  }
  criteria.refill = `Return to base to refill water (${ctx.robot.water}%) and foam (${ctx.robot.foam}%).`;
  criteria.wait = "Hold position.";

  const questions: Record<string, Question> = {
    action: { type: "choice", instructions: "What should robot R1 do next?", criteria },
  };
  for (const f of top) {
    questions[`agent_${f.sector}`] = {
      type: "choice",
      instructions: `Which extinguishing agent for the fire in ${f.sector} (${CONTENT_DESCRIPTION[f.content]})?`,
      criteria: {
        water: "Water jet. For solid fuels like paper, wood and vegetation.",
        foam: "Foam. For flammable liquids like paint and solvents.",
      },
    };
  }
  return questions;
}
