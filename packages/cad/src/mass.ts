import type { MassProperties, Primitive, Sym3, V3 } from '@botfoundry/model';
import { primitiveInertia, primitiveVolume } from './primitives.ts';
import { applyPoint, type M4 } from './vec.ts';

export const ZERO_MASS: MassProperties = { mass: 0, volume: 0, com: [0, 0, 0], inertia: [0, 0, 0, 0, 0, 0] };

/**
 * Exact volume, centre of mass and inertia tensor of a closed, outward-oriented triangle mesh of
 * uniform density, by the divergence theorem (D. Eberly, "Polyhedral Mass Properties (Revisited)",
 * Geometric Tools, 2002). Off-diagonal entries are tensor entries, i.e. minus the products of inertia.
 */
export function meshMassProperties(positions: ArrayLike<number>, indices: ArrayLike<number>, density: number): MassProperties {
  const nv = positions.length / 3;
  if (nv === 0 || indices.length === 0) return ZERO_MASS;

  // work relative to the bounding-box centre to keep the cubic sums well conditioned
  let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < nv; i++) {
    const x = positions[3 * i] as number, y = positions[3 * i + 1] as number, z = positions[3 * i + 2] as number;
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
  }
  const ox = (minX + maxX) / 2, oy = (minY + maxY) / 2, oz = (minZ + maxZ) / 2;

  let i0 = 0, ix = 0, iy = 0, iz = 0, ixx = 0, iyy = 0, izz = 0, ixy = 0, iyz = 0, izx = 0;
  for (let t = 0; t < indices.length; t += 3) {
    const a = 3 * (indices[t] as number), b = 3 * (indices[t + 1] as number), c = 3 * (indices[t + 2] as number);
    const x0 = (positions[a] as number) - ox, y0 = (positions[a + 1] as number) - oy, z0 = (positions[a + 2] as number) - oz;
    const x1 = (positions[b] as number) - ox, y1 = (positions[b + 1] as number) - oy, z1 = (positions[b + 2] as number) - oz;
    const x2 = (positions[c] as number) - ox, y2 = (positions[c + 1] as number) - oy, z2 = (positions[c + 2] as number) - oz;

    const a1 = x1 - x0, b1 = y1 - y0, c1 = z1 - z0;
    const a2 = x2 - x0, b2 = y2 - y0, c2 = z2 - z0;
    const d0 = b1 * c2 - b2 * c1;
    const d1 = a2 * c1 - a1 * c2;
    const d2 = a1 * b2 - a2 * b1;

    const f1x = x0 + x1 + x2;
    const f2x = x0 * x0 + x1 * (x0 + x1) + x2 * f1x;
    const f3x = x0 * x0 * x0 + x1 * (x0 * x0 + x1 * (x0 + x1)) + x2 * f2x;
    const g0x = f2x + x0 * (f1x + x0), g1x = f2x + x1 * (f1x + x1), g2x = f2x + x2 * (f1x + x2);

    const f1y = y0 + y1 + y2;
    const f2y = y0 * y0 + y1 * (y0 + y1) + y2 * f1y;
    const f3y = y0 * y0 * y0 + y1 * (y0 * y0 + y1 * (y0 + y1)) + y2 * f2y;
    const g0y = f2y + y0 * (f1y + y0), g1y = f2y + y1 * (f1y + y1), g2y = f2y + y2 * (f1y + y2);

    const f1z = z0 + z1 + z2;
    const f2z = z0 * z0 + z1 * (z0 + z1) + z2 * f1z;
    const f3z = z0 * z0 * z0 + z1 * (z0 * z0 + z1 * (z0 + z1)) + z2 * f2z;
    const g0z = f2z + z0 * (f1z + z0), g1z = f2z + z1 * (f1z + z1), g2z = f2z + z2 * (f1z + z2);

    i0 += d0 * f1x;
    ix += d0 * f2x;
    iy += d1 * f2y;
    iz += d2 * f2z;
    ixx += d0 * f3x;
    iyy += d1 * f3y;
    izz += d2 * f3z;
    ixy += d0 * (y0 * g0x + y1 * g1x + y2 * g2x);
    iyz += d1 * (z0 * g0y + z1 * g1y + z2 * g2y);
    izx += d2 * (x0 * g0z + x1 * g1z + x2 * g2z);
  }
  const volume = i0 / 6;
  if (!(volume > 0)) return ZERO_MASS;
  ix /= 24; iy /= 24; iz /= 24;
  ixx /= 60; iyy /= 60; izz /= 60;
  ixy /= 120; iyz /= 120; izx /= 120;

  const cx = ix / volume, cy = iy / volume, cz = iz / volume;
  // second moments about the centre of mass, per unit density
  const sxx = iyy + izz - volume * (cy * cy + cz * cz);
  const syy = ixx + izz - volume * (cz * cz + cx * cx);
  const szz = ixx + iyy - volume * (cx * cx + cy * cy);
  const sxy = -(ixy - volume * cx * cy);
  const syz = -(iyz - volume * cy * cz);
  const sxz = -(izx - volume * cz * cx);
  const k = density;
  return {
    mass: volume * k,
    volume,
    com: [cx + ox, cy + oy, cz + oz],
    inertia: [sxx * k, syy * k, szz * k, sxy * k, sxz * k, syz * k],
  };
}

/** Inertia about a point displaced by d from the centre of mass (parallel-axis theorem), tensor entries. */
function shiftInertia(i: Sym3, mass: number, d: V3): Sym3 {
  const [dx, dy, dz] = d;
  return [
    i[0] + mass * (dy * dy + dz * dz),
    i[1] + mass * (dx * dx + dz * dz),
    i[2] + mass * (dx * dx + dy * dy),
    i[3] - mass * dx * dy,
    i[4] - mass * dx * dz,
    i[5] - mass * dy * dz,
  ];
}

/** Combine rigid bodies into one: summed mass, mass-weighted COM, inertia about the combined COM. */
export function combineMass(parts: readonly MassProperties[]): MassProperties {
  let mass = 0, volume = 0, cx = 0, cy = 0, cz = 0;
  for (const p of parts) {
    mass += p.mass;
    volume += p.volume;
    cx += p.mass * p.com[0];
    cy += p.mass * p.com[1];
    cz += p.mass * p.com[2];
  }
  if (mass <= 0) return { ...ZERO_MASS, volume };
  const com: V3 = [cx / mass, cy / mass, cz / mass];
  const inertia: number[] = [0, 0, 0, 0, 0, 0];
  for (const p of parts) {
    if (p.mass <= 0) continue;
    const s = shiftInertia(p.inertia, p.mass, [p.com[0] - com[0], p.com[1] - com[1], p.com[2] - com[2]]);
    for (let i = 0; i < 6; i++) inertia[i] = (inertia[i] ?? 0) + (s[i] ?? 0);
  }
  return { mass, volume, com, inertia: inertia as unknown as Sym3 };
}

/** R I Rᵀ for a symmetric tensor and a rotation given as the upper 3x3 of a 4x4 column-major matrix. */
export function rotateInertia(i: Sym3, r: readonly number[]): Sym3 {
  const m = [
    [i[0], i[3], i[4]],
    [i[3], i[1], i[5]],
    [i[4], i[5], i[2]],
  ];
  const R = [
    [r[0] ?? 0, r[4] ?? 0, r[8] ?? 0],
    [r[1] ?? 0, r[5] ?? 0, r[9] ?? 0],
    [r[2] ?? 0, r[6] ?? 0, r[10] ?? 0],
  ];
  const out = (a: number, b: number): number => {
    let s = 0;
    for (let p = 0; p < 3; p++) for (let q = 0; q < 3; q++) s += (R[a]?.[p] ?? 0) * (m[p]?.[q] ?? 0) * (R[b]?.[q] ?? 0);
    return s;
  };
  return [out(0, 0), out(1, 1), out(2, 2), out(0, 1), out(0, 2), out(1, 2)];
}

/**
 * Mass properties of a catalog component: the catalog mass spread uniformly over its geometry
 * primitives (density = mass / total primitive volume), placed by `pose`.
 */
export function componentMass(geometry: readonly Primitive[], mass: number, pose: M4): MassProperties {
  const volumes = geometry.map(primitiveVolume);
  const total = volumes.reduce((a, b) => a + b, 0);
  if (total <= 0 || mass <= 0) return { ...ZERO_MASS, mass: Math.max(0, mass) };
  const parts: MassProperties[] = geometry.map((p, k) => {
    const m = (mass * (volumes[k] as number)) / total;
    return { mass: m, volume: volumes[k] as number, com: p.at, inertia: primitiveInertia(p, m) };
  });
  const local = combineMass(parts);
  return {
    mass: local.mass,
    volume: total,
    com: applyPoint(pose, local.com),
    inertia: rotateInertia(local.inertia, pose),
  };
}
