import { SIM } from "../config";
import { type DecisionContext, type FireSector, priority } from "../context";
import type { Answer, Answers, DecisionRequest, Policy, Question } from "../decision";
import type { Agent } from "../robot";

const ACTION_TEMPERATURE = 0.5;
/** Tank level (percent) below which both tanks count as low and refilling is preferred. */
const REFILL_BELOW = 15;
/** Tank level (percent) below which attacking with that agent is discouraged. */
const ATTACK_MIN_TANK = 10;

export function softmax(
  scores: Record<string, number>,
  temperature: number,
): Record<string, number> {
  const max = Math.max(...Object.values(scores));
  const exps: Record<string, number> = {};
  let sum = 0;
  for (const [k, s] of Object.entries(scores)) {
    const e = Math.exp((s - max) / temperature);
    exps[k] = e;
    sum += e;
  }
  for (const k of Object.keys(exps)) exps[k] = (exps[k] ?? 0) / sum;
  return exps;
}

/** Laya's `confidence`: 1 − entropy / log(options), so 0 is a uniform guess and 1 a certainty. */
function entropyConfidence(ps: number[]): number {
  if (ps.length < 2) return 1;
  const entropy = -ps.reduce((s, p) => s + (p > 0 ? p * Math.log(p) : 0), 0);
  return Math.min(1, Math.max(0, 1 - entropy / Math.log(ps.length)));
}

/** Argmax (ties go to the first key), with confidence measured the way Laya measures it. */
export function choiceAnswer(probabilities: Record<string, number>): Answer {
  let choice = "";
  let best = -1;
  for (const [k, p] of Object.entries(probabilities)) {
    if (p > best) {
      choice = k;
      best = p;
    }
  }
  const confidence = entropyConfidence(Object.values(probabilities));
  return { type: "choice", choice, probabilities, confidence };
}

/** For noul, Laya reports confidence as max(p, 1 − p). */
export function noulAnswer(noul: number): Answer {
  return { type: "noul", noul, confidence: Math.max(noul, 1 - noul) };
}

/** A flat score answer: rules never ask score questions, but a policy must answer every question. */
export function uniformScoreAnswer(levels: string[]): Answer {
  const probabilities = Object.fromEntries(levels.map((l) => [l, 1 / levels.length]));
  return { type: "score", score: 0.5, probabilities, confidence: 0 };
}

function preferredAgent(f: FireSector | undefined): Agent {
  return f?.content === "paint" ? "foam" : "water";
}

function fireFor(ctx: DecisionContext, sector: string): FireSector | undefined {
  return ctx.fires.find((f) => f.sector === sector);
}

function actionScores(ctx: DecisionContext, labels: string[]): Record<string, number> {
  const { robot } = ctx;
  const scores: Record<string, number> = {};
  for (const label of labels) {
    if (label === "refill") {
      scores[label] = robot.water < REFILL_BELOW && robot.foam < REFILL_BELOW ? 2 : 0;
    } else if (label === "wait") {
      scores[label] = -1;
    } else if (label.startsWith("attack_")) {
      const f = fireFor(ctx, label.slice("attack_".length));
      const tank = robot[preferredAgent(f)];
      scores[label] = !f || tank < ATTACK_MIN_TANK ? -2 : Math.log(1 + priority(f));
    } else {
      scores[label] = 0;
    }
  }
  return scores;
}

function agentProbabilities(ctx: DecisionContext, sector: string): Record<string, number> {
  let agent = preferredAgent(fireFor(ctx, sector));
  if (ctx.robot[agent] <= 0) agent = agent === "foam" ? "water" : "foam";
  return agent === "foam" ? { water: 0.1, foam: 0.9 } : { water: 0.9, foam: 0.1 };
}

function answer(ctx: DecisionContext, id: string, q: Question): Answer {
  if (q.type === "noul") {
    const smoke = ctx.door?.smoke ?? 0;
    return noulAnswer(smoke < SIM.DOOR_SMOKE_THRESHOLD ? 0.85 : 0.15);
  }
  if (q.type === "score") return uniformScoreAnswer(q.criteria);
  const labels = Object.keys(q.criteria);
  if (id === "action") return choiceAnswer(softmax(actionScores(ctx, labels), ACTION_TEMPERATURE));
  if (id.startsWith("agent_"))
    return choiceAnswer(agentProbabilities(ctx, id.slice("agent_".length)));
  return choiceAnswer(Object.fromEntries(labels.map((l) => [l, 1 / labels.length])));
}

/** Hand-written rules that answer in the model's format, the reference to beat. */
export class BaselinePolicy implements Policy {
  readonly name = "baseline";

  async decide(req: DecisionRequest): Promise<Answers> {
    const answers: Answers = {};
    for (const [id, q] of Object.entries(req.questions)) answers[id] = answer(req.context, id, q);
    return answers;
  }
}
