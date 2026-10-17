import { H, W } from "@firescout/sim";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { PALETTE } from "./palette";

export interface View {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.OrthographicCamera;
  controls: OrbitControls;
  resetCamera(): void;
  render(): void;
}

/** Map cell (x, y) to world coordinates: the grid lies on the XZ plane, centred on the origin. */
export function cellToWorld(x: number, y: number): [number, number] {
  return [x - W / 2 + 0.5, y - H / 2 + 0.5];
}

const FRAME = 46; // world units visible vertically at zoom 1

export function createView(container: HTMLElement): View {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(PALETTE.haze);

  scene.add(new THREE.HemisphereLight(0xf2f0ea, 0x5a5f5c, 1.6));
  const sun = new THREE.DirectionalLight(0xfff6e8, 1.4);
  sun.position.set(-30, 50, -20);
  scene.add(sun);

  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 400);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.maxPolarAngle = Math.PI * 0.45;
  controls.minZoom = 0.6;
  controls.maxZoom = 4;

  function resize(): void {
    const w = container.clientWidth;
    const h = container.clientHeight;
    const aspect = w / h;
    camera.left = (-FRAME * aspect) / 2;
    camera.right = (FRAME * aspect) / 2;
    camera.top = FRAME / 2;
    camera.bottom = -FRAME / 2;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
  }

  function resetCamera(): void {
    camera.position.set(45, 55, 60);
    camera.zoom = 1;
    controls.target.set(0, 0, 2);
    camera.updateProjectionMatrix();
    controls.update();
  }

  window.addEventListener("resize", resize);
  resize();
  resetCamera();

  return {
    renderer,
    scene,
    camera,
    controls,
    resetCamera,
    render() {
      controls.update();
      renderer.render(scene, camera);
    },
  };
}
