import { serializeState } from "@firescout/sim";
import type { GameHistory, TimelineEntry } from "../history";
import { el } from "./dom";
import { answerRows, percent, questionLabel, reasonLabel, sourceLabel, sourceTone } from "./labels";

export interface Details {
  show(history: GameHistory, index: number | null): void;
}

export interface DetailsHandlers {
  onClose(): void;
  onStep(dir: -1 | 1): void;
}

/** Everything behind one decision: what the model read, and every answer with its options. */
function render(body: HTMLElement, title: HTMLElement, entry: TimelineEntry, index: number): void {
  const { req, answers, source } = entry;
  title.textContent = `Decision ${index + 1} · ${req.t.toFixed(1)} s`;

  const meta = el("p", "dt-meta");
  const chip = el("span", "source", sourceLabel(source));
  chip.dataset.tone = sourceTone(source);
  meta.append(el("span", "", `${req.unit}, ${reasonLabel(req.reason)}`), chip);
  const nodes: HTMLElement[] = [meta];
  if (source.fallback !== undefined)
    nodes.push(el("p", "dt-fallback", `The brain was not used: ${source.fallback}`));

  const read = el("section", "dt-read");
  read.append(
    el("h3", "", "What the model read"),
    el("pre", "dt-state", serializeState(req.context)),
  );
  nodes.push(read);

  for (const [id, q] of Object.entries(req.questions)) {
    const a = answers[id];
    if (!a) continue;
    const section = el("section", "dt-q");
    const head = el("header", "dt-q-head");
    const scores = el("p", "dt-scores");
    scores.append(el("span", "", `Sure ${percent(a.confidence)}`));
    if (a.answer_confidence !== undefined)
      scores.append(el("span", "", `Top answer ${percent(a.answer_confidence)}`));
    head.append(el("h3", "", questionLabel(id, req)), scores);
    const list = el("ol", "dt-options");
    for (const row of answerRows(q, a)) {
      const li = el("li", row.chosen ? "dt-option chosen" : "dt-option");
      const bar = el("span", "dt-bar");
      bar.style.setProperty("--p", row.p.toFixed(3));
      const track = el("span", "dt-track");
      track.append(bar);
      li.append(el("span", "dt-label", row.label), el("span", "pct", percent(row.p)), track);
      if (row.description) li.append(el("span", "dt-desc", row.description));
      list.append(li);
    }
    section.append(head, el("p", "dt-ask", q.instructions), list);
    nodes.push(section);
  }
  body.replaceChildren(...nodes);
  body.scrollTop = 0;
}

export function createDetails(root: HTMLElement, handlers: DetailsHandlers): Details {
  root.hidden = true;
  root.setAttribute("role", "dialog");
  root.setAttribute("aria-labelledby", "details-title");
  root.tabIndex = -1;
  const head = el("header", "dt-head");
  const title = el("h2", "dt-title");
  title.id = "details-title";
  const close = el("button", "icon-button dt-close");
  close.type = "button";
  close.title = "Close (Esc)";
  close.setAttribute("aria-label", "Close the details");
  close.innerHTML =
    '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5 5l10 10M15 5 5 15"/></svg>';
  close.addEventListener("click", () => handlers.onClose());
  head.append(title, close);
  const body = el("div", "dt-body");
  const foot = el("footer", "dt-foot");
  const prev = el("button", "", "Previous");
  prev.type = "button";
  prev.title = "Previous decision (←)";
  prev.addEventListener("click", () => handlers.onStep(-1));
  const next = el("button", "", "Next");
  next.type = "button";
  next.title = "Next decision (→)";
  next.addEventListener("click", () => handlers.onStep(1));
  foot.append(prev, next);
  root.replaceChildren(head, body, foot);

  window.addEventListener("keydown", (e) => {
    if (root.hidden || e.target instanceof HTMLSelectElement) return;
    if (e.key === "Escape") handlers.onClose();
    else if (e.key === "ArrowLeft") handlers.onStep(-1);
    else if (e.key === "ArrowRight") handlers.onStep(1);
    else return;
    e.preventDefault();
  });

  let shownIndex: number | null = null;
  let shownCount = -1;
  let returnFocus: HTMLElement | null = null;

  return {
    show(history, index) {
      const entry = index === null ? undefined : history.entries[index];
      if (index === null || !entry) {
        if (!root.hidden) {
          root.hidden = true;
          returnFocus?.focus({ preventScroll: true });
          returnFocus = null;
        }
        shownIndex = null;
        return;
      }
      const count = history.entries.length;
      if (index === shownIndex && count === shownCount) return;
      if (index !== shownIndex) render(body, title, entry, index);
      shownIndex = index;
      shownCount = count;
      prev.disabled = index === 0;
      next.disabled = index >= count - 1;
      if (root.hidden) {
        returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        root.hidden = false;
        root.focus({ preventScroll: true });
      }
    },
  };
}
