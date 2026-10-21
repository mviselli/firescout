import { RemotePolicy } from "@firescout/brain-client";
import { BaselinePolicy, type DecisionSource, type Policy, type Wind } from "@firescout/sim";
import { policyBadge, sourceFromMeta } from "./hud/badge";
import { createPanel, type PolicyChoice } from "./hud/panel";
import { createFire } from "./scene/fire";
import { createRobotView } from "./scene/robot";
import { createTerrain } from "./scene/terrain";
import { createView } from "./scene/view";
import { LiveSession } from "./session";

const stage = document.getElementById("stage") as HTMLElement;
const panelRoot = document.getElementById("panel") as HTMLElement;
const view = createView(stage);
const baseline = new BaselinePolicy();
// One brain connection for the page's lifetime; it falls back to the rules while the brain is away.
const brain = new RemotePolicy({
  url: import.meta.env.VITE_BRAIN_URL ?? "ws://127.0.0.1:8765/ws",
  fallback: baseline,
});
let policyChoice: PolicyChoice = "brain";

function currentPolicy(): Policy {
  return policyChoice === "brain" ? brain : baseline;
}

let seed = 1;
/** Bearing the wind blows from, chosen in the panel; null keeps the seed's own wind. */
let windFromDeg: number | null = null;
let speed = 1;
let session = newSession();

const terrain = createTerrain(view.scene, session.loop.engine.world);
const fire = createFire(view.scene);
const robotView = createRobotView(view.scene);

/** Who answered the decision that just resolved. */
function currentSource(): DecisionSource {
  if (policyChoice === "baseline") return { backend: "baseline" };
  return brain.lastMeta ? sourceFromMeta(brain.lastMeta) : { backend: "brain" };
}

function newSession(): LiveSession {
  let wind: Wind | undefined;
  if (windFromDeg !== null) {
    const rad = (windFromDeg * Math.PI) / 180;
    // Blows toward the opposite bearing; y grows southward on the grid.
    wind = { dx: -Math.sin(rad), dy: Math.cos(rad), speedKmh: 15 };
  }
  return new LiveSession({
    engine: wind ? { seed, wind } : { seed },
    policy: currentPolicy(),
    policyChoice,
    speed,
    sourceOf: currentSource,
  });
}

function restart(): void {
  // The old session's in-flight answer, if any, is dropped with it.
  session.dispose();
  session = newSession();
}

const panel = createPanel(panelRoot, {
  onPause() {
    session.loop.paused = !session.loop.paused;
  },
  onNewSeed() {
    // Only the sim must be deterministic; picking the next seed is a UI choice.
    seed = 1 + Math.floor(Math.random() * 9999);
    restart();
  },
  onWind(dirDeg) {
    windFromDeg = dirDeg;
    restart();
  },
  onSpeed(x) {
    speed = x;
    session.loop.speed = x;
  },
  onPolicy(choice) {
    // Same seed, so the two policies can be compared on the same fire.
    policyChoice = choice;
    restart();
  },
});

window.addEventListener("keydown", (e) => {
  if (e.target instanceof HTMLSelectElement || e.target instanceof HTMLButtonElement) return;
  if (e.code === "Space") session.loop.paused = !session.loop.paused;
  else if (e.code === "KeyN") {
    seed = 1 + Math.floor(Math.random() * 9999);
    restart();
  } else if (e.code === "KeyC") view.resetCamera();
  else return;
  e.preventDefault();
});

let last = performance.now();
view.renderer.setAnimationLoop((now: number) => {
  const dt = (now - last) / 1000;
  last = now;
  session.advance(dt);
  const { loop, history } = session;
  const { world } = loop.engine;
  terrain.update(world);
  fire.update(world.grid, now / 1000);
  robotView.update(world.robot, Math.min(dt, 0.25), now / 1000);
  const badge = policyBadge(policyChoice, history.last?.source ?? null);
  panel.update(world, history.last, {
    seed,
    paused: loop.paused,
    ended: loop.engine.ended,
    speed: loop.speed,
    error: loop.error,
    policyChoice,
    policy: badge.text,
    policyTone: badge.tone,
    ...(badge.detail === undefined ? {} : { policyDetail: badge.detail }),
  });
  view.render();
});
