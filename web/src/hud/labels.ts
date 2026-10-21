import type {
  Answer,
  DecisionReason,
  DecisionRequest,
  DecisionSource,
  Question,
} from "@firescout/sim";
import type { TimelineEntry } from "../history";

/** How the HUD names a question. */
export function questionLabel(id: string, req: DecisionRequest): string {
  if (id === "action") return "Next move";
  if (id === "door_safe") return `Is door ${req.context.door?.id ?? ""} safe to open?`;
  if (id.startsWith("agent_")) return `Agent for ${id.slice("agent_".length)}`;
  return id;
}

/** How the HUD names an option label. */
export function optionLabel(label: string): string {
  if (label.startsWith("attack_")) return `Attack ${label.slice("attack_".length)}`;
  if (label === "wait") return "Hold";
  return label.charAt(0).toUpperCase() + label.slice(1);
}

const REASONS: Record<DecisionReason, string> = {
  start: "first call",
  cadence: "routine check",
  door: "closed door ahead",
  tank_empty: "tank empty",
  blocked: "path blocked",
  task_done: "sector put out",
  refilled: "tanks full",
};

export function reasonLabel(reason: DecisionReason): string {
  return REASONS[reason];
}

export interface OptionRow {
  key: string;
  label: string;
  p: number;
  chosen: boolean;
  /** The option's text in the question, as the model read it. */
  description?: string;
}

/** Every option, most likely first (score: criteria order); noul → Yes/No. */
export function answerRows(q: Question | undefined, a: Answer): OptionRow[] {
  if (a.type === "noul") {
    // Like the engine: only a yes above 0.5 opens the door.
    const yes = a.noul > 0.5;
    return [
      { key: "yes", label: "Yes, open it", p: a.noul, chosen: yes },
      { key: "no", label: "No, hold", p: 1 - a.noul, chosen: !yes },
    ];
  }
  if (a.type === "score") {
    const levels = q?.type === "score" ? q.criteria : Object.keys(a.probabilities);
    const best = levels.reduce(
      (b, l) => ((a.probabilities[l] ?? 0) > (a.probabilities[b] ?? 0) ? l : b),
      levels[0] ?? "",
    );
    return levels.map((l) => ({
      key: l,
      label: optionLabel(l),
      p: a.probabilities[l] ?? 0,
      chosen: l === best,
    }));
  }
  const criteria = q?.type === "choice" ? q.criteria : {};
  const order = Object.keys(criteria);
  const rank = (k: string) => (order.includes(k) ? order.indexOf(k) : order.length);
  return Object.entries(a.probabilities)
    .sort((x, y) => y[1] - x[1] || rank(x[0]) - rank(y[0]))
    .map(([key, p]) => {
      const row: OptionRow = { key, label: optionLabel(key), p, chosen: key === a.choice };
      const description = criteria[key];
      if (description !== undefined) row.description = description;
      return row;
    });
}

export function percent(p: number): string {
  if (p > 0 && p < 0.005) return "<1%";
  return `${Math.round(p * 100)}%`;
}

export function sourceLabel(s: DecisionSource): string {
  if (s.fallback !== undefined) return "Rules (brain offline)";
  if (s.backend === "baseline") return "Rules";
  const name = s.backend.charAt(0).toUpperCase() + s.backend.slice(1);
  return s.latencyMs === undefined ? name : `${name} · ${Math.round(s.latencyMs)} ms`;
}

/** The question that decides what R1 does: the door question on a door event, else the action. */
export function mainQuestion(entry: TimelineEntry): string {
  return "door_safe" in entry.req.questions ? "door_safe" : "action";
}

/** One line for the log: what R1 was told to do. */
export function entrySummary(entry: TimelineEntry): string {
  const { answers, req } = entry;
  const door = answers.door_safe;
  if (mainQuestion(entry) === "door_safe" && door?.type === "noul") {
    const id = req.context.door?.id ?? "";
    return door.noul > 0.5 ? `Open door ${id}` : `Hold at door ${id}`;
  }
  const action = answers.action;
  if (action?.type !== "choice") return "Hold";
  const label = optionLabel(action.choice);
  if (!action.choice.startsWith("attack_")) return label;
  const agent = answers[`agent_${action.choice.slice("attack_".length)}`];
  return agent?.type === "choice" ? `${label} with ${agent.choice}` : label;
}

/** The main answer's confidence (Laya's distance from a uniform guess). */
export function entryConfidence(entry: TimelineEntry): number {
  return entry.answers[mainQuestion(entry)]?.confidence ?? 0;
}

export type SourceTone = "brain" | "rules" | "fallback";

/** Colour key for who answered: the brain, the chosen rules, or the rules standing in. */
export function sourceTone(s: DecisionSource): SourceTone {
  if (s.fallback !== undefined) return "fallback";
  return s.backend === "baseline" ? "rules" : "brain";
}

/** Probability of the option R1 acts on, as its bar shows it. */
export function entryChosenP(entry: TimelineEntry): number {
  const id = mainQuestion(entry);
  const a = entry.answers[id];
  if (!a) return 0;
  return answerRows(entry.req.questions[id], a).find((r) => r.chosen)?.p ?? 0;
}
