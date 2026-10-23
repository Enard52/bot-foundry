import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { Plane, V2, V3 } from '@botfoundry/model';
import { planeBasis, planeToWorld, rayPlane } from '../geom/plane.ts';

export const COLORS = {
  bg: 0x101318,
  line: 0x2c333d,
  line2: 0x3a434f,
  amber: 0xf5a524,
  red: 0xff5a47,
  blue: 0x47a3ff,
} as const;

type FrameListener = () => void;

/**
 * The 3D canvas: renderer, a perspective camera for the workshop and an orthographic one for
 * sketching, orbit controls, the ground grid and the FRONT arrow. Rendering is on demand.
 * Design frame: x forward, y up, z to the right; the ground is y = 0.
 */
export class Viewport {
  readonly scene = new THREE.Scene();
  /** bodies and components */
  readonly content = new THREE.Group();
  /** sketch lines, markers, previews */
  readonly overlay = new THREE.Group();
  readonly renderer: THREE.WebGLRenderer;
  readonly persp = new THREE.PerspectiveCamera(45, 1, 0.01, 50);
  readonly ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.05, 20);
  readonly controls: OrbitControls;
  camera: THREE.PerspectiveCamera | THREE.OrthographicCamera = this.persp;
  readonly dom: HTMLCanvasElement;
  /** HTML labels (dimensions) positioned over the canvas */
  readonly labels: HTMLDivElement;

  private readonly host: HTMLElement;
  private readonly ground = new THREE.Group();
  private planeGrid: THREE.Object3D | null = null;
  private saved: { pos: THREE.Vector3; target: THREE.Vector3 } | null = null;
  private sketchPlane: Plane | null = null;
  private orthoHalfHeight = 0.2;
  private dirty = false;
  private frameListeners = new Set<FrameListener>();
  private size = { w: 1, h: 1 };

  constructor(host: HTMLElement) {
    this.host = host;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, preserveDrawingBuffer: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setClearColor(COLORS.bg);
    this.dom = this.renderer.domElement;
    this.dom.className = 'gl';
    this.labels = document.createElement('div');
    this.labels.className = 'labels';
    host.append(this.dom, this.labels);

    this.scene.add(this.content, this.overlay, this.ground);
    this.addLights();
    this.buildGround();

    this.persp.position.set(0.55, 0.4, 0.6);
    this.controls = new OrbitControls(this.persp, this.dom);
    this.controls.target.set(0, 0.05, 0);
    this.controls.enableDamping = false;
    this.controls.zoomToCursor = true;
    this.controls.minDistance = 0.05;
    this.controls.maxDistance = 6;
    this.controls.addEventListener('change', () => this.requestRender());
    this.controls.update();

    new ResizeObserver(() => this.resize()).observe(host);
    this.resize();
  }

  // ----- scene furniture -------------------------------------------------------------------

  private addLights(): void {
    this.scene.add(new THREE.HemisphereLight(0xdfe6f0, 0x1b1f26, 1.1));
    const key = new THREE.DirectionalLight(0xffffff, 1.6);
    key.position.set(0.6, 1.2, 0.8);
    const fill = new THREE.DirectionalLight(0x9db8ff, 0.5);
    fill.position.set(-0.8, 0.4, -0.6);
    this.scene.add(key, fill);
  }

  private buildGround(): void {
    const minor = new THREE.GridHelper(1.6, 160, COLORS.line, COLORS.line);
    (minor.material as THREE.Material).transparent = true;
    (minor.material as THREE.Material).opacity = 0.35;
    const major = new THREE.GridHelper(1.6, 16, COLORS.line2, COLORS.line2);
    major.position.y = 0.0001;
    this.ground.add(minor, major, this.frontArrow());
  }

  /** A flat arrow on the ground ahead of the robot, pointing the way it faces (+x). */
  private frontArrow(): THREE.Object3D {
    const group = new THREE.Group();
    const shape = new THREE.Shape();
    shape.moveTo(0, -0.012);
    shape.lineTo(0.07, -0.012);
    shape.lineTo(0.07, -0.03);
    shape.lineTo(0.12, 0);
    shape.lineTo(0.07, 0.03);
    shape.lineTo(0.07, 0.012);
    shape.lineTo(0, 0.012);
    shape.closePath();
    const geo = new THREE.ShapeGeometry(shape);
    // shape lies in xy; lay it on the ground with its +y pointing to -z so it faces +x
    geo.rotateX(-Math.PI / 2);
    const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: COLORS.amber, transparent: true, opacity: 0.8, side: THREE.DoubleSide }));
    mesh.position.set(0.3, 0.0005, 0);
    group.add(mesh);

    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.fillStyle = '#f5a524';
      ctx.font = '700 44px "Arial Narrow", "Helvetica Neue", Arial, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('FRONT', 128, 34);
    }
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(canvas), transparent: true, depthWrite: false }));
    sprite.scale.set(0.08, 0.02, 1);
    sprite.position.set(0.37, 0.02, 0);
    group.add(sprite);
    return group;
  }

  // ----- rendering -------------------------------------------------------------------------

  requestRender(): void {
    if (this.dirty) return;
    this.dirty = true;
    requestAnimationFrame(() => {
      this.dirty = false;
      // belt and braces next to the ResizeObserver: a layout change that slipped past it still gets fixed
      if (this.host.clientWidth !== this.size.w || this.host.clientHeight !== this.size.h) this.resize();
      this.renderer.render(this.scene, this.camera);
      for (const fn of this.frameListeners) fn();
    });
  }

  /** Called after every render; used to keep HTML labels glued to 3D points. */
  onFrame(fn: FrameListener): void {
    this.frameListeners.add(fn);
  }

  private resize(): void {
    const w = Math.max(1, this.host.clientWidth), h = Math.max(1, this.host.clientHeight);
    this.size = { w, h };
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(w, h, false);
    this.dom.style.width = '100%';
    this.dom.style.height = '100%';
    this.persp.aspect = w / h;
    this.persp.updateProjectionMatrix();
    this.updateOrtho();
    this.requestRender();
  }

  private updateOrtho(): void {
    const { w, h } = this.size;
    const hh = this.orthoHalfHeight;
    this.ortho.left = (-hh * w) / h;
    this.ortho.right = (hh * w) / h;
    this.ortho.top = hh;
    this.ortho.bottom = -hh;
    this.ortho.updateProjectionMatrix();
  }

  // ----- sketch view -----------------------------------------------------------------------

  get sketching(): boolean {
    return this.sketchPlane !== null;
  }

  /**
   * Look straight onto a plane with the orthographic camera: sketch u to the right, v up. Left
   * mouse is freed for drawing; right pans and the wheel zooms.
   */
  enterSketchView(plane: Plane, halfHeight: number): void {
    if (!this.saved) this.saved = { pos: this.persp.position.clone(), target: this.controls.target.clone() };
    this.sketchPlane = plane;
    const { n, v } = planeBasis(plane);
    const centre = new THREE.Vector3(...planeToWorld(plane, [0, 0]));
    this.orthoHalfHeight = halfHeight;
    this.ortho.zoom = 1;
    this.ortho.up.set(...v);
    this.ortho.position.copy(centre).addScaledVector(new THREE.Vector3(...n), 4);
    this.ortho.lookAt(centre);
    this.ortho.near = 0.05;
    this.ortho.far = 12;
    this.updateOrtho();
    this.camera = this.ortho;
    this.controls.object = this.ortho;
    this.controls.target.copy(centre);
    this.controls.enableRotate = false;
    this.controls.mouseButtons = { LEFT: null, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.PAN };
    this.controls.minDistance = 0;
    this.controls.maxDistance = Infinity;
    this.controls.update();
    this.ground.visible = false;
    this.setPlaneGrid(plane);
    this.requestRender();
  }

  exitSketchView(): void {
    if (!this.sketchPlane) return;
    this.sketchPlane = null;
    this.camera = this.persp;
    this.controls.object = this.persp;
    this.controls.enableRotate = true;
    this.controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
    this.controls.minDistance = 0.05;
    this.controls.maxDistance = 6;
    if (this.saved) {
      this.persp.position.copy(this.saved.pos);
      this.controls.target.copy(this.saved.target);
      this.saved = null;
    }
    this.controls.update();
    this.ground.visible = true;
    this.setPlaneGrid(null);
    this.requestRender();
  }

  private setPlaneGrid(plane: Plane | null): void {
    if (this.planeGrid) {
      this.scene.remove(this.planeGrid);
      this.planeGrid.traverse((o) => {
        const m = o as THREE.Mesh;
        m.geometry?.dispose();
      });
      this.planeGrid = null;
    }
    if (!plane) return;
    const { u, n, v } = planeBasis(plane);
    const grid = new THREE.Group();
    const minor = new THREE.GridHelper(2, 200, COLORS.line, COLORS.line);
    (minor.material as THREE.Material).transparent = true;
    (minor.material as THREE.Material).opacity = 0.25;
    const major = new THREE.GridHelper(2, 40, COLORS.line2, COLORS.line2);
    grid.add(minor, major);
    // GridHelper lies in xz with normal y: send x -> u, y -> n, z -> -v (right-handed)
    const m = new THREE.Matrix4().makeBasis(new THREE.Vector3(...u), new THREE.Vector3(...n), new THREE.Vector3(-v[0], -v[1], -v[2]));
    m.setPosition(...planeToWorld(plane, [0, 0]));
    grid.matrixAutoUpdate = false;
    grid.matrix.copy(m);
    this.planeGrid = grid;
    this.scene.add(grid);
  }

  /** World units per screen pixel in the sketch view. */
  pixelSize(): number {
    return (2 * this.orthoHalfHeight) / this.ortho.zoom / this.size.h;
  }

  // ----- picking and projection ------------------------------------------------------------

  raycaster(e: { clientX: number; clientY: number }): THREE.Raycaster {
    const r = this.dom.getBoundingClientRect();
    const ndc = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    const rc = new THREE.Raycaster();
    this.camera.updateMatrixWorld();
    rc.setFromCamera(ndc, this.camera);
    return rc;
  }

  /** Sketch coordinates under the pointer on a plane, or null when the ray misses it. */
  pointOnPlane(e: { clientX: number; clientY: number }, plane: Plane): V2 | null {
    const ray = this.raycaster(e).ray;
    const t = rayPlane(plane, [ray.origin.x, ray.origin.y, ray.origin.z], [ray.direction.x, ray.direction.y, ray.direction.z]);
    if (t === null) return null;
    const hit: V3 = [ray.origin.x + ray.direction.x * t, ray.origin.y + ray.direction.y * t, ray.origin.z + ray.direction.z * t];
    const { u, v } = planeBasis(plane);
    const d: V3 = [hit[0] - plane.origin[0], hit[1] - plane.origin[1], hit[2] - plane.origin[2]];
    return [d[0] * u[0] + d[1] * u[1] + d[2] * u[2], d[0] * v[0] + d[1] * v[1] + d[2] * v[2]];
  }

  /** Screen position (px, relative to the canvas) of a world point. */
  project(p: V3): { x: number; y: number } {
    this.camera.updateMatrixWorld();
    const v = new THREE.Vector3(...p).project(this.camera);
    return { x: ((v.x + 1) / 2) * this.size.w, y: ((1 - v.y) / 2) * this.size.h };
  }

  /** Frame everything in the content group. */
  frameContent(): void {
    if (this.sketching) return;
    const box = new THREE.Box3().setFromObject(this.content);
    if (box.isEmpty()) return;
    const c = box.getCenter(new THREE.Vector3());
    const r = Math.max(box.getSize(new THREE.Vector3()).length() / 2, 0.08);
    const dir = new THREE.Vector3(0.65, 0.5, 0.75).normalize();
    // fit the bounding sphere into the narrower of the vertical and horizontal fields of view
    const vfov = (this.persp.fov * Math.PI) / 180;
    const hfov = 2 * Math.atan(Math.tan(vfov / 2) * this.persp.aspect);
    this.controls.target.copy(c);
    this.persp.position.copy(c).addScaledVector(dir, (r / Math.sin(Math.min(vfov, hfov) / 2)) * 1.1);
    this.controls.update();
    this.requestRender();
  }

  /** Half the extent of the content along the sketch plane, for choosing an orthographic zoom. */
  contentRadius(): number {
    const box = new THREE.Box3().setFromObject(this.content);
    return box.isEmpty() ? 0.15 : Math.min(1, Math.max(0.1, box.getSize(new THREE.Vector3()).length() * 0.35));
  }
}
