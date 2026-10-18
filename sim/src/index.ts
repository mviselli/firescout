export { SIM } from "./config";
export {
  buildContext,
  buildQuestions,
  type Content,
  type DecisionContext,
  type FireSector,
  priority,
} from "./context";
export type {
  Answer,
  Answers,
  DecisionReason,
  DecisionRequest,
  Policy,
  Question,
} from "./decision";
export {
  type DecisionRecord,
  Engine,
  type EngineOptions,
  type StepResult,
} from "./engine";
export { ignite, stepFire } from "./fire";
export { type GameResult, hashWorld, runGame } from "./game";
export {
  type BuildingId,
  buildingOf,
  CellState,
  CellType,
  createGrid,
  FUEL,
  type Grid,
  get,
  H,
  idx,
  inBounds,
  isFlammable,
  N,
  SECTOR_SIZE,
  sectorOf,
  W,
  xy,
} from "./grid";
export { lineOfSight } from "./los";
export { buildYard, type Door, type Yard } from "./map";
export {
  BaselinePolicy,
  choiceAnswer,
  noulAnswer,
  softmax,
  uniformScoreAnswer,
} from "./policies/baseline";
export { IdlePolicy } from "./policies/idle";
export { createRng, type Rng } from "./rng";
export {
  type Agent,
  createRobot,
  doorInnerSmoke,
  holdDoor,
  openDoor,
  type Robot,
  type RobotEvent,
  setTask,
  type Task,
  tickRobot,
} from "./robot";
export { stepSmoke } from "./smoke";
export {
  createWorld,
  type Stats,
  simTime,
  type Wind,
  type World,
  type WorldOptions,
} from "./world";
