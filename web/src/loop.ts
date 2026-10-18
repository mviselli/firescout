import { type Answers, type DecisionRequest, type Engine, type Policy, SIM } from "@firescout/sim";

/** Longest stretch of sim time one frame may catch up on. */
const MAX_CATCH_UP = 0.5;

/**
 * Drives an Engine from animation frames. Sim time only accumulates while no decision is in flight,
 * so the game is the same however long the policy takes or however irregular the frames are.
 */
export class GameLoop {
  paused = false;
  speed: number;
  onDecision?: (req: DecisionRequest, answers: Answers) => void;
  private acc = 0;
  private inFlight = false;

  constructor(
    readonly engine: Engine,
    private readonly policy: Policy,
    opts: { speed?: number } = {},
  ) {
    this.speed = opts.speed ?? 1;
  }

  /** True while a policy answer is awaited. */
  get waiting(): boolean {
    return this.inFlight;
  }

  /** Run the whole ticks that fit in the accumulated sim time. Never awaits. */
  advance(realDtSec: number): void {
    if (this.paused || this.inFlight || this.engine.ended) return;
    this.acc = Math.min(MAX_CATCH_UP, this.acc + realDtSec * this.speed);
    while (this.acc >= SIM.TICK) {
      const tick = this.engine.world.tick;
      const r = this.engine.step();
      if (this.engine.world.tick !== tick) this.acc -= SIM.TICK;
      if (r.kind === "ended") {
        this.acc = 0;
        return;
      }
      if (r.kind === "pending") {
        this.ask(r.request);
        return;
      }
    }
  }

  private ask(req: DecisionRequest): void {
    this.inFlight = true;
    this.policy
      .decide(req)
      .then((answers) => {
        this.engine.resolve(req.id, answers);
        this.onDecision?.(req, answers);
      })
      .catch((err: unknown) => {
        // The engine stays pending, so the next frame asks again.
        console.error(`decision ${req.id} failed`, err);
      })
      .finally(() => {
        this.inFlight = false;
      });
  }
}
