import {
  type DecisionSource,
  Engine,
  type EngineOptions,
  type Policy,
  type Recording,
  recordGame,
} from "@firescout/sim";
import { GameHistory } from "./history";
import { GameLoop } from "./loop";

export interface LiveSessionOptions {
  engine: EngineOptions;
  policy: Policy;
  /** The panel choice, saved in recordings ("brain" or "baseline"). */
  policyChoice: string;
  speed: number;
  /** Read right after each decision resolves (RemotePolicy.lastMeta is set by then). */
  sourceOf(): DecisionSource;
}

/** One live game: its loop and its history, recordable for a replay. */
export class LiveSession {
  readonly loop: GameLoop;
  readonly history = new GameHistory();
  private readonly policyChoice: string;
  private disposed = false;

  constructor(opts: LiveSessionOptions) {
    this.policyChoice = opts.policyChoice;
    this.loop = new GameLoop(new Engine(opts.engine), opts.policy, { speed: opts.speed });
    this.loop.onDecision = (req, answers) => {
      if (!this.disposed) this.history.addDecision(req, answers, opts.sourceOf());
    };
    this.history.sample(this.loop.engine.world);
  }

  advance(realDtSec: number): void {
    this.loop.advance(realDtSec);
    this.history.sample(this.loop.engine.world);
  }

  recording(): Recording {
    const sources = new Map(this.history.entries.map((e) => [e.req.id, e.source]));
    return recordGame(this.loop.engine, this.policyChoice, (id) => sources.get(id));
  }

  /** Stops the game; an answer still in flight never reaches the history. */
  dispose(): void {
    this.disposed = true;
    this.loop.paused = true;
  }
}
