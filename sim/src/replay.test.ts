import { describe, expect, it } from "vitest";
import type { Policy } from "./decision";
import { Engine, type EngineOptions } from "./engine";
import { hashWorld } from "./game";
import { BaselinePolicy } from "./policies/baseline";
import { type Recording, Replay, ReplayDesyncError, recordGame } from "./replay";

/** Play with the policy until the game ends or `stopAt` ticks have run. */
async function play(opts: EngineOptions, policy: Policy, stopAt = Infinity): Promise<Engine> {
  const engine = new Engine(opts);
  while (engine.world.tick < stopAt) {
    const r = engine.step();
    if (r.kind === "ended") break;
    if (r.kind === "pending") engine.resolve(r.request.id, await policy.decide(r.request));
  }
  return engine;
}

const clone = (rec: Recording): Recording => JSON.parse(JSON.stringify(rec)) as Recording;

let seed3: Promise<Recording> | null = null;

/** A baseline game's recording; seed 3's is played once and handed out as copies. */
async function recorded(opts?: EngineOptions): Promise<Recording> {
  if (opts) return recordGame(await play(opts, new BaselinePolicy()), "baseline");
  seed3 ??= play({ seed: 3 }, new BaselinePolicy()).then((e) => recordGame(e, "baseline"));
  return clone(await seed3);
}

function errorOf(fn: () => void): ReplayDesyncError {
  try {
    fn();
  } catch (err) {
    if (err instanceof ReplayDesyncError) return err;
    throw err;
  }
  throw new Error("expected a ReplayDesyncError");
}

describe("recordGame", () => {
  it("records the options, every resolved decision with its tick, and the end hash", async () => {
    const engine = await play({ seed: 3 }, new BaselinePolicy());
    const rec = recordGame(engine, "baseline", (id) => ({ backend: `b${id}` }));
    expect(rec.version).toBe(1);
    expect(rec.options).toEqual({ seed: 3 });
    expect(rec.policy).toBe("baseline");
    expect(rec.decisions).toHaveLength(engine.log.length);
    expect(rec.decisions[0]).toMatchObject({ id: 1, tick: 0, reason: "start" });
    expect(rec.decisions[1]?.source).toEqual({ backend: "b2" });
    expect(rec.end).toEqual({ tick: engine.world.tick, hash: hashWorld(engine.world) });
  });

  it("copies the answers, so later changes to the log don't leak in", async () => {
    const engine = await play({ seed: 3, maxTime: 10 }, new BaselinePolicy());
    const rec = recordGame(engine, "baseline");
    const before = JSON.stringify(rec.decisions[0]);
    const action = engine.log[0]?.answers.action;
    if (action?.type === "choice") action.choice = "tampered";
    expect(JSON.stringify(rec.decisions[0])).toBe(before);
  });
});

describe("Replay", () => {
  it("replays to the same hash at the end, with an explicit wind and 2 ignitions", async () => {
    const rec = await recorded({
      seed: 5,
      wind: { dx: -Math.sin(1), dy: Math.cos(1), speedKmh: 15 },
      ignitions: 2,
    });
    const replay = new Replay(rec);
    replay.seekTick(rec.end.tick);
    expect(replay.atEnd).toBe(true);
    expect(hashWorld(replay.engine.world)).toBe(rec.end.hash);
    expect(replay.decided).toBe(rec.decisions.length);
  });

  it("seekTick(0) resolves the start decision only", async () => {
    const replay = new Replay(await recorded());
    replay.seekTick(0);
    expect(replay.tick).toBe(0);
    expect(replay.decided).toBe(1);
    expect(replay.engine.pending).toBeNull();
  });

  it("seeks backwards and forwards to identical worlds", async () => {
    const rec = await recorded();
    const replay = new Replay(rec);
    const mid = Math.floor(rec.end.tick / 2);
    replay.seekTick(rec.end.tick);
    const end = hashWorld(replay.engine.world);
    replay.seekTick(mid);
    const atMid = hashWorld(replay.engine.world);
    replay.seekTick(Math.floor(mid / 3));
    replay.seekTick(mid);
    expect(hashWorld(replay.engine.world)).toBe(atMid);
    replay.seekTick(rec.end.tick);
    expect(hashWorld(replay.engine.world)).toBe(end);
  });

  it("clamps and rounds the target", async () => {
    const rec = await recorded();
    const replay = new Replay(rec);
    replay.seekTick(1e9);
    expect(replay.atEnd).toBe(true);
    expect(replay.tick).toBe(rec.end.tick);
    replay.seekTick(-5);
    expect(replay.tick).toBe(0);
    replay.seekTick(12.6);
    expect(replay.tick).toBe(13);
  });

  it("stops at a pending request with no recorded answer (recorded mid-game)", async () => {
    const engine = await play({ seed: 3 }, new BaselinePolicy(), 40);
    // Step on until a request is pending and leave it unanswered, like a decision in flight.
    while (!engine.pending) engine.step();
    const rec = recordGame(engine, "baseline");
    expect(rec.decisions).toHaveLength(engine.log.length);

    const replay = new Replay(rec);
    replay.seekTick(rec.end.tick);
    expect(replay.tick).toBe(rec.end.tick);
    expect(replay.engine.pending?.id).toBe(engine.pending?.id);
    expect(hashWorld(replay.engine.world)).toBe(rec.end.hash);
    expect(replay.decided).toBe(engine.log.length);
  });

  it("throws ReplayDesyncError after a decision is changed to another valid answer", async () => {
    const rec = await recorded();
    // The first attack decision becomes a wait: still a valid answer, but a different game.
    const k = rec.decisions.findIndex(
      (d) => d.answers.action?.type === "choice" && d.answers.action.choice.startsWith("attack_"),
    );
    expect(k).toBeGreaterThanOrEqual(0);
    const action = rec.decisions[k]?.answers.action;
    if (action?.type !== "choice") throw new Error("unreachable");
    action.choice = "wait";

    const err = errorOf(() => new Replay(rec).seekTick(rec.end.tick));
    expect(err.decisionIndex).toBeGreaterThan(k);
    expect(err.decisionIndex).toBeLessThanOrEqual(rec.decisions.length);
    expect(err.message).toContain(
      err.decisionIndex === rec.decisions.length ? "end" : `decision ${err.decisionIndex + 1}`,
    );
  });

  it("throws ReplayDesyncError when a recorded reason or tick does not match", async () => {
    const rec = await recorded();
    const k = 3;
    const bad = clone(rec);
    const d = bad.decisions[k];
    if (!d) throw new Error("too few decisions");
    d.reason = d.reason === "cadence" ? "blocked" : "cadence";
    const err = errorOf(() => new Replay(bad).seekTick(bad.end.tick));
    expect(err.decisionIndex).toBe(k);
    expect(err.t).toBeCloseTo(d.t, 6);

    const late = clone(rec);
    const e = late.decisions[k];
    if (!e) throw new Error("too few decisions");
    e.tick += 1;
    expect(errorOf(() => new Replay(late).seekTick(late.end.tick)).decisionIndex).toBe(k);
  });

  it("calls onDecision once per resolve, in order, again after a backward seek", async () => {
    const rec = await recorded();
    const seen: number[] = [];
    const replay = new Replay(rec, {
      onDecision(req, d) {
        expect(req.id).toBe(d.id);
        seen.push(d.id);
      },
    });
    replay.seekTick(rec.end.tick);
    expect(seen).toEqual(rec.decisions.map((d) => d.id));
    seen.length = 0;
    replay.seekTick(0);
    expect(seen).toEqual([1]);
  });

  it("survives a JSON round trip", async () => {
    const rec = await recorded({ seed: 8, wind: { dx: 0.6, dy: -0.8, speedKmh: 22 } });
    const copy = JSON.parse(JSON.stringify(rec)) as Recording;
    const replay = new Replay(copy);
    replay.seekTick(copy.end.tick);
    expect(hashWorld(replay.engine.world)).toBe(rec.end.hash);
  });
});
