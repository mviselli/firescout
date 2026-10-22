import type { GameHistory } from "../history";
import { el } from "./dom";
import {
  entryChosenP,
  entryConfidence,
  entrySummary,
  mainQuestion,
  percent,
  sourceTone,
} from "./labels";
import { sparkTop } from "./spark";
import { burnPath, nearestEntry, type TimeScale, timelineSpan, timeScale } from "./timeline-scale";

export interface Timeline {
  update(
    history: GameHistory,
    t: number,
    opts: { replayEnd: number | null; selected: number | null },
  ): void;
}

export interface TimelineHandlers {
  onSelect(index: number): void;
  /** Only set in replay mode; called on click and on drag release. */
  onSeek?(t: number): void;
}

const SVG_NS = "http://www.w3.org/2000/svg";
/** SVG height, the marks' baseline, and the room the marks and the clock labels take. */
const H = 88;
const BASE = 66;
const MARK_MIN = 8;
const MARK_MAX = 54;
/** Inner margin so the first and last marks are not clipped. */
const PAD = 8;
/** A click this many pixels from a mark selects it. */
const HIT_PX = 6;
/** Grab the playhead within this many pixels. */
const GRAB_PX = 9;
/** Clock labels at the first of these steps that leaves this much room between them. */
const LABEL_STEPS = [5, 10, 15, 30, 60, 120, 300, 600];
/** Live, the span grows in 30 s steps, so labels stay at 30 s or more; a short replay goes finer. */
const LIVE_MIN_STEP = 30;
const LABEL_ROOM = 52;

const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;
const r1 = (v: number) => Math.round(v * 10) / 10;

function svg<K extends keyof SVGElementTagNameMap>(tag: K, cls: string): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG_NS, tag);
  node.setAttribute("class", cls);
  return node;
}

/** One strip: the burned area behind, a mark per decision, the playhead on top. */
export function createTimeline(root: HTMLElement, handlers: TimelineHandlers): Timeline {
  const chart = svg("svg", "tl");
  chart.setAttribute("role", "img");
  chart.setAttribute("aria-label", "Decisions and the burned area over time");
  const grid = svg("g", "tl-grid");
  const area = svg("path", "tl-burn");
  const edge = svg("path", "tl-burn-edge");
  const scaleLabel = svg("text", "tl-scale");
  scaleLabel.setAttribute("y", "11");
  scaleLabel.setAttribute("text-anchor", "end");
  const marks = svg("g", "tl-marks");
  const ghost = svg("line", "tl-ghost");
  ghost.setAttribute("y1", "0");
  ghost.setAttribute("y2", String(BASE + 2));
  ghost.style.display = "none";
  const head = svg("g", "tl-head");
  const headLine = svg("line", "tl-head-line");
  headLine.setAttribute("y1", "0");
  headLine.setAttribute("y2", String(BASE + 2));
  const knob = svg("circle", "tl-knob");
  knob.setAttribute("cy", "4");
  knob.setAttribute("r", "4");
  head.append(headLine, knob);
  chart.append(grid, area, edge, scaleLabel, marks, ghost, head);
  const tip = el("p", "tl-tip");
  tip.hidden = true;
  root.replaceChildren(chart, tip);

  let width = 0;
  let scale: TimeScale = timeScale(60, 0);
  let history: GameHistory | null = null;
  let replay = false;
  let headX = -1;
  let dragging = false;
  let shownKey = "";

  const observer = new ResizeObserver(() => {
    width = Math.max(0, Math.floor(root.clientWidth));
    chart.setAttribute("viewBox", `0 0 ${width} ${H}`);
    shownKey = "";
  });
  observer.observe(root);

  const localX = (e: PointerEvent) => e.clientX - chart.getBoundingClientRect().left - PAD;
  const hitDt = () => scale.t(HIT_PX) - scale.t(0);

  function hovered(x: number): number | null {
    return history ? nearestEntry(history.entries, scale.t(x), hitDt()) : null;
  }

  function showTip(x: number, index: number | null): void {
    const entry = index === null ? undefined : history?.entries[index];
    if (!entry) {
      tip.hidden = true;
      return;
    }
    tip.textContent = `${entry.req.t.toFixed(1)} s · ${entrySummary(entry)} · ${percent(entryChosenP(entry))}`;
    tip.hidden = false;
    // Keep the tip inside the strip.
    const half = tip.offsetWidth / 2;
    const left = Math.min(Math.max(PAD + x, half), width - half);
    tip.style.left = `${left}px`;
  }

  chart.addEventListener("pointermove", (e) => {
    const x = localX(e);
    if (dragging) {
      ghost.setAttribute("x1", String(r1(PAD + Math.min(Math.max(x, 0), width - 2 * PAD))));
      ghost.setAttribute("x2", ghost.getAttribute("x1") ?? "0");
      tip.textContent = `${scale.t(x).toFixed(1)} s`;
      tip.hidden = false;
      return;
    }
    const near = replay && Math.abs(x + PAD - headX) <= GRAB_PX;
    chart.dataset.cursor = near ? "grab" : hovered(x) !== null || replay ? "pointer" : "";
    showTip(x, hovered(x));
  });
  chart.addEventListener("pointerleave", () => {
    if (!dragging) tip.hidden = true;
  });
  chart.addEventListener("pointerdown", (e) => {
    const x = localX(e);
    if (!replay || Math.abs(x + PAD - headX) > GRAB_PX) return;
    dragging = true;
    chart.setPointerCapture(e.pointerId);
    ghost.style.display = "";
    e.preventDefault();
  });
  chart.addEventListener("pointerup", (e) => {
    const x = localX(e);
    if (dragging) {
      // Seek only on release: a seek backwards re-simulates from the start.
      dragging = false;
      ghost.style.display = "none";
      tip.hidden = true;
      handlers.onSeek?.(scale.t(x));
      return;
    }
    const index = hovered(x);
    if (index !== null) handlers.onSelect(index);
    else if (replay) handlers.onSeek?.(scale.t(x));
  });
  chart.addEventListener("pointercancel", () => {
    dragging = false;
    ghost.style.display = "none";
  });

  function drawGrid(span: number): void {
    const plotW = width - 2 * PAD;
    const minStep = replay ? 0 : LIVE_MIN_STEP;
    const step =
      LABEL_STEPS.find((s) => s >= minStep && (s / span) * plotW >= LABEL_ROOM) ??
      LABEL_STEPS.at(-1) ??
      30;
    const parts: string[] = [];
    for (let s = 0; s <= span + 1e-9; s += step) {
      const x = r1(PAD + scale.x(s));
      const anchor = s === 0 ? "start" : x > width - 18 ? "end" : "middle";
      parts.push(
        `<line class="tl-tick" x1="${x}" x2="${x}" y1="${BASE - MARK_MAX}" y2="${BASE + 3}"/>`,
        `<text class="tl-time" x="${x}" y="${H - 4}" text-anchor="${anchor}">${clock(s)}</text>`,
      );
    }
    parts.push(`<line class="tl-base" x1="0" x2="${width}" y1="${BASE}" y2="${BASE}"/>`);
    grid.innerHTML = parts.join("");
  }

  function drawMarks(h: GameHistory, t: number, selected: number | null): void {
    const parts: string[] = [];
    h.entries.forEach((entry, k) => {
      const x = r1(PAD + scale.x(entry.req.t));
      const top = r1(BASE - MARK_MIN - entryConfidence(entry) * (MARK_MAX - MARK_MIN));
      const door = mainQuestion(entry) === "door_safe";
      const cls = `tl-mark${entry.req.t > t ? " ahead" : ""}`;
      const tone = sourceTone(entry.source);
      parts.push(`<g class="${cls}" data-tone="${tone}">`);
      if (k === selected)
        parts.push(
          `<rect class="tl-selected" x="${r1(x - 5)}" y="${r1(top - 6)}" width="10" height="${r1(BASE - top + 8)}" rx="5"/>`,
        );
      parts.push(`<line x1="${x}" x2="${x}" y1="${BASE}" y2="${top}"/>`);
      // Door calls carry a diamond head, so they stand out from routine moves.
      if (door)
        parts.push(
          `<path class="tl-door" d="M${x},${r1(top - 4.5)}l4.5,4.5l-4.5,4.5l-4.5,-4.5z"/>`,
        );
      parts.push("</g>");
    });
    marks.innerHTML = parts.join("");
  }

  return {
    update(h, t, opts) {
      history = h;
      replay = opts.replayEnd !== null && handlers.onSeek !== undefined;
      chart.toggleAttribute("data-replay", replay);
      const span = timelineSpan(t, opts.replayEnd);
      scale = timeScale(span, Math.max(0, width - 2 * PAD));
      const x = Math.round(PAD + scale.x(t));
      // In a replay the playhead splits marks into seen and ahead; the split moves with it.
      const ahead = replay ? h.entries.findIndex((e) => e.req.t > t) : -1;
      const key = `${h.version}|${span}|${opts.selected}|${width}|${ahead}|${replay}`;
      if (key !== shownKey) {
        shownKey = key;
        drawGrid(span);
        const top = sparkTop(h.samples);
        const line = burnPath(h.samples, scale, BASE, top);
        const end = r1(scale.x(h.samples.at(-1)?.t ?? 0));
        area.setAttribute("d", line ? `${line}L${end},${BASE}L0,${BASE}Z` : "");
        edge.setAttribute("d", line);
        area.setAttribute("transform", `translate(${PAD} 0)`);
        edge.setAttribute("transform", `translate(${PAD} 0)`);
        scaleLabel.setAttribute("x", String(width - PAD));
        scaleLabel.textContent = `Burned area, 0–${top}% scale`;
        drawMarks(h, t, opts.selected);
      }
      if (x !== headX) {
        headX = x;
        head.setAttribute("transform", `translate(${x} 0)`);
        // The scale label sits top-right; let the playhead pass in front of it.
        const labelLeft = width - PAD - scaleLabel.getComputedTextLength() - 6;
        scaleLabel.classList.toggle("under", x >= labelLeft);
      }
    },
  };
}
