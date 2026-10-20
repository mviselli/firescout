import { describe, expect, it } from "vitest";
import { SIM } from "./config";
import { CellState, CellType, get, idx, N, xy } from "./grid";
import { doorInnerSmoke, holdDoor, openDoor, type RobotEvent, setTask, tickRobot } from "./robot";
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

function burn(w: World, x: number, y: number, intensity = 1): number {
  const i = idx(x, y);
  w.grid.state[i] = CellState.Burning;
  w.grid.intensity[i] = intensity;
  return i;
}

function place(w: World, x: number, y: number): void {
  w.robot.x = x;
  w.robot.y = y;
}

function run(w: World, ticks: number): RobotEvent[] {
  const events: RobotEvent[] = [];
  for (let t = 0; t < ticks; t++) {
    events.push(...tickRobot(w));
    w.tick++;
  }
  return events;
}

function runUntil(w: World, event: RobotEvent, max: number): number {
  for (let t = 0; t < max; t++) {
    const events = tickRobot(w);
    w.tick++;
    if (events.includes(event)) return t + 1;
  }
  return -1;
}

function door(w: World, id: string) {
  const d = w.doors.find((d) => d.id === id);
  if (!d) throw new Error(id);
  return d;
}

describe("robot: attack", () => {
  it("drives to range and extinguishes a paper fire with water", () => {
    const w = quietWorld();
    door(w, "A-south").open = true;
    const target = burn(w, 8, 16, 0.5);
    setTask(w, { kind: "attack", sector: "C2", agent: "water" });
    expect(runUntil(w, "task_done", 300)).toBeGreaterThan(0);
    expect(get(w.grid.state, target)).toBe(CellState.Extinguished);
    const [tx, ty] = xy(target);
    expect(Math.max(Math.abs(w.robot.x - tx), Math.abs(w.robot.y - ty))).toBeLessThanOrEqual(
      SIM.SPRAY_RANGE,
    );
  });

  it("barely dents a paint fire with water but kills it with foam", () => {
    const water = quietWorld();
    const a = burn(water, 34, 10);
    place(water, 34, 13);
    setTask(water, { kind: "attack", sector: "B5", agent: "water" });
    run(water, 10);
    expect(get(water.grid.state, a)).toBe(CellState.Burning);
    expect(get(water.grid.intensity, a)).toBeGreaterThan(0.6);

    const foam = quietWorld();
    const b = burn(foam, 34, 10);
    place(foam, 34, 13);
    setTask(foam, { kind: "attack", sector: "B5", agent: "foam" });
    run(foam, 10);
    expect(get(foam.grid.state, b)).toBe(CellState.Extinguished);
  });

  it("spreads burning paint when sprayed with water", () => {
    let spread = 0;
    for (let seed = 1; seed <= 5; seed++) {
      const w = quietWorld();
      w.rng = createWorld(seed).rng;
      burn(w, 34, 10);
      place(w, 34, 13);
      setTask(w, { kind: "attack", sector: "B5", agent: "water" });
      run(w, 20);
      for (let i = 0; i < N; i++) if (get(w.grid.state, i) === CellState.Burning) spread++;
    }
    expect(spread).toBeGreaterThan(5); // more than the one cell per run we lit
  });

  it("counts water on a paint sector as wrong agent once per task", () => {
    const w = quietWorld();
    burn(w, 34, 10);
    place(w, 34, 13);
    setTask(w, { kind: "attack", sector: "B5", agent: "water" });
    run(w, 5);
    expect(w.stats.wrongAgent).toBe(1);
    setTask(w, { kind: "attack", sector: "B5", agent: "foam" });
    expect(w.stats.wrongAgent).toBe(1);
    setTask(w, { kind: "attack", sector: "B5", agent: "water" });
    expect(w.stats.wrongAgent).toBe(2);
  });

  it("never lets a tank go below zero and emits tank_empty once", () => {
    const w = quietWorld();
    burn(w, 40, 28);
    place(w, 40, 30);
    w.robot.water = 2;
    setTask(w, { kind: "attack", sector: "D6", agent: "water" });
    const events = run(w, 10);
    expect(w.robot.water).toBe(0);
    expect(events.filter((e) => e === "tank_empty")).toHaveLength(1);
  });

  it("heads back to refill on its own when the attack's tank runs dry", () => {
    const w = quietWorld();
    burn(w, 40, 28);
    place(w, 40, 30);
    w.robot.water = 2;
    setTask(w, { kind: "attack", sector: "D6", agent: "water" });
    const events = run(w, 10);
    expect(w.robot.task).toEqual({ kind: "refill" });
    expect(events.filter((e) => e === "tank_empty")).toHaveLength(1);
    expect(runUntil(w, "refilled", 2000)).toBeGreaterThan(0);
    expect(w.robot.water).toBe(SIM.TANK);
  });

  it("emits task_done when its sector has no fire", () => {
    const w = quietWorld();
    setTask(w, { kind: "attack", sector: "D6", agent: "water" });
    expect(run(w, 3).filter((e) => e === "task_done")).toHaveLength(1);
  });

  it("emits blocked once when enclosed by fire", () => {
    const w = quietWorld();
    place(w, 40, 30);
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) if (dx || dy) burn(w, 40 + dx, 30 + dy);
    }
    burn(w, 10, 1); // target far away, out of range
    setTask(w, { kind: "attack", sector: "A2", agent: "water" });
    let events: RobotEvent[] = [];
    expect(() => {
      events = run(w, 5);
    }).not.toThrow();
    expect(events.filter((e) => e === "blocked")).toHaveLength(1);
  });
});

describe("robot: jet", () => {
  it("stops drawing the jet while stunned or with an empty tank", () => {
    const w = quietWorld();
    burn(w, 34, 10);
    place(w, 34, 13);
    setTask(w, { kind: "attack", sector: "B5", agent: "foam" });
    run(w, 1);
    expect(w.robot.sprayTarget).not.toBeNull();
    w.robot.stunned = 5;
    run(w, 1);
    expect(w.robot.sprayTarget).toBeNull();

    w.robot.stunned = 0;
    run(w, 1);
    expect(w.robot.sprayTarget).not.toBeNull();
    w.robot.foam = 0;
    run(w, 1);
    expect(w.robot.sprayTarget).toBeNull();
  });
});

describe("robot: refill", () => {
  it("refills at base and emits refilled", () => {
    const w = quietWorld();
    place(w, 31, 28);
    w.robot.water = 40;
    w.robot.foam = 90;
    setTask(w, { kind: "refill" });
    expect(runUntil(w, "refilled", 300)).toBeGreaterThan(0);
    expect([w.robot.water, w.robot.foam]).toEqual([SIM.TANK, SIM.TANK]);
    expect(get(w.grid.type, idx(w.robot.x, w.robot.y))).toBe(CellType.Base);
  });
});

describe("robot: planning", () => {
  it("keeps its plan while cooling down between steps", () => {
    const w = quietWorld();
    setTask(w, { kind: "refill" });
    place(w, 10, 30);
    run(w, 1); // plans and steps; the cooldown starts
    const plan = w.robot.path;
    expect(w.robot.moveCooldown).toBeGreaterThan(0);
    run(w, 1);
    expect(w.robot.path).toBe(plan);
  });

  it("replans during the cooldown once fire lands on its plan", () => {
    const w = quietWorld();
    setTask(w, { kind: "refill" });
    place(w, 10, 30);
    run(w, 1);
    const plan = w.robot.path;
    const onPath = plan[2];
    if (onPath === undefined) throw new Error("expected a longer plan");
    const [x, y] = xy(onPath);
    burn(w, x, y);
    run(w, 1);
    expect(w.robot.path).not.toBe(plan);
    expect(w.robot.path).not.toContain(onPath);
  });
});

describe("robot: doors", () => {
  it("stops before a closed door and emits door", () => {
    const w = quietWorld();
    burn(w, 34, 10);
    setTask(w, { kind: "attack", sector: "B5", agent: "foam" });
    expect(runUntil(w, "door", 300)).toBeGreaterThan(0);
    const id = w.robot.doorAhead;
    expect(id).not.toBeNull();
    const d = door(w, id ?? "");
    expect(Math.abs(w.robot.x - d.x) + Math.abs(w.robot.y - d.y)).toBe(1);
    const before = [w.robot.x, w.robot.y];
    run(w, 10);
    expect([w.robot.x, w.robot.y]).toEqual(before);
  });

  it("goes through the door once it is opened", () => {
    const w = quietWorld();
    burn(w, 34, 10);
    setTask(w, { kind: "attack", sector: "B5", agent: "foam" });
    runUntil(w, "door", 300);
    openDoor(w, w.robot.doorAhead ?? "");
    expect(runUntil(w, "task_done", 300)).toBeGreaterThan(0);
  });

  it("plans around a held door", () => {
    const w = quietWorld();
    burn(w, 34, 10);
    setTask(w, { kind: "attack", sector: "B5", agent: "foam" });
    runUntil(w, "door", 300);
    const first = w.robot.doorAhead ?? "";
    holdDoor(w, first);
    expect(runUntil(w, "door", 300)).toBeGreaterThan(0);
    expect(w.robot.doorAhead).not.toBe(first);
  });

  it("walks through an open door rather than open a closed one nearby", () => {
    const w = quietWorld();
    door(w, "B-west").open = true;
    burn(w, 34, 10);
    setTask(w, { kind: "attack", sector: "B5", agent: "foam" });
    expect(run(w, 400)).not.toContain("door");
    expect(door(w, "B-south").open).toBe(false);
  });

  it("measures the smoke behind a door", () => {
    const w = quietWorld();
    w.grid.smoke[idx(27, 12)] = 0.7;
    w.grid.smoke[idx(25, 12)] = 0.9; // outside: does not count
    expect(doorInnerSmoke(w, door(w, "B-west"))).toBeCloseTo(0.7);
  });

  it("causes a backdraft when opening a smoky door", () => {
    const w = quietWorld();
    w.grid.smoke[idx(27, 12)] = 0.8;
    place(w, 25, 12);
    expect(openDoor(w, "B-west")).toEqual({ backdraft: true });
    expect(door(w, "B-west").open).toBe(true);
    expect(w.stats).toMatchObject({ riskyDoors: 1, backdrafts: 1 });
    expect(w.robot.stunned).toBe(SIM.BACKDRAFT_STUN_TICKS);
    expect(w.robot.water).toBe(SIM.TANK - SIM.BACKDRAFT_WATER_LOSS);
    expect(get(w.grid.state, idx(27, 11))).toBe(CellState.Burning);
    const at = [w.robot.x, w.robot.y];
    run(w, SIM.BACKDRAFT_STUN_TICKS - 1);
    expect([w.robot.x, w.robot.y]).toEqual(at);
  });

  it("opens a clear door without backdraft", () => {
    const w = quietWorld();
    place(w, 25, 12);
    expect(openDoor(w, "B-west")).toEqual({ backdraft: false });
    expect(w.stats).toMatchObject({ riskyDoors: 0, backdrafts: 0 });
    expect(w.robot.stunned).toBe(0);
  });
});
