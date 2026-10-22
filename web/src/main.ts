import { RemotePolicy } from "@firescout/brain-client";
import {
  BaselinePolicy,
  type DecisionSource,
  type Policy,
  type Recording,
  SIM,
  simTime,
  type Wind,
} from "@firescout/sim";
import type { GameHistory } from "./history";
import { policyBadge, sourceFromMeta } from "./hud/badge";
import { createDetails } from "./hud/details";
import { createPanel, type PolicyChoice } from "./hud/panel";
import { createTimeline } from "./hud/timeline";
import {
  parseRecording,
  RecordingError,
  recordingFileName,
  serializeRecording,
} from "./replay/file";
import { loadReplay, type ReplayPlayer } from "./replay/player";
import { createFire } from "./scene/fire";
import { createRobotView } from "./scene/robot";
import { createTerrain } from "./scene/terrain";
import { createView } from "./scene/view";
import { LiveSession } from "./session";
import { applyTheme, loadTheme, saveTheme, type Theme } from "./theme";

const byId = (id: string) => document.getElementById(id) as HTMLElement;
const stage = byId("stage");
const view = createView(stage);
let theme: Theme = loadTheme();

function setTheme(next: Theme): void {
  theme = next;
  applyTheme(theme);
  view.setTheme(theme);
  saveTheme(theme);
}
setTheme(theme);
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

/** The decision open in the details drawer, as an index into the history. */
let selected: number | null = null;
/** A file or replay problem for the panel, shown until dismissed. */
let notice: string | null = null;

/** Replay mode: a recorded game played back over the paused live session. Null in live mode. */
let replay: { recording: Recording; player: ReplayPlayer; history: GameHistory } | null = null;

function activeHistory(): GameHistory {
  return replay ? replay.history : session.history;
}

function restart(): void {
  // The old session's in-flight answer, if any, is dropped with it.
  session.dispose();
  session = newSession();
  selected = null;
}

function newFire(): void {
  replay = null;
  // Only the sim must be deterministic; picking the next seed is a UI choice.
  seed = 1 + Math.floor(Math.random() * 9999);
  restart();
}

function select(index: number | null): void {
  const count = activeHistory().entries.length;
  selected = index === null || count === 0 ? null : Math.min(Math.max(index, 0), count - 1);
}

/** Plays a recording from t = 0, paused; the live game waits paused where it was. */
function openReplay(recording: Recording): void {
  const loaded = loadReplay(recording);
  if ("error" in loaded) {
    notice = loaded.error;
    backToLive();
    return;
  }
  session.loop.paused = true;
  loaded.player.speed = speed;
  replay = { recording, ...loaded };
  selected = null;
  notice = null;
}

function backToLive(): void {
  if (!replay) return;
  replay = null;
  selected = null;
}

function toggleReplay(): void {
  if (replay) backToLive();
  else openReplay(session.recording());
}

async function openFile(file: File): Promise<void> {
  try {
    openReplay(parseRecording(await file.text()));
  } catch (err) {
    if (!(err instanceof RecordingError)) throw err;
    notice = err.message;
    backToLive();
  }
}

function saveReplay(): void {
  const recording = replay ? replay.recording : session.recording();
  const url = URL.createObjectURL(
    new Blob([serializeRecording(recording)], { type: "application/json" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = recordingFileName(recording);
  a.click();
  // The download has started by the next task.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function togglePlay(): void {
  if (!replay) session.loop.paused = !session.loop.paused;
  else if (replay.player.paused) replay.player.play();
  else replay.player.paused = true;
}

const panel = createPanel(
  { top: byId("topbar"), status: byId("readout"), board: byId("panel") },
  {
    onTheme() {
      setTheme(theme === "dark" ? "light" : "dark");
    },
    onPause: togglePlay,
    onPlay: togglePlay,
    onNewSeed: newFire,
    onReplay: toggleReplay,
    onBackToLive: backToLive,
    onSaveReplay: saveReplay,
    onOpenFile(file) {
      void openFile(file);
    },
    onStepDecision(dir) {
      replay?.player.stepDecision(dir);
    },
    onDismissNotice() {
      notice = null;
    },
    onWind(dirDeg) {
      windFromDeg = dirDeg;
      restart();
    },
    onSpeed(x) {
      speed = x;
      session.loop.speed = x;
      if (replay) replay.player.speed = x;
    },
    onOpenDecision(index) {
      select(index);
    },
    onPolicy(choice) {
      // Same seed, so the two policies can be compared on the same fire.
      policyChoice = choice;
      restart();
    },
  },
);

const timeline = createTimeline(byId("timeline"), {
  onSelect: select,
  onSeek: (t) => replay?.player.seek(t),
});
const details = createDetails(byId("details"), {
  onClose: () => select(null),
  onStep: (dir) => {
    if (selected !== null) select(selected + dir);
  },
});

/** Frame the yard in the part of the scene the floating panels leave free. */
function fitToPanels(): void {
  const r = (id: string) => byId(id).getBoundingClientRect();
  const stageRect = stage.getBoundingClientRect();
  // On phones the panels stack below the scene instead of floating over it.
  const floating = getComputedStyle(byId("panel")).position === "fixed";
  const insets = floating
    ? {
        top: r("topbar").bottom - stageRect.top,
        right: stageRect.right - r("panel").left,
        bottom: stageRect.bottom - r("status").top,
        left: 0,
      }
    : { top: 0, right: 0, bottom: 0, left: 0 };
  view.setInsets(insets);
  // The details drawer fits between the top bar and the status card.
  const root = document.documentElement.style;
  root.setProperty("--inset-top", `${Math.round(insets.top)}px`);
  root.setProperty("--inset-bottom", `${Math.round(insets.bottom)}px`);
}
const panelsObserver = new ResizeObserver(fitToPanels);
for (const id of ["topbar", "status", "panel"]) panelsObserver.observe(byId(id));
panelsObserver.observe(document.body);
fitToPanels();

window.addEventListener("keydown", (e) => {
  // The details drawer handles its own keys (←/→, Esc) first.
  if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
  const t = e.target;
  if (
    t instanceof HTMLSelectElement ||
    t instanceof HTMLButtonElement ||
    t instanceof HTMLInputElement
  )
    return;
  if (e.code === "Space") togglePlay();
  else if (e.code === "KeyR") toggleReplay();
  else if (e.code === "Escape" && replay) backToLive();
  else if (e.code === "ArrowLeft" && replay) replay.player.stepDecision(-1);
  else if (e.code === "ArrowRight" && replay) replay.player.stepDecision(1);
  else if (e.code === "KeyN") newFire();
  else if (e.code === "KeyC") view.resetCamera();
  else if (e.code === "KeyT") setTheme(theme === "dark" ? "light" : "dark");
  else return;
  e.preventDefault();
});

let last = performance.now();
view.renderer.setAnimationLoop((now: number) => {
  const dt = (now - last) / 1000;
  last = now;
  session.advance(dt);
  replay?.player.advance(dt);
  const { loop } = session;
  const history = activeHistory();
  const world = replay ? replay.player.replay.engine.world : loop.engine.world;
  terrain.update(world);
  fire.update(world.grid, now / 1000);
  robotView.update(world.robot, Math.min(dt, 0.25), now / 1000);
  const badge = policyBadge(policyChoice, session.history.last?.source ?? null);
  const player = replay?.player;
  panel.update(world, history, {
    seed,
    paused: player ? player.paused : loop.paused,
    ended: player ? player.ended : loop.engine.ended,
    speed,
    error: player ? null : loop.error,
    policyChoice,
    policy: badge.text,
    policyTone: badge.tone,
    pending: !player && loop.waiting ? loop.engine.pending : null,
    // A replay shows the decisions made up to the playhead.
    upTo: player ? player.replay.decided : history.entries.length,
    theme,
    mode: replay ? "replay" : "live",
    replay: replay
      ? { seed: replay.recording.options.seed, policy: replay.recording.policy }
      : null,
    // loadReplay plays the whole game before opening it, so the player itself never desyncs here.
    notice,
    ...(badge.detail === undefined ? {} : { policyDetail: badge.detail }),
  });
  timeline.update(history, simTime(world), {
    replayEnd: player ? player.replay.endTick * SIM.TICK : null,
    selected,
  });
  details.show(history, selected);
  view.render();
});
