import type { Answer, DecisionRequest, Question } from "@firescout/sim";
import { describe, expect, it } from "vitest";
import type { TimelineEntry } from "../history";
import {
  answerRows,
  entryChosenP,
  entryConfidence,
  entrySummary,
  mainQuestion,
  optionLabel,
  percent,
  questionLabel,
  reasonLabel,
  sourceLabel,
  sourceTone,
} from "./labels";

const action: Question = {
  type: "choice",
  instructions: "What should robot R1 do next?",
  criteria: {
    attack_B5: "Paint fire in B5.",
    attack_A2: "Paper fire in A2.",
    refill: "Return to base.",
    wait: "Stand still.",
  },
};

function req(questions: Record<string, Question>, door: string | null = null): DecisionRequest {
  return {
    id: 4,
    unit: "R1",
    t: 12.4,
    reason: door ? "door" : "cadence",
    context: { door: door ? { id: door, smoke: 0.7 } : null } as DecisionRequest["context"],
    questions,
  };
}

const choice = (c: string, probabilities: Record<string, number>, confidence = 0.4): Answer => ({
  type: "choice",
  choice: c,
  probabilities,
  confidence,
});

describe("answerRows", () => {
  it("lists every choice option, most likely first, with the question's descriptions", () => {
    const rows = answerRows(
      action,
      choice("attack_B5", { attack_A2: 0.2, attack_B5: 0.6, refill: 0.05, wait: 0.15 }),
    );
    expect(rows.map((r) => r.key)).toEqual(["attack_B5", "attack_A2", "wait", "refill"]);
    expect(rows[0]).toEqual({
      key: "attack_B5",
      label: "Attack B5",
      p: 0.6,
      chosen: true,
      description: "Paint fire in B5.",
    });
    expect(rows.filter((r) => r.chosen)).toHaveLength(1);
  });

  it("breaks probability ties by the question's option order", () => {
    const rows = answerRows(
      action,
      choice("refill", { wait: 0.25, refill: 0.25, attack_A2: 0.25, attack_B5: 0.25 }),
    );
    expect(rows.map((r) => r.key)).toEqual(["attack_B5", "attack_A2", "refill", "wait"]);
  });

  it("keeps score options in criteria order and maps noul to Yes/No", () => {
    const score: Question = { type: "score", instructions: "Spread", criteria: ["low", "high"] };
    const rows = answerRows(score, {
      type: "score",
      score: 1,
      probabilities: { high: 0.7, low: 0.3 },
      confidence: 0.2,
    });
    expect(rows.map((r) => [r.label, r.chosen])).toEqual([
      ["Low", false],
      ["High", true],
    ]);

    const door: Question = { type: "noul", instructions: "Opening door B-west now is safe." };
    expect(answerRows(door, { type: "noul", noul: 0.3, confidence: 0.1 })).toEqual([
      { key: "yes", label: "Yes, open it", p: 0.3, chosen: false },
      { key: "no", label: "No, hold", p: 0.7, chosen: true },
    ]);
    // 0.5 is not a yes: the engine holds the door.
    expect(answerRows(door, { type: "noul", noul: 0.5, confidence: 0 })[1]?.chosen).toBe(true);
  });
});

describe("percent", () => {
  it("formats percents, including <1%", () => {
    expect(percent(0.564)).toBe("56%");
    expect(percent(1)).toBe("100%");
    expect(percent(0.004)).toBe("<1%");
    expect(percent(0)).toBe("0%");
  });
});

describe("sourceLabel", () => {
  it("labels sources: brain with latency, rules, fallback", () => {
    expect(sourceLabel({ backend: "laya", latencyMs: 311.6 })).toBe("Laya · 312 ms");
    expect(sourceLabel({ backend: "mock" })).toBe("Mock");
    expect(sourceLabel({ backend: "baseline" })).toBe("Rules");
    expect(sourceLabel({ backend: "baseline", fallback: "timeout" })).toBe("Rules (brain offline)");
  });
});

describe("sourceTone", () => {
  it("colours brain, rules and fallback apart", () => {
    expect(sourceTone({ backend: "laya" })).toBe("brain");
    expect(sourceTone({ backend: "baseline" })).toBe("rules");
    expect(sourceTone({ backend: "baseline", fallback: "offline" })).toBe("fallback");
  });
});

describe("names", () => {
  it("names questions and reasons like the old panel", () => {
    const r = req({ action }, "B-west");
    expect(questionLabel("action", r)).toBe("Next move");
    expect(questionLabel("agent_B5", r)).toBe("Agent for B5");
    expect(questionLabel("door_safe", r)).toBe("Is door B-west safe to open?");
    expect(optionLabel("attack_B5")).toBe("Attack B5");
    expect(optionLabel("wait")).toBe("Hold");
    expect(optionLabel("foam")).toBe("Foam");
    expect(reasonLabel("cadence")).toBe("routine check");
    expect(reasonLabel("task_done")).toBe("sector put out");
  });
});

describe("entry summaries", () => {
  const agent: Question = {
    type: "choice",
    instructions: "Which agent?",
    criteria: { water: "Solids.", foam: "Liquids." },
  };

  it("summarises an attack with its agent, and its main confidence", () => {
    const entry: TimelineEntry = {
      req: req({ action, agent_B5: agent }),
      answers: {
        action: choice(
          "attack_B5",
          { attack_B5: 0.6, attack_A2: 0.2, refill: 0.1, wait: 0.1 },
          0.33,
        ),
        agent_B5: choice("foam", { water: 0.1, foam: 0.9 }, 0.5),
      },
      source: { backend: "laya" },
    };
    expect(mainQuestion(entry)).toBe("action");
    expect(entrySummary(entry)).toBe("Attack B5 with foam");
    expect(entryConfidence(entry)).toBe(0.33);
    expect(entryChosenP(entry)).toBe(0.6);
  });

  it("summarises holds, refills and doors", () => {
    const hold: TimelineEntry = {
      req: req({ action }),
      answers: {
        action: choice("wait", { attack_B5: 0.2, attack_A2: 0.2, refill: 0.1, wait: 0.5 }),
      },
      source: { backend: "laya" },
    };
    expect(entrySummary(hold)).toBe("Hold");

    const door = (noul: number): TimelineEntry => ({
      req: req(
        { door_safe: { type: "noul", instructions: "Opening door B-west now is safe." } },
        "B-west",
      ),
      answers: { door_safe: { type: "noul", noul, confidence: 0.4 } },
      source: { backend: "laya" },
    });
    expect(mainQuestion(door(0.8))).toBe("door_safe");
    expect(entrySummary(door(0.8))).toBe("Open door B-west");
    expect(entrySummary(door(0.2))).toBe("Hold at door B-west");
    expect(entryChosenP(door(0.2))).toBeCloseTo(0.8, 9);
  });
});
