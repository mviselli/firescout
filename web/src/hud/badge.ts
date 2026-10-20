import type { DecisionMeta } from "@firescout/brain-client";
import type { PolicyChoice, PolicyTone } from "./panel";

export interface Badge {
  text: string;
  tone: PolicyTone;
  /** Why the brain was not used (tooltip). */
  detail?: string;
}

/** The panel's line saying who answered R1's last decision. */
export function policyBadge(choice: PolicyChoice, meta: DecisionMeta | null): Badge {
  if (choice === "baseline") return { text: "Baseline rules", tone: "rules" };
  if (!meta) return { text: "Brain connecting…", tone: "waiting" };
  if (meta.source === "brain") {
    const name = meta.backend.charAt(0).toUpperCase() + meta.backend.slice(1);
    return { text: `${name} · ${Math.round(meta.latencyMs)} ms`, tone: "brain" };
  }
  const badge: Badge = { text: "Brain offline, baseline rules", tone: "fallback" };
  if (meta.reason) badge.detail = meta.reason;
  return badge;
}
