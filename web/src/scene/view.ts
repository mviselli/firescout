import { H, W } from "@firescout/sim";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { PALETTE } from "./palette";

export type SceneTheme = "dark" | "light";

/** Pixels of the canvas covered by floating HUD panels; the yard is framed in what is left. */
export interface Insets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface View {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.OrthographicCamera;
  controls: OrbitControls;
  resetCamera(): void;
  setInsets(insets: Insets): void;
  setTheme(theme: SceneTheme): void;
  render(): void;
}

/** Day: the operations-map haze. Night: a dark slate yard, so the fire is the brightest thing. */
const LIGHTING: Record<
  SceneTheme,
  { background: number; sky: number; ground: number; hemi: number; sun: number; sunI: number }
> = {
  light: {
    background: PALETTE.haze,
    sky: 0xf2f0ea,
    ground: 0x5a5f5c,
    hemi: 1.6,
    sun: 0xfff6e8,
    sunI: 1.4,
  },
  dark: {
    background: 0x0f1418,
    sky: 0xa9bccf,
    ground: 0x1a1f24,
    hemi: 0.95,
    sun: 0xc8d8ff,
    sunI: 0.6,
  },
};

/** Map cell (x, y) to world coordinates: the grid lies on the XZ plane, centred on the origin. */
export function cellToWorld(x: number, y: number): [number, number] {
  return [x - W / 2 + 0.5, y - H / 2 + 0.5];
}

const FRAME = 46; // world units visible vertically at zoom 1
const MIN_WIDTH = 84; // world units always visible horizontally, so the whole yard fits a narrow stage

export function createView(container: HTMLElement): View {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(PALETTE.haze);

  const hemi = new THREE.HemisphereLight(0xf2f0ea, 0x5a5f5c, 1.6);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff6e8, 1.4);
  sun.position.set(-30, 50, -20);
  scene.add(sun);

  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 400);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.maxPolarAngle = Math.PI * 0.45;
  controls.minZoom = 0.6;
  controls.maxZoom = 4;

  let insets: Insets = { top: 0, right: 0, bottom: 0, left: 0 };

  function resize(): void {
    const w = container.clientWidth;
    const h = container.clientHeight;
    // Frame the yard in the part of the canvas no panel covers, centred there.
    const freeW = Math.max(1, w - insets.left - insets.right);
    const freeH = Math.max(1, h - insets.top - insets.bottom);
    const perPx = Math.max(FRAME / freeH, MIN_WIDTH / freeW);
    const cx = insets.left + freeW / 2;
    const cy = insets.top + freeH / 2;
    camera.left = -cx * perPx;
    camera.right = (w - cx) * perPx;
    camera.top = cy * perPx;
    camera.bottom = -(h - cy) * perPx;
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
    setInsets(next) {
      insets = next;
      resize();
    },
    setTheme(theme) {
      const l = LIGHTING[theme];
      (scene.background as THREE.Color).setHex(l.background);
      hemi.color.setHex(l.sky);
      hemi.groundColor.setHex(l.ground);
      hemi.intensity = l.hemi;
      sun.color.setHex(l.sun);
      sun.intensity = l.sunI;
    },
    render() {
      controls.update();
      renderer.render(scene, camera);
    },
  };
}
