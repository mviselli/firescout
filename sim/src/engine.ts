import { SIM } from "./config";
import { buildContext, buildQuestions } from "./context";
import type { Answers, DecisionReason, DecisionRequest } from "./decision";
import { stepFire } from "./fire";
import { CellState, get, N } from "./grid";
import {
  type Agent,
  holdDoor,
  openDoor,
  type RobotEvent,
  setTask,
  type Task,
  tickRobot,
} from "./robot";
import { stepSmoke } from "./smoke";
import { createWorld, simTime, type World, type WorldOptions } from "./world";

export type StepResult =
  | { kind: "pending"; request: DecisionRequest }
  | { kind: "advanced" }
  | { kind: "ended" };

export interface DecisionRecord {
  id: number;
  t: number;
  reason: DecisionReason;
  answers: Answers;
}

export interface EngineOptions extends WorldOptions {
  seed: number;
  /** Sim seconds after which the game ends (default SIM.MAX_TIME). */
  maxTime?: number;
}

/** Robot events that trigger a decision at once, most urgent first. */
const EVENT_ORDER: readonly RobotEvent[] = [
  "door",
  "tank_empty",
  "blocked",
  "task_done",
  "refilled",
];

/**
 * Fixed-step game loop that stops whenever R1 needs a decision. Nothing advances until the pending
 * request is resolved, so how long a policy takes never changes the game.
 */
export class Engine {
  readonly world: World;
  readonly log: DecisionRecord[] = [];
  private readonly maxTicks: number;
  private request: DecisionRequest | null = null;
  private started = false;
  private done = false;
  private lastId = 0;
  private nextDecisionTick = 0;

  constructor(opts: EngineOptions) {
    this.world = createWorld(opts.seed, opts);
    this.maxTicks = Math.round((opts.maxTime ?? SIM.MAX_TIME) / SIM.TICK);
  }

  get pending(): DecisionRequest | null {
    return this.request;
  }

  get ended(): boolean {
    return this.done;
  }

  step(): StepResult {
    if (this.request) return { kind: "pending", request: this.request };
    if (this.done) return { kind: "ended" };
    if (!this.started) {
      this.started = true;
      return this.ask("start");
    }

    const { world } = this;
    stepFire(world.grid, world.wind, world.rng);
    stepSmoke(world.grid, world.doors);
    const events = tickRobot(world);
    world.tick++;

    if (world.tick >= this.maxTicks || !this.anyBurning()) {
      this.done = true;
      return { kind: "ended" };
    }
    const event = EVENT_ORDER.find((e) => events.includes(e));
    if (event) return this.ask(event);
    if (world.tick >= this.nextDecisionTick) return this.ask("cadence");
    return { kind: "advanced" };
  }

  resolve(id: number, answers: Answers): void {
    const req = this.request;
    if (!req) throw new Error(`no decision pending (got id ${id})`);
    if (id !== req.id) throw new Error(`decision id ${id} does not match pending id ${req.id}`);
    validate(req, answers);

    const { world } = this;
    const door = answers.door_safe;
    if (req.questions.door_safe && req.context.door && door?.type === "noul") {
      // An unsure answer (0.5) is not a yes. Holding keeps the current task, so R1 plans around
      // the door, or reports blocked if there is no other way.
      if (door.noul > 0.5) openDoor(world, req.context.door.id);
      else holdDoor(world, req.context.door.id);
    } else {
      const action = answers.action;
      const label = action?.type === "choice" ? action.choice : "wait";
      if (label.startsWith("attack_")) {
        const sector = label.slice("attack_".length);
        const agent = answers[`agent_${sector}`];
        assign(world, {
          kind: "attack",
          sector,
          agent: agent?.type === "choice" ? (agent.choice as Agent) : "water",
        });
      } else if (label === "refill") {
        assign(world, { kind: "refill" });
      } else {
        assign(world, { kind: "wait" });
      }
    }

    this.log.push({ id: req.id, t: req.t, reason: req.reason, answers });
    this.request = null;
  }

  private ask(reason: DecisionReason): StepResult {
    const context = buildContext(this.world, reason);
    this.request = {
      id: ++this.lastId,
      unit: "R1",
      t: simTime(this.world),
      reason,
      context,
      questions: buildQuestions(context),
    };
    this.nextDecisionTick = this.world.tick + SIM.R1_CADENCE_TICKS;
    return { kind: "pending", request: this.request };
  }

  private anyBurning(): boolean {
    for (let i = 0; i < N; i++)
      if (get(this.world.grid.state, i) === CellState.Burning) return true;
    return false;
  }
}

/**
 * Set a new task, but leave an unchanged one alone: re-setting it would forget the events already
 * reported (a re-chosen blocked attack would report blocked again on the next tick, forever).
 */
function assign(world: World, task: Task): void {
  const cur = world.robot.task;
  const same =
    cur.kind === task.kind &&
    (cur.kind !== "attack" ||
      (task.kind === "attack" && cur.sector === task.sector && cur.agent === task.agent));
  if (!same) setTask(world, task);
}

/** Every question answered with the right type, and every choice label one of its options. */
function validate(req: DecisionRequest, answers: Answers): void {
  for (const [id, q] of Object.entries(req.questions)) {
    const a = answers[id];
    if (!a) throw new Error(`missing answer for question ${id}`);
    if (a.type !== q.type)
      throw new Error(`question ${id} expects a ${q.type} answer, got ${a.type}`);
    if (q.type === "choice" && a.type === "choice" && !(a.choice in q.criteria)) {
      throw new Error(`question ${id}: label ${a.choice} is not an option`);
    }
  }
}
