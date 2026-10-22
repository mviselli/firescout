import type { DecisionMeta } from "@firescout/brain-client";
import type { DecisionSource } from "@firescout/sim";
import type { PolicyChoice, PolicyTone } from "./panel";

export interface Badge {
  text: string;
  tone: PolicyTone;
  /** Why the brain was not used (tooltip). */
  detail?: string;
}

/** Replay files cap a fallback reason at 200 characters (`replay/file.ts`). */
const MAX_REASON = 200;

/** Who answered, from RemotePolicy's meta: the brain's backend, or the rules standing in. */
export function sourceFromMeta(meta: DecisionMeta): DecisionSource {
  if (meta.source === "brain") return { backend: meta.backend, latencyMs: meta.latencyMs };
  // A brain error can carry a whole traceback; keep it short enough to save in a replay.
  let reason = meta.reason ?? "offline";
  if (reason.length > MAX_REASON) reason = `${reason.slice(0, MAX_REASON - 1)}…`;
  return { backend: "baseline", latencyMs: meta.latencyMs, fallback: reason };
}

/** The panel's line saying who answered R1's last decision in this game. */
export function policyBadge(choice: PolicyChoice, source: DecisionSource | null): Badge {
  if (choice === "baseline") return { text: "Baseline rules", tone: "rules" };
  if (!source) return { text: "Brain connecting…", tone: "waiting" };
  if (source.fallback !== undefined) {
    return { text: "Brain offline, baseline rules", tone: "fallback", detail: source.fallback };
  }
  const name = source.backend.charAt(0).toUpperCase() + source.backend.slice(1);
  return { text: `${name} · ${Math.round(source.latencyMs ?? 0)} ms`, tone: "brain" };
}
