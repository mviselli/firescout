import {
  type Answers,
  CellState,
  type DecisionRequest,
  type DecisionSource,
  get,
  N,
  SIM,
  savedFraction,
  type World,
} from "@firescout/sim";

export interface TimelineEntry {
  req: DecisionRequest;
  answers: Answers;
  source: DecisionSource;
}

/** The fire's extent at one sim second. */
export interface Sample {
  t: number;
  /** 0–100. */
  burnedPct: number;
  burning: number;
}

const TICKS_PER_SECOND = Math.round(1 / SIM.TICK);
let nextId = 1;

/** A game's decisions and a once-per-second burn sample, for the log and the timeline. */
export class GameHistory {
  /** Unique per history, so a view switching between two (live and replay) redraws even at equal counts. */
  readonly id = nextId++;
  readonly entries: TimelineEntry[] = [];
  readonly samples: Sample[] = [];
  private changes = 0;
  private lastSecond = -1;

  /** Bumped on every change, so views redraw only when it moves. */
  get version(): number {
    return this.changes;
  }

  get last(): TimelineEntry | null {
    return this.entries.at(-1) ?? null;
  }

  addDecision(req: DecisionRequest, answers: Answers, source: DecisionSource): void {
    this.entries.push({ req, answers, source });
    this.changes++;
  }

  /** Adds a sample at t = 0 and then at most one per whole sim second. */
  sample(world: World): void {
    const second = Math.floor(world.tick / TICKS_PER_SECOND);
    if (second <= this.lastSecond) return;
    this.lastSecond = second;
    let burning = 0;
    for (let i = 0; i < N; i++) if (get(world.grid.state, i) === CellState.Burning) burning++;
    this.samples.push({
      t: second,
      burnedPct: Math.round((1 - savedFraction(world)) * 100),
      burning,
    });
    this.changes++;
  }
}
