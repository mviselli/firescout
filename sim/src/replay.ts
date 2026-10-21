import type { DecisionRequest } from "./decision";
import { type DecisionRecord, Engine, type EngineOptions } from "./engine";
import { hashWorld } from "./game";
import { simTime } from "./world";

/** Who answered a decision: backend "laya", "mock", "baseline", ...; fallback = why the brain was not used. */
export interface DecisionSource {
  backend: string;
  latencyMs?: number;
  fallback?: string;
}

export interface RecordedDecision extends DecisionRecord {
  source?: DecisionSource;
}

/** Everything a replay needs, JSON-safe: the engine options and every resolved decision in order. */
export interface Recording {
  version: 1;
  options: EngineOptions;
  /** The panel choice that played it: "brain", "baseline", or a bench policy name. */
  policy: string;
  decisions: RecordedDecision[];
  /** Where the recording stops, and the world's hash there. */
  end: { tick: number; hash: string };
}

/** The game so far: its options and resolved decisions. A pending request is not recorded. */
export function recordGame(
  engine: Engine,
  policy: string,
  sourceOf?: (id: number) => DecisionSource | undefined,
): Recording {
  // A JSON copy, so later changes to the engine's log never reach the recording.
  const copy = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
  const decisions = engine.log.map((d): RecordedDecision => {
    const source = sourceOf?.(d.id);
    return source ? { ...copy(d), source: copy(source) } : copy(d);
  });
  return {
    version: 1,
    options: copy(engine.options),
    policy,
    decisions,
    end: { tick: engine.world.tick, hash: hashWorld(engine.world) },
  };
}

/** The replayed game no longer matches the recording. */
export class ReplayDesyncError extends Error {
  constructor(
    message: string,
    /** Index into `recording.decisions`; `decisions.length` when only the end state differs. */
    readonly decisionIndex: number,
    /** Sim seconds where it diverged. */
    readonly t: number,
  ) {
    super(message);
    this.name = "ReplayDesyncError";
  }
}

export interface ReplayHooks {
  onDecision?(req: DecisionRequest, d: RecordedDecision): void;
}

/**
 * Re-runs a recorded game, resolving each request with the recorded answers. Seeking backwards
 * starts over from tick 0, which is cheap enough that no snapshots are kept.
 */
export class Replay {
  private current: Engine;
  private index = 0;
  private stepped = false;

  constructor(
    readonly recording: Recording,
    private readonly hooks: ReplayHooks = {},
  ) {
    this.current = new Engine(recording.options);
  }

  get engine(): Engine {
    return this.current;
  }

  get tick(): number {
    return this.current.world.tick;
  }

  get endTick(): number {
    return this.recording.end.tick;
  }

  get atEnd(): boolean {
    return this.tick === this.endTick;
  }

  get decided(): number {
    return this.index;
  }

  /** Go to `tick` (clamped to the recording, rounded), resolving every request made up to it. */
  seekTick(tick: number): void {
    const goal = Math.min(this.endTick, Math.max(0, Math.round(tick)));
    if (goal < this.tick) {
      this.current = new Engine(this.recording.options);
      this.index = 0;
      this.stepped = false;
    }

    const { decisions } = this.recording;
    const engine = this.current;
    for (;;) {
      const req = engine.pending;
      if (req) {
        const d = decisions[this.index];
        if (!d) {
          if (this.tick === this.endTick) break; // Recorded while this decision was in flight.
          throw this.desync(this.index, req.t, "the game asks for a decision the recording lacks");
        }
        if (d.id !== req.id || d.tick !== this.tick || d.reason !== req.reason) {
          throw this.desync(
            this.index,
            req.t,
            `the game asks (${req.reason} at tick ${this.tick}), ` +
              `the recording has (${d.reason} at tick ${d.tick})`,
          );
        }
        try {
          engine.resolve(req.id, d.answers);
        } catch (err) {
          throw this.desync(this.index, req.t, err instanceof Error ? err.message : String(err));
        }
        this.index++;
        this.hooks.onDecision?.(req, d);
        continue;
      }
      if (engine.ended || (this.stepped && this.tick >= goal)) break;
      engine.step();
      this.stepped = true;
    }

    if (engine.ended && this.tick < this.endTick) {
      throw this.endDesync(`the game ended at tick ${this.tick}, the recording at ${this.endTick}`);
    }
    if (this.tick === this.endTick) {
      if (this.index < decisions.length) {
        const d = decisions[this.index] as RecordedDecision;
        throw this.desync(this.index, d.t, "the game ended before this recorded decision");
      }
      const hash = hashWorld(engine.world);
      if (hash !== this.recording.end.hash) {
        throw this.endDesync(`hash ${hash}, the recording has ${this.recording.end.hash}`);
      }
    }
  }

  private desync(k: number, t: number, detail: string): ReplayDesyncError {
    return new ReplayDesyncError(
      `replay diverges at decision ${k + 1} (${t.toFixed(1)} s): ${detail}`,
      k,
      t,
    );
  }

  private endDesync(detail: string): ReplayDesyncError {
    return new ReplayDesyncError(
      `replay ends in a different state: ${detail}`,
      this.recording.decisions.length,
      simTime(this.current.world),
    );
  }
}
