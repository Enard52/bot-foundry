import { describe, expect, it } from 'vitest';
import { eulerToQuat, quatToEuler } from './math.ts';

describe('euler', () => {
  it('round-trips ordinary rotations', () => {
    for (const e of [[0.3, -0.5, 1.1], [-1.2, 0.4, 0.2], [0, 0, 0]] as const) {
      const back = quatToEuler(eulerToQuat(e));
      expect(back[0]).toBeCloseTo(e[0], 9);
      expect(back[1]).toBeCloseTo(e[1], 9);
      expect(back[2]).toBeCloseTo(e[2], 9);
    }
  });

  it('gives a unit quaternion', () => {
    const q = eulerToQuat([0.7, 0.2, -2]);
    expect(Math.hypot(...q)).toBeCloseTo(1, 12);
  });

  it('lays a part flat with -90 degrees about x', () => {
    const q = eulerToQuat([-Math.PI / 2, 0, 0]);
    expect(q[0]).toBeCloseTo(-Math.SQRT1_2, 12);
    expect(q[3]).toBeCloseTo(Math.SQRT1_2, 12);
  });
});
