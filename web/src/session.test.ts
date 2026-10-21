import {
  type Answers,
  BaselinePolicy,
  type DecisionRequest,
  hashWorld,
  type Policy,
  Replay,
} from "@firescout/sim";
import { describe, expect, it } from "vitest";
import { LiveSession } from "./session";

/** Baseline that answers at once until `gate()`, then holds every answer until `release()`. */
class GateablePolicy implements Policy {
  readonly name = "gateable";
  private readonly inner = new BaselinePolicy();
  private gated = false;
  private held: (() => void)[] = [];

  decide(req: DecisionRequest): Promise<Answers> {
    if (!this.gated) return this.inner.decide(req);
    return new Promise((done) => {
      this.held.push(() => void this.inner.decide(req).then(done));
    });
  }

  gate(): void {
    this.gated = true;
  }

  release(): void {
    this.gated = false;
    for (const h of this.held.splice(0)) h();
  }
}

const flush = () => new Promise((r) => setTimeout(r, 0));

function session(policy: Policy, sourceOf = () => ({ backend: "baseline" })): LiveSession {
  return new LiveSession({
    engine: { seed: 3 },
    policy,
    policyChoice: "baseline",
    speed: 4,
    sourceOf,
  });
}

describe("LiveSession", () => {
  it("records a source for every decision, from sourceOf", async () => {
    let n = 0;
    const s = session(new BaselinePolicy(), () => ({ backend: "laya", latencyMs: ++n }));
    for (let k = 0; k < 60; k++) {
      s.advance(0.1);
      await flush();
    }
    const { entries } = s.history;
    expect(entries.length).toBeGreaterThan(2);
    expect(entries.map((e) => e.source.latencyMs)).toEqual(entries.map((_, k) => k + 1));
    expect(s.recording().decisions.map((d) => d.source)).toEqual(entries.map((e) => e.source));
    expect(s.history.samples.length).toBeGreaterThan(1);
  });

  it("its recording replays to the live hash, with a decision still in flight", async () => {
    const policy = new GateablePolicy();
    const s = session(policy);
    for (let k = 0; k < 40; k++) {
      s.advance(0.1);
      await flush();
    }
    policy.gate();
    while (!s.loop.waiting) {
      s.advance(0.1);
      await flush();
    }
    const rec = s.recording();
    expect(rec.decisions).toHaveLength(s.loop.engine.log.length);

    const replay = new Replay(rec);
    replay.seekTick(rec.end.tick);
    expect(hashWorld(replay.engine.world)).toBe(hashWorld(s.loop.engine.world));
    expect(replay.engine.pending?.id).toBe(s.loop.engine.pending?.id);
  });

  it("drops a late answer after dispose", async () => {
    const policy = new GateablePolicy();
    policy.gate();
    const s = session(policy);
    s.advance(0.1);
    expect(s.loop.waiting).toBe(true);
    s.dispose();
    policy.release();
    await flush();
    expect(s.history.entries).toHaveLength(0);
    expect(s.history.last).toBeNull();
  });
});
