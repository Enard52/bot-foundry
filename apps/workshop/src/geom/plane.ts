import type { Plane, V2, V3 } from '@botfoundry/model';

// Sketch coordinates (u, v) map to origin + u * xAxis + v * (normal x xAxis), as in the model contract.

const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const unit = (a: V3): V3 => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

export interface PlaneBasis {
  u: V3;
  v: V3;
  n: V3;
}

export function planeBasis(plane: Plane): PlaneBasis {
  const n = unit(plane.normal);
  // re-orthogonalise xAxis against the normal so a slightly skewed input still gives a frame
  const d = dot(plane.xAxis, n);
  const u = unit([plane.xAxis[0] - d * n[0], plane.xAxis[1] - d * n[1], plane.xAxis[2] - d * n[2]]);
  return { u, v: cross(n, u), n };
}

export function planeToWorld(plane: Plane, p: V2): V3 {
  const { u, v } = planeBasis(plane);
  return [
    plane.origin[0] + p[0] * u[0] + p[1] * v[0],
    plane.origin[1] + p[0] * u[1] + p[1] * v[1],
    plane.origin[2] + p[0] * u[2] + p[1] * v[2],
  ];
}

/** Project a world point onto the plane's (u, v) coordinates. */
export function worldToPlane(plane: Plane, w: V3): V2 {
  const { u, v } = planeBasis(plane);
  const d: V3 = [w[0] - plane.origin[0], w[1] - plane.origin[1], w[2] - plane.origin[2]];
  return [dot(d, u), dot(d, v)];
}

/** The plane moved along its normal. */
export function offsetPlane(plane: Plane, distance: number): Plane {
  const n = unit(plane.normal);
  return {
    ...plane,
    origin: [plane.origin[0] + n[0] * distance, plane.origin[1] + n[1] * distance, plane.origin[2] + n[2] * distance],
  };
}

/** The same plane seen from the other side: normal flipped, u kept, so v flips too. */
export function flipPlane(plane: Plane): Plane {
  return { ...plane, normal: [-plane.normal[0], -plane.normal[1], -plane.normal[2]] };
}

/** Distance along the ray from `from` along `dir` to the plane, or null when parallel or behind. */
export function rayPlane(plane: Plane, from: V3, dir: V3): number | null {
  const n = unit(plane.normal);
  const denom = dot(dir, n);
  if (Math.abs(denom) < 1e-9) return null;
  const t = dot([plane.origin[0] - from[0], plane.origin[1] - from[1], plane.origin[2] - from[2]], n) / denom;
  return t >= 0 ? t : null;
}

/** Name of the signed world axis a unit vector points along, or null when it is not axis aligned. */
export function axisName(n: V3): string | null {
  const a = unit(n);
  const names = ['X', 'Y', 'Z'];
  for (let i = 0; i < 3; i++) {
    const c = a[i] as number;
    if (Math.abs(c) > 0.9995) return `${c > 0 ? '+' : '-'}${names[i]}`;
  }
  return null;
}
