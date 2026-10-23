import type { BodySystem } from './body.ts';

// Stamping helpers and the dense 6x6 solve for one body's AVBD primal step.
// lhs is row-major 6x6 with unknowns [Δx(3), Δθ(3)]; only entries with row ≥ column are used.

export function createSystem(): BodySystem {
  return { lhs: new Float64Array(36), rhs: new Float64Array(6) };
}

/** lhs += k·j·jᵀ, rhs += j·f for one scalar constraint row with Jacobian j (6 entries). */
export function stampRow(sys: BodySystem, j: Float64Array, k: number, f: number): void {
  const lhs = sys.lhs, rhs = sys.rhs;
  for (let r = 0; r < 6; r++) {
    const jr = j[r]!;
    if (jr === 0) continue;
    rhs[r] = rhs[r]! + jr * f;
    const kj = k * jr;
    for (let c = 0; c <= r; c++) lhs[r * 6 + c] = lhs[r * 6 + c]! + kj * j[c]!;
  }
}

/** Same as stampRow for a purely angular row with Jacobian (0, 0, 0, jx, jy, jz). */
export function stampAngularRow(sys: BodySystem, jx: number, jy: number, jz: number, k: number, f: number): void {
  const lhs = sys.lhs, rhs = sys.rhs;
  rhs[3] = rhs[3]! + jx * f;
  rhs[4] = rhs[4]! + jy * f;
  rhs[5] = rhs[5]! + jz * f;
  lhs[21] = lhs[21]! + k * jx * jx;
  lhs[27] = lhs[27]! + k * jy * jx;
  lhs[28] = lhs[28]! + k * jy * jy;
  lhs[33] = lhs[33]! + k * jz * jx;
  lhs[34] = lhs[34]! + k * jz * jy;
  lhs[35] = lhs[35]! + k * jz * jz;
}

const L = new Float64Array(36);
const D = new Float64Array(6);
const Y = new Float64Array(6);

/**
 * Solve lhs·x = −rhs by LDLᵀ (lhs is symmetric positive definite: M/h² plus PSD stamps).
 * Writes the six unknowns to out.
 */
export function solveSystem(sys: BodySystem, out: Float64Array): void {
  const a = sys.lhs;
  for (let j = 0; j < 6; j++) {
    let d = a[j * 6 + j]!;
    for (let k = 0; k < j; k++) d -= L[j * 6 + k]! * L[j * 6 + k]! * D[k]!;
    D[j] = d;
    const inv = 1 / d;
    for (let i = j + 1; i < 6; i++) {
      let s = a[i * 6 + j]!;
      for (let k = 0; k < j; k++) s -= L[i * 6 + k]! * L[j * 6 + k]! * D[k]!;
      L[i * 6 + j] = s * inv;
    }
  }
  const b = sys.rhs;
  for (let i = 0; i < 6; i++) {
    let s = -b[i]!;
    for (let k = 0; k < i; k++) s -= L[i * 6 + k]! * Y[k]!;
    Y[i] = s;
  }
  for (let i = 5; i >= 0; i--) {
    let s = Y[i]! / D[i]!;
    for (let k = i + 1; k < 6; k++) s -= L[k * 6 + i]! * out[k]!;
    out[i] = s;
  }
}
