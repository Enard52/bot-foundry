// Fastener and weld ratings from the standards. Characteristic resistances, no partial safety
// factors: the game wants the load where a real joint lets go, not a design allowable.

export type BoltSize = 'M3' | 'M4' | 'M5' | 'M6' | 'M8' | 'M10' | 'M12';
export type BoltGrade = '8.8' | '10.9' | '12.9';

export interface BoltSpec {
  size: BoltSize;
  grade: BoltGrade;
  /** shank length, m */
  length: number;
}

/** Nominal diameter, m. */
export const BOLT_DIAMETER: Record<BoltSize, number> = {
  M3: 0.003, M4: 0.004, M5: 0.005, M6: 0.006, M8: 0.008, M10: 0.010, M12: 0.012,
};

/** Tensile stress area As, m² (ISO 898-1, coarse thread). */
export const BOLT_STRESS_AREA: Record<BoltSize, number> = {
  M3: 5.03e-6, M4: 8.78e-6, M5: 14.2e-6, M6: 20.1e-6, M8: 36.6e-6, M10: 58.0e-6, M12: 84.3e-6,
};

/** Ultimate strength fub, proof stress Sp (Pa, ISO 898-1, d ≤ 16 mm) and shear factor αv (EN 1993-1-8). */
export const BOLT_GRADE: Record<BoltGrade, { ultimate: number; proof: number; shearFactor: number }> = {
  '8.8': { ultimate: 800e6, proof: 580e6, shearFactor: 0.6 },
  '10.9': { ultimate: 1040e6, proof: 830e6, shearFactor: 0.5 },
  '12.9': { ultimate: 1220e6, proof: 970e6, shearFactor: 0.5 },
};

export interface BoltRating {
  /** axial load at fracture, N */
  tension: number;
  /** load at which the bolt starts to yield, N */
  proof: number;
  /** shear load at fracture through the threads, N */
  shear: number;
  /** clamp force from tightening, N */
  preload: number;
  /** friction grip: shear load the clamped joint carries before it slips, N */
  slip: number;
}

/** Steel on steel, untreated faying surfaces. */
export const DEFAULT_SLIP_FRICTION = 0.2;

export function boltRating(spec: BoltSpec, slipFriction = DEFAULT_SLIP_FRICTION): BoltRating {
  const as = BOLT_STRESS_AREA[spec.size];
  const g = BOLT_GRADE[spec.grade];
  // tightening to 75 % of proof load is standard practice for structural bolts
  const preload = 0.75 * g.proof * as;
  return {
    tension: g.ultimate * as,
    proof: g.proof * as,
    shear: g.shearFactor * g.ultimate * as,
    preload,
    slip: slipFriction * preload,
  };
}

/**
 * Combined tension and shear check (EN 1993-1-8 Table 3.4 interaction): failure when
 * Fv / Fv,R + Ft / (1.4 · Ft,R) ≥ 1. Returns the utilisation; ≥ 1 means the bolt breaks.
 */
export function boltUtilisation(r: BoltRating, tension: number, shear: number): number {
  return Math.abs(shear) / r.shear + Math.max(0, tension) / (1.4 * r.tension);
}

export interface WeldRating {
  /** shear load the seam carries before fracture, N */
  strength: number;
}

/**
 * Fillet weld, EN 1993-1-8 simplified method: resistance per unit length = fu / (√3 · βw) · a.
 * `throat` a and `length` in m, `parentUltimate` fu in Pa. βw ≈ 0.8 to 1.0 for steels; 0.9 is a fair middle.
 * Aluminium welds lose strength in the heat-affected zone: pass a knockdown below 1 for them.
 */
export function weldRating(throat: number, length: number, parentUltimate: number, betaW = 0.9, knockdown = 1): WeldRating {
  return { strength: (knockdown * parentUltimate * throat * length) / (Math.sqrt(3) * betaW) };
}
