import { describe, expect, it } from "vitest";
import { parseRecording, serializeRecording } from "../replay/file";
import { policyBadge, sourceFromMeta } from "./badge";

describe("policyBadge", () => {
  it("names the rules when they were chosen", () => {
    expect(policyBadge("baseline", null)).toEqual({ text: "Baseline rules", tone: "rules" });
    expect(policyBadge("baseline", { backend: "baseline" })).toEqual({
      text: "Baseline rules",
      tone: "rules",
    });
  });

  it("says the brain is connecting with no source yet", () => {
    expect(policyBadge("brain", null)).toEqual({ text: "Brain connecting…", tone: "waiting" });
  });

  it("names the backend and its latency for a brain source", () => {
    expect(policyBadge("brain", { backend: "laya", latencyMs: 93.6 })).toEqual({
      text: "Laya · 94 ms",
      tone: "brain",
    });
  });

  it("says the brain is offline when the rules stood in, with the reason as detail", () => {
    const source = { backend: "baseline", latencyMs: 0, fallback: "timeout" };
    expect(policyBadge("brain", source)).toEqual({
      text: "Brain offline, baseline rules",
      tone: "fallback",
      detail: "timeout",
    });
  });
});

describe("sourceFromMeta", () => {
  it("keeps the backend and latency of a brain answer", () => {
    expect(sourceFromMeta({ source: "brain", backend: "laya", latencyMs: 312 })).toEqual({
      backend: "laya",
      latencyMs: 312,
    });
  });

  it("maps a fallback to a baseline source with the reason", () => {
    expect(
      sourceFromMeta({ source: "fallback", backend: "baseline", latencyMs: 2, reason: "timeout" }),
    ).toEqual({ backend: "baseline", latencyMs: 2, fallback: "timeout" });
    expect(sourceFromMeta({ source: "fallback", backend: "baseline", latencyMs: 2 })).toEqual({
      backend: "baseline",
      latencyMs: 2,
      fallback: "offline",
    });
  });
});

describe("sourceFromMeta with a long brain error", () => {
  it("keeps the fallback reason short enough for a replay file to reopen", () => {
    const reason = `brain error: ${"Traceback line\n".repeat(40)}`;
    const source = sourceFromMeta({
      source: "fallback",
      backend: "baseline",
      reason,
      latencyMs: 3,
    });
    expect(source.fallback?.startsWith("brain error: Traceback line")).toBe(true);
    expect(source.fallback?.endsWith("…")).toBe(true);
    const rec = {
      version: 1 as const,
      policy: "brain",
      options: { seed: 1 },
      decisions: [
        {
          id: 1,
          tick: 0,
          t: 0,
          reason: "start" as const,
          answers: {},
          source,
        },
      ],
      end: { tick: 0, hash: "00000000" },
    };
    expect(() => parseRecording(serializeRecording(rec))).not.toThrow();
  });
});
