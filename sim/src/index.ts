export { SIM } from "./config";
export { ignite, stepFire } from "./fire";
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
export { buildYard, type Door, type Yard } from "./map";
export { createRng, type Rng } from "./rng";
export { stepSmoke } from "./smoke";
export type { Wind } from "./world";
