import {
  CellState,
  type DecisionRequest,
  get,
  N,
  savedFraction,
  simTime,
  type World,
} from "@firescout/sim";
import type { GameHistory } from "../history";
import type { Theme } from "../theme";
import { createDecisionView } from "./decision-view";
import { el, setText } from "./dom";
import { entryChosenP, entrySummary, percent, sourceLabel, sourceTone } from "./labels";

export interface PanelHandlers {
  onPause(): void;
  onNewSeed(): void;
  /** Compass bearing the wind blows from (0 = north, clockwise), or null for the seed's own wind. */
  onWind(dirDeg: number | null): void;
  onSpeed(x: number): void;
  onPolicy(policy: PolicyChoice): void;
  onTheme(): void;
  /** A log row was clicked: the index into the history's entries. */
  onOpenDecision(index: number): void;
  /** Missing until replay is wired; the button is then disabled. */
  onReplay?(): void;
  onOpenFile?(file: File): void;
}

export type PolicyChoice = "brain" | "baseline";

/** Who answered the last decision: the brain, the fallback rules, the chosen rules, or nobody yet. */
export type PolicyTone = "brain" | "fallback" | "rules" | "waiting";

export interface PanelStatus {
  seed: number;
  paused: boolean;
  ended: boolean;
  speed: number;
  /** Why the last decision failed; the game waits until a retry succeeds. */
  error: string | null;
  policyChoice: PolicyChoice;
  /** Badge text, e.g. "Laya · 94 ms" or "Brain offline, baseline rules". */
  policy: string;
  policyTone: PolicyTone;
  /** Why the brain was not used for the last decision (badge tooltip). */
  policyDetail?: string;
  /** The request in flight, if any. */
  pending: DecisionRequest | null;
  /** Entries [0, upTo) are shown: all of them live, those up to the playhead in a replay. */
  upTo: number;
  theme: Theme;
}

export interface Panel {
  update(world: World, history: GameHistory, status: PanelStatus): void;
}

const WIND_FROM = [
  "north",
  "north-east",
  "east",
  "south-east",
  "south",
  "south-west",
  "west",
  "north-west",
];
const WIND_SHORT = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
const SPEEDS = [0.5, 1, 2, 4];
/** The log scrolls, so it can hold a good stretch of the game. */
const LOG_ROWS = 40;

/** Index (0 = north, clockwise in 45° steps) of the bearing the wind blows from. */
function windFromIndex(world: World): number {
  const toward = (Math.atan2(world.wind.dx, -world.wind.dy) * 180) / Math.PI;
  return (Math.round(toward / 45) + 4 + 8) % 8;
}

function taskLabel(world: World): string {
  const { robot } = world;
  if (robot.stunned > 0) return "Stunned by a backdraft";
  if (robot.doorAhead) return `At door ${robot.doorAhead}`;
  const t = robot.task;
  if (t.kind === "attack") return `Attacking ${t.sector} with ${t.agent}`;
  if (t.kind === "refill") return "Going back to refill";
  return "Holding position";
}

function tank(label: string, kind: string): { root: HTMLElement; set(v: number): void } {
  const root = el("div", `tank ${kind}`);
  const fill = el("span", "tank-fill");
  const value = el("span", "tank-value");
  const track = el("span", "tank-track");
  track.append(fill);
  root.append(el("span", "tank-label", label), value, track);
  return {
    root,
    set(v) {
      fill.style.setProperty("--p", (v / 100).toFixed(3));
      setText(value, `${Math.round(v)}%`);
    },
  };
}

/** One big figure with a small word after it: "4% burned". */
function figure(word: string): {
  root: HTMLElement;
  set(value: string): void;
  setWord(word: string): void;
} {
  const root = el("p", "figure");
  const value = el("b");
  const label = el("span", "", word);
  root.append(value, label);
  return { root, set: (v) => setText(value, v), setWord: (w) => setText(label, w) };
}

function button(text: string, onClick: () => void): HTMLButtonElement {
  const b = el("button", "", text);
  b.type = "button";
  b.addEventListener("click", onClick);
  return b;
}

/** Where the HUD lives: the top bar, the status card's readout, and the unit board. */
export interface PanelRoots {
  top: HTMLElement;
  status: HTMLElement;
  board: HTMLElement;
}

/** Sun and moon, drawn on a 20-unit grid; the button shows the theme it switches to. */
const SUN =
  '<circle cx="10" cy="10" r="3.6"/><path d="M10 1.5v2.4M10 16.1v2.4M1.5 10h2.4M16.1 10h2.4M4 4l1.7 1.7M14.3 14.3 16 16M4 16l1.7-1.7M14.3 5.7 16 4"/>';
const MOON = '<path d="M16.5 12.6A7 7 0 0 1 7.4 3.5a7 7 0 1 0 9.1 9.1Z"/>';

const SVG_NS = "http://www.w3.org/2000/svg";

export function createPanel(roots: PanelRoots, handlers: PanelHandlers): Panel {
  // Header: name, fire, who decides, and who answered last.
  const header = el("div", "board-head");
  const brand = el("div", "brand");
  const fireName = el("p", "fire-name");
  brand.append(el("h1", "", "FireScout"), fireName);
  const policySelect = el("select", "policy-select");
  policySelect.setAttribute("aria-label", "Who decides for R1");
  for (const [value, label] of [
    ["brain", "Laya decides"],
    ["baseline", "Rules decide"],
  ] as const) {
    const o = el("option", "", label);
    o.value = value;
    policySelect.append(o);
  }
  policySelect.addEventListener("change", () =>
    handlers.onPolicy(policySelect.value === "baseline" ? "baseline" : "brain"),
  );
  const badge = el("p", "policy-badge");
  badge.setAttribute("aria-live", "polite");
  header.append(brand, policySelect, badge);

  // Readout: the clock and the fire's extent.
  const readout = el("div", "readout");
  const clockRow = el("p", "clock");
  const clock = el("span", "clock-t");
  const clockState = el("span", "clock-state");
  clockRow.append(clock, clockState);
  const burned = figure("burned");
  const burning = figure("on fire");
  const wind = figure("");
  wind.root.classList.add("wind");
  const figures = el("div", "figures");
  figures.append(burned.root, burning.root, wind.root);
  readout.append(clockRow, figures);

  // Controls.
  const controls = el("div", "controls");
  const pause = button("Pause", () => handlers.onPause());
  const newFire = button("New fire", () => handlers.onNewSeed());
  const replay = button("Replay", () => handlers.onReplay?.());
  replay.disabled = handlers.onReplay === undefined;
  const fileInput = el("input");
  fileInput.type = "file";
  fileInput.accept = ".json,application/json";
  fileInput.hidden = true;
  fileInput.addEventListener("change", () => {
    const file = fileInput.files?.[0];
    if (file) handlers.onOpenFile?.(file);
    fileInput.value = "";
  });
  const theme = button("", () => handlers.onTheme());
  theme.classList.add("icon-button");
  const themeIcon = document.createElementNS(SVG_NS, "svg");
  themeIcon.setAttribute("viewBox", "0 0 20 20");
  themeIcon.setAttribute("aria-hidden", "true");
  theme.append(themeIcon);
  let shownTheme = "";
  const open = button("Open…", () => fileInput.click());
  open.title = "Open a saved replay";
  open.disabled = handlers.onOpenFile === undefined;
  const actions = el("div", "actions");
  actions.append(pause, newFire, replay, open, fileInput);

  const windSelect = el("select", "wind-select");
  windSelect.setAttribute("aria-label", "Wind");
  windSelect.title = "Where the wind blows from";
  windSelect.append(el("option", "", "Wind: seed"));
  windSelect.options[0]?.setAttribute("value", "");
  WIND_FROM.forEach((name, k) => {
    const o = el("option", "", `Wind: ${WIND_SHORT[k]}`);
    o.value = String(k * 45);
    o.title = `Wind from the ${name}`;
    windSelect.append(o);
  });
  windSelect.addEventListener("change", () =>
    handlers.onWind(windSelect.value === "" ? null : Number(windSelect.value)),
  );
  const speedGroup = el("div", "speeds");
  speedGroup.setAttribute("role", "group");
  speedGroup.setAttribute("aria-label", "Speed");
  const speedButtons = SPEEDS.map((x) => {
    const b = button(`${x}×`, () => handlers.onSpeed(x));
    speedGroup.append(b);
    return { x, b };
  });
  const tuning = el("div", "tuning");
  tuning.append(windSelect, speedGroup, theme);
  controls.append(actions, tuning);

  // The unit: its tag, what it is doing, its tanks, and its decision.
  const unit = el("section", "unit");
  unit.setAttribute("aria-label", "R1 ground robot");
  const unitHead = el("header", "unit-head");
  const task = el("p", "task");
  unitHead.append(el("span", "unit-tag", "R1"), el("h2", "", "Ground robot"), task);
  const water = tank("Water", "water");
  const foam = tank("Foam", "foam");
  const tanks = el("div", "tanks");
  tanks.append(water.root, foam.root);
  const decisionError = el("p", "decision-error");
  decisionError.setAttribute("role", "alert");
  decisionError.hidden = true;
  const decision = createDecisionView();
  decision.root.setAttribute("aria-live", "polite");
  unit.append(unitHead, tanks, decisionError, decision.root);

  // Radio log: the latest decisions, newest first.
  const log = el("section", "log");
  const logHead = el("header", "log-head");
  const logCount = el("span", "log-count");
  logHead.append(el("h2", "", "Radio log"), logCount);
  const logList = el("ol", "log-list");
  log.append(logHead, logList);

  const keys = el(
    "p",
    "keys",
    "Space pauses, N starts a new fire, C resets the camera, T switches the theme.",
  );

  roots.top.replaceChildren(header, controls);
  roots.status.replaceChildren(readout);
  roots.board.replaceChildren(unit, log, keys);

  let shownKey = "";

  function renderLog(history: GameHistory, upTo: number): void {
    const rows: HTMLElement[] = [];
    for (let k = upTo - 1; k >= Math.max(0, upTo - LOG_ROWS); k--) {
      const entry = history.entries[k];
      if (!entry) continue;
      const b = el("button", "log-row");
      b.type = "button";
      b.dataset.tone = sourceTone(entry.source);
      b.title = `${sourceLabel(entry.source)}. Open the details.`;
      b.append(
        el("span", "log-t", entry.req.t.toFixed(1)),
        el("span", "log-unit", entry.req.unit),
        el("span", "log-what", entrySummary(entry)),
        el("span", "log-conf", percent(entryChosenP(entry))),
      );
      b.addEventListener("click", () => handlers.onOpenDecision(k));
      const li = el("li");
      li.append(b);
      rows.push(li);
    }
    if (rows.length === 0) {
      const li = el("li", "empty", "No calls yet.");
      rows.push(li);
    }
    logList.replaceChildren(...rows);
    setText(logCount, upTo === 1 ? "1 call" : `${upTo} calls`);
  }

  return {
    update(world, history, status) {
      setText(fireName, `Fire ${status.seed}`);
      if (policySelect.value !== status.policyChoice) policySelect.value = status.policyChoice;
      setText(badge, status.policy);
      badge.dataset.tone = status.policyTone;
      badge.title = status.policyDetail ?? "";

      setText(clock, `${simTime(world).toFixed(1)} s`);
      setText(clockState, status.ended ? "Over" : status.paused ? "Paused" : "");
      let cells = 0;
      for (let i = 0; i < N; i++) if (get(world.grid.state, i) === CellState.Burning) cells++;
      burned.set(`${Math.round((1 - savedFraction(world)) * 100)}%`);
      burning.set(String(cells));
      const w = windFromIndex(world);
      wind.set(`${world.wind.speedKmh} km/h`);
      wind.setWord(`from ${WIND_SHORT[w]}`);
      wind.root.title = `Wind from the ${WIND_FROM[w]}`;

      if (status.theme !== shownTheme) {
        shownTheme = status.theme;
        const next = status.theme === "dark" ? "light" : "dark";
        themeIcon.innerHTML = next === "light" ? SUN : MOON;
        theme.title = `Switch to the ${next} theme (T)`;
        theme.setAttribute("aria-label", `Switch to the ${next} theme`);
      }
      setText(pause, status.paused ? "Resume" : "Pause");
      pause.disabled = status.ended;
      for (const { x, b } of speedButtons)
        b.setAttribute("aria-pressed", String(x === status.speed));

      setText(task, taskLabel(world));
      water.set(world.robot.water);
      foam.set(world.robot.foam);

      decisionError.hidden = status.error === null;
      setText(
        decisionError,
        status.error
          ? `The game is waiting: R1's decision failed (${status.error}). Asking again shortly.`
          : "",
      );

      // Redraw the decision and the log only when a decision lands or one starts.
      const key = `${history.entries.length}|${status.upTo}|${status.pending?.id ?? ""}`;
      if (key !== shownKey) {
        shownKey = key;
        decision.show(history.entries[status.upTo - 1] ?? null, status.pending);
        renderLog(history, status.upTo);
      }
    },
  };
}
