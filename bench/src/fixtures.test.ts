import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  buildContext,
  buildQuestions,
  CellState,
  CellType,
  createWorld,
  type DecisionReason,
  get,
  idx,
  isFlammable,
  N,
  type Question,
  SECTOR_SIZE,
  SIM,
  sectorOf,
  serializeState,
  type World,
  xy,
} from "@firescout/sim";
import { describe, expect, it } from "vitest";

/**
 * Sim-generated states and questions that `brain/tests/test_laya_prompts.py` sends to the real model, so the token
 * budget and the wording are checked on what the game actually sends. Regenerate with UPDATE_FIXTURES=1.
 */
const DIR = fileURLToPath(new URL("../../shared/fixtures/scenarios/", import.meta.url));

interface Scenario {
  name: string;
  state: string;
  questions: Record<string, Question>;
  /** A choice label, or "true" / "false" for a noul (P(true) above / below 0.5). */
  expect: Record<string, string>;
}

/** Seed-1 world with its random fire put out, so each scenario places its own fires. */
function quietWorld(): World {
  const w = createWorld(1);
  for (let i = 0; i < N; i++) {
    if (get(w.grid.state, i) === CellState.Burning) {
      w.grid.state[i] = CellState.Intact;
      w.grid.intensity[i] = 0;
    }
  }
  return w;
}

/** Sets the first `count` cells of `type` in `sector` (row-major) burning. */
function burnSector(
  w: World,
  sector: string,
  type: CellType,
  count: number,
  intensity = 0.8,
): void {
  let lit = 0;
  for (let i = 0; i < N && lit < count; i++) {
    const [x, y] = xy(i);
    if (sectorOf(x, y) !== sector || get(w.grid.type, i) !== type) continue;
    w.grid.state[i] = CellState.Burning;
    w.grid.intensity[i] = intensity;
    lit++;
  }
  if (lit < count) throw new Error(`only ${lit} cells of type ${type} in ${sector}`);
}

function scenario(
  name: string,
  w: World,
  reason: DecisionReason,
  expectation: Record<string, string>,
): Scenario {
  const ctx = buildContext(w, reason);
  return { name, state: serializeState(ctx), questions: buildQuestions(ctx), expect: expectation };
}

function paintFire(): World {
  const w = quietWorld();
  burnSector(w, "B5", CellType.Paint, 6);
  return w;
}

function doorAt(smoke: number): World {
  const w = paintFire();
  w.robot.doorAhead = "B-south";
  // The cell just inside B-south (34, 18).
  w.grid.smoke[idx(34, 17)] = smoke;
  return w;
}

function worstCase(): World {
  const w = quietWorld();
  // One burning flammable cell in every sector.
  for (let sy = 0; sy * SECTOR_SIZE < 40; sy++) {
    for (let sx = 0; sx * SECTOR_SIZE < 64; sx++) {
      for (let i = 0; i < N; i++) {
        const [x, y] = xy(i);
        if (Math.floor(x / SECTOR_SIZE) !== sx || Math.floor(y / SECTOR_SIZE) !== sy) continue;
        if (!isFlammable(w.grid, i) || get(w.grid.type, i) === CellType.Door) continue;
        w.grid.state[i] = CellState.Burning;
        w.grid.intensity[i] = 0.8;
        break;
      }
    }
  }
  w.robot.x = 8;
  w.robot.y = 15;
  w.robot.doorAhead = "A-inner";
  // The east room of A, behind A-inner (12, 11).
  w.grid.smoke[idx(13, 11)] = 0.7;
  w.robot.water = 0.07 * SIM.TANK;
  w.robot.foam = 0.07 * SIM.TANK;
  return w;
}

const SCENARIOS: (() => Scenario)[] = [
  () => scenario("paint-fire", paintFire(), "cadence", { action: "attack_B5", agent_B5: "foam" }),
  () => {
    const w = quietWorld();
    burnSector(w, "B3", CellType.Paper, 6);
    return scenario("paper-fire", w, "cadence", { agent_B3: "water" });
  },
  () => {
    const w = paintFire();
    w.robot.water = 0;
    w.robot.foam = 0;
    // Laya never picks refill here (0.01-0.08 under every wording), so the engine refills when an
    // attack's tank is empty; this scenario only pins the token budget.
    return scenario("empty-tanks", w, "cadence", {});
  },
  () => scenario("smoky-door", doorAt(0.9), "door", { door_safe: "false" }),
  () => scenario("clear-door", doorAt(0), "door", { door_safe: "true" }),
  // Cadence, not a door event, so the state carries the door line and the full action question set.
  () => scenario("worst-case", worstCase(), "cadence", {}),
];

describe("scenario fixtures", () => {
  for (const make of SCENARIOS) {
    const s = make();
    it(s.name, () => {
      for (const q of Object.values(s.questions)) {
        if (q.type === "choice") expect(Object.keys(q.criteria).length).toBeLessThanOrEqual(10);
      }
      for (const qid of Object.keys(s.expect)) expect(s.questions).toHaveProperty(qid);

      const file = `${DIR}${s.name}.json`;
      const json = `${JSON.stringify(s, null, 2)}\n`;
      if (process.env.UPDATE_FIXTURES) {
        mkdirSync(DIR, { recursive: true });
        writeFileSync(file, json);
      }
      expect(existsSync(file), `${file} missing, run with UPDATE_FIXTURES=1`).toBe(true);
      expect(readFileSync(file, "utf8")).toBe(json);
    });
  }
});
