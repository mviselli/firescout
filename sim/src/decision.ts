import type { DecisionContext } from "./context";
import type { RobotEvent } from "./robot";

/** Typed questions in Laya's format (docs/laya-api.md). */
export type Question =
  | { type: "choice"; instructions: string; criteria: Record<string, string> }
  | { type: "noul"; instructions: string }
  | { type: "score"; instructions: string; criteria: string[] };

/**
 * Answers mirror Laya's output: probabilities over labels, `noul` = P(true). `confidence` is
 * Laya's entropy-based value; `answer_confidence` (the calibrated top probability) is optional.
 */
export type Answer =
  | {
      type: "choice";
      choice: string;
      probabilities: Record<string, number>;
      confidence: number;
      answer_confidence?: number;
    }
  | { type: "noul"; noul: number; confidence: number; answer_confidence?: number }
  | {
      type: "score";
      score: number;
      probabilities: Record<string, number>;
      confidence: number;
      answer_confidence?: number;
    };

export type Answers = Record<string, Answer>;

export type DecisionReason = "start" | "cadence" | RobotEvent;

export interface DecisionRequest {
  id: number;
  unit: "R1";
  t: number;
  reason: DecisionReason;
  context: DecisionContext;
  questions: Record<string, Question>;
}

/** Shared by the baseline, the remote (brain) policy and mocks. */
export interface Policy {
  readonly name: string;
  decide(req: DecisionRequest): Promise<Answers>;
}
