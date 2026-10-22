import { BaselinePolicy, Engine, type Recording, recordGame, SIM } from "@firescout/sim";
import { beforeAll, describe, expect, it } from "vitest";
import { LiveSession } from "../session";
import { historyFromRecording, loadReplay, ReplayPlayer } from "./player";

let rec: Recording;

beforeAll(async () => {
  const engine = new Engine({ seed: 3 });
  const policy = new BaselinePolicy();
  for (;;) {
    const r = engine.step();
    if (r.kind === "ended") break;
    if (r.kind === "pending") engine.resolve(r.request.id, await policy.decide(r.request));
  }
  rec = recordGame(engine, "baseline");
});

const clone = (r: Recording): Recording => JSON.parse(JSON.stringify(r)) as Recording;
const flush = () => new Promise((r) => setTimeout(r, 0));

describe("ReplayPlayer", () => {
  it("starts paused at t=0 with the start decision resolved", () => {
    const p = new ReplayPlayer(rec);
    expect(p.paused).toBe(true);
    expect(p.t).toBe(0);
    expect(p.replay.decided).toBe(1);
    p.advance(1);
    expect(p.t).toBe(0);
  });

  it("advances at speed and stops paused at the end", () => {
    const p = new ReplayPlayer(rec);
    p.speed = 2;
    p.play();
    p.advance(0.25);
    p.advance(0.25);
    p.advance(0.25);
    p.advance(0.25);
    expect(p.t).toBeCloseTo(2.0, 6);
    for (let k = 0; k < 10_000 && !p.ended; k++) p.advance(0.25);
    expect(p.ended).toBe(true);
    expect(p.paused).toBe(true);
    expect(p.replay.tick).toBe(rec.end.tick);
    expect(p.error).toBeNull();
  });

  it("caps one frame's catch-up at 0.5 s of sim time", () => {
    const p = new ReplayPlayer(rec);
    p.speed = 4;
    p.play();
    p.advance(10);
    expect(p.t).toBeCloseTo(0.5, 6);
  });

  it("seeks to fractional times and steps between decisions", () => {
    const p = new ReplayPlayer(rec);
    p.seek(12.34);
    expect(p.replay.tick).toBe(123);
    const next = rec.decisions.find((d) => d.tick > 123);
    const prev = [...rec.decisions].reverse().find((d) => d.tick < 123);
    p.stepDecision(1);
    expect(p.replay.tick).toBe(next?.tick);
    p.seek(12.3);
    p.stepDecision(-1);
    expect(p.replay.tick).toBe(prev?.tick);
    p.seek(-3);
    expect(p.t).toBe(0);
    p.stepDecision(-1);
    expect(p.t).toBe(0);
    p.seek(1e6);
    expect(p.ended).toBe(true);
  });

  it("restarts from 0 when played at the end", () => {
    const p = new ReplayPlayer(rec);
    p.seek(1e6);
    p.play();
    expect(p.t).toBe(0);
    expect(p.paused).toBe(false);
  });

  it("reports a desync once and stays paused", () => {
    const bad = clone(rec);
    const d = bad.decisions[4];
    if (!d) throw new Error("too few decisions");
    d.reason = d.reason === "cadence" ? "blocked" : "cadence";
    const p = new ReplayPlayer(bad);
    p.play();
    for (let k = 0; k < 2000; k++) p.advance(0.25);
    expect(p.error).toBe(
      `This replay doesn't match the current simulation: it diverges at decision 5 (${d.t.toFixed(1)} s). ` +
        "It was probably recorded with an older version.",
    );
    expect(p.paused).toBe(true);
    const t = p.t;
    p.play();
    p.advance(1);
    expect(p.t).toBe(t);
  });

  it("names a different end state", () => {
    const bad = clone(rec);
    bad.end.hash = "00000000";
    const p = new ReplayPlayer(bad);
    p.seek(1e6);
    expect(p.error).toBe(
      "This replay doesn't match the current simulation: it ends in a different state. " +
        "It was probably recorded with an older version.",
    );
  });
});

describe("historyFromRecording", () => {
  it("builds the same history as the live session did", async () => {
    const live = new LiveSession({
      engine: { seed: 3, maxTime: 30 },
      policy: new BaselinePolicy(),
      policyChoice: "baseline",
      speed: 4,
      sourceOf: () => ({ backend: "baseline", latencyMs: 1 }),
    });
    while (!live.loop.engine.ended) {
      live.advance(0.37);
      await flush();
    }
    const built = historyFromRecording(live.recording());
    expect(built.entries).toEqual(live.history.entries);
    expect(built.samples).toEqual(live.history.samples);
    expect(built.samples.length).toBeGreaterThan(Math.floor(30 * 0.5));
  });

  it("defaults sources to the recording's policy", () => {
    const built = historyFromRecording(rec);
    expect(built.entries[0]?.source).toEqual({ backend: "baseline" });
    expect(built.entries).toHaveLength(rec.decisions.length);
    expect(built.samples.at(-1)?.t).toBe(Math.floor(rec.end.tick * SIM.TICK + 1e-9));
  });
});

describe("loadReplay", () => {
  it("opens a recording paused at t=0 with its whole history", () => {
    const loaded = loadReplay(rec);
    if ("error" in loaded) throw new Error(loaded.error);
    expect(loaded.player.t).toBe(0);
    expect(loaded.player.paused).toBe(true);
    expect(loaded.history.entries).toHaveLength(rec.decisions.length);
  });

  it("refuses a recording that diverges, naming the decision", () => {
    const bad = clone(rec);
    const d = bad.decisions[4];
    if (!d) throw new Error("too few decisions");
    d.reason = d.reason === "cadence" ? "blocked" : "cadence";
    expect(loadReplay(bad)).toEqual({
      error:
        `This replay doesn't match the current simulation: it diverges at decision 5 (${d.t.toFixed(1)} s). ` +
        "It was probably recorded with an older version.",
    });
  });

  it("refuses a recording that ends in a different state", () => {
    const bad = clone(rec);
    bad.end.hash = "00000000";
    const loaded = loadReplay(bad);
    expect("error" in loaded && loaded.error).toContain("it ends in a different state");
  });
});
