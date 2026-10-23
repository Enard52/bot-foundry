import type { Vec3 } from './math.ts';

/**
 * Solver parameters. The AVBD reference (avbd-demo3d, MIT) tunes absolute penalty ramps for a
 * 60 Hz step and unit masses; at 1 kHz and masses from grams to hundreds of kilograms those
 * values ramp far too slowly, so penalties here are relative to each constraint's base stiffness
 * k0 = m/h² (linear) or I/h² (angular) of the lighter body it touches. A row's penalty starts at
 * penaltyMin·k0, grows by beta·k0·|C| each iteration (Giles et al. 2025, Eq. 16) and is capped at
 * penaltyMax·k0.
 */
export interface SolverParams {
  dt: number;
  iterations: number;
  gravity: Vec3;
  /** stabilisation: the fraction of the start-of-substep error left uncorrected per substep */
  alpha: number;
  /** warm-start decay of penalties and multipliers per substep (Eq. 19) */
  gamma: number;
  /** joints: penalty ramp per metre of linear error, in units of k0 */
  betaLin: number;
  /** joints: penalty ramp per radian of angular error, in units of k0 */
  betaAng: number;
  /** joints: starting penalty, in units of k0 */
  penaltyMin: number;
  /** contacts: penalty ramp per metre, in units of k0 */
  contactBeta: number;
  /** contacts: starting penalty, in units of k0 */
  contactPenaltyMin: number;
  /** cap for every penalty, in units of k0 */
  penaltyMax: number;
  /** contacts are created this far apart (speculatively), m */
  margin: number;
  /** a contact whose tangential slip this substep stays under stickSpeed·dt keeps its anchors */
  stickSpeed: number;
}

export function defaultParams(dt: number, iterations: number, gravity: Vec3): SolverParams {
  return {
    dt,
    iterations,
    gravity,
    alpha: 0.95,
    gamma: 0.999,
    // Joints start stiff and ramp fast: a load applied at rest then reads within 0.1 % from the
    // first substep instead of sagging and overshooting by 7 %. Contacts stay softer, since a stiff
    // saturated friction row drags a sliding contact (with these values μ reads about 5 % high).
    betaLin: 1e6,
    betaAng: 1e4,
    penaltyMin: 1,
    contactBeta: 1e5,
    contactPenaltyMin: 0.1,
    penaltyMax: 1e4,
    margin: 0.002,
    stickSpeed: 1e-3,
  };
}

/** Warm start a penalty for a new substep (Eq. 19). */
export function warmPenalty(k: number, p: SolverParams, k0: number, min = p.penaltyMin): number {
  const v = k * p.gamma;
  const lo = min * k0, hi = p.penaltyMax * k0;
  return v < lo ? lo : v > hi ? hi : v;
}

/** Ramp a penalty by the remaining error (Eq. 16). */
export function rampPenalty(k: number, absC: number, beta: number, p: SolverParams, k0: number): number {
  const v = k + beta * k0 * absC;
  const hi = p.penaltyMax * k0;
  return v > hi ? hi : v;
}
