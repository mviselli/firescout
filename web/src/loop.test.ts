import {
  type Answers,
  BaselinePolicy,
  createRng,
  type DecisionRequest,
  Engine,
  hashWorld,
  type Policy,
  runGame,
} from "@firescout/sim";
import { describe, expect, it } from "vitest";
import { GameLoop } from "./loop";

/** Baseline that answers only when `release()` is called. */
class GatedPolicy implements Policy {
  readonly name = "gated";
  private readonly inner = new BaselinePolicy();
  private gates: (() => void)[] = [];

  decide(req: DecisionRequest): Promise<Answers> {
    return new Promise((done) => {
      this.gates.push(() => void this.inner.decide(req).then(done));
    });
  }

  release(): void {
    for (const g of this.gates.splice(0)) g();
  }
}

/** Baseline that answers after a random real delay of 0–5 ms. */
class DelayedPolicy implements Policy {
  readonly name = "delayed";
  private readonly inner = new BaselinePolicy();
  private readonly jitter = createRng(7);

  async decide(req: DecisionRequest): Promise<Answers> {
    await new Promise((r) => setTimeout(r, this.jitter.next() * 5));
    return this.inner.decide(req);
  }
}

/** Always answers with nothing, so the engine rejects every answer. */
class BrokenPolicy implements Policy {
  readonly name = "broken";
  calls = 0;

  async decide(): Promise<Answers> {
    this.calls++;
    return {};
  }
}

const flush = () => new Promise((r) => setTimeout(r, 0));

/** Answer the start request. Its frame's 0.1 s is not spent (no tick ran), so it carries over. */
async function start(loop: GameLoop): Promise<void> {
  loop.advance(0.1);
  await flush();
}

describe("GameLoop", () => {
  it("does not advance the engine while paused", async () => {
    const engine = new Engine({ seed: 1 });
    const loop = new GameLoop(engine, new BaselinePolicy());
    await start(loop);
    loop.paused = true;
    for (let k = 0; k < 10; k++) loop.advance(0.1);
    expect(engine.world.tick).toBe(0);
    loop.paused = false;
    loop.advance(0.35); // 0.1 carried + 0.35
    expect(engine.world.tick).toBe(4);
  });

  it("stops ticking while a decision is in flight and resumes after it resolves", async () => {
    const engine = new Engine({ seed: 1 });
    const policy = new GatedPolicy();
    const seen: number[] = [];
    const loop = new GameLoop(engine, policy);
    loop.onDecision = (req) => seen.push(req.id);

    loop.advance(0.1);
    expect(loop.waiting).toBe(true);
    for (let k = 0; k < 10; k++) loop.advance(0.1);
    expect(engine.world.tick).toBe(0);

    policy.release();
    await flush();
    expect(loop.waiting).toBe(false);
    expect(seen).toEqual([1]);
    loop.advance(0.35); // 0.1 carried + 0.35
    expect(engine.world.tick).toBe(4);
  });

  it("caps catch-up after a long frame", async () => {
    const engine = new Engine({ seed: 1 });
    const loop = new GameLoop(engine, new BaselinePolicy(), { speed: 4 });
    await start(loop);
    loop.advance(10);
    expect(engine.world.tick).toBeGreaterThan(0);
    expect(engine.world.tick).toBeLessThanOrEqual(5);
  });

  it("backs off after a failed decision and reports the error", async () => {
    const engine = new Engine({ seed: 1 });
    const policy = new BrokenPolicy();
    const loop = new GameLoop(engine, policy);
    loop.advance(0.1);
    await flush();
    expect(policy.calls).toBe(1);
    expect(loop.waiting).toBe(false);
    expect(loop.error).toMatch(/missing answer/);
    for (let k = 0; k < 5; k++) {
      loop.advance(0.1);
      await flush();
    }
    expect(policy.calls).toBe(1);
    loop.advance(0.6); // 1.1 s of real time since the failure
    await flush();
    expect(policy.calls).toBe(2);
    expect(engine.world.tick).toBe(0);
  });

  it("reaches the same final hash as runGame regardless of frame timing", async () => {
    const opts = { seed: 5, maxTime: 40 };
    const expected = await runGame(opts, new BaselinePolicy());

    const engine = new Engine(opts);
    const loop = new GameLoop(engine, new DelayedPolicy(), { speed: 2 });
    const frames = createRng(11);
    while (!engine.ended) {
      loop.advance(0.005 + frames.next() * 0.2);
      await flush();
    }
    expect(engine.log).toHaveLength(expected.decisions);
    expect(hashWorld(engine.world)).toBe(expected.hash);
  }, 30_000);
});
