import { describe, expect, it } from "vitest";
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
