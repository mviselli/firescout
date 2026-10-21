import type { DecisionRequest } from "@firescout/sim";
import type { TimelineEntry } from "../history";
import { el } from "./dom";
import {
  answerRows,
  mainQuestion,
  percent,
  questionLabel,
  reasonLabel,
  sourceLabel,
  sourceTone,
} from "./labels";

export interface DecisionView {
  root: HTMLElement;
  show(entry: TimelineEntry | null, pending: DecisionRequest | null): void;
}

const SURE_TITLE =
  "How far the answer is from an even guess across the options: 0% is a coin toss, 100% is certain.";

/** The main question as one bar per option, then each sub-question on one line. */
function renderAnswer(body: HTMLElement, entry: TimelineEntry): void {
  const { req, answers, source } = entry;
  const head = el("p", "dv-head");
  head.append(
    el("span", "dv-time", `${req.t.toFixed(1)} s`),
    el("span", "dv-reason", reasonLabel(req.reason)),
  );
  // Who answered is on the badge; a fallback is worth repeating next to the answer it gave.
  if (source.fallback !== undefined) {
    const chip = el("span", "source", sourceLabel(source));
    chip.dataset.tone = sourceTone(source);
    chip.title = `The brain was not used: ${source.fallback}`;
    head.append(chip);
  }

  const mainId = mainQuestion(entry);
  const main = answers[mainId];
  const nodes: HTMLElement[] = [head];
  if (main) {
    const q = el("p", "dv-q");
    const sure = el("span", "sure", `Sure ${percent(main.confidence)}`);
    sure.title = SURE_TITLE;
    q.append(el("span", "", questionLabel(mainId, req)), sure);

    const list = el("ol", "options");
    for (const row of answerRows(req.questions[mainId], main)) {
      const li = el("li", row.chosen ? "option chosen" : "option");
      if (row.description) li.title = row.description;
      const bar = el("span", "bar");
      bar.style.setProperty("--p", row.p.toFixed(3));
      const track = el("span", "track");
      track.append(bar);
      li.append(el("span", "option-label", row.label), track, el("span", "pct", percent(row.p)));
      list.append(li);
    }
    nodes.push(q, list);
  }

  // Sub-questions: the agent for each attack option. The one R1 acts on is emphasised.
  const action = answers.action;
  const acting =
    action?.type === "choice" && action.choice.startsWith("attack_")
      ? `agent_${action.choice.slice("attack_".length)}`
      : null;
  const subs = el("ul", "subs");
  for (const [id, a] of Object.entries(answers)) {
    if (id === mainId) continue;
    const chosen = answerRows(req.questions[id], a).find((r) => r.chosen);
    if (!chosen) continue;
    const li = el("li", id === acting ? "sub acting" : "sub");
    const mini = el("span", "mini");
    mini.style.setProperty("--p", chosen.p.toFixed(3));
    li.append(
      el("span", "sub-q", questionLabel(id, req)),
      el("span", "sub-a", chosen.label),
      mini,
      el("span", "pct", percent(chosen.p)),
    );
    subs.append(li);
  }
  if (subs.childElementCount > 0) nodes.push(subs);
  body.replaceChildren(...nodes);
}

export function createDecisionView(): DecisionView {
  const root = el("div", "dv");
  const pendingLine = el("p", "dv-pending");
  pendingLine.hidden = true;
  const body = el("div", "dv-body");
  root.append(pendingLine, body);
  let shown: TimelineEntry | null | undefined;

  return {
    root,
    show(entry, pending) {
      pendingLine.hidden = pending === null;
      pendingLine.textContent = pending ? `Deciding: ${reasonLabel(pending.reason)}…` : "";
      root.toggleAttribute("data-pending", pending !== null);
      if (entry === shown) return;
      shown = entry;
      if (entry) renderAnswer(body, entry);
      else body.replaceChildren(el("p", "empty", "R1 is waiting for its first call."));
    },
  };
}
