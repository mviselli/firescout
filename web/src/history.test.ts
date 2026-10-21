import { CellState, createWorld, N, savedFraction } from "@firescout/sim";
import { describe, expect, it } from "vitest";
import { GameHistory } from "./history";

describe("GameHistory", () => {
  it("samples at t=0 and then once per sim second", () => {
    const world = createWorld(1);
    const history = new GameHistory();
    for (let tick = 0; tick <= 25; tick++) {
      world.tick = tick;
      history.sample(world);
    }
    expect(history.samples.map((s) => s.t)).toEqual([0, 1, 2]);
  });

  it("counts burned percent and burning cells like the panel", () => {
    const world = createWorld(1);
    for (let i = 0; i < 40; i++) world.grid.state[i] = CellState.Burned;
    const history = new GameHistory();
    history.sample(world);
    let burning = 0;
    for (let i = 0; i < N; i++) if (world.grid.state[i] === CellState.Burning) burning++;
    expect(history.samples[0]).toEqual({
      t: 0,
      burnedPct: Math.round((1 - savedFraction(world)) * 100),
      burning,
    });
  });

  it("bumps version on each decision and each new sample only", () => {
    const world = createWorld(1);
    const history = new GameHistory();
    expect(history.version).toBe(0);
    history.sample(world);
    expect(history.version).toBe(1);
    world.tick = 5;
    history.sample(world);
    expect(history.version).toBe(1);
    const req = {
      id: 1,
      unit: "R1" as const,
      t: 0.5,
      reason: "start" as const,
      context: {} as never,
      questions: {},
    };
    history.addDecision(req, {}, { backend: "baseline" });
    expect(history.version).toBe(2);
    expect(history.last).toEqual({ req, answers: {}, source: { backend: "baseline" } });
  });
});
