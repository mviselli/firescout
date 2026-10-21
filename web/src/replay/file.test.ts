import { BaselinePolicy, Engine, type Recording, recordGame } from "@firescout/sim";
import { beforeAll, describe, expect, it } from "vitest";
import { parseRecording, RecordingError, recordingFileName, serializeRecording } from "./file";

let rec: Recording;

beforeAll(async () => {
  const engine = new Engine({ seed: 7, wind: { dx: 0.6, dy: -0.8, speedKmh: 15 }, maxTime: 20 });
  const policy = new BaselinePolicy();
  for (;;) {
    const r = engine.step();
    if (r.kind === "ended") break;
    if (r.kind === "pending") engine.resolve(r.request.id, await policy.decide(r.request));
  }
  rec = recordGame(engine, "brain", (id) =>
    id % 2 ? { backend: "laya", latencyMs: 300 } : { backend: "baseline", fallback: "timeout" },
  );
});

/** The recording as plain JSON, edited by `edit`, then serialized again. */
function edited(
  edit: (raw: Record<string, unknown> & { decisions: Record<string, unknown>[] }) => void,
) {
  const raw = JSON.parse(serializeRecording(rec));
  edit(raw);
  return JSON.stringify(raw);
}

function reason(text: string): string {
  try {
    parseRecording(text);
  } catch (err) {
    expect(err).toBeInstanceOf(RecordingError);
    return (err as Error).message;
  }
  throw new Error("expected a RecordingError");
}

describe("replay file", () => {
  it("round-trips a recording from a real baseline game", () => {
    expect(rec.decisions.length).toBeGreaterThan(2);
    expect(parseRecording(serializeRecording(rec))).toEqual(rec);
  });

  it("names the file after the seed and the policy", () => {
    expect(recordingFileName(rec)).toBe("firescout-fire-7-brain.json");
  });

  it("rejects non-JSON, an unsupported version and oversized text with the exact messages", () => {
    expect(reason("{nope")).toBe("Not a FireScout replay (not JSON).");
    expect(reason(edited((r) => (r.version = 2)))).toBe(
      "Replay version 2 is not supported (expected 1).",
    );
    expect(reason(" ".repeat(5 * 1024 * 1024 + 1))).toBe("Replay file is too large (over 5 MB).");
    expect(reason("[]")).toMatch(/^Not a valid FireScout replay: /);
  });

  it("rejects unknown keys and names the path", () => {
    const msg = reason(edited((r) => ((r.decisions[0] as Record<string, unknown>).extra = 1)));
    expect(msg).toMatch(/^Not a valid FireScout replay: decisions\.0/);
    expect(msg.endsWith(".")).toBe(true);
  });

  it("rejects decisions out of order or past the end", () => {
    expect(reason(edited((r) => r.decisions.reverse()))).toMatch(/decisions/);
    expect(reason(edited((r) => ((r.decisions[1] as { id: number }).id = 9)))).toMatch(/decisions/);
    expect(reason(edited((r) => ((r.end as { tick: number }).tick = 0)))).toMatch(
      /Not a valid FireScout replay/,
    );
  });

  it("rejects bad options, policy names and hashes", () => {
    expect(reason(edited((r) => ((r.options as { seed: number }).seed = -1)))).toMatch(
      /options\.seed/,
    );
    expect(reason(edited((r) => (r.policy = "Laya!")))).toMatch(/policy/);
    expect(reason(edited((r) => ((r.end as { hash: string }).hash = "xyz")))).toMatch(/end\.hash/);
    expect(
      reason(edited((r) => ((r.decisions[0] as { reason: string }).reason = "panic"))),
    ).toMatch(/decisions\.0\.reason/);
  });
});
