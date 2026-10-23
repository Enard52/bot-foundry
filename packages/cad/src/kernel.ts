import type { Box, Manifold, ManifoldToplevel } from 'manifold-3d';
import {
  CATALOG, MATERIALS,
  type ComponentDef, type Design, type Id, type MassProperties, type MeshData, type Transform,
} from '@botfoundry/model';
import type { EvaluatedBody, EvaluatedComponent, Evaluation, Kernel } from './index.ts';
import { buildBody, bodyInputs, type CatalogMap, type FirstExtrude } from './body.ts';
import { compileModel } from './compile.ts';
import { stableHash } from './hash.ts';
import { combineMass, componentMass, meshMassProperties, ZERO_MASS } from './mass.ts';
import { primitiveManifold } from './primitives.ts';
import { Scope } from './scope.ts';
import { fromTransform } from './vec.ts';
import { loadManifold } from './wasm.ts';

// The kernel keeps every evaluated body alive in a cache keyed by a stable hash of everything the
// body depends on, so an edit re-evaluates only the bodies it touches.

export interface BodyEntry {
  id: Id;
  key: string;
  manifold: Manifold | null;
  bbox: Box | null;
  mesh: MeshData;
  mass: MassProperties;
  errors: string[];
  firstExtrude: FirstExtrude | undefined;
  /** component instances this body carves */
  carves: ReadonlySet<Id>;
}

export interface ComponentEntry {
  id: Id;
  key: string;
  def: ComponentDef;
  pose: Transform;
  matrix: number[];
  mesh: MeshData;
  keepOutMesh: MeshData;
  keepOut: Manifold | null;
  keepOutBox: Box | null;
  mass: MassProperties;
}

export interface Run {
  evaluation: Evaluation;
  bodies: Map<Id, BodyEntry>;
  components: Map<Id, ComponentEntry>;
}

/** What the last evaluate() did, for tests and tooling. */
export interface KernelStats {
  bodiesEvaluated: Id[];
  bodiesReused: Id[];
  componentsBuilt: Id[];
  /** keep-out against body intersections actually computed (bounding boxes overlapped, no cached answer) */
  collisionTests: number;
}

export interface CadKernel extends Kernel {
  stats(): KernelStats;
}

export interface KernelOptions {
  /** parts the design may reference; defaults to the starter CATALOG */
  catalog?: readonly ComponentDef[];
}

/** Keep-out volume (m³) above which an envelope counts as intersecting a body: 1 mm³ ignores coincident-face noise. */
const COLLISION_VOLUME = 1e-9;

const EMPTY_MESH: MeshData = { positions: [], indices: [] };

export function meshOf(m: Manifold): MeshData {
  const mesh = m.getMesh();
  const stride = mesh.numProp;
  const nv = mesh.vertProperties.length / stride;
  const positions = new Array<number>(nv * 3);
  for (let i = 0; i < nv; i++) {
    positions[3 * i] = mesh.vertProperties[i * stride] as number;
    positions[3 * i + 1] = mesh.vertProperties[i * stride + 1] as number;
    positions[3 * i + 2] = mesh.vertProperties[i * stride + 2] as number;
  }
  return { positions, indices: Array.from(mesh.triVerts) };
}

function boxesOverlap(a: Box, b: Box): boolean {
  for (let k = 0; k < 3; k++) {
    if ((a.max[k] as number) <= (b.min[k] as number) || (b.max[k] as number) <= (a.min[k] as number)) return false;
  }
  return true;
}

function assertUniqueIds(design: Design): void {
  const seen = new Set<Id>();
  for (const id of [...design.bodies.map((b) => b.id), ...design.components.map((c) => c.id)]) {
    if (seen.has(id)) throw new Error(`duplicate id "${id}": bodies and components share one id space`);
    seen.add(id);
  }
}

class KernelImpl implements CadKernel {
  private bodies = new Map<Id, BodyEntry>();
  private components = new Map<Id, ComponentEntry>();
  private pairs = new Map<string, boolean>();
  private last: KernelStats = { bodiesEvaluated: [], bodiesReused: [], componentsBuilt: [], collisionTests: 0 };
  private readonly w: ManifoldToplevel;
  private readonly catalog: CatalogMap;

  constructor(w: ManifoldToplevel, catalog: readonly ComponentDef[]) {
    this.w = w;
    this.catalog = new Map(catalog.map((d) => [d.id, d]));
  }

  stats(): KernelStats {
    return this.last;
  }

  evaluate(design: Design): Evaluation {
    return this.run(design).evaluation;
  }

  compile(design: Design) {
    const run = this.run(design);
    return compileModel(this.w, design, this.catalog, run);
  }

  dispose(): void {
    for (const b of this.bodies.values()) b.manifold?.delete();
    for (const c of this.components.values()) c.keepOut?.delete();
    this.bodies.clear();
    this.components.clear();
    this.pairs.clear();
  }

  private run(design: Design): Run {
    const t0 = performance.now();
    assertUniqueIds(design);
    const stats: KernelStats = { bodiesEvaluated: [], bodiesReused: [], componentsBuilt: [], collisionTests: 0 };

    // bodies
    const bodies = new Map<Id, BodyEntry>();
    for (const body of design.bodies) {
      const key = stableHash(bodyInputs(design, body, this.catalog));
      const old = this.bodies.get(body.id);
      if (old && old.key === key) {
        bodies.set(body.id, old);
        stats.bodiesReused.push(body.id);
        continue;
      }
      old?.manifold?.delete();
      this.bodies.delete(body.id);
      bodies.set(body.id, this.buildBodyEntry(design, body, key));
      stats.bodiesEvaluated.push(body.id);
    }
    for (const [id, entry] of this.bodies) {
      if (!bodies.has(id)) entry.manifold?.delete();
    }
    this.bodies = bodies;

    // components
    const components = new Map<Id, ComponentEntry>();
    for (const inst of design.components) {
      const def = this.catalog.get(inst.def);
      if (!def) throw new Error(`component "${inst.id}" uses unknown catalog part "${inst.def}"`);
      const key = stableHash({ def, pose: inst.pose });
      const old = this.components.get(inst.id);
      if (old && old.key === key) {
        components.set(inst.id, old);
        continue;
      }
      old?.keepOut?.delete();
      this.components.delete(inst.id);
      components.set(inst.id, this.buildComponentEntry(inst.id, def, inst.pose, key));
      stats.componentsBuilt.push(inst.id);
    }
    for (const [id, entry] of this.components) {
      if (!components.has(id)) entry.keepOut?.delete();
    }
    this.components = components;

    // keep-out envelopes against bodies that do not carve them
    const nextPairs = new Map<string, boolean>();
    const evaluatedComponents: EvaluatedComponent[] = [];
    for (const inst of design.components) {
      const comp = components.get(inst.id) as ComponentEntry;
      const collidesWith: Id[] = [];
      for (const body of design.bodies) {
        const entry = bodies.get(body.id) as BodyEntry;
        if (entry.carves.has(inst.id) || !entry.manifold || !entry.bbox || !comp.keepOut || !comp.keepOutBox) continue;
        if (!boxesOverlap(entry.bbox, comp.keepOutBox)) continue;
        const pairKey = `${entry.key}|${comp.key}`;
        let hit = this.pairs.get(pairKey) ?? nextPairs.get(pairKey);
        if (hit === undefined) {
          const overlap = entry.manifold.intersect(comp.keepOut);
          hit = overlap.volume() > COLLISION_VOLUME;
          overlap.delete();
          stats.collisionTests++;
        }
        nextPairs.set(pairKey, hit);
        if (hit) collidesWith.push(body.id);
      }
      evaluatedComponents.push({
        id: inst.id, pose: inst.pose, mesh: comp.mesh, keepOut: comp.keepOutMesh, collidesWith,
      });
    }
    this.pairs = nextPairs;

    const evaluatedBodies: EvaluatedBody[] = design.bodies.map((b) => {
      const e = bodies.get(b.id) as BodyEntry;
      return { id: b.id, mesh: e.mesh, mass: e.mass, errors: e.errors };
    });
    const mass = combineMass([
      ...evaluatedBodies.map((b) => b.mass),
      ...design.components.map((c) => (components.get(c.id) as ComponentEntry).mass),
    ]);
    this.last = stats;
    return {
      evaluation: { bodies: evaluatedBodies, components: evaluatedComponents, mass, timeMs: performance.now() - t0 },
      bodies,
      components,
    };
  }

  private buildBodyEntry(design: Design, body: Design['bodies'][number], key: string): BodyEntry {
    const built = buildBody(this.w, design, body, this.catalog);
    const material = MATERIALS[body.material];
    const errors = [...built.errors];
    if (!material) errors.push(`unknown material "${body.material}"`);
    let mesh = EMPTY_MESH;
    let mass = ZERO_MASS;
    let bbox: Box | null = null;
    if (built.manifold) {
      mesh = meshOf(built.manifold);
      mass = meshMassProperties(mesh.positions, mesh.indices, material?.density ?? 0);
      bbox = built.manifold.boundingBox();
    }
    return {
      id: body.id, key, manifold: built.manifold, bbox, mesh, mass, errors,
      firstExtrude: built.firstExtrude, carves: new Set(built.carves),
    };
  }

  private buildComponentEntry(id: Id, def: ComponentDef, pose: Transform, key: string): ComponentEntry {
    const matrix = fromTransform(pose);
    const scope = new Scope();
    const solid = (prims: ComponentDef['geometry']): Manifold | null => {
      if (prims.length === 0) return null;
      const parts = prims.map((p) => scope.track(primitiveManifold(this.w, p, matrix)));
      return parts.length === 1 ? (parts[0] as Manifold) : scope.track(this.w.Manifold.union(parts));
    };
    const geometry = solid(def.geometry);
    const envelope = solid(def.keepOut);
    const mesh = geometry ? meshOf(geometry) : EMPTY_MESH;
    const keepOutMesh = envelope ? meshOf(envelope) : EMPTY_MESH;
    const keepOut = envelope ? scope.keep(envelope) : null;
    const keepOutBox = keepOut ? keepOut.boundingBox() : null;
    scope.dispose();
    return {
      id, key, def, pose, matrix, mesh, keepOutMesh, keepOut, keepOutBox,
      mass: componentMass(def.geometry, def.mass, matrix),
    };
  }
}


/**
 * Create a CAD kernel. Loads the manifold-3d WASM module once; the returned kernel caches
 * per-body results between calls to evaluate() and compile().
 */
export async function createKernel(options: KernelOptions = {}): Promise<CadKernel> {
  const w = await loadManifold();
  return new KernelImpl(w, options.catalog ?? CATALOG);
}
