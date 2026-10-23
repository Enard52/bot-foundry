import { describe, expect, it } from 'vitest';
import { arcGeometry, bulgeThrough, sampleLoop } from './arc.ts';

describe('arc', () => {
  it('finds a half circle through three points (bulge 1, counter-clockwise)', () => {
    expect(bulgeThrough([-1, 0], [1, 0], [0, -1])).toBeCloseTo(1, 12);
    expect(bulgeThrough([-1, 0], [1, 0], [0, 1])).toBeCloseTo(-1, 12);
  });

  it('finds a quarter circle and a major arc', () => {
    const s = Math.SQRT1_2;
    expect(bulgeThrough([1, 0], [0, 1], [s, s])).toBeCloseTo(Math.tan(Math.PI / 8), 12);
    // three-quarter turn the long way round
    expect(bulgeThrough([1, 0], [0, 1], [-s, -s])).toBeCloseTo(-Math.tan((3 * Math.PI) / 8), 12);
  });

  it('treats collinear points as a line', () => {
    expect(bulgeThrough([0, 0], [2, 0], [1, 0])).toBe(0);
  });

  it('recovers centre and radius from a bulge', () => {
    const g = arcGeometry([-1, 0], [1, 0], 1);
    expect(g?.center[0]).toBeCloseTo(0, 12);
    expect(g?.center[1]).toBeCloseTo(0, 12);
    expect(g?.radius).toBeCloseTo(1, 12);
    expect(g?.sweep).toBeCloseTo(Math.PI, 12);
  });

  it('samples a circle loop on its radius and closes it', () => {
    const r = 0.02;
    const pts = sampleLoop({ start: [-r, 0], segments: [{ to: [r, 0], bulge: 1 }, { to: [-r, 0], bulge: 1 }] });
    expect(pts[0]).toEqual(pts[pts.length - 1]);
    for (const p of pts) expect(Math.hypot(p[0], p[1])).toBeCloseTo(r, 9);
    expect(pts.length).toBeGreaterThan(40);
  });
});
