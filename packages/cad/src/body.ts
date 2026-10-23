import type { CrossSection, Manifold, ManifoldToplevel, Vec2 } from 'manifold-3d';
import type { Body, BooleanOp, ComponentDef, Design, Feature, Id, Plane, Profile, Sketch, V2 } from '@botfoundry/model';
import { BOLT_DIAMETER } from '@botfoundry/model';
import { circleSegments, growPrimitive, primitiveManifold } from './primitives.ts';
import { CHORD_TOLERANCE, arcSegmentCount, tessellateProfile } from './profile.ts';
import { Scope } from './scope.ts';
import { asMat4, fromTransform, mul4, norm3, planeFrame, powM4, translation, type M4 } from './vec.ts';

// Feature-tree evaluation of one body. Everything is built directly in the design frame.

export type CatalogMap = ReadonlyMap<Id, ComponentDef>;

export interface FirstExtrude {
  plane: Plane;
  /** signed, along the plane normal */
  distance: number;
  symmetric: boolean;
}

export interface BodyBuild {
  /** the finished solid, owned by the caller; null when the tree produced nothing */
  manifold: Manifold | null;
  errors: string[];
  firstExtrude: FirstExtrude | undefined;
  /** component instances this body carves */
  carves: Id[];
}

/** Everything a body's geometry depends on, for the cache key. */
export function bodyInputs(design: Design, body: Body, catalog: CatalogMap): unknown {
  const sketchIds = new Set<Id>();
  const carves: unknown[] = [];
  for (const f of body.features) {
    if (f.kind === 'extrude' || f.kind === 'revolve') sketchIds.add(f.sketch);
    if (f.kind === 'carve') {
      const inst = design.components.find((c) => c.id === f.component);
      carves.push({ feature: f.id, instance: inst ?? null, def: inst ? (catalog.get(inst.def) ?? null) : null });
    }
  }
  return {
    body,
    sketches: [...sketchIds].map((id) => design.sketches.find((s) => s.id === id) ?? { missing: id }),
    carves,
  };
}

const TAPER_LIMIT = Math.PI / 2 - 1e-3;
/** hole diameter = bolt nominal diameter + 0.5 mm */
const HOLE_CLEARANCE = 0.0005;

interface Tool {
  tool: Manifold;
  op: BooleanOp;
}

export function buildBody(w: ManifoldToplevel, design: Design, body: Body, catalog: CatalogMap): BodyBuild {
  const scope = new Scope();
  const errors: string[] = [];
  const carves: Id[] = [];
  const tools = new Map<Id, Tool>();
  let current: Manifold | null = null;
  let firstExtrude: FirstExtrude | undefined;

  const sketchOf = (id: Id): Sketch => {
    const s = design.sketches.find((x) => x.id === id);
    if (!s) throw new Error(`sketch "${id}" does not exist`);
    return s;
  };

  const combine = (tool: Manifold, op: BooleanOp): void => {
    if (current === null) {
      if (op !== 'new' && op !== 'add') throw new Error(`nothing to ${op} from: the body has no material yet`);
      current = tool;
      return;
    }
    let next: Manifold;
    switch (op) {
      case 'new':
      case 'add': next = scope.track(current.add(tool)); break;
      case 'subtract': next = scope.track(current.subtract(tool)); break;
      case 'intersect': next = scope.track(current.intersect(tool)); break;
    }
    const status = next.status();
    if (status !== 'NoError') throw new Error(`boolean ${op} failed (${status})`);
    current = next;
  };

  body.features.forEach((f, index) => {
    const label = `feature ${index} (${f.kind} "${f.id}")`;
    try {
      if (index === 0) {
        if (f.kind !== 'extrude' && f.kind !== 'revolve') errors.push(`${label}: the first feature must create material (extrude or revolve with op 'new')`);
        else if (f.op !== 'new') errors.push(`${label}: the first feature must have op 'new'`);
      }
      switch (f.kind) {
        case 'extrude': {
          const sketch = sketchOf(f.sketch);
          const tool = scope.track(extrudeTool(w, scope, f, sketch));
          if (index === 0) firstExtrude = { plane: sketch.plane, distance: f.distance, symmetric: f.symmetric ?? false };
          tools.set(f.id, { tool, op: f.op });
          combine(tool, f.op);
          break;
        }
        case 'revolve': {
          const tool = scope.track(revolveTool(w, scope, f, sketchOf(f.sketch)));
          tools.set(f.id, { tool, op: f.op });
          combine(tool, f.op);
          break;
        }
        case 'mirror': {
          if (current === null) throw new Error('nothing to mirror: the body has no material yet');
          const n = norm3(f.plane.normal);
          const o = f.plane.origin;
          const moved = scope.track((current as Manifold).translate([-o[0], -o[1], -o[2]]));
          const flipped = scope.track(moved.mirror(n));
          const back = scope.track(flipped.translate([o[0], o[1], o[2]]));
          combine(back, 'add');
          break;
        }
        case 'pattern': {
          const src = tools.get(f.feature);
          if (!src) throw new Error(`refers to feature "${f.feature}", which is not an earlier extrude or revolve of this body`);
          if (!Number.isInteger(f.count) || f.count < 1) throw new Error('count must be a positive integer');
          const step = fromTransform(f.step);
          // count includes the original, which is already applied
          for (let k = 1; k < f.count; k++) {
            const instance = scope.track(src.tool.transform(asMat4(powM4(step, k))));
            combine(instance, src.op);
          }
          break;
        }
        case 'carve': {
          if (current === null) throw new Error('nothing to carve: the body has no material yet');
          carves.push(f.component);
          const cutters = carveTools(w, scope, design, body, catalog, f);
          const result = scope.track(w.Manifold.difference([current as Manifold, ...cutters]));
          const status = result.status();
          if (status !== 'NoError') throw new Error(`boolean subtract failed (${status})`);
          current = result;
          break;
        }
      }
    } catch (e) {
      errors.push(`${label}: ${e instanceof Error ? e.message : String(e)}`);
    }
  });

  // a plate is a constant-thickness sheet: its first feature has to extrude exactly the thickness
  if (body.structure.kind === 'plate') {
    const t = body.structure.thickness;
    const first = body.features[0];
    if (!(t > 0)) errors.push('plate thickness must be positive');
    else if (!first || first.kind !== 'extrude') errors.push(`plate "${body.name}": the first feature must be an extrude of the plate thickness (${t * 1000} mm)`);
    else if (Math.abs(Math.abs(first.distance) - t) > Math.max(1e-6, 1e-4 * t)) {
      errors.push(`plate "${body.name}": the first extrude is ${Math.abs(first.distance) * 1000} mm but the plate thickness is ${t * 1000} mm`);
    }
  }

  let out: Manifold | null = null;
  if (current !== null && !(current as Manifold).isEmpty()) out = scope.keep(current as Manifold);
  else if (current !== null) errors.push('the finished body has no material left');
  scope.dispose();
  return { manifold: out, errors, firstExtrude, carves };
}

// ---------------------------------------------------------------------------------------------
// extrude

function profileSelection(sketch: Sketch, selection: number[] | undefined): number[] {
  const all = sketch.profiles.map((_, i) => i);
  const picked = selection ?? all;
  if (picked.length === 0) throw new Error(`sketch "${sketch.name}" has no profiles to use`);
  for (const i of picked) if (!sketch.profiles[i]) throw new Error(`sketch "${sketch.name}" has no profile ${i}`);
  return picked;
}

/** Union of the selected profiles as a cross-section; `map` transforms sketch points first. */
function crossSectionOf(
  w: ManifoldToplevel, scope: Scope, sketch: Sketch, picked: number[],
  map?: (p: V2) => V2,
): CrossSection {
  const sections: CrossSection[] = [];
  for (const i of picked) {
    const t = tessellateProfile(sketch.profiles[i] as Profile);
    if (t.errors.length > 0) throw new Error(`sketch "${sketch.name}" profile ${i}: ${t.errors.join('; ')}`);
    const rings = map ? t.rings.map((r) => r.map(map)) : t.rings;
    sections.push(scope.track(new w.CrossSection(rings.map((r) => r.map((p) => [p[0], p[1]] as Vec2)), 'EvenOdd')));
  }
  const first = sections[0] as CrossSection;
  return sections.length === 1 ? first : scope.track(w.CrossSection.union(sections));
}

/**
 * Extrusion along +z from the cross-section, with a draft angle. Manifold scales the top about
 * the origin, so the section is centred on its bounding box and scaled per axis by
 * 1 - 2 h tan(taper) / extent. That puts every edge of a rectangle exactly h tan(taper) inward;
 * for other outlines it is the best uniform-scale approximation.
 */
function extrudeDrafted(scope: Scope, cs: CrossSection, height: number, taper: number): Manifold {
  if (Math.abs(taper) < 1e-9) return scope.track(cs.extrude(height));
  if (Math.abs(taper) > TAPER_LIMIT) throw new Error('taper must be less than 90 degrees');
  const b = cs.bounds();
  const cx = (b.min[0] + b.max[0]) / 2, cy = (b.min[1] + b.max[1]) / 2;
  const width = b.max[0] - b.min[0], depth = b.max[1] - b.min[1];
  const inset = height * Math.tan(taper);
  const sx = 1 - (2 * inset) / width, sy = 1 - (2 * inset) / depth;
  if (sx <= 1e-6 || sy <= 1e-6) throw new Error('the taper closes the profile before the end of the extrusion');
  const centred = scope.track(cs.translate([-cx, -cy]));
  const solid = scope.track(centred.extrude(height, 0, 0, [sx, sy]));
  return scope.track(solid.translate([cx, cy, 0]));
}

function extrudeTool(
  w: ManifoldToplevel, scope: Scope, f: Extract<Feature, { kind: 'extrude' }>, sketch: Sketch,
): Manifold {
  const frame = planeFrame(sketch.plane);
  const cs = crossSectionOf(w, scope, sketch, profileSelection(sketch, f.profiles));
  const h = Math.abs(f.distance);
  if (h < 1e-9) throw new Error('extrude distance is zero');
  const taper = f.taper ?? 0;
  let local: Manifold;
  if (f.symmetric) {
    if (Math.abs(taper) < 1e-9) {
      local = scope.track(cs.extrude(h, 0, 0, [1, 1], true));
    } else {
      const up = extrudeDrafted(scope, cs, h / 2, taper);
      const down = scope.track(up.mirror([0, 0, 1]));
      local = scope.track(up.add(down));
    }
  } else {
    const up = extrudeDrafted(scope, cs, h, taper);
    local = f.distance < 0 ? scope.track(up.mirror([0, 0, 1])) : up;
  }
  return local.transform(asMat4(frame.matrix));
}

// ---------------------------------------------------------------------------------------------
// revolve

// manifold revolves about its Y axis and returns the result with that axis as Z:
// (r, y) -> (r cos φ, r sin φ, y). This takes that frame to the sketch frame where the axis is +y,
// profile on +x, and a positive sweep turns right-handed about the axis direction.
const REVOLVE_TO_SKETCH: M4 = [1, 0, 0, 0, 0, 0, -1, 0, 0, 1, 0, 0, 0, 0, 0, 1];

function rotateAboutY(angle: number): M4 {
  const c = Math.cos(angle), s = Math.sin(angle);
  return [c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1];
}

function revolveTool(
  w: ManifoldToplevel, scope: Scope, f: Extract<Feature, { kind: 'revolve' }>, sketch: Sketch,
): Manifold {
  const frame = planeFrame(sketch.plane);
  const o = f.axis.origin;
  const dl = Math.hypot(f.axis.direction[0], f.axis.direction[1]);
  if (dl < 1e-12) throw new Error('revolve axis has no direction');
  const dx = f.axis.direction[0] / dl, dy = f.axis.direction[1] / dl;
  if (!(f.angle > 1e-9)) throw new Error('revolve angle must be positive');
  const sweep = Math.min(f.angle, 2 * Math.PI);
  const full = sweep >= 2 * Math.PI - 1e-9;

  // sketch point -> (distance right of the axis, distance along it)
  const toAxisFrame = (p: V2): V2 => {
    const rx = p[0] - o[0], ry = p[1] - o[1];
    return [rx * dy - ry * dx, rx * dx + ry * dy];
  };
  const picked = profileSelection(sketch, f.profiles);
  let minR = Infinity, maxR = -Infinity;
  for (const i of picked) {
    const t = tessellateProfile(sketch.profiles[i] as Profile);
    if (t.errors.length > 0) throw new Error(`sketch "${sketch.name}" profile ${i}: ${t.errors.join('; ')}`);
    for (const ring of t.rings) for (const p of ring) {
      const r = toAxisFrame(p)[0];
      minR = Math.min(minR, r);
      maxR = Math.max(maxR, r);
    }
  }
  const eps = 1e-9;
  if (minR < -eps && maxR > eps) throw new Error('the profile crosses the revolve axis');
  // profiles on the left of the axis are mirrored across it, revolved, then mirrored back
  const leftSide = maxR <= eps;
  const map = (p: V2): V2 => {
    const q = toAxisFrame(p);
    return leftSide ? [-q[0], q[1]] : q;
  };
  const cs = crossSectionOf(w, scope, sketch, picked, map);
  const radius = leftSide ? -minR : maxR;
  const segments = Math.min(256, Math.max(12, arcSegmentCount(radius, 2 * Math.PI, CHORD_TOLERANCE)));
  const solid = scope.track(cs.revolve(segments, full ? 360 : (sweep * 180) / Math.PI));

  let m = REVOLVE_TO_SKETCH;
  if (leftSide) {
    // mirrored profile sweeps the opposite way: sweep it over [-θ, 0], then flip x
    const flipX: M4 = [-1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
    m = mul4(flipX, mul4(rotateAboutY(full ? 0 : -sweep), m));
  }
  // axis frame -> sketch coordinates: rotate so +y is the axis direction, then shift to the origin
  const axisToSketch: M4 = [dy, -dx, 0, 0, dx, dy, 0, 0, 0, 0, 1, 0, o[0], o[1], 0, 1];
  return solid.transform(asMat4(mul4(frame.matrix, mul4(axisToSketch, m))));
}

// ---------------------------------------------------------------------------------------------
// carve

function carveTools(
  w: ManifoldToplevel, scope: Scope, design: Design, body: Body, catalog: CatalogMap,
  f: Extract<Feature, { kind: 'carve' }>,
): Manifold[] {
  const inst = design.components.find((c) => c.id === f.component);
  if (!inst) throw new Error(`component "${f.component}" does not exist`);
  const def = catalog.get(inst.def);
  if (!def) throw new Error(`component "${f.component}" uses unknown catalog part "${inst.def}"`);
  if (!(f.clearance >= 0)) throw new Error('clearance must not be negative');
  const pose = fromTransform(inst.pose);
  const cutters: Manifold[] = def.keepOut.map((p) => scope.track(primitiveManifold(w, growPrimitive(p, f.clearance), pose)));

  // clearance holes through the body the part is bolted to
  if (inst.mountedTo === body.id) {
    for (const mount of def.mounts) {
      const face = planeFrame(mount.face);
      for (const hole of mount.holes) {
        const radius = (BOLT_DIAMETER[hole.bolt.size] + HOLE_CLEARANCE) / 2;
        // reach one bolt length either side of the mount face: the material the bolt actually passes through
        const place = mul4(pose, mul4(face.matrix, translation([hole.at[0], hole.at[1], 0])));
        const cyl = scope.track(w.Manifold.cylinder(2 * hole.bolt.length, radius, radius, circleSegments(radius), true));
        cutters.push(scope.track(cyl.transform(asMat4(place))));
      }
    }
  }
  return cutters;
}

