import type { V3 } from '@botfoundry/model';

export const fmtMass = (kg: number): string => (kg < 1 ? `${(kg * 1000).toFixed(0)} g` : `${kg.toFixed(3)} kg`);
export const fmtMm = (m: number, digits = 1): string => `${(m * 1000).toFixed(digits)}`;
export const fmtVecMm = (v: V3, digits = 1): string => v.map((x) => fmtMm(x, digits)).join(', ');
/** Three significant digits, switching to exponent form for very small or large values. */
export const fmtSig = (v: number): string => {
  if (v === 0) return '0';
  const a = Math.abs(v);
  return a < 0.01 || a >= 1000 ? v.toExponential(2) : v.toPrecision(3);
};
