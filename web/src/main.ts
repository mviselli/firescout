import { createRng } from "@firescout/sim";
import * as THREE from "three";

// Phase 0 smoke scene: proves Vite, three.js and the sim package are wired up.
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const aspect = window.innerWidth / window.innerHeight;
const viewSize = 30;
const camera = new THREE.OrthographicCamera(
  (-viewSize * aspect) / 2,
  (viewSize * aspect) / 2,
  viewSize / 2,
  -viewSize / 2,
  0.1,
  500,
);
camera.position.set(40, 40, 40);
camera.lookAt(0, 0, 0);

scene.add(new THREE.AmbientLight(0xffffff, 0.6));
const sun = new THREE.DirectionalLight(0xffffff, 1);
sun.position.set(10, 20, 5);
scene.add(sun);

const rng = createRng(1);
const size = 16;
const tiles = new THREE.InstancedMesh(
  new THREE.BoxGeometry(0.95, 0.2, 0.95),
  new THREE.MeshLambertMaterial(),
  size * size,
);
const m = new THREE.Matrix4();
const c = new THREE.Color();
for (let i = 0; i < size * size; i++) {
  m.setPosition((i % size) - size / 2, 0, Math.floor(i / size) - size / 2);
  tiles.setMatrixAt(i, m);
  tiles.setColorAt(i, c.setHSL(0.08 * rng.next(), 0.7, 0.35));
}
scene.add(tiles);

renderer.setAnimationLoop(() => renderer.render(scene, camera));
