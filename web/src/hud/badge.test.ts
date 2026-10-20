import { describe, expect, it } from "vitest";
import { policyBadge } from "./badge";

describe("policyBadge", () => {
  it("names the rules when they were chosen", () => {
    expect(policyBadge("baseline", null)).toEqual({ text: "Baseline rules", tone: "rules" });
  });

  it("says the brain is connecting before its first decision", () => {
    expect(policyBadge("brain", null)).toEqual({ text: "Brain connecting…", tone: "waiting" });
  });

  it("names the backend and its latency when the brain answered", () => {
    const meta = { source: "brain", backend: "laya", latencyMs: 93.6 } as const;
    expect(policyBadge("brain", meta)).toEqual({ text: "Laya · 94 ms", tone: "brain" });
  });

  it("says the brain is offline when the rules stood in, with the reason as detail", () => {
    const meta = {
      source: "fallback",
      backend: "baseline",
      latencyMs: 0,
      reason: "timeout",
    } as const;
    expect(policyBadge("brain", meta)).toEqual({
      text: "Brain offline, baseline rules",
      tone: "fallback",
      detail: "timeout",
    });
  });
});
