import { describe, expect, it } from "vitest";
import { buildContext, buildQuestions, priority } from "./context";
import { CellState, get, idx, N } from "./grid";
import { createWorld, type World } from "./world";

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

function choiceOptions(q: ReturnType<typeof buildQuestions>[string] | undefined): string[] {
  if (q?.type !== "choice") throw new Error("expected a choice question");
  return Object.keys(q.criteria);
}

describe("buildContext", () => {
  it("summarises burning sectors sorted by priority", () => {
    const w = quietWorld();
    // Small paper fire in C2 (building A), larger scrub fire in A1 (outdoors).
    burn(w, 8, 16, 0.5);
    for (let x = 0; x < 6; x++) burn(w, x, 1, 0.8);
    const ctx = buildContext(w, "cadence");

    expect(ctx.fires.map((f) => f.sector)).toEqual(["A1", "C2"]);
    const [a1, c2] = ctx.fires;
    if (!a1 || !c2) throw new Error("expected two fire sectors");
    expect(a1).toMatchObject({ building: null, content: "scrub", burning: 6, door: null });
    expect(a1.meanIntensity).toBeCloseTo(0.8);
    expect(a1.maxIntensity).toBeCloseTo(0.8);
    // Robot spawns at (31, 35); nearest A1 fire cell is (5, 1).
    expect(a1.dist).toBe(26 + 34);
    expect(c2).toMatchObject({ building: "A", content: "paper", burning: 1, dist: 23 + 19 });
    expect(priority(a1)).toBeGreaterThan(priority(c2));

    expect(ctx.robot).toEqual({ sector: "E4", water: 100, foam: 100, task: "wait" });
    expect(ctx.reason).toBe("cadence");
    expect(ctx.door).toBeNull();
  });

  it("labels a paint sector behind a closed door", () => {
    const w = quietWorld();
    burn(w, 34, 10);
    burn(w, 35, 10);
    const ctx = buildContext(w, "cadence");
    expect(ctx.fires[0]).toMatchObject({ sector: "B5", building: "B", content: "paint" });
    expect(ctx.fires[0]?.door).toBe("B-south");

    for (const d of w.doors) if (d.id === "B-west") d.open = true;
    expect(buildContext(w, "cadence").fires[0]?.door).toBeNull();
  });
});

describe("buildQuestions", () => {
  it("offers attack options for at most the top 3 sectors plus refill and wait", () => {
    const w = quietWorld();
    burn(w, 34, 10); // B5
    burn(w, 8, 16); // C2
    burn(w, 50, 14); // C7
    burn(w, 3, 1); // A1
    const ctx = buildContext(w, "cadence");
    const qs = buildQuestions(ctx);
    const top = ctx.fires.slice(0, 3).map((f) => f.sector);

    expect(choiceOptions(qs.action)).toEqual([...top.map((s) => `attack_${s}`), "refill", "wait"]);
    const action = qs.action;
    if (action?.type !== "choice") throw new Error("expected choice");
    expect(action.criteria.attack_B5).toBe(
      `Paint fire in B5: 1 cells, intensity 1.00, distance ${ctx.fires.find((f) => f.sector === "B5")?.dist}, behind closed door B-south.`,
    );
    expect(action.criteria.refill).toBe("Return to base to refill water (100%) and foam (100%).");
    expect(action.criteria.wait).toBe("Hold position.");
  });

  it("asks one agent question per attack option", () => {
    const w = quietWorld();
    burn(w, 34, 10);
    burn(w, 8, 16);
    const qs = buildQuestions(buildContext(w, "cadence"));
    const agentIds = Object.keys(qs).filter((k) => k.startsWith("agent_"));
    expect(agentIds.sort()).toEqual(["agent_B5", "agent_C2"]);
    expect(choiceOptions(qs.agent_B5)).toEqual(["water", "foam"]);
    expect(qs.agent_B5?.instructions).toContain("B5");
  });

  it("asks only refill or wait with no fires", () => {
    const qs = buildQuestions(buildContext(quietWorld(), "start"));
    expect(Object.keys(qs)).toEqual(["action"]);
    expect(choiceOptions(qs.action)).toEqual(["refill", "wait"]);
  });

  it("asks only door_safe on a door event", () => {
    const w = quietWorld();
    burn(w, 34, 10);
    w.robot.doorAhead = "B-south";
    const ctx = buildContext(w, "door");
    expect(ctx.door).toEqual({ id: "B-south", smoke: 0 });
    expect(buildQuestions(ctx)).toEqual({
      door_safe: { type: "noul", instructions: "Opening door B-south now is safe." },
    });
  });

  it("never exceeds 10 options per choice question", () => {
    const w = quietWorld();
    for (let y = 0; y < 40; y += 8) for (let x = 0; x < 64; x += 8) burn(w, x + 3, y + 3);
    const qs = buildQuestions(buildContext(w, "cadence"));
    for (const q of Object.values(qs)) {
      if (q.type === "choice") expect(Object.keys(q.criteria).length).toBeLessThanOrEqual(10);
    }
    expect(choiceOptions(qs.action)).toHaveLength(5);
  });
});
