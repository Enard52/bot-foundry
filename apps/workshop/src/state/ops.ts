import {
  EMPTY_CONTROLS,
  type Body, type ComponentInstance, type Design, type Feature, type Id, type Plane, type Sketch, type Structure, type V3,
} from '@botfoundry/model';
import { planeBasis } from '../geom/plane.ts';

// Pure edits of a Design. Every function returns a new Design and leaves its input alone, which is
// what makes undo a matter of keeping the previous value.

export function emptyDesign(name = 'Untitled bot'): Design {
  return {
    schema: 'botfoundry/design@0',
    name,
    sketches: [],
    bodies: [],
    components: [],
    fasteners: [],
    welds: [],
    joints: [],
    wiring: [],
    controls: { ...EMPTY_CONTROLS, nodes: [], edges: [], outputs: [] },
  };
}

/** Bodies and components share one id space in the kernel; features and sketches get unique ids too. */
export function allIds(d: Design): Set<Id> {
  const ids = new Set<Id>();
  for (const s of d.sketches) ids.add(s.id);
  for (const b of d.bodies) {
    ids.add(b.id);
    for (const f of b.features) ids.add(f.id);
  }
  for (const c of d.components) ids.add(c.id);
  for (const x of [...d.fasteners, ...d.welds, ...d.joints, ...d.wiring]) ids.add(x.id);
  return ids;
}

export function nextId(prefix: string, taken: ReadonlySet<Id>): Id {
  for (let n = 1; ; n++) {
    const id = `${prefix}-${n}`;
    if (!taken.has(id)) return id;
  }
}

export function renameDesign(d: Design, name: string): Design {
  return { ...d, name };
}

// ---------------------------------------------------------------------------------------------
// sketches

export function addSketch(d: Design, sketch: Sketch): Design {
  return { ...d, sketches: [...d.sketches, sketch] };
}

export function updateSketch(d: Design, id: Id, patch: Partial<Pick<Sketch, 'name'>>): Design {
  return { ...d, sketches: d.sketches.map((s) => (s.id === id ? { ...s, ...patch } : s)) };
}

/** Remove a sketch and every feature built from it; a body left without features goes too. */
export function removeSketch(d: Design, id: Id): Design {
  let next: Design = { ...d, sketches: d.sketches.filter((s) => s.id !== id) };
  for (const body of d.bodies) {
    const used = body.features.some((f) => (f.kind === 'extrude' || f.kind === 'revolve') && f.sketch === id);
    if (!used) continue;
    const kept = dropFeatures(body.features, (f) => (f.kind === 'extrude' || f.kind === 'revolve') && f.sketch === id);
    next = kept.length === 0 ? removeBody(next, body.id) : replaceBody(next, { ...body, features: kept });
  }
  return next;
}

// ---------------------------------------------------------------------------------------------
// bodies and features

const replaceBody = (d: Design, body: Body): Design => ({ ...d, bodies: d.bodies.map((b) => (b.id === body.id ? body : b)) });

/** Drop matching features plus any pattern that repeats one of them. */
function dropFeatures(features: Feature[], match: (f: Feature) => boolean): Feature[] {
  const gone = new Set(features.filter(match).map((f) => f.id));
  return features.filter((f) => !gone.has(f.id) && !(f.kind === 'pattern' && gone.has(f.feature)));
}

export function addBody(d: Design, body: Body): Design {
  return { ...d, bodies: [...d.bodies, body] };
}

export function updateBody(d: Design, id: Id, patch: Partial<Pick<Body, 'name' | 'material' | 'structure'>>): Design {
  const body = d.bodies.find((b) => b.id === id);
  if (!body) return d;
  let next: Body = { ...body, ...patch };
  const s = next.structure;
  if (patch.structure && s.kind === 'plate') {
    // a plate's first extrude is the thickness; keep the two in step
    const first = next.features[0];
    if (first && first.kind === 'extrude') {
      const sign = first.distance < 0 ? -1 : 1;
      next = { ...next, features: [{ ...first, distance: sign * s.thickness }, ...next.features.slice(1)] };
    }
  }
  return replaceBody(d, next);
}

export function removeBody(d: Design, id: Id): Design {
  const touches = (ids: readonly Id[]): boolean => ids.includes(id);
  return {
    ...d,
    bodies: d.bodies.filter((b) => b.id !== id),
    components: d.components.map((c) => (c.mountedTo === id ? { ...c, mountedTo: undefined } : c)),
    fasteners: d.fasteners.filter((f) => !touches(f.joins)),
    welds: d.welds.filter((w) => !touches(w.joins)),
    joints: d.joints.filter((j) => j.a !== id && j.b !== id),
  };
}

export function addFeature(d: Design, bodyId: Id, feature: Feature): Design {
  const body = d.bodies.find((b) => b.id === bodyId);
  return body ? replaceBody(d, { ...body, features: [...body.features, feature] }) : d;
}

export function updateFeature(d: Design, bodyId: Id, featureId: Id, patch: Record<string, unknown>): Design {
  const body = d.bodies.find((b) => b.id === bodyId);
  if (!body) return d;
  const features = body.features.map((f) => (f.id === featureId ? ({ ...f, ...patch } as Feature) : f));
  let next: Body = { ...body, features };
  const first = features[0];
  if (next.structure.kind === 'plate' && first && first.id === featureId && first.kind === 'extrude' && typeof patch.distance === 'number') {
    if (Math.abs(patch.distance) > 0) next = { ...next, structure: { kind: 'plate', thickness: Math.abs(patch.distance) } };
  }
  return replaceBody(d, next);
}

export function removeFeature(d: Design, bodyId: Id, featureId: Id): Design {
  const body = d.bodies.find((b) => b.id === bodyId);
  if (!body) return d;
  const features = dropFeatures(body.features, (f) => f.id === featureId);
  return features.length === 0 ? removeBody(d, bodyId) : replaceBody(d, { ...body, features });
}

export function structureLabel(s: Structure): string {
  switch (s.kind) {
    case 'plate': return `plate ${+(s.thickness * 1000).toFixed(2)} mm`;
    case 'tube': return `tube ${+(s.wall * 1000).toFixed(2)} mm wall`;
    case 'billet': return 'billet';
  }
}

// ---------------------------------------------------------------------------------------------
// components

export function addComponent(d: Design, inst: ComponentInstance): Design {
  return { ...d, components: [...d.components, inst] };
}

export function updateComponent(d: Design, id: Id, patch: Partial<Omit<ComponentInstance, 'id'>>): Design {
  return { ...d, components: d.components.map((c) => (c.id === id ? { ...c, ...patch } : c)) };
}

export function removeComponent(d: Design, id: Id): Design {
  const touches = (ids: readonly Id[]): boolean => ids.includes(id);
  return {
    ...d,
    bodies: d.bodies.map((b) => ({ ...b, features: b.features.filter((f) => !(f.kind === 'carve' && f.component === id)) })),
    components: d.components.filter((c) => c.id !== id),
    fasteners: d.fasteners.filter((f) => !touches(f.joins)),
    welds: d.welds.filter((w) => !touches(w.joins)),
    joints: d.joints.filter((j) => j.a !== id && j.b !== id && j.drive !== id),
    wiring: d.wiring.filter((w) => w.from.component !== id && w.to.component !== id),
    controls: { ...d.controls, outputs: d.controls.outputs.filter((o) => o.component !== id) },
  };
}

/** Ids of the bodies that carve a component. */
export function carvedBodies(d: Design, componentId: Id): Id[] {
  return d.bodies.filter((b) => b.features.some((f) => f.kind === 'carve' && f.component === componentId)).map((b) => b.id);
}

/**
 * Add a carve of `componentId` to each listed body that lacks one (on), or strip every carve of
 * it from the design (off).
 */
export function setCarve(d: Design, componentId: Id, bodyIds: readonly Id[], on: boolean, clearance = 0.001): Design {
  if (!on) {
    return { ...d, bodies: d.bodies.map((b) => ({ ...b, features: b.features.filter((f) => !(f.kind === 'carve' && f.component === componentId)) })) };
  }
  const taken = allIds(d);
  const bodies = d.bodies.map((b) => {
    if (!bodyIds.includes(b.id) || b.features.some((f) => f.kind === 'carve' && f.component === componentId)) return b;
    const id = nextId('carve', taken);
    taken.add(id);
    return { ...b, features: [...b.features, { kind: 'carve', id, component: componentId, clearance } as Feature] };
  });
  return { ...d, bodies };
}

// ---------------------------------------------------------------------------------------------
// planes to sketch on

export interface FacePlane {
  label: string;
  body: Id;
  plane: Plane;
}

/**
 * The two flat faces of every body whose first feature is an extrude, as planes whose normal points
 * out of the material so a cut sketched there goes in with a negative distance.
 */
export function facePlanes(d: Design, describe: (n: V3) => string): FacePlane[] {
  const out: FacePlane[] = [];
  for (const body of d.bodies) {
    const first = body.features[0];
    if (!first || first.kind !== 'extrude') continue;
    const sketch = d.sketches.find((s) => s.id === first.sketch);
    if (!sketch) continue;
    const { n } = planeBasis(sketch.plane);
    const h = Math.abs(first.distance);
    const s = first.distance < 0 ? -1 : 1;
    const o = sketch.plane.origin;
    const at = (k: number): V3 => [o[0] + n[0] * k, o[1] + n[1] * k, o[2] + n[2] * k];
    const [farK, nearK] = first.symmetric ? [h / 2, -h / 2] : [s * h, 0];
    const outward = (sign: number): V3 => [n[0] * sign, n[1] * sign, n[2] * sign];
    const farSign = first.symmetric ? 1 : s;
    out.push({ label: `${body.name} ${describe(outward(farSign))}`, body: body.id, plane: { origin: at(farK), normal: outward(farSign), xAxis: sketch.plane.xAxis } });
    out.push({ label: `${body.name} ${describe(outward(-farSign))}`, body: body.id, plane: { origin: at(nearK), normal: outward(-farSign), xAxis: sketch.plane.xAxis } });
  }
  return out;
}
