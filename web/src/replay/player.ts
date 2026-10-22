import { type Recording, Replay, ReplayDesyncError, SIM } from "@firescout/sim";
import { GameHistory } from "../history";

/** Longest stretch of sim time one frame may catch up on (as GameLoop). */
const MAX_CATCH_UP = 0.5;
const OLDER = "It was probably recorded with an older version.";

function desyncMessage(err: ReplayDesyncError, decisions: number): string {
  const where =
    err.decisionIndex >= decisions
      ? "it ends in a different state"
      : `it diverges at decision ${err.decisionIndex + 1} (${err.t.toFixed(1)} s)`;
  return `This replay doesn't match the current simulation: ${where}. ${OLDER}`;
}

/** Plays a Replay from animation frames: play, pause, speed, seek, previous/next decision. */
export class ReplayPlayer {
  paused = true;
  speed = 1;
  readonly replay: Replay;
  private acc = 0;
  private lastError: string | null = null;

  constructor(recording: Recording) {
    this.replay = new Replay(recording);
    this.run(0);
  }

  /** Sim seconds. */
  get t(): number {
    return this.replay.tick * SIM.TICK;
  }

  get ended(): boolean {
    return this.replay.atEnd;
  }

  /** The desync message, once the replay has diverged; the player stays paused from then on. */
  get error(): string | null {
    return this.lastError;
  }

  /** Plays on; at the end, starts again from 0. */
  play(): void {
    if (this.lastError) return;
    if (this.ended) this.run(0);
    this.paused = false;
  }

  advance(realDtSec: number): void {
    if (this.paused || this.lastError) return;
    this.acc = Math.min(MAX_CATCH_UP, this.acc + realDtSec * this.speed);
    // The epsilon keeps 0.1 + 0.1 + ... from falling a hair short of a whole tick.
    const ticks = Math.floor(this.acc / SIM.TICK + 1e-9);
    if (ticks === 0) return;
    this.acc = Math.max(0, this.acc - ticks * SIM.TICK);
    this.run(this.replay.tick + ticks);
    if (this.ended) {
      this.paused = true;
      this.acc = 0;
    }
  }

  seek(tSec: number): void {
    this.acc = 0;
    this.run(Math.round(tSec / SIM.TICK));
  }

  /** Seek to the previous / next recorded decision's tick (from the current tick). */
  stepDecision(dir: -1 | 1): void {
    const { decisions } = this.replay.recording;
    const now = this.replay.tick;
    let target: number | undefined;
    if (dir === 1) target = decisions.find((d) => d.tick > now)?.tick;
    else for (const d of decisions) if (d.tick < now) target = d.tick;
    if (target !== undefined) {
      this.acc = 0;
      this.run(target);
    }
  }

  private run(tick: number): void {
    if (this.lastError) return;
    try {
      this.replay.seekTick(tick);
    } catch (err) {
      if (!(err instanceof ReplayDesyncError)) throw err;
      this.lastError = desyncMessage(err, this.replay.recording.decisions.length);
      this.paused = true;
    }
  }
}

/** Plays the whole recording headless once, sampling every tick; throws ReplayDesyncError. */
export function historyFromRecording(recording: Recording): GameHistory {
  const history = new GameHistory();
  const replay = new Replay(recording, {
    onDecision(req, d) {
      history.addDecision(req, d.answers, d.source ?? { backend: recording.policy });
    },
  });
  history.sample(replay.engine.world);
  for (let tick = 0; tick <= replay.endTick; tick++) {
    replay.seekTick(tick);
    history.sample(replay.engine.world);
  }
  return history;
}

/**
 * A player at t=0 and the recording's whole history (for the timeline and the log), or the reason it
 * can't be replayed. The whole game is checked up front, so a diverging file never opens.
 */
export function loadReplay(
  recording: Recording,
): { player: ReplayPlayer; history: GameHistory } | { error: string } {
  try {
    const history = historyFromRecording(recording);
    return { player: new ReplayPlayer(recording), history };
  } catch (err) {
    if (!(err instanceof ReplayDesyncError)) throw err;
    return { error: desyncMessage(err, recording.decisions.length) };
  }
}
