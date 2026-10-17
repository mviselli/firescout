import { CellState, type Grid, get, N, xy } from "@firescout/sim";
import * as THREE from "three";
import { PALETTE } from "./palette";
import { cellToWorld } from "./view";

const TILE_TOP = 0.2;

export interface FireView {
  update(grid: Grid, timeSec: number): void;
}

/**
 * Two nested instanced cones per burning cell (a hot core inside a darker flame), pulsing
 * with intensity, plus one point light at the intensity-weighted centroid of the fire.
 */
export function createFire(scene: THREE.Scene): FireView {
  const outer = new THREE.InstancedMesh(
    new THREE.ConeGeometry(0.42, 1, 7),
    new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85 }),
    N,
  );
  const inner = new THREE.InstancedMesh(
    new THREE.ConeGeometry(0.22, 1, 6),
    new THREE.MeshBasicMaterial({ color: PALETTE.fireCore }),
    N,
  );
  outer.count = 0;
  inner.count = 0;
  outer.frustumCulled = false;
  inner.frustumCulled = false;
  scene.add(outer, inner);

  const light = new THREE.PointLight(PALETTE.fireMid, 0, 40, 1.4);
  light.position.y = 3;
  scene.add(light);

  const m = new THREE.Matrix4();
  const pos = new THREE.Vector3();
  const scale = new THREE.Vector3();
  const rot = new THREE.Quaternion();
  const edge = new THREE.Color(PALETTE.fireEdge);
  const mid = new THREE.Color(PALETTE.fireMid);
  const c = new THREE.Color();

  return {
    update(grid, timeSec) {
      let k = 0;
      let sx = 0;
      let sz = 0;
      let total = 0;
      for (let i = 0; i < N; i++) {
        if (get(grid.state, i) !== CellState.Burning) continue;
        const intensity = get(grid.intensity, i);
        const [wx, wz] = cellToWorld(...xy(i));
        const flicker = 0.85 + 0.15 * Math.sin(timeSec * 7 + i * 1.7);
        const h = (0.35 + intensity * 1.6) * flicker;

        scale.set(0.7 + 0.3 * intensity, h, 0.7 + 0.3 * intensity);
        pos.set(wx, TILE_TOP + h / 2, wz);
        outer.setMatrixAt(k, m.compose(pos, rot, scale));
        outer.setColorAt(k, c.copy(edge).lerp(mid, intensity));

        scale.set(1, h * 0.6, 1);
        pos.set(wx, TILE_TOP + (h * 0.6) / 2, wz);
        inner.setMatrixAt(k, m.compose(pos, rot, scale));

        sx += wx * intensity;
        sz += wz * intensity;
        total += intensity;
        k++;
      }
      outer.count = k;
      inner.count = k;
      outer.instanceMatrix.needsUpdate = true;
      inner.instanceMatrix.needsUpdate = true;
      if (outer.instanceColor) outer.instanceColor.needsUpdate = true;

      if (total > 0) {
        light.position.x = sx / total;
        light.position.z = sz / total;
        light.intensity = Math.min(400, 40 + total * 6);
      } else {
        light.intensity = 0;
      }
    },
  };
}
