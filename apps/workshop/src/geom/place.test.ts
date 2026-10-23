import { describe, expect, it } from 'vitest';
import { placementPose, rotateVector } from './place.ts';

describe('placementPose', () => {
  it('stands a part on the ground with its mount normal up', () => {
    const pose = placementPose([0.1, 0, 0.2], [0, 1, 0]);
    expect(pose.position).toEqual([0.1, 0, 0.2]);
    const up = rotateVector(pose.rotation, [0, 0, 1]);
    expect(up[0]).toBeCloseTo(0, 12);
    expect(up[1]).toBeCloseTo(1, 12);
    expect(up[2]).toBeCloseTo(0, 12);
  });

  it('turns local z onto any normal', () => {
    for (const n of [[1, 0, 0], [0, 0, 1], [0, 0, -1], [0.3, -0.5, 0.8], [-1, 0, 0]] as const) {
      const len = Math.hypot(...n);
      const out = rotateVector(placementPose([0, 0, 0], n).rotation, [0, 0, 1]);
      expect(out[0]).toBeCloseTo(n[0] / len, 9);
      expect(out[1]).toBeCloseTo(n[1] / len, 9);
      expect(out[2]).toBeCloseTo(n[2] / len, 9);
    }
  });

  it('returns a unit quaternion', () => {
    const q = placementPose([0, 0, 0], [0.2, 0.9, -0.4]).rotation;
    expect(Math.hypot(...q)).toBeCloseTo(1, 12);
  });
});
