// Engineering properties of the materials robots are actually built from.
// Typical published values; individual heats and suppliers vary.

export type MaterialId =
  | 'ar500'
  | 's7'
  | 'a36'
  | 'ti64'
  | 'al7075'
  | 'al6061'
  | 'uhmw'
  | 'pc'
  | 'rubber';

export interface Material {
  id: MaterialId;
  name: string;
  /** kg/m³ */
  density: number;
  /** Young's modulus, Pa */
  youngs: number;
  poisson: number;
  /** 0.2 % offset yield strength, Pa */
  yield: number;
  /** ultimate tensile strength, Pa */
  ultimate: number;
  /** elongation at break, fraction */
  elongation: number;
  /** Brinell hardness */
  hardness: number;
  /** Coulomb friction against steel */
  friction: number;
}

export const MATERIALS: Record<MaterialId, Material> = {
  ar500: { id: 'ar500', name: 'AR500 armor steel', density: 7850, youngs: 200e9, poisson: 0.29, yield: 1.40e9, ultimate: 1.65e9, elongation: 0.08, hardness: 500, friction: 0.35 },
  s7: { id: 's7', name: 'S7 tool steel, hardened', density: 7830, youngs: 207e9, poisson: 0.29, yield: 1.50e9, ultimate: 1.90e9, elongation: 0.07, hardness: 560, friction: 0.35 },
  a36: { id: 'a36', name: 'A36 mild steel', density: 7850, youngs: 200e9, poisson: 0.26, yield: 250e6, ultimate: 400e6, elongation: 0.20, hardness: 120, friction: 0.4 },
  ti64: { id: 'ti64', name: 'Ti-6Al-4V titanium', density: 4430, youngs: 114e9, poisson: 0.34, yield: 880e6, ultimate: 950e6, elongation: 0.14, hardness: 334, friction: 0.36 },
  al7075: { id: 'al7075', name: '7075-T6 aluminium', density: 2810, youngs: 71.7e9, poisson: 0.33, yield: 503e6, ultimate: 572e6, elongation: 0.11, hardness: 150, friction: 0.4 },
  al6061: { id: 'al6061', name: '6061-T6 aluminium', density: 2700, youngs: 68.9e9, poisson: 0.33, yield: 276e6, ultimate: 310e6, elongation: 0.12, hardness: 95, friction: 0.4 },
  uhmw: { id: 'uhmw', name: 'UHMW polyethylene', density: 940, youngs: 0.69e9, poisson: 0.46, yield: 21e6, ultimate: 40e6, elongation: 3.5, hardness: 6, friction: 0.15 },
  pc: { id: 'pc', name: 'Polycarbonate', density: 1200, youngs: 2.4e9, poisson: 0.37, yield: 62e6, ultimate: 69e6, elongation: 1.1, hardness: 15, friction: 0.3 },
  rubber: { id: 'rubber', name: 'Neoprene tyre rubber', density: 1250, youngs: 5e6, poisson: 0.49, yield: 15e6, ultimate: 15e6, elongation: 4.0, hardness: 1, friction: 1.0 },
};

/**
 * Linear hardening (tangent) modulus between yield and ultimate, Pa.
 * Strain at yield is yield/E; strain at ultimate is taken as the elongation at break.
 */
export function hardeningModulus(m: Material): number {
  const span = m.elongation - m.yield / m.youngs;
  return span > 0 ? (m.ultimate - m.yield) / span : 0;
}

/** Plastic moment of a rectangular section of width b and thickness t, N·m: σy · b · t² / 4. */
export function plasticMoment(m: Material, width: number, thickness: number): number {
  return (m.yield * width * thickness * thickness) / 4;
}
