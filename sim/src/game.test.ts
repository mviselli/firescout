import { describe, expect, it } from "vitest";
import type { Answers, DecisionRequest, Policy } from "./decision";
import { Engine } from "./engine";
import { hashWorld, runGame } from "./game";
import { BaselinePolicy } from "./policies/baseline";
import { IdlePolicy } from "./policies/idle";
import { createRng } from "./rng";

// sim has no DOM or Node types (tsconfig `types: []`); the test runner provides the timer.
declare function setTimeout(callback: () => void, ms: number): unknown;

/** Baseline answers after a random real delay, to show latency never reaches the game. */
class DelayedPolicy implements Policy {
  readonly name = "delayed";
  private readonly inner = new BaselinePolicy();
  private readonly jitter = createRng(99);

  async decide(req: DecisionRequest): Promise<Answers> {
    await new Promise<void>((r) => setTimeout(r, this.jitter.next() * 5));
    return this.inner.decide(req);
  }
}

const SEEDS = Array.from({ length: 10 }, (_, k) => k + 1);

describe("runGame", () => {
  it("is deterministic: same seed and policy give the same hash", async () => {
    const a = await runGame({ seed: 3 }, new BaselinePolicy());
    const b = await runGame({ seed: 3 }, new BaselinePolicy());
    expect(a).toEqual(b);
    expect(a.hash).toMatch(/^[0-9a-f]{8}$/);
    expect(a.decisions).toBeGreaterThan(0);
  });

  it("differs across seeds", async () => {
    const a = await runGame({ seed: 1 }, new BaselinePolicy());
    const b = await runGame({ seed: 2 }, new BaselinePolicy());
    expect(a.hash).not.toBe(b.hash);
  });

  it("does not depend on decision latency", async () => {
    const plain = await runGame({ seed: 4, maxTime: 30 }, new BaselinePolicy());
    const delayed = await runGame({ seed: 4, maxTime: 30 }, new DelayedPolicy());
    expect(delayed.hash).toBe(plain.hash);
    expect(delayed.decisions).toBe(plain.decisions);
  });

  it("baseline saves more than idle on average over seeds 1..10", async () => {
    const mean = async (policy: Policy) => {
      let sum = 0;
      for (const seed of SEEDS) sum += (await runGame({ seed }, policy)).savedFraction;
      return sum / SEEDS.length;
    };
    expect(await mean(new BaselinePolicy())).toBeGreaterThan(await mean(new IdlePolicy()));
  }, 60_000);

  it("ends every game within maxTime", async () => {
    for (const seed of SEEDS.slice(0, 3)) {
      const r = await runGame({ seed, maxTime: 20 }, new IdlePolicy());
      expect(r.t).toBeLessThanOrEqual(20 + 1e-9);
      expect(r.savedFraction).toBeGreaterThanOrEqual(0);
      expect(r.savedFraction).toBeLessThanOrEqual(1);
    }
  });
});

describe("hashWorld", () => {
  it("changes when the world changes", () => {
    const e = new Engine({ seed: 1 });
    const before = hashWorld(e.world);
    e.world.robot.x++;
    expect(hashWorld(e.world)).not.toBe(before);
  });
});
