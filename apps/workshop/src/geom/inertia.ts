import type { Sym3, V3 } from '@botfoundry/model';

/**
 * Principal moments of a symmetric 3x3 inertia tensor, ascending. Closed form for the
 * eigenvalues of a symmetric matrix (Smith 1961, "Eigenvalues of a symmetric 3x3 matrix").
 * Input order is [Ixx, Iyy, Izz, Ixy, Ixz, Iyz] with the off-diagonals as tensor entries.
 */
export function principalMoments(t: Sym3): V3 {
  const [a, b, c, ab, ac, bc] = t;
  const p1 = ab * ab + ac * ac + bc * bc;
  if (p1 === 0) {
    const d = [a, b, c].sort((x, y) => x - y);
    return [d[0] as number, d[1] as number, d[2] as number];
  }
  const q = (a + b + c) / 3;
  const p2 = (a - q) ** 2 + (b - q) ** 2 + (c - q) ** 2 + 2 * p1;
  const p = Math.sqrt(p2 / 6);
  // B = (A - qI) / p, det(B) / 2 = cos(3 phi)
  const b11 = (a - q) / p, b22 = (b - q) / p, b33 = (c - q) / p;
  const b12 = ab / p, b13 = ac / p, b23 = bc / p;
  const detB =
    b11 * (b22 * b33 - b23 * b23) - b12 * (b12 * b33 - b23 * b13) + b13 * (b12 * b23 - b22 * b13);
  const r = Math.max(-1, Math.min(1, detB / 2));
  const phi = Math.acos(r) / 3;
  const e3 = q + 2 * p * Math.cos(phi);
  const e1 = q + 2 * p * Math.cos(phi + (2 * Math.PI) / 3);
  const e2 = 3 * q - e1 - e3;
  return [e1, e2, e3];
}
