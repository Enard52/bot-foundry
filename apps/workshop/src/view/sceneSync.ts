import * as THREE from 'three';
import { CATALOG, type ComponentCategory, type Design, type Id, type MaterialId, type MeshData, type V3 } from '@botfoundry/model';
import type { Evaluation } from '@botfoundry/cad';
import type { Selection } from '../state/store.ts';
import { COLORS, type Viewport } from './viewport.ts';

const MATERIAL_COLOR: Record<MaterialId, number> = {
  ar500: 0x5b636e, s7: 0x666f7c, a36: 0x77808c, ti64: 0x8f95a0, al7075: 0xaab4c2,
  al6061: 0xb8c1ce, uhmw: 0xe4e2d8, pc: 0x9fd0e8, rubber: 0x2c3036,
};
const CATEGORY_COLOR: Record<ComponentCategory, number> = {
  motor: 0x3f7fd9, battery: 0xd9a833, esc: 0x3aa57c, wheel: 0x2f3338, controller: 0x9a6ad8, actuator: 0xd9783f, sensor: 0x8a94a2,
};

export type Pick = { selection: Selection; point: V3; normal: V3; kind: 'body' | 'component' };

interface Entry {
  mesh: THREE.Mesh;
  edges: THREE.LineSegments;
  source: MeshData;
  keepOut?: THREE.Mesh;
  keepOutSource?: MeshData;
}

function geometryOf(data: MeshData): THREE.BufferGeometry {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(Float32Array.from(data.positions), 3));
  geo.setIndex(new THREE.BufferAttribute(Uint32Array.from(data.indices), 1));
  geo.computeVertexNormals();
  return geo;
}

/** Keeps the three.js meshes in step with the latest Evaluation and the current selection. */
export class SceneSync {
  private bodies = new Map<Id, Entry>();
  private components = new Map<Id, Entry>();
  /** draw bodies see-through (sketch mode) */
  ghost = false;
  /** show every keep-out envelope, not only colliding or selected ones */
  showKeepOuts = false;
  private last: { design: Design; evaluation: Evaluation; selection: Selection } | null = null;

  private readonly vp: Viewport;

  constructor(vp: Viewport) {
    this.vp = vp;
  }

  update(design: Design, evaluation: Evaluation, selection: Selection): void {
    this.last = { design, evaluation, selection };
    this.syncBodies(design, evaluation);
    this.syncComponents(design, evaluation);
    this.restyle();
  }

  /** Re-apply colours and visibility after a selection, ghost or keep-out change. */
  restyle(selection?: Selection): void {
    if (!this.last) return;
    if (selection) this.last.selection = selection;
    const { design, evaluation, selection: sel } = this.last;
    for (const b of design.bodies) {
      const e = this.bodies.get(b.id);
      if (!e) continue;
      const selected = (sel.kind === 'body' && sel.id === b.id) || (sel.kind === 'feature' && sel.body === b.id);
      const mat = e.mesh.material as THREE.MeshStandardMaterial;
      const errors = evaluation.bodies.find((x) => x.id === b.id)?.errors.length ?? 0;
      mat.color.set(errors > 0 ? COLORS.red : (MATERIAL_COLOR[b.material] ?? 0x888888));
      mat.emissive.set(selected ? COLORS.amber : 0x000000);
      mat.emissiveIntensity = selected ? 0.12 : 0;
      mat.opacity = this.ghost ? 0.3 : b.material === 'pc' ? 0.6 : 1;
      mat.transparent = this.ghost || b.material === 'pc';
      mat.depthWrite = !this.ghost;
      (e.edges.material as THREE.LineBasicMaterial).color.set(selected ? COLORS.amber : 0x1a1f26);
      (e.edges.material as THREE.LineBasicMaterial).opacity = this.ghost ? 0.5 : 1;
      (e.edges.material as THREE.LineBasicMaterial).transparent = this.ghost;
      e.mesh.renderOrder = 0;
    }
    for (const c of design.components) {
      const e = this.components.get(c.id);
      const ev = evaluation.components.find((x) => x.id === c.id);
      if (!e || !ev) continue;
      const def = categoryOf(c.def);
      const selected = sel.kind === 'component' && sel.id === c.id;
      const colliding = ev.collidesWith.length > 0;
      const mat = e.mesh.material as THREE.MeshStandardMaterial;
      mat.color.set(colliding ? COLORS.red : CATEGORY_COLOR[def]);
      mat.emissive.set(selected ? COLORS.amber : colliding ? COLORS.red : 0x000000);
      mat.emissiveIntensity = selected ? 0.3 : colliding ? 0.25 : 0;
      mat.opacity = this.ghost ? 0.4 : 1;
      mat.transparent = this.ghost;
      (e.edges.material as THREE.LineBasicMaterial).color.set(selected ? COLORS.amber : colliding ? COLORS.red : 0x12151a);
      if (e.keepOut) {
        const km = e.keepOut.material as THREE.MeshBasicMaterial;
        e.keepOut.visible = colliding || selected || this.showKeepOuts;
        km.color.set(colliding ? COLORS.red : COLORS.blue);
        km.opacity = colliding ? 0.32 : 0.12;
      }
    }
    this.vp.requestRender();
  }

  private syncBodies(design: Design, evaluation: Evaluation): void {
    const live = new Set<Id>();
    for (const b of design.bodies) {
      const ev = evaluation.bodies.find((x) => x.id === b.id);
      if (!ev) continue;
      live.add(b.id);
      let e = this.bodies.get(b.id);
      if (e && e.source !== ev.mesh) {
        this.remove(e);
        e = undefined;
      }
      if (!e) {
        e = this.build(ev.mesh, new THREE.MeshStandardMaterial({ color: 0x888888, metalness: 0.3, roughness: 0.55, flatShading: true, side: THREE.DoubleSide }));
        e.mesh.userData = { kind: 'body', id: b.id };
        this.bodies.set(b.id, e);
        this.vp.content.add(e.mesh);
      }
    }
    for (const [id, e] of this.bodies) {
      if (!live.has(id)) {
        this.remove(e);
        this.bodies.delete(id);
      }
    }
  }

  private syncComponents(design: Design, evaluation: Evaluation): void {
    const live = new Set<Id>();
    for (const c of design.components) {
      const ev = evaluation.components.find((x) => x.id === c.id);
      if (!ev) continue;
      live.add(c.id);
      let e = this.components.get(c.id);
      if (e && (e.source !== ev.mesh || e.keepOutSource !== ev.keepOut)) {
        this.remove(e);
        e = undefined;
      }
      if (!e) {
        e = this.build(ev.mesh, new THREE.MeshStandardMaterial({ color: 0x888888, metalness: 0.45, roughness: 0.45, flatShading: true }));
        e.mesh.userData = { kind: 'component', id: c.id };
        if (ev.keepOut.indices.length > 0) {
          const ko = new THREE.Mesh(
            geometryOf(ev.keepOut),
            new THREE.MeshBasicMaterial({ color: COLORS.blue, transparent: true, opacity: 0.12, depthWrite: false }),
          );
          ko.raycast = () => {};
          ko.renderOrder = 2;
          e.keepOut = ko;
          e.keepOutSource = ev.keepOut;
          e.mesh.add(ko);
        }
        this.components.set(c.id, e);
        this.vp.content.add(e.mesh);
      }
    }
    for (const [id, e] of this.components) {
      if (!live.has(id)) {
        this.remove(e);
        this.components.delete(id);
      }
    }
  }

  private build(data: MeshData, material: THREE.Material): Entry {
    const geo = geometryOf(data);
    const mesh = new THREE.Mesh(geo, material);
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geo, 28), new THREE.LineBasicMaterial({ color: 0x1a1f26 }));
    edges.raycast = () => {};
    mesh.add(edges);
    return { mesh, edges, source: data };
  }

  private remove(e: Entry): void {
    this.vp.content.remove(e.mesh);
    e.mesh.geometry.dispose();
    e.edges.geometry.dispose();
    (e.mesh.material as THREE.Material).dispose();
    if (e.keepOut) {
      e.keepOut.geometry.dispose();
      (e.keepOut.material as THREE.Material).dispose();
    }
  }

  /** Nearest body or component under the pointer, with the surface point and normal. */
  pick(e: { clientX: number; clientY: number }): Pick | null {
    const targets: THREE.Object3D[] = [];
    for (const x of this.bodies.values()) targets.push(x.mesh);
    for (const x of this.components.values()) targets.push(x.mesh);
    const hit = this.vp.raycaster(e).intersectObjects(targets, false)[0];
    if (!hit || !hit.face) return null;
    const kind = hit.object.userData.kind as 'body' | 'component';
    const id = hit.object.userData.id as Id;
    const n = hit.face.normal.clone().transformDirection(hit.object.matrixWorld);
    return {
      kind,
      selection: kind === 'body' ? { kind: 'body', id } : { kind: 'component', id },
      point: [hit.point.x, hit.point.y, hit.point.z],
      normal: [n.x, n.y, n.z],
    };
  }

  hasContent(): boolean {
    return this.bodies.size + this.components.size > 0;
  }
}

const CATALOG_CATEGORY = new Map(CATALOG.map((d) => [d.id, d.category]));
const categoryOf = (defId: Id): ComponentCategory => CATALOG_CATEGORY.get(defId) ?? 'sensor';
