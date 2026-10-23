import type { Body, BodySystem, Constraint } from './body.ts';
import { MAX_CONTACTS, type ContactOut } from './collide.ts';
import { bodyDelta } from './joint.ts';
import { cross3, rotate, rotateInv, tangentBasis, vec3 } from './math.ts';
import { rampPenalty, warmPenalty, type SolverParams } from './params.ts';
import { stampRow } from './system.ts';

// Frictional contact manifold for AVBD, after the reference Manifold in avbd-demo3d (Giles, MIT):
// three rows per point (normal, two tangents) linearised at the start of the substep (paper Sec. 4),
// the normal force clamped to push only, and the tangential force clamped to the Coulomb cone
// |f_t| ≤ μ|f_n|. Points that stuck last substep keep their anchors, which gives static friction.
// Sign convention as in joint.ts: rows are C = basis · (x_A − x_B) with the normal pointing from B
// to A, and the force on body X is −J_Xᵀ·λ; a pushing contact has λ_n < 0.

const xA = vec3(), xB = vec3(), rAw = vec3(), rBw = vec3(), row = vec3(), T = vec3();
const dqA = new Float64Array(6), dqB = new Float64Array(6);
const J6 = new Float64Array(6);
const F = new Float64Array(3);
const C = new Float64Array(3);

// merge scratch
const nPen = new Float64Array(3 * MAX_CONTACTS);
const nLam = new Float64Array(3 * MAX_CONTACTS);
const nRA = new Float64Array(3 * MAX_CONTACTS);
const nRB = new Float64Array(3 * MAX_CONTACTS);
const nStick = new Uint8Array(MAX_CONTACTS);

export class Manifold implements Constraint {
  readonly a: Body;
  readonly b: Body;
  readonly key: number;
  readonly params: SolverParams;
  readonly friction: number;
  readonly k0: number;
  /** substep in which collision last reported this pair */
  seen = -1;

  count = 0;
  readonly feature = new Float64Array(MAX_CONTACTS);
  /** contact offsets in each body's frame, flat xyz */
  readonly rA = new Float64Array(3 * MAX_CONTACTS);
  readonly rB = new Float64Array(3 * MAX_CONTACTS);
  /** rows: normal (B to A), tangent 1, tangent 2 */
  readonly basis = new Float64Array(9);
  readonly C0 = new Float64Array(3 * MAX_CONTACTS);
  readonly penalty = new Float64Array(3 * MAX_CONTACTS);
  readonly lambda = new Float64Array(3 * MAX_CONTACTS);
  readonly stick = new Uint8Array(MAX_CONTACTS);
  /** Jacobians frozen at the start of the substep: contact × row × 6 */
  readonly JA = new Float64Array(18 * MAX_CONTACTS);
  readonly JB = new Float64Array(18 * MAX_CONTACTS);

  constructor(a: Body, b: Body, key: number, params: SolverParams) {
    this.a = a;
    this.b = b;
    this.key = key;
    this.params = params;
    // Material.friction is against steel; the arena floor is steel, so a ground contact uses the
    // part's own value and two parts combine geometrically (as the reference does).
    this.friction = b.isGround ? a.friction : Math.sqrt(a.friction * b.friction);
    const m = Math.min(a.isStatic ? Infinity : a.mass, b.isStatic ? Infinity : b.mass);
    this.k0 = Number.isFinite(m) ? m / (params.dt * params.dt) : 0;
  }

  /** Take this substep's collision result, carrying multipliers over by feature key. */
  update(out: ContactOut, step: number): void {
    this.seen = step;
    const a = this.a, b = this.b;
    for (let i = 0; i < out.count; i++) {
      let match = -1;
      for (let j = 0; j < this.count; j++) {
        if (this.feature[j] === out.feature[i]) {
          match = j;
          break;
        }
      }
      if (match >= 0) {
        for (let r = 0; r < 3; r++) {
          nPen[i * 3 + r] = this.penalty[match * 3 + r]!;
          nLam[i * 3 + r] = this.lambda[match * 3 + r]!;
        }
        nStick[i] = this.stick[match]!;
      } else {
        for (let r = 0; r < 3; r++) {
          nPen[i * 3 + r] = 0;
          nLam[i * 3 + r] = 0;
        }
        nStick[i] = 0;
      }
      if (match >= 0 && this.stick[match]) {
        for (let r = 0; r < 3; r++) {
          nRA[i * 3 + r] = this.rA[match * 3 + r]!;
          nRB[i * 3 + r] = this.rB[match * 3 + r]!;
        }
      } else {
        for (let r = 0; r < 3; r++) {
          T[r] = out.pA[i * 3 + r]! - a.pos[r]!;
          row[r] = out.pB[i * 3 + r]! - b.pos[r]!;
        }
        rotateInv(T, a.rot, T);
        rotateInv(row, b.rot, row);
        for (let r = 0; r < 3; r++) {
          nRA[i * 3 + r] = T[r]!;
          nRB[i * 3 + r] = row[r]!;
        }
      }
    }
    this.count = out.count;
    for (let i = 0; i < out.count; i++) this.feature[i] = out.feature[i]!;
    this.penalty.set(nPen);
    this.lambda.set(nLam);
    this.rA.set(nRA);
    this.rB.set(nRB);
    this.stick.set(nStick);
    tangentBasis(out.normal, T, row);
    this.basis.set(out.normal, 0);
    this.basis.set(T, 3);
    this.basis.set(row, 6);
  }

  prepare(): boolean {
    if (this.count === 0) return false;
    const p = this.params;
    const a = this.a, b = this.b;
    const decay = p.alpha * p.gamma;
    for (let i = 0; i < this.count; i++) {
      for (let r = 0; r < 3; r++) {
        rAw[r] = this.rA[i * 3 + r]!;
        rBw[r] = this.rB[i * 3 + r]!;
      }
      rotate(rAw, a.rot, rAw);
      rotate(rBw, b.rot, rBw);
      for (let r = 0; r < 3; r++) {
        xA[r] = a.pos[r]! + rAw[r]!;
        xB[r] = b.pos[r]! + rBw[r]!;
      }
      for (let r = 0; r < 3; r++) {
        row[0] = this.basis[r * 3]!;
        row[1] = this.basis[r * 3 + 1]!;
        row[2] = this.basis[r * 3 + 2]!;
        const c0 = row[0]! * (xA[0]! - xB[0]!) + row[1]! * (xA[1]! - xB[1]!) + row[2]! * (xA[2]! - xB[2]!);
        // a speculative gap is kept exactly; only the correction of penetration and anchor drift
        // is softened by alpha (the reference's C0·(1 − α))
        this.C0[i * 3 + r] = r === 0 && c0 > 0 ? c0 : (1 - p.alpha) * c0;
        const o = (i * 3 + r) * 6;
        cross3(T, rAw, row);
        this.JA[o] = row[0]!;
        this.JA[o + 1] = row[1]!;
        this.JA[o + 2] = row[2]!;
        this.JA[o + 3] = T[0]!;
        this.JA[o + 4] = T[1]!;
        this.JA[o + 5] = T[2]!;
        cross3(T, rBw, row);
        this.JB[o] = -row[0]!;
        this.JB[o + 1] = -row[1]!;
        this.JB[o + 2] = -row[2]!;
        this.JB[o + 3] = -T[0]!;
        this.JB[o + 4] = -T[1]!;
        this.JB[o + 5] = -T[2]!;
        this.lambda[i * 3 + r] = this.lambda[i * 3 + r]! * decay;
        this.penalty[i * 3 + r] = warmPenalty(this.penalty[i * 3 + r]!, p, this.k0, p.contactPenaltyMin);
      }
    }
    return true;
  }

  /** C and the clamped F of contact i into the module scratch; returns whether the friction is inside the cone. */
  private evaluate(i: number): boolean {
    for (let r = 0; r < 3; r++) {
      const o = (i * 3 + r) * 6;
      let c = this.C0[i * 3 + r]!;
      for (let k = 0; k < 6; k++) c += this.JA[o + k]! * dqA[k]! + this.JB[o + k]! * dqB[k]!;
      C[r] = c;
      F[r] = this.penalty[i * 3 + r]! * c + this.lambda[i * 3 + r]!;
    }
    if (F[0]! > 0) F[0] = 0;
    const bound = -F[0]! * this.friction;
    const ft = Math.sqrt(F[1]! * F[1]! + F[2]! * F[2]!);
    if (ft > bound && ft > 0) {
      const s = bound / ft;
      F[1] = F[1]! * s;
      F[2] = F[2]! * s;
      return false;
    }
    return true;
  }

  stamp(body: Body, sys: BodySystem): void {
    const isA = body === this.a;
    const J = isA ? this.JA : this.JB;
    bodyDelta(this.a, dqA);
    bodyDelta(this.b, dqB);
    for (let i = 0; i < this.count; i++) {
      // As in the reference, a point stamps its stiffness even while its force is clamped to zero:
      // the K term then acts as a proximal damping on that iteration's step, which is what keeps an
      // impact from bouncing between the active and inactive sets within one substep.
      this.evaluate(i);
      for (let r = 0; r < 3; r++) {
        const o = (i * 3 + r) * 6;
        for (let k = 0; k < 6; k++) J6[k] = J[o + k]!;
        stampRow(sys, J6, this.penalty[i * 3 + r]!, F[r]!);
      }
    }
  }

  dual(): void {
    const p = this.params;
    bodyDelta(this.a, dqA);
    bodyDelta(this.b, dqB);
    const stickTol = p.stickSpeed * p.dt;
    for (let i = 0; i < this.count; i++) {
      const inCone = this.evaluate(i);
      for (let r = 0; r < 3; r++) this.lambda[i * 3 + r] = F[r]!;
      if (F[0]! < 0) {
        this.penalty[i * 3] = rampPenalty(this.penalty[i * 3]!, Math.abs(C[0]!), p.contactBeta, p, this.k0);
      }
      if (inCone) {
        this.penalty[i * 3 + 1] = rampPenalty(this.penalty[i * 3 + 1]!, Math.abs(C[1]!), p.contactBeta, p, this.k0);
        this.penalty[i * 3 + 2] = rampPenalty(this.penalty[i * 3 + 2]!, Math.abs(C[2]!), p.contactBeta, p, this.k0);
        this.stick[i] = Math.sqrt(C[1]! * C[1]! + C[2]! * C[2]!) < stickTol ? 1 : 0;
      } else {
        this.stick[i] = 0;
      }
    }
  }
}
