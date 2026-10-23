import { describe, expect, it } from 'vitest';
import { awgDiameter, awgResistancePerMetre, wireResistance } from './wiring.ts';

describe('AWG copper wire', () => {
  it('matches the standard table', () => {
    expect(awgDiameter(10) * 1000).toBeCloseTo(2.588, 3);
    expect(awgDiameter(0) * 1000).toBeCloseTo(8.251, 3);
    expect(awgResistancePerMetre(10) * 1000).toBeCloseTo(3.277, 2); // mΩ/m
    expect(awgResistancePerMetre(12) * 1000).toBeCloseTo(5.211, 2);
  });

  it('is 0.3 m of conductor per wire', () => {
    expect(wireResistance(10)).toBeCloseTo(0.3 * awgResistancePerMetre(10), 12);
  });
});
