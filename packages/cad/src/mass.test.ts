import { describe, expect, it } from 'vitest';
import { combineMass, componentMass, meshMassProperties, rotateInertia } from './mass.ts';
import { fromTransform } from './vec.ts';

/** Axis-aligned box as an outward-oriented triangle mesh. */
function boxMesh(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number) {
  const positions = [x0, y0, z0, x1, y0, z0, x1, y1, z0, x0, y1, z0, x0, y0, z1, x1, y0, z1, x1, y1, z1, x0, y1, z1];
  const indices = [
    0, 2, 1, 0, 3, 2, // -z
    4, 5, 6, 4, 6, 7, // +z
    0, 1, 5, 0, 5, 4, // -y
    3, 6, 2, 3, 7, 6, // +y
    0, 4, 7, 0, 7, 3, // -x
    1, 2, 6, 1, 6, 5, // +x
  ];
  return { positions, indices };
}

describe('meshMassProperties', () => {
  it('matches the analytic box, away from the origin', () => {
    const { positions, indices } = boxMesh(1, 2, 3, 1.2, 2.1, 3.05);
    const rho = 2700;
    const m = meshMassProperties(positions, indices, rho);
    const [a, b, c] = [0.2, 0.1, 0.05];
    expect(m.volume).toBeCloseTo(a * b * c, 12);
    expect(m.mass).toBeCloseTo(a * b * c * rho, 9);
    expect(m.com[0]).toBeCloseTo(1.1, 9);
    expect(m.com[1]).toBeCloseTo(2.05, 9);
    expect(m.com[2]).toBeCloseTo(3.025, 9);
    const mass = a * b * c * rho;
    expect(m.inertia[0]).toBeCloseTo((mass * (b * b + c * c)) / 12, 9);
    expect(m.inertia[1]).toBeCloseTo((mass * (a * a + c * c)) / 12, 9);
    expect(m.inertia[2]).toBeCloseTo((mass * (a * a + b * b)) / 12, 9);
    for (const k of [3, 4, 5]) expect(Math.abs(m.inertia[k] as number)).toBeLessThan(1e-9);
  });

  it('reports tensor off-diagonals (minus the product of inertia) for a tilted shape', () => {
    // two unit-density cubes touching at a corner along the x=y diagonal: Ixy products are positive, tensor entry negative
    const a = boxMesh(0, 0, 0, 1, 1, 1);
    const b = boxMesh(1, 1, 0, 2, 2, 1);
    const parts = [a, b].map((p) => meshMassProperties(p.positions, p.indices, 1));
    const total = combineMass(parts);
    expect(total.inertia[3]).toBeLessThan(0);
    expect(total.com[0]).toBeCloseTo(1, 12);
  });

  it('returns zero for an inside-out mesh', () => {
    const { positions, indices } = boxMesh(0, 0, 0, 1, 1, 1);
    const flipped = indices.map((_, i) => indices[i - (i % 3) + ((3 - (i % 3)) % 3)] as number);
    expect(meshMassProperties(positions, flipped, 1).mass).toBe(0);
  });
});

describe('combineMass', () => {
  it('uses the parallel-axis theorem', () => {
    const unit = { mass: 1, volume: 1, com: [0, 0, 0] as const, inertia: [0.1, 0.1, 0.1, 0, 0, 0] as const };
    const two = combineMass([unit, { ...unit, com: [2, 0, 0] }]);
    expect(two.mass).toBe(2);
    expect(two.com[0]).toBe(1);
    expect(two.inertia[0]).toBeCloseTo(0.2, 12); // along the line joining them
    expect(two.inertia[1]).toBeCloseTo(0.2 + 2 * 1, 12);
  });
});

describe('componentMass', () => {
  it('scales primitive inertia to the catalog mass and rotates it with the pose', () => {
    const geometry = [{ kind: 'cylinder', radius: 0.05, length: 0.2, axis: 'z', at: [0, 0, 0.1] }] as const;
    const upright = componentMass(geometry, 2, fromTransform({ position: [0, 0, 0], rotation: [0, 0, 0, 1] }));
    expect(upright.mass).toBe(2);
    expect(upright.com[2]).toBeCloseTo(0.1, 12);
    expect(upright.inertia[2]).toBeCloseTo(0.5 * 2 * 0.05 ** 2, 12);
    // lay it along y: spin axis moves from z to y
    const s = Math.SQRT1_2;
    const laid = componentMass(geometry, 2, fromTransform({ position: [1, 0, 0], rotation: [-s, 0, 0, s] }));
    expect(laid.com[0]).toBeCloseTo(1, 12);
    expect(laid.inertia[1]).toBeCloseTo(upright.inertia[2], 12);
    expect(laid.inertia[2]).toBeCloseTo(upright.inertia[0], 12);
  });
});

describe('rotateInertia', () => {
  it('is the identity for the identity rotation', () => {
    const i = [1, 2, 3, 0.1, 0.2, 0.3] as const;
    const r = rotateInertia(i, fromTransform({ position: [0, 0, 0], rotation: [0, 0, 0, 1] }));
    r.forEach((v, k) => expect(v).toBeCloseTo(i[k] as number, 12));
  });
});
