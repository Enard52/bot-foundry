/** Copper resistivity at 20 °C, Ω·m (IACS 100 %: 58.0 MS/m, IEC 60028). */
export const COPPER_RESISTIVITY = 1.7241e-8;

/** Length of conductor assumed for every Wire in a design, m. */
export const WIRE_LENGTH = 0.3;

/** Conductor diameter of an American wire gauge, m: d = 0.127 mm · 92^((36 - n) / 39) (ASTM B258). */
export function awgDiameter(gauge: number): number {
  return 0.000127 * Math.pow(92, (36 - gauge) / 39);
}

/** Resistance per metre of solid copper wire of the given AWG, Ω/m. */
export function awgResistancePerMetre(gauge: number): number {
  const d = awgDiameter(gauge);
  return COPPER_RESISTIVITY / ((Math.PI * d * d) / 4);
}

/** Resistance of one design Wire, Ω. */
export function wireResistance(gauge: number): number {
  return awgResistancePerMetre(gauge) * WIRE_LENGTH;
}
