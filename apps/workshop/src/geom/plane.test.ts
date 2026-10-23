import { describe, expect, it } from 'vitest';
import { PLANE_XY, PLANE_XZ, PLANE_YZ } from '@botfoundry/model';
import { axisName, flipPlane, offsetPlane, planeBasis, planeToWorld, rayPlane, worldToPlane } from './plane.ts';

describe('plane', () => {
  it('maps the standard planes the way the contract says (v = normal x xAxis)', () => {
    expect(planeBasis(PLANE_XY).v).toEqual([0, 1, 0]);
    expect(planeBasis(PLANE_XZ).v).toEqual([0, 0, -1]);
    expect(planeBasis(PLANE_YZ).v).toEqual([0, 0, 1]);
  });

  it('round-trips plane and world coordinates on a tilted plane', () => {
    const plane = { origin: [0.2, 0.03, 0] as const, normal: [Math.sin(0.2), Math.cos(0.2), 0] as const, xAxis: [0, 0, 1] as const };
    const w = planeToWorld(plane, [0.05, -0.02]);
    const back = worldToPlane(plane, w);
    expect(back[0]).toBeCloseTo(0.05, 12);
    expect(back[1]).toBeCloseTo(-0.02, 12);
  });

  it('offsets along the normal and flips', () => {
    expect(offsetPlane(PLANE_XZ, 0.01).origin).toEqual([0, 0.01, 0]);
    expect(planeBasis(flipPlane(PLANE_XY)).v).toEqual([0, -1, 0]);
  });

  it('intersects rays', () => {
    expect(rayPlane(PLANE_XZ, [0, 1, 0], [0, -1, 0])).toBe(1);
    expect(rayPlane(PLANE_XZ, [0, 1, 0], [1, 0, 0])).toBeNull();
    expect(rayPlane(PLANE_XZ, [0, 1, 0], [0, 1, 0])).toBeNull();
  });

  it('names axis-aligned normals', () => {
    expect(axisName([0, -1, 0])).toBe('-Y');
    expect(axisName([1, 1, 0])).toBeNull();
  });
});
