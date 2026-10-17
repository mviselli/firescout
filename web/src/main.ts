import {
  buildYard,
  CellState,
  createRng,
  get,
  ignite,
  isFlammable,
  N,
  type Rng,
  SIM,
  stepFire,
  stepSmoke,
  type Wind,
  type Yard,
} from "@firescout/sim";
import { createFire } from "./scene/fire";
import { createTerrain } from "./scene/terrain";
import { createView } from "./scene/view";

// UI preview: map, fire and smoke only. The engine, robot and HUD replace this wiring in Task 11.

const COMPASS = [
  "east",
  "south-east",
  "south",
  "south-west",
  "west",
  "north-west",
  "north",
  "north-east",
];
const DIRS: readonly [number, number][] = [
  [1, 0],
  [1, 1],
  [0, 1],
  [-1, 1],
  [-1, 0],
  [-1, -1],
  [0, -1],
  [1, -1],
];

interface Preview {
  seed: number;
  yard: Yard;
  rng: Rng;
  wind: Wind;
  windLabel: string;
  tick: number;
}

function newPreview(seed: number): Preview {
  const rng = createRng(seed);
  const yard = buildYard();
  const d = Math.floor(rng.next() * 8);
  const [dx, dy] = DIRS[d] ?? [1, 0];
  const len = Math.hypot(dx, dy);
  const wind = { dx: dx / len, dy: dy / len, speedKmh: 5 + Math.floor(rng.next() * 26) };
  const candidates: number[] = [];
  for (let i = 0; i < N; i++)
    if (isFlammable(yard.grid, i) && get(yard.grid.fuel, i) >= 0.5) candidates.push(i);
  ignite(yard.grid, candidates[Math.floor(rng.next() * candidates.length)] ?? 0, 0.5);
  // Wind blows *toward* (dx, dy); people name it by where it comes from.
  return {
    seed,
    yard,
    rng,
    wind,
    windLabel: `${COMPASS[(d + 4) % 8]} ${wind.speedKmh} km/h`,
    tick: 0,
  };
}

const stage = document.getElementById("stage") as HTMLElement;
const status = document.getElementById("status") as HTMLElement;
const view = createView(stage);
let p = newPreview(1);
const terrain = createTerrain(view.scene, p.yard);
const fire = createFire(view.scene);
let paused = false;
let acc = 0;
let last = performance.now();

function burning(): number {
  let n = 0;
  for (let i = 0; i < N; i++) if (get(p.yard.grid.state, i) === CellState.Burning) n++;
  return n;
}

function renderStatus(): void {
  const t = (p.tick * SIM.TICK).toFixed(1);
  const n = burning();
  status.innerHTML = `
    <h1>FireScout</h1>
    <p>Fire ${p.seed}, wind from the ${p.windLabel}</p>
    <p>${t} s, ${n} ${n === 1 ? "cell" : "cells"} burning${paused ? ", paused" : ""}</p>
    <p class="keys"><kbd>Space</kbd> pause, <kbd>N</kbd> new fire, <kbd>C</kbd> reset camera</p>`;
}

window.addEventListener("keydown", (e) => {
  if (e.code === "Space") paused = !paused;
  else if (e.code === "KeyN") p = newPreview(p.seed + 1);
  else if (e.code === "KeyC") view.resetCamera();
  else return;
  e.preventDefault();
  renderStatus();
});

view.renderer.setAnimationLoop((now: number) => {
  const dt = Math.min(0.25, (now - last) / 1000);
  last = now;
  if (!paused) {
    acc += dt;
    while (acc >= SIM.TICK) {
      stepFire(p.yard.grid, p.wind, p.rng);
      stepSmoke(p.yard.grid, p.yard.doors);
      p.tick++;
      acc -= SIM.TICK;
    }
  }
  terrain.update(p.yard);
  fire.update(p.yard.grid, now / 1000);
  if (p.tick % 5 === 0) renderStatus();
  view.render();
});
renderStatus();
