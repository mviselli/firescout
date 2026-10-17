import {
  CellState,
  CellType,
  type Door,
  type Grid,
  get,
  H,
  idx,
  N,
  SECTOR_SIZE,
  W,
  xy,
} from "@firescout/sim";
import * as THREE from "three";
import { PALETTE, tileColor } from "./palette";
import { cellToWorld } from "./view";

/** What the terrain needs to draw; satisfied by the yard now and by the World later. */
export interface TerrainSource {
  grid: Grid;
  doors: readonly Door[];
}

const TILE_H = 0.2;
const WALL_H = 1.4;
const DOOR_H = 1.1;

export interface Terrain {
  update(src: TerrainSource): void;
}

export function createTerrain(scene: THREE.Scene, src: TerrainSource): Terrain {
  const m = new THREE.Matrix4();
  const c = new THREE.Color();

  const tiles = new THREE.InstancedMesh(
    new THREE.BoxGeometry(1, TILE_H, 1),
    new THREE.MeshLambertMaterial(),
    N,
  );
  for (let i = 0; i < N; i++) {
    const [x, y] = xy(i);
    const [wx, wz] = cellToWorld(x, y);
    tiles.setMatrixAt(i, m.makeTranslation(wx, TILE_H / 2, wz));
    tiles.setColorAt(i, c.setHex(PALETTE.ground));
  }
  scene.add(tiles);

  const wallCells: number[] = [];
  for (let i = 0; i < N; i++) if (get(src.grid.type, i) === CellType.Wall) wallCells.push(i);
  const walls = new THREE.InstancedMesh(
    new THREE.BoxGeometry(1, WALL_H, 1),
    new THREE.MeshLambertMaterial({ color: PALETTE.wall }),
    wallCells.length,
  );
  wallCells.forEach((i, k) => {
    const [wx, wz] = cellToWorld(...xy(i));
    walls.setMatrixAt(k, m.makeTranslation(wx, TILE_H + WALL_H / 2, wz));
  });
  scene.add(walls);

  const doors = new THREE.InstancedMesh(
    new THREE.BoxGeometry(1, DOOR_H, 1),
    new THREE.MeshLambertMaterial(),
    src.doors.length,
  );
  scene.add(doors);

  scene.add(sectorGrid());

  const scale = new THREE.Vector3();
  const pos = new THREE.Vector3();
  const rot = new THREE.Quaternion();

  function update(s: TerrainSource): void {
    const { grid } = s;
    for (let i = 0; i < N; i++) {
      tileColor(get(grid.type, i) as CellType, get(grid.state, i), get(grid.smoke, i), c);
      tiles.setColorAt(i, c);
    }
    if (tiles.instanceColor) tiles.instanceColor.needsUpdate = true;

    s.doors.forEach((d, k) => {
      const state = get(grid.state, idx(d.x, d.y));
      const [wx, wz] = cellToWorld(d.x, d.y);
      // Closed: a full-height leaf. Open: folded flat. Burned through: a charred stub.
      const h = state === CellState.Burned ? 0.15 : d.open ? 0.08 : 1;
      scale.set(1, h, 1);
      pos.set(wx, TILE_H + (DOOR_H * h) / 2, wz);
      doors.setMatrixAt(k, m.compose(pos, rot, scale));
      c.setHex(state === CellState.Burned ? PALETTE.burned : PALETTE.doorClosed);
      if (state === CellState.Burning) c.lerp(new THREE.Color(PALETTE.fireEdge), 0.6);
      doors.setColorAt(k, c);
    });
    doors.instanceMatrix.needsUpdate = true;
    if (doors.instanceColor) doors.instanceColor.needsUpdate = true;
  }

  update(src);
  return { update };
}

/** Faint sector lines every 8 cells, with A–E / 1–8 labels outside the map edges. */
function sectorGrid(): THREE.Group {
  const group = new THREE.Group();
  const points: THREE.Vector3[] = [];
  const y = TILE_H + 0.01;
  for (let sx = 0; sx <= W; sx += SECTOR_SIZE) {
    points.push(new THREE.Vector3(sx - W / 2, y, -H / 2), new THREE.Vector3(sx - W / 2, y, H / 2));
  }
  for (let sy = 0; sy <= H; sy += SECTOR_SIZE) {
    points.push(new THREE.Vector3(-W / 2, y, sy - H / 2), new THREE.Vector3(W / 2, y, sy - H / 2));
  }
  group.add(
    new THREE.LineSegments(
      new THREE.BufferGeometry().setFromPoints(points),
      new THREE.LineBasicMaterial({ color: PALETTE.sectorLine, transparent: true, opacity: 0.35 }),
    ),
  );

  "ABCDE".split("").forEach((row, r) => {
    group.add(label(row, -W / 2 - 1.6, (r + 0.5) * SECTOR_SIZE - H / 2));
  });
  for (let col = 0; col < W / SECTOR_SIZE; col++) {
    group.add(label(String(col + 1), (col + 0.5) * SECTOR_SIZE - W / 2, -H / 2 - 1.6));
  }
  return group;
}

function label(text: string, x: number, z: number): THREE.Mesh {
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.fillStyle = "#3d413e";
    ctx.font = "600 96px 'Barlow Condensed', sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, 64, 70);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(2.2, 2.2),
    new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false }),
  );
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set(x, 0.02, z);
  return mesh;
}
