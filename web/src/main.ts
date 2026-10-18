import { BaselinePolicy, Engine, type Wind } from "@firescout/sim";
import { createPanel, type LastDecision } from "./hud/panel";
import { GameLoop } from "./loop";
import { createFire } from "./scene/fire";
import { createRobotView } from "./scene/robot";
import { createTerrain } from "./scene/terrain";
import { createView } from "./scene/view";

const stage = document.getElementById("stage") as HTMLElement;
const panelRoot = document.getElementById("panel") as HTMLElement;
const view = createView(stage);
const policy = new BaselinePolicy();

let seed = 1;
/** Bearing the wind blows from, chosen in the panel; null keeps the seed's own wind. */
let windFromDeg: number | null = null;
let speed = 1;
let loop = newLoop();
let lastDecision: LastDecision | null = null;

const terrain = createTerrain(view.scene, loop.engine.world);
const fire = createFire(view.scene);
const robotView = createRobotView(view.scene);

function newLoop(): GameLoop {
  let wind: Wind | undefined;
  if (windFromDeg !== null) {
    const rad = (windFromDeg * Math.PI) / 180;
    // Blows toward the opposite bearing; y grows southward on the grid.
    wind = { dx: -Math.sin(rad), dy: Math.cos(rad), speedKmh: 15 };
  }
  const engine = new Engine(wind ? { seed, wind } : { seed });
  const next = new GameLoop(engine, policy, { speed });
  next.onDecision = (req, answers) => {
    if (loop === next) lastDecision = { req, answers };
  };
  return next;
}

function restart(): void {
  loop = newLoop();
  lastDecision = null;
}

const panel = createPanel(panelRoot, {
  onPause() {
    loop.paused = !loop.paused;
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
    loop.speed = x;
  },
});

window.addEventListener("keydown", (e) => {
  if (e.target instanceof HTMLSelectElement || e.target instanceof HTMLButtonElement) return;
  if (e.code === "Space") loop.paused = !loop.paused;
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
  loop.advance(dt);
  const { world } = loop.engine;
  terrain.update(world);
  fire.update(world.grid, now / 1000);
  robotView.update(world.robot, Math.min(dt, 0.25), now / 1000);
  panel.update(world, lastDecision, {
    seed,
    paused: loop.paused,
    ended: loop.engine.ended,
    speed: loop.speed,
    error: loop.error,
  });
  view.render();
});
