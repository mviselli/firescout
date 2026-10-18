import { describe, expect, it } from "vitest";
import { SIM } from "./config";
import type { Answers, DecisionRequest } from "./decision";
import { Engine } from "./engine";
import { CellState, get, idx, N } from "./grid";
import { choiceAnswer, noulAnswer } from "./policies/baseline";

/** Engine on seed 1 with the random fire put out, so each test places its own fires. */
function quietEngine(opts: { maxTime?: number } = {}): Engine {
  const e = new Engine({ seed: 1, ...opts });
  const { grid } = e.world;
  for (let i = 0; i < N; i++) {
    if (get(grid.state, i) === CellState.Burning) {
      grid.state[i] = CellState.Intact;
      grid.intensity[i] = 0;
    }
  }
  return e;
}

function burn(e: Engine, x: number, y: number, intensity = 1): void {
  const i = idx(x, y);
  e.world.grid.state[i] = CellState.Burning;
  e.world.grid.intensity[i] = intensity;
}

function pick(label: string, labels: string[]) {
  return choiceAnswer(Object.fromEntries(labels.map((l) => [l, l === label ? 1 : 0])));
}

/** Answer `action` with `label` (or wait if absent), agents with foam, doors with `doorSafe`. */
function answer(req: DecisionRequest, label = "wait", doorSafe = 1): Answers {
  const answers: Answers = {};
  for (const [id, q] of Object.entries(req.questions)) {
    if (q.type === "noul") answers[id] = noulAnswer(doorSafe);
    else if (q.type === "choice") {
      const labels = Object.keys(q.criteria);
      const want = id === "action" ? label : "foam";
      answers[id] = pick(labels.includes(want) ? want : "wait", labels);
    }
  }
  return answers;
}

function expectPending(e: Engine): DecisionRequest {
  const r = e.step();
  if (r.kind !== "pending") throw new Error(`expected pending, got ${r.kind}`);
  return r.request;
}

/** Step until a request comes, answering nothing; returns it and the ticks it took. */
function nextRequest(e: Engine, max = 1000): DecisionRequest {
  for (let k = 0; k < max; k++) {
    const r = e.step();
    if (r.kind === "pending") return r.request;
    if (r.kind === "ended") throw new Error("ended");
  }
  throw new Error("no request");
}

describe("Engine", () => {
  it("asks for a start decision before the first tick", () => {
    const e = quietEngine();
    burn(e, 34, 10);
    const req = expectPending(e);
    expect(req).toMatchObject({ id: 1, unit: "R1", t: 0, reason: "start" });
    expect(e.world.tick).toBe(0);
    expect(Object.keys(req.questions)).toContain("action");
  });

  it("does not advance while a decision is pending", () => {
    const e = quietEngine();
    burn(e, 34, 10);
    const req = expectPending(e);
    const before = get(e.world.grid.intensity, idx(34, 10));
    for (let k = 0; k < 5; k++) expect(expectPending(e)).toBe(req);
    expect(e.world.tick).toBe(0);
    expect(get(e.world.grid.intensity, idx(34, 10))).toBe(before);
    expect(e.pending).toBe(req);
  });

  it("asks again on cadence every 8 ticks", () => {
    const e = quietEngine();
    burn(e, 34, 10);
    e.resolve(1, answer(expectPending(e)));
    for (let n = 1; n <= 3; n++) {
      const req = nextRequest(e);
      expect(req).toMatchObject({ id: n + 1, reason: "cadence" });
      expect(e.world.tick).toBe(n * SIM.R1_CADENCE_TICKS);
      e.resolve(req.id, answer(req));
    }
    expect(e.log.map((d) => d.reason)).toEqual(["start", "cadence", "cadence", "cadence"]);
  });

  it("asks immediately on a robot event", () => {
    const e = quietEngine();
    burn(e, 34, 10);
    e.world.robot.x = 34;
    e.world.robot.y = 13;
    e.resolve(1, answer(expectPending(e), "attack_B5"));
    e.world.robot.foam = 0;
    const req = nextRequest(e);
    expect(req.reason).toBe("tank_empty");
    expect(e.world.tick).toBe(1);
  });

  it("rejects unknown labels, missing questions and wrong ids and stays pending", () => {
    const e = quietEngine();
    burn(e, 34, 10);
    const req = expectPending(e);
    const good = answer(req);

    expect(() => e.resolve(2, good)).toThrow(/id/);
    expect(() => e.resolve(1, { ...good, action: pick("attack_Z9", ["attack_Z9"]) })).toThrow(
      /action.*attack_Z9/,
    );
    const { action: _omit, ...missing } = good;
    expect(() => e.resolve(1, missing)).toThrow(/action/);
    expect(e.pending).toBe(req);
    expect(e.log).toHaveLength(0);
    expect(expectPending(e)).toBe(req);

    e.resolve(1, good);
    expect(e.pending).toBeNull();
    expect(() => e.resolve(1, good)).toThrow(/pending/);
  });

  it("opens the door when door_safe ≥ 0.5 and holds otherwise", () => {
    for (const safe of [0.9, 0.2]) {
      const e = quietEngine();
      burn(e, 34, 10);
      e.world.robot.x = 34;
      e.world.robot.y = 21;
      e.resolve(1, answer(expectPending(e), "attack_B5"));
      let req = nextRequest(e);
      while (req.reason !== "door") {
        e.resolve(req.id, answer(req, "attack_B5"));
        req = nextRequest(e);
      }
      expect(Object.keys(req.questions)).toEqual(["door_safe"]);
      expect(req.context.door?.id).toBe("B-south");
      e.resolve(req.id, answer(req, "wait", safe));

      const door = e.world.doors.find((d) => d.id === "B-south");
      if (safe >= 0.5) {
        expect(door?.open).toBe(true);
      } else {
        expect(door?.open).toBe(false);
        expect(e.world.robot.task.kind).toBe("wait");
        expect(e.world.robot.doorHold["B-south"]).toBeGreaterThan(e.world.tick);
      }
    }
  });

  it("ends when no cell is burning or at maxTime", () => {
    const out = quietEngine();
    out.resolve(1, answer(expectPending(out)));
    expect(out.step().kind).toBe("ended");
    expect(out.ended).toBe(true);
    expect(out.step().kind).toBe("ended");

    const timed = quietEngine({ maxTime: 2 });
    for (let x = 0; x < 20; x++) burn(timed, x, 1);
    let r = timed.step();
    while (r.kind !== "ended") {
      if (r.kind === "pending") timed.resolve(r.request.id, answer(r.request));
      r = timed.step();
    }
    expect(timed.world.tick).toBe(2 / SIM.TICK);
  });
});
