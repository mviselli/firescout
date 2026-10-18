import {
  type Answer,
  type Answers,
  CellState,
  type DecisionRequest,
  get,
  N,
  savedFraction,
  simTime,
  type World,
} from "@firescout/sim";

export interface PanelHandlers {
  onPause(): void;
  onNewSeed(): void;
  /** Compass bearing the wind blows from (0 = north, clockwise), or null for the seed's own wind. */
  onWind(dirDeg: number | null): void;
  onSpeed(x: number): void;
}

export interface LastDecision {
  req: DecisionRequest;
  answers: Answers;
}

export interface PanelStatus {
  seed: number;
  paused: boolean;
  ended: boolean;
  speed: number;
  /** Why the last decision failed; the game waits until a retry succeeds. */
  error: string | null;
}

export interface Panel {
  update(world: World, lastDecision: LastDecision | null, status: PanelStatus): void;
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
const SPEEDS = [0.5, 1, 2, 4];

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** Bearing (0 = north) the wind blows from, given the direction it blows toward. */
function windFrom(world: World): string {
  const toward = (Math.atan2(world.wind.dx, -world.wind.dy) * 180) / Math.PI;
  const from = WIND_FROM[(Math.round(toward / 45) + 4 + 8) % 8];
  return `From the ${from}, ${world.wind.speedKmh} km/h`;
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

function questionLabel(id: string, req: DecisionRequest): string {
  if (id === "action") return "Next move";
  if (id === "door_safe") return `Is door ${req.context.door?.id ?? ""} safe to open?`;
  if (id.startsWith("agent_")) return `Agent for ${id.slice("agent_".length)}`;
  return id;
}

function optionLabel(label: string): string {
  if (label.startsWith("attack_")) return `Attack ${label.slice("attack_".length)}`;
  if (label === "wait") return "Hold";
  return label.charAt(0).toUpperCase() + label.slice(1);
}

const REASONS: Record<string, string> = {
  start: "first call",
  cadence: "routine check",
  door: "closed door ahead",
  tank_empty: "tank empty",
  blocked: "path blocked",
  task_done: "sector put out",
  refilled: "tanks full",
};

/** Top-3 options as bars; the chosen one is highlighted. */
function answerRows(a: Answer): { label: string; p: number; chosen: boolean }[] {
  if (a.type === "noul") {
    const yes = a.noul >= 0.5;
    return [
      { label: "Yes", p: a.noul, chosen: yes },
      { label: "No", p: 1 - a.noul, chosen: !yes },
    ];
  }
  const chosen = a.type === "choice" ? a.choice : null;
  return Object.entries(a.probabilities)
    .sort((x, y) => y[1] - x[1])
    .slice(0, 3)
    .map(([label, p]) => ({ label: optionLabel(label), p, chosen: label === chosen }));
}

function renderDecision(box: HTMLElement, d: LastDecision): void {
  box.replaceChildren();
  const head = el("p", "decision-head");
  head.append(
    el("span", "decision-t", `${d.req.t.toFixed(1)} s`),
    el("span", "", ` R1, ${REASONS[d.req.reason] ?? d.req.reason}`),
  );
  box.append(head);
  for (const [id, a] of Object.entries(d.answers)) {
    const q = el("div", "question");
    q.append(el("p", "question-label", questionLabel(id, d.req)));
    for (const row of answerRows(a)) {
      const r = el("div", row.chosen ? "option chosen" : "option");
      const bar = el("span", "bar");
      bar.style.setProperty("--p", row.p.toFixed(3));
      r.append(
        el("span", "option-label", row.label),
        bar,
        el("span", "pct", `${Math.round(row.p * 100)}%`),
      );
      q.append(r);
    }
    box.append(q);
  }
}

function tank(label: string, kind: string): { root: HTMLElement; set(v: number): void } {
  const root = el("div", `tank ${kind}`);
  const fill = el("span", "tank-fill");
  const value = el("span", "tank-value");
  const track = el("span", "tank-track");
  track.append(fill);
  root.append(el("span", "tank-label", label), track, value);
  return {
    root,
    set(v) {
      fill.style.setProperty("--p", (v / 100).toFixed(3));
      value.textContent = `${Math.round(v)}%`;
    },
  };
}

export function createPanel(root: HTMLElement, handlers: PanelHandlers): Panel {
  root.replaceChildren();

  const header = el("header", "panel-head");
  const title = el("h1", "", "FireScout");
  const fireName = el("p", "fire-name");
  header.append(title, fireName);

  const clock = el("p", "clock");
  const stats = el("p", "stats");
  const wind = el("p", "wind");

  const controls = el("div", "controls");
  const pause = el("button", "", "Pause");
  pause.type = "button";
  pause.addEventListener("click", () => handlers.onPause());
  const newFire = el("button", "", "New fire");
  newFire.type = "button";
  newFire.addEventListener("click", () => handlers.onNewSeed());
  controls.append(pause, newFire);

  const windField = el("label", "field");
  const windSelect = el("select");
  windSelect.append(el("option", "", "Wind from the seed"));
  windSelect.options[0]?.setAttribute("value", "");
  WIND_FROM.forEach((name, k) => {
    const o = el("option", "", `Wind from the ${name}`);
    o.value = String(k * 45);
    windSelect.append(o);
  });
  windSelect.addEventListener("change", () =>
    handlers.onWind(windSelect.value === "" ? null : Number(windSelect.value)),
  );
  windField.append(windSelect);

  const speedGroup = el("div", "speeds");
  speedGroup.setAttribute("role", "group");
  speedGroup.setAttribute("aria-label", "Speed");
  const speedButtons = SPEEDS.map((x) => {
    const b = el("button", "", `${x}×`);
    b.type = "button";
    b.addEventListener("click", () => handlers.onSpeed(x));
    speedGroup.append(b);
    return { x, b };
  });

  const unit = el("section", "unit");
  const unitName = el("h2", "", "R1 ground robot");
  const task = el("p", "task");
  const water = tank("Water", "water");
  const foam = tank("Foam", "foam");
  unit.append(unitName, task, water.root, foam.root);

  const decision = el("section", "decision");
  decision.setAttribute("aria-live", "polite");
  const decisionTitle = el("h2", "", "Last decision");
  const decisionError = el("p", "decision-error");
  decisionError.setAttribute("role", "alert");
  decisionError.hidden = true;
  const decisionBody = el("div", "decision-body");
  decisionBody.append(el("p", "empty", "Waiting for R1's first call."));
  decision.append(decisionTitle, decisionError, decisionBody);

  const keys = el("p", "keys", "Space pauses, N starts a new fire, C resets the camera.");

  root.append(header, clock, stats, wind, controls, windField, speedGroup, unit, decision, keys);

  let shownDecision: LastDecision | null = null;

  return {
    update(world, lastDecision, status) {
      fireName.textContent = `Fire ${status.seed}, baseline rules`;
      const t = simTime(world);
      clock.textContent = status.ended
        ? `Over at ${t.toFixed(1)} s`
        : `${t.toFixed(1)} s${status.paused ? ", paused" : ""}`;

      let burning = 0;
      for (let i = 0; i < N; i++) if (get(world.grid.state, i) === CellState.Burning) burning++;
      const burned = Math.round((1 - savedFraction(world)) * 100);
      stats.textContent = `${burned}% of the site burned, ${burning} ${burning === 1 ? "cell" : "cells"} on fire`;
      wind.textContent = windFrom(world);

      pause.textContent = status.paused ? "Resume" : "Pause";
      pause.disabled = status.ended;
      for (const { x, b } of speedButtons)
        b.setAttribute("aria-pressed", String(x === status.speed));

      task.textContent = taskLabel(world);
      water.set(world.robot.water);
      foam.set(world.robot.foam);

      decisionError.hidden = status.error === null;
      decisionError.textContent = status.error
        ? `The game is waiting: R1's decision failed (${status.error}). Asking again shortly.`
        : "";

      if (lastDecision !== shownDecision) {
        shownDecision = lastDecision;
        if (lastDecision) renderDecision(decisionBody, lastDecision);
        else decisionBody.replaceChildren(el("p", "empty", "Waiting for R1's first call."));
      }
    },
  };
}
