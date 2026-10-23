import { describe, expect, it } from 'vitest';
import { boltRating, boltUtilisation, weldRating } from './fasteners.ts';
import { MATERIALS, hardeningModulus, plasticMoment } from './materials.ts';

describe('bolt ratings (ISO 898-1)', () => {
  it('M8 grade 8.8 breaks in tension near 29 kN', () => {
    const r = boltRating({ size: 'M8', grade: '8.8', length: 0.02 });
    expect(r.tension).toBeCloseTo(29_280, -1);
    expect(r.proof).toBeCloseTo(21_228, -1);
  });

  it('shear uses αv = 0.6 for 8.8 and 0.5 for 10.9', () => {
    expect(boltRating({ size: 'M8', grade: '8.8', length: 0.02 }).shear).toBeCloseTo(0.6 * 800e6 * 36.6e-6, 3);
    expect(boltRating({ size: 'M8', grade: '10.9', length: 0.02 }).shear).toBeCloseTo(0.5 * 1040e6 * 36.6e-6, 3);
  });

  it('preload is 75 % of proof load and slip is μ times preload', () => {
    const r = boltRating({ size: 'M6', grade: '12.9', length: 0.02 });
    expect(r.preload).toBeCloseTo(0.75 * r.proof, 6);
    expect(r.slip).toBeCloseTo(0.2 * r.preload, 6);
  });

  it('utilisation reaches 1 at pure shear failure and at 1.4 × tension failure', () => {
    const r = boltRating({ size: 'M10', grade: '10.9', length: 0.03 });
    expect(boltUtilisation(r, 0, r.shear)).toBeCloseTo(1, 9);
    expect(boltUtilisation(r, 1.4 * r.tension, 0)).toBeCloseTo(1, 9);
  });
});

describe('fillet welds (EN 1993-1-8 simplified)', () => {
  it('scales with throat and length', () => {
    const a = weldRating(0.004, 0.1, 400e6).strength;
    expect(weldRating(0.008, 0.1, 400e6).strength).toBeCloseTo(2 * a, 6);
    expect(weldRating(0.004, 0.2, 400e6).strength).toBeCloseTo(2 * a, 6);
    expect(a).toBeCloseTo((400e6 * 0.004 * 0.1) / (Math.sqrt(3) * 0.9), 3);
  });
});

describe('material helpers', () => {
  it('plastic moment of a 10 mm × 100 mm AR500 strip', () => {
    expect(plasticMoment(MATERIALS.ar500, 0.1, 0.01)).toBeCloseTo((1.4e9 * 0.1 * 1e-4) / 4, 3);
  });

  it('hardening moduli are positive and far below Young’s modulus', () => {
    for (const m of Object.values(MATERIALS)) {
      const h = hardeningModulus(m);
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThan(m.youngs);
    }
  });
});
