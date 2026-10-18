import { describe, expect, it } from "vitest";
import { buildContext, buildQuestions } from "../context";
import type { Answer, DecisionReason, DecisionRequest } from "../decision";
import { CellState, get, idx, N } from "../grid";
import { createWorld, type World } from "../world";
import { BaselinePolicy, softmax } from "./baseline";
import { IdlePolicy } from "./idle";

/** Seed-1 world with its random fire put out, so each test places its own fires. */
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

function burn(w: World, x: number, y: number, intensity = 1): void {
  const i = idx(x, y);
  w.grid.state[i] = CellState.Burning;
  w.grid.intensity[i] = intensity;
}

function request(w: World, reason: DecisionReason = "cadence"): DecisionRequest {
  const context = buildContext(w, reason);
  return { id: 1, unit: "R1", t: context.t, reason, context, questions: buildQuestions(context) };
}

function choice(a: Answer | undefined): Extract<Answer, { type: "choice" }> {
  if (a?.type !== "choice") throw new Error("expected a choice answer");
  return a;
}

function noul(a: Answer | undefined): Extract<Answer, { type: "noul" }> {
  if (a?.type !== "noul") throw new Error("expected a noul answer");
  return a;
}

const baseline = new BaselinePolicy();

describe("softmax", () => {
  it("normalises and sharpens with a low temperature", () => {
    const p = softmax({ a: 1, b: 0 }, 0.5);
    expect((p.a ?? 0) + (p.b ?? 0)).toBeCloseTo(1, 12);
    expect(p.a).toBeCloseTo(1 / (1 + Math.exp(-2)), 12);
  });
});

describe("BaselinePolicy", () => {
  it("attacks the highest-priority sector", async () => {
    const w = quietWorld();
    for (let x = 0; x < 6; x++) burn(w, x, 1, 0.8); // A1, big
    burn(w, 8, 16, 0.3); // C2, small
    const answers = await baseline.decide(request(w));
    expect(choice(answers.action).choice).toBe("attack_A1");
  });

  it("chooses foam for paint and water for paper", async () => {
    const w = quietWorld();
    burn(w, 34, 10); // B5 paint
    burn(w, 8, 16); // C2 paper
    const answers = await baseline.decide(request(w));
    expect(choice(answers.agent_B5).choice).toBe("foam");
    expect(choice(answers.agent_B5).probabilities.foam).toBeCloseTo(0.9);
    expect(choice(answers.agent_C2).choice).toBe("water");

    w.robot.foam = 0;
    expect(choice((await baseline.decide(request(w))).agent_B5).choice).toBe("water");
  });

  it("refills when both tanks are low", async () => {
    const w = quietWorld();
    burn(w, 8, 16, 0.3);
    w.robot.water = 12;
    w.robot.foam = 12;
    expect(choice((await baseline.decide(request(w))).action).choice).toBe("refill");
  });

  it("avoids attacking when the preferred tank is nearly empty", async () => {
    const w = quietWorld();
    burn(w, 34, 10); // paint, needs foam
    w.robot.foam = 5;
    const action = choice((await baseline.decide(request(w))).action);
    expect(action.probabilities.attack_B5).toBeLessThan(action.probabilities.refill ?? 0);
  });

  it("says a smoky door is unsafe and a clear one safe", async () => {
    const w = quietWorld();
    w.robot.doorAhead = "B-south";
    const clear = noul((await baseline.decide(request(w, "door"))).door_safe);
    expect(clear.noul).toBe(0.85);
    expect(clear.confidence).toBe(0.85);

    w.grid.smoke[idx(34, 17)] = 0.9;
    const smoky = noul((await baseline.decide(request(w, "door"))).door_safe);
    expect(smoky.noul).toBe(0.15);
    expect(smoky.confidence).toBe(0.85);
  });

  it("answers every question with normalised probabilities", async () => {
    const w = quietWorld();
    burn(w, 34, 10);
    burn(w, 8, 16);
    burn(w, 50, 14);
    burn(w, 3, 1);
    const req = request(w);
    const answers = await baseline.decide(req);
    expect(Object.keys(answers).sort()).toEqual(Object.keys(req.questions).sort());
    for (const [id, a] of Object.entries(answers)) {
      if (a.type !== "choice") continue;
      const q = req.questions[id];
      if (q?.type !== "choice") throw new Error(id);
      expect(Object.keys(a.probabilities).sort()).toEqual(Object.keys(q.criteria).sort());
      const sum = Object.values(a.probabilities).reduce((s, p) => s + p, 0);
      expect(Math.abs(sum - 1)).toBeLessThan(1e-9);
      expect(a.confidence).toBe(Math.max(...Object.values(a.probabilities)));
    }
  });
});

describe("IdlePolicy", () => {
  it("idle always waits", async () => {
    const idle = new IdlePolicy();
    const w = quietWorld();
    burn(w, 34, 10);
    const answers = await idle.decide(request(w));
    expect(choice(answers.action)).toMatchObject({ choice: "wait", confidence: 1 });
    expect(choice(answers.action).probabilities.attack_B5).toBe(0);
    expect(choice(answers.agent_B5).choice).toBe("water");

    w.robot.doorAhead = "B-south";
    expect(noul((await idle.decide(request(w, "door"))).door_safe).noul).toBe(0.5);
  });
});
