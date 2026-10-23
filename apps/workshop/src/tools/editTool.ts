import * as THREE from 'three';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { CATALOG, type Id, type V3 } from '@botfoundry/model';
import { placementPose } from '../geom/place.ts';
import { addComponent, allIds, nextId, updateComponent } from '../state/ops.ts';
import type { Store } from '../state/store.ts';
import type { SceneSync } from '../view/sceneSync.ts';
import type { Viewport } from '../view/viewport.ts';

export const DRAG_MIME = 'text/plain';
export const DRAG_PREFIX = 'bot-foundry-part:';

export type GizmoMode = 'translate' | 'rotate';

const TRANSLATE_SNAP = 0.001;
const ROTATE_SNAP = (5 * Math.PI) / 180;
/** pointer travel (px) below which a press-release counts as a click */
const CLICK_SLOP = 4;

/**
 * Selecting in the 3D view, placing catalog parts by drag and drop, and moving them with the
 * translate / rotate gizmo. A gizmo drag streams previews into the store and records one undo step.
 */
export class EditTool {
  mode: GizmoMode = 'translate';
  snap = true;

  private readonly vp: Viewport;
  private readonly sync: SceneSync;
  private readonly store: Store;
  private readonly gizmo: TransformControls;
  private readonly proxy = new THREE.Object3D();
  private enabled = true;
  private down: { x: number; y: number; onGizmo: boolean } | null = null;

  constructor(vp: Viewport, sync: SceneSync, store: Store) {
    this.vp = vp;
    this.sync = sync;
    this.store = store;
    this.gizmo = new TransformControls(vp.camera, vp.dom);
    this.gizmo.setSize(0.85);
    vp.scene.add(this.proxy, this.gizmo.getHelper());
    this.applySnap();

    this.gizmo.addEventListener('dragging-changed', (e) => {
      const dragging = Boolean((e as unknown as { value: boolean }).value);
      vp.controls.enabled = !dragging;
      if (dragging) store.beginGesture();
      else store.endGesture();
    });
    this.gizmo.addEventListener('objectChange', () => this.onGizmoChange());
    this.gizmo.addEventListener('change', () => vp.requestRender());

    vp.dom.addEventListener('pointerdown', (e) => {
      this.down = { x: e.clientX, y: e.clientY, onGizmo: this.gizmo.axis !== null };
    });
    vp.dom.addEventListener('pointerup', (e) => this.onPointerUp(e));
    vp.dom.addEventListener('dragover', (e) => {
      if (!this.enabled || !e.dataTransfer?.types.includes(DRAG_MIME)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    });
    vp.dom.addEventListener('drop', (e) => this.onDrop(e));
    store.subscribe(() => this.syncGizmo());
  }

  /** Off while sketching: no gizmo, no picking. */
  setEnabled(on: boolean): void {
    this.enabled = on;
    this.gizmo.camera = this.vp.camera;
    this.syncGizmo();
  }

  setMode(mode: GizmoMode): void {
    this.mode = mode;
    this.gizmo.setMode(mode);
    this.vp.requestRender();
  }

  setSnap(on: boolean): void {
    this.snap = on;
    this.applySnap();
  }

  private applySnap(): void {
    this.gizmo.setTranslationSnap(this.snap ? TRANSLATE_SNAP : null);
    this.gizmo.setRotationSnap(this.snap ? ROTATE_SNAP : null);
  }

  /** Attach the gizmo to the selected component, or hide it. */
  syncGizmo(): void {
    const sel = this.store.selection;
    const inst = sel.kind === 'component' ? this.store.design.components.find((c) => c.id === sel.id) : undefined;
    this.gizmo.camera = this.vp.camera;
    if (!this.enabled || !inst) {
      this.gizmo.detach();
      this.gizmo.getHelper().visible = false;
      this.vp.requestRender();
      return;
    }
    if (!this.gizmo.dragging) {
      this.proxy.position.set(...inst.pose.position);
      this.proxy.quaternion.set(...inst.pose.rotation);
      this.proxy.updateMatrixWorld(true);
    }
    this.gizmo.attach(this.proxy);
    this.gizmo.getHelper().visible = true;
    this.vp.requestRender();
  }

  private onGizmoChange(): void {
    const sel = this.store.selection;
    if (sel.kind !== 'component') return;
    const p = this.proxy.position, q = this.proxy.quaternion;
    this.store.preview((d) => updateComponent(d, sel.id, {
      pose: { position: [p.x, p.y, p.z], rotation: [q.x, q.y, q.z, q.w] },
    }));
  }

  private onPointerUp(e: PointerEvent): void {
    const down = this.down;
    this.down = null;
    if (!this.enabled || !down || down.onGizmo || e.button !== 0) return;
    if (Math.hypot(e.clientX - down.x, e.clientY - down.y) > CLICK_SLOP) return;
    const hit = this.sync.pick(e);
    this.store.select(hit ? hit.selection : { kind: 'none' });
  }

  private onDrop(e: DragEvent): void {
    if (!this.enabled) return;
    const text = e.dataTransfer?.getData(DRAG_MIME) ?? '';
    if (!text.startsWith(DRAG_PREFIX)) return;
    e.preventDefault();
    this.place(text.slice(DRAG_PREFIX.length), e);
  }

  /** Put a catalog part on the surface under the pointer (or the ground), or at the origin without a pointer. */
  place(defId: Id, at?: { clientX: number; clientY: number }): Id | null {
    const def = CATALOG.find((d) => d.id === defId);
    if (!def) return null;
    let point: V3 = [0, 0, 0];
    let normal: V3 = [0, 1, 0];
    let mountedTo: Id | undefined;
    if (at) {
      const hit = this.sync.pick(at);
      if (hit) {
        point = hit.point;
        normal = hit.normal;
        if (hit.selection.kind === 'body') mountedTo = hit.selection.id;
      } else {
        const ray = this.vp.raycaster(at).ray;
        const target = new THREE.Vector3();
        if (ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), target)) point = [target.x, 0, target.z];
      }
    }
    const taken = allIds(this.store.design);
    const id = nextId(def.category, taken);
    const label = `${def.category[0]?.toUpperCase()}${def.category.slice(1)} ${id.split('-').pop()}`;
    this.store.commit((d) => addComponent(d, { id, def: def.id, name: label, pose: placementPose(point, normal), ...(mountedTo ? { mountedTo } : {}) }));
    this.store.select({ kind: 'component', id });
    return id;
  }
}
