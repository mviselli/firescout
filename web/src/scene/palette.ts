import { CellState, CellType } from "@firescout/sim";
import * as THREE from "three";

/** Operations-map palette: muted site materials, the fire is the only saturated element. */
export const PALETTE = {
  haze: 0xa7b2b6,
  ground: 0x6b6f6a,
  floor: 0xb4aea0,
  wall: 0xd6d1c4,
  paper: 0xc2995c,
  paint: 0x3f6f8f,
  scrub: 0x7d8e4f,
  base: 0xe2b007,
  doorClosed: 0x8e3b2d,
  burned: 0x2b2623,
  extinguished: 0x5d7884,
  smoke: 0x8a8d90,
  sectorLine: 0xe8e4da,
  fireCore: 0xfff0c2,
  fireMid: 0xff7a1a,
  fireEdge: 0xc4280e,
  robotBody: 0xeae6dc,
  robotTracks: 0x2e3234,
  robotStripe: 0xb3261e,
  pathDot: 0xf4f1e8,
  water: 0x5fb3e0,
  foam: 0xf6f6f2,
} as const;

const BY_TYPE: Record<CellType, number> = {
  [CellType.Ground]: PALETTE.ground,
  [CellType.Wall]: PALETTE.wall,
  [CellType.Floor]: PALETTE.floor,
  [CellType.Paint]: PALETTE.paint,
  [CellType.Paper]: PALETTE.paper,
  [CellType.Scrub]: PALETTE.scrub,
  [CellType.Base]: PALETTE.base,
  [CellType.Door]: PALETTE.doorClosed,
};

const smokeColor = new THREE.Color(PALETTE.smoke);
const burnedColor = new THREE.Color(PALETTE.burned);
const wetColor = new THREE.Color(PALETTE.extinguished);

/** Tile colour for a cell, written into `out`. Burning tiles are scorched; the cones carry the flame. */
export function tileColor(
  type: CellType,
  state: number,
  smoke: number,
  out: THREE.Color,
): THREE.Color {
  out.setHex(BY_TYPE[type]);
  if (state === CellState.Burned) out.copy(burnedColor);
  else if (state === CellState.Extinguished) out.lerp(wetColor, 0.75);
  else if (state === CellState.Burning) out.lerp(burnedColor, 0.55);
  return out.lerp(smokeColor, Math.min(0.5, smoke));
}
