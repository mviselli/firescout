import { type Robot, xy } from "@firescout/sim";
import * as THREE from "three";
import { PALETTE } from "./palette";
import { cellToWorld } from "./view";

const TILE_TOP = 0.2;
const MAX_DOTS = 160;

export interface RobotView {
  update(robot: Robot, dt: number, timeSec: number): void;
}

/**
 * R1: a pale tracked body with a red stripe and a turret, eased between cells.
 * The planned path is drawn as dots; the jet is a tapered cone coloured by agent.
 */
export function createRobotView(scene: THREE.Scene): RobotView {
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);

  const tracks = new THREE.MeshLambertMaterial({ color: PALETTE.robotTracks });
  for (const side of [-0.36, 0.36]) {
    const track = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.28, 0.95), tracks);
    track.position.set(side, 0.14, 0);
    body.add(track);
  }
  const hull = new THREE.Mesh(
    new THREE.BoxGeometry(0.62, 0.3, 0.8),
    new THREE.MeshLambertMaterial({ color: PALETTE.robotBody }),
  );
  hull.position.y = 0.38;
  body.add(hull);
  const stripe = new THREE.Mesh(
    new THREE.BoxGeometry(0.64, 0.07, 0.82),
    new THREE.MeshLambertMaterial({ color: PALETTE.robotStripe }),
  );
  stripe.position.y = 0.36;
  body.add(stripe);

  const turret = new THREE.Group();
  turret.position.y = 0.6;
  root.add(turret);
  const dome = new THREE.Mesh(
    new THREE.CylinderGeometry(0.2, 0.24, 0.18, 12),
    new THREE.MeshLambertMaterial({ color: PALETTE.robotBody }),
  );
  turret.add(dome);
  const nozzle = new THREE.Mesh(
    new THREE.CylinderGeometry(0.05, 0.06, 0.5, 8),
    new THREE.MeshLambertMaterial({ color: PALETTE.robotTracks }),
  );
  nozzle.rotation.x = Math.PI / 2;
  nozzle.position.z = 0.3;
  turret.add(nozzle);
  scene.add(root);

  // Jet: unit cone along +Z from the nozzle, scaled to the target distance each frame.
  const jetGeometry = new THREE.ConeGeometry(0.22, 1, 10, 1, true);
  jetGeometry.rotateX(-Math.PI / 2);
  jetGeometry.translate(0, 0, 0.5);
  const jetMaterial = new THREE.MeshBasicMaterial({
    transparent: true,
    opacity: 0.6,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const jet = new THREE.Mesh(jetGeometry, jetMaterial);
  jet.visible = false;
  scene.add(jet);

  const dots = new THREE.InstancedMesh(
    new THREE.SphereGeometry(0.09, 8, 6),
    new THREE.MeshBasicMaterial({ color: PALETTE.pathDot }),
    MAX_DOTS,
  );
  dots.count = 0;
  dots.frustumCulled = false;
  scene.add(dots);

  const pos = new THREE.Vector3();
  const target = new THREE.Vector3();
  const nozzleTip = new THREE.Vector3();
  const m = new THREE.Matrix4();
  let placed = false;
  let heading = 0;

  return {
    update(robot, dt, timeSec) {
      const [wx, wz] = cellToWorld(robot.x, robot.y);
      target.set(wx, TILE_TOP, wz);
      if (!placed) {
        pos.copy(target);
        placed = true;
      }
      // Ease toward the current cell; one cell takes 0.3 s in the sim.
      pos.lerp(target, 1 - Math.exp(-dt * 14));
      root.position.copy(pos);

      const next = robot.path[0];
      if (next !== undefined) {
        const [nx, nz] = cellToWorld(...xy(next));
        if (nx !== wx || nz !== wz) heading = Math.atan2(nx - wx, nz - wz);
      }
      body.rotation.y += shortestAngle(body.rotation.y, heading) * Math.min(1, dt * 10);

      let aim = heading;
      if (robot.sprayTarget !== null) {
        const [sx, sz] = cellToWorld(...xy(robot.sprayTarget));
        aim = Math.atan2(sx - pos.x, sz - pos.z);
        const agent = robot.task.kind === "attack" ? robot.task.agent : "water";
        jetMaterial.color.setHex(agent === "foam" ? PALETTE.foam : PALETTE.water);
        nozzle.getWorldPosition(nozzleTip);
        const dist = Math.hypot(sx - nozzleTip.x, sz - nozzleTip.z);
        jet.position.copy(nozzleTip);
        jet.rotation.set(0, aim, 0);
        jet.scale.set(1 + 0.15 * Math.sin(timeSec * 30), 1, dist);
        jet.visible = true;
      } else {
        jet.visible = false;
      }
      turret.rotation.y += shortestAngle(turret.rotation.y, aim) * Math.min(1, dt * 12);

      const n = Math.min(MAX_DOTS, robot.path.length);
      for (let k = 0; k < n; k++) {
        const cell = robot.path[k];
        if (cell === undefined) break;
        const [dx, dz] = cellToWorld(...xy(cell));
        dots.setMatrixAt(k, m.makeTranslation(dx, TILE_TOP + 0.08, dz));
      }
      dots.count = n;
      dots.instanceMatrix.needsUpdate = true;
    },
  };
}

function shortestAngle(from: number, to: number): number {
  let d = (to - from) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}
