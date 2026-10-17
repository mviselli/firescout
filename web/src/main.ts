import {
  CellState,
  CellType,
  createWorld,
  doorInnerSmoke,
  get,
  holdDoor,
  N,
  openDoor,
  type RobotEvent,
  SIM,
  sectorOf,
  setTask,
  simTime,
  stepFire,
  stepSmoke,
  tickRobot,
  type World,
  xy,
} from "@firescout/sim";
import { createFire } from "./scene/fire";
import { createRobotView } from "./scene/robot";
import { createTerrain } from "./scene/terrain";
import { createView } from "./scene/view";

// UI preview. A throwaway crew-chief rule drives R1 until the engine and baseline policy
// (Tasks 6–8) replace it; the GameLoop and HUD replace this whole file in Task 11.

const CADENCE_TICKS = 8;
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

function windLabel(world: World): string {
  const deg = (Math.atan2(world.wind.dy, world.wind.dx) * 180) / Math.PI;
  const from = COMPASS[(Math.round(deg / 45) + 4 + 8) % 8];
  return `${from} ${world.wind.speedKmh} km/h`;
}

/** Hottest sector, discounted by distance; foam if it is mostly paint. */
function previewDecision(world: World): void {
  const { robot, grid } = world;
  if (robot.water < 15 && robot.foam < 15) {
    if (robot.task.kind !== "refill") setTask(world, { kind: "refill" });
    return;
  }
  const sectors = new Map<string, { heat: number; paint: number; cells: number; dist: number }>();
  for (let i = 0; i < N; i++) {
    if (get(grid.state, i) !== CellState.Burning) continue;
    const [x, y] = xy(i);
    const s = sectorOf(x, y);
    const e = sectors.get(s) ?? { heat: 0, paint: 0, cells: 0, dist: Number.POSITIVE_INFINITY };
    e.heat += get(grid.intensity, i);
    e.cells++;
    if (get(grid.type, i) === CellType.Paint) e.paint++;
    e.dist = Math.min(e.dist, Math.abs(x - robot.x) + Math.abs(y - robot.y));
    sectors.set(s, e);
  }
  let best: string | null = null;
  let bestScore = 0;
  for (const [s, e] of sectors) {
    const score = e.heat / (1 + e.dist / 16);
    if (score > bestScore) [best, bestScore] = [s, score];
  }
  if (best === null) {
    if (robot.task.kind !== "refill") setTask(world, { kind: "refill" });
    return;
  }
  const e = sectors.get(best);
  const agent = e && e.paint * 2 > e.cells ? "foam" : "water";
  if (robot[agent] <= 0) {
    setTask(world, { kind: "refill" });
    return;
  }
  const t = robot.task;
  if (t.kind !== "attack" || t.sector !== best || t.agent !== agent) {
    setTask(world, { kind: "attack", sector: best, agent });
  }
}

function onEvents(world: World, events: RobotEvent[]): boolean {
  const { robot } = world;
  if (events.includes("door") && robot.doorAhead) {
    const door = world.doors.find((d) => d.id === robot.doorAhead);
    if (door && doorInnerSmoke(world, door) < SIM.DOOR_SMOKE_THRESHOLD) openDoor(world, door.id);
    else if (door) holdDoor(world, door.id);
  }
  return events.some((e) => e !== "door");
}

const stage = document.getElementById("stage") as HTMLElement;
const status = document.getElementById("status") as HTMLElement;
const view = createView(stage);
let seed = 1;
let world = createWorld(seed);
const terrain = createTerrain(view.scene, world);
const fire = createFire(view.scene);
const robotView = createRobotView(view.scene);
let paused = false;
let acc = 0;
let last = performance.now();
let nextDecision = 0;

function newGame(): void {
  seed++;
  world = createWorld(seed);
  nextDecision = 0;
}

function renderStatus(): void {
  let n = 0;
  for (let i = 0; i < N; i++) if (get(world.grid.state, i) === CellState.Burning) n++;
  const { robot } = world;
  const task =
    robot.task.kind === "attack"
      ? `attacking ${robot.task.sector} with ${robot.task.agent}`
      : robot.task.kind === "refill"
        ? "going back to refill"
        : "waiting";
  status.innerHTML = `
    <h1>FireScout</h1>
    <p>Fire ${seed}, wind from the ${windLabel(world)}</p>
    <p>${simTime(world).toFixed(1)} s, ${n} ${n === 1 ? "cell" : "cells"} burning${paused ? ", paused" : ""}</p>
    <p>R1 ${task}${robot.stunned > 0 ? ", stunned by a backdraft" : ""}</p>
    <p>Water ${Math.round(robot.water)}%, foam ${Math.round(robot.foam)}%</p>
    <p class="keys"><kbd>Space</kbd> pause, <kbd>N</kbd> new fire, <kbd>C</kbd> reset camera</p>`;
}

window.addEventListener("keydown", (e) => {
  if (e.code === "Space") paused = !paused;
  else if (e.code === "KeyN") newGame();
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
      stepFire(world.grid, world.wind, world.rng);
      stepSmoke(world.grid, world.doors);
      const urgent = onEvents(world, tickRobot(world));
      world.tick++;
      if (urgent || world.tick >= nextDecision) {
        previewDecision(world);
        nextDecision = world.tick + CADENCE_TICKS;
      }
      acc -= SIM.TICK;
    }
  }
  terrain.update(world);
  fire.update(world.grid, now / 1000);
  robotView.update(world.robot, dt, now / 1000);
  if (world.tick % 5 === 0) renderStatus();
  view.render();
});
renderStatus();
