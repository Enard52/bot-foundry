import type { Manifold, ManifoldToplevel } from 'manifold-3d';
import type { Primitive, Sym3, V3 } from '@botfoundry/model';
import { arcSegmentCount, CHORD_TOLERANCE } from './profile.ts';
import { applyPoint, asMat4, fromBasis, mul4, translation, type M4 } from './vec.ts';

/** Segments around a circle of the given radius at the chord tolerance, even and at least 12 so rings stay round. */
export function circleSegments(radius: number): number {
  const n = arcSegmentCount(radius, 2 * Math.PI, CHORD_TOLERANCE);
  return Math.max(12, n + (n % 2));
}

/** Rotation taking the cylinder's native +z axis to the requested axis. */
function axisFrame(axis: 'x' | 'y' | 'z'): M4 {
  if (axis === 'z') return fromBasis([1, 0, 0], [0, 1, 0], [0, 0, 1], [0, 0, 0]);
  if (axis === 'x') return fromBasis([0, 1, 0], [0, 0, 1], [1, 0, 0], [0, 0, 0]);
  return fromBasis([0, 0, 1], [1, 0, 0], [0, 1, 0], [0, 0, 0]);
}

/** Primitive grown outward by `grow` on every side (negative shrinks). */
export function growPrimitive(p: Primitive, grow: number): Primitive {
  if (p.kind === 'box') {
    return { ...p, size: [p.size[0] + 2 * grow, p.size[1] + 2 * grow, p.size[2] + 2 * grow] };
  }
  return { ...p, radius: p.radius + grow, length: p.length + 2 * grow };
}

/** The primitive as a manifold, moved by `pose` (local frame to design frame). */
export function primitiveManifold(w: ManifoldToplevel, p: Primitive, pose: readonly number[]): Manifold {
  const { Manifold } = w;
  if (p.kind === 'box') {
    const base = Manifold.cube([...p.size], true);
    const placed = base.transform(asMat4(mul4(pose, translation(p.at))));
    base.delete();
    return placed;
  }
  const base = Manifold.cylinder(p.length, p.radius, p.radius, circleSegments(p.radius), true);
  const placed = base.transform(asMat4(mul4(pose, mul4(translation(p.at), axisFrame(p.axis)))));
  base.delete();
  return placed;
}

export function primitiveVolume(p: Primitive): number {
  return p.kind === 'box' ? p.size[0] * p.size[1] * p.size[2] : Math.PI * p.radius * p.radius * p.length;
}

/** Inertia tensor of a uniform solid of the given mass about its own centre, local axes. */
export function primitiveInertia(p: Primitive, mass: number): Sym3 {
  if (p.kind === 'box') {
    const [x, y, z] = p.size;
    return [(mass * (y * y + z * z)) / 12, (mass * (x * x + z * z)) / 12, (mass * (x * x + y * y)) / 12, 0, 0, 0];
  }
  const axial = (mass * p.radius * p.radius) / 2;
  const radial = (mass * (3 * p.radius * p.radius + p.length * p.length)) / 12;
  if (p.axis === 'x') return [axial, radial, radial, 0, 0, 0];
  if (p.axis === 'y') return [radial, axial, radial, 0, 0, 0];
  return [radial, radial, axial, 0, 0, 0];
}

/** Vertices of the primitive's convex polytope in the design frame (cylinders as inscribed rings). */
export function primitiveVertices(p: Primitive, pose: readonly number[]): V3[] {
  const out: V3[] = [];
  if (p.kind === 'box') {
    for (const sx of [-0.5, 0.5]) for (const sy of [-0.5, 0.5]) for (const sz of [-0.5, 0.5]) {
      out.push(applyPoint(pose, [p.at[0] + sx * p.size[0], p.at[1] + sy * p.size[1], p.at[2] + sz * p.size[2]]));
    }
    return out;
  }
  const frame = mul4(translation(p.at), axisFrame(p.axis));
  const n = circleSegments(p.radius);
  for (const z of [-p.length / 2, p.length / 2]) {
    for (let i = 0; i < n; i++) {
      const a = (2 * Math.PI * i) / n;
      out.push(applyPoint(pose, applyPoint(frame, [p.radius * Math.cos(a), p.radius * Math.sin(a), z])));
    }
  }
  return out;
}
