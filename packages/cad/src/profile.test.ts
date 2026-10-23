import { describe, expect, it } from 'vitest';
import { CHORD_TOLERANCE, signedArea, tessellateLoop, tessellateProfile } from './profile.ts';
import { circleLoop, polygonLoop, rectLoop } from './sketch.ts';

describe('tessellateLoop', () => {
  it('keeps straight loops as they are', () => {
    expect(tessellateLoop(rectLoop(0, 0, 2, 1))).toEqual([[0, 0], [2, 0], [2, 1], [0, 1]]);
  });

  it('turns a bulge-1 pair into a circle within the chord tolerance', () => {
    const r = 0.05;
    const ring = tessellateLoop(circleLoop(0.1, 0.2, r));
    for (const p of ring) expect(Math.hypot(p[0] - 0.1, p[1] - 0.2)).toBeCloseTo(r, 12);
    // the longest chord's sagitta stays under the tolerance
    let worst = 0;
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i] as [number, number], b = ring[(i + 1) % ring.length] as [number, number];
      const chord = Math.hypot(b[0] - a[0], b[1] - a[1]);
      worst = Math.max(worst, r - Math.sqrt(r * r - (chord / 2) ** 2));
    }
    expect(worst).toBeLessThanOrEqual(CHORD_TOLERANCE + 1e-12);
    expect(signedArea(ring)).toBeGreaterThan(0); // counter-clockwise
    expect(signedArea(ring)).toBeCloseTo(Math.PI * r * r, 2);
  });

  it('follows the DXF sign convention: negative bulge sweeps clockwise', () => {
    // quarter arc from (1,0) to (0,1): +bulge bulges outward around the origin, -bulge bulges inward
    const t = Math.tan(Math.PI / 8);
    const ccw = tessellateLoop({ start: [1, 0], segments: [{ to: [0, 1], bulge: t }, { to: [1, 0] }] });
    const cw = tessellateLoop({ start: [1, 0], segments: [{ to: [0, 1], bulge: -t }, { to: [1, 0] }] });
    const radius = (p: readonly [number, number]) => Math.hypot(p[0], p[1]);
    expect(Math.max(...ccw.map((p) => radius(p as [number, number])))).toBeCloseTo(1, 9);
    expect(ccw.length).toBeGreaterThan(3);
    // the counter-clockwise arc bulges away from the origin, the clockwise one toward it
    const midOf = (ring: [number, number][]) => ring[Math.floor(ring.length / 2)] as [number, number];
    const m1 = midOf(ccw as [number, number][]);
    const m2 = midOf(cw as [number, number][]);
    expect(m1[0] + m1[1]).toBeGreaterThan(1.3);
    expect(m2[0] + m2[1]).toBeLessThan(0.7);
  });
});

describe('tessellateProfile validation', () => {
  it('accepts a rectangle with a hole', () => {
    const t = tessellateProfile({ outer: rectLoop(0, 0, 0.1, 0.1), holes: [circleLoop(0.05, 0.05, 0.01)] });
    expect(t.errors).toEqual([]);
    expect(t.rings).toHaveLength(2);
  });

  it('rejects an open loop', () => {
    const t = tessellateProfile({ outer: { start: [0, 0], segments: [{ to: [1, 0] }, { to: [1, 1] }] }, holes: [] });
    expect(t.errors[0]).toMatch(/not closed/);
  });

  it('rejects a self-intersecting bow-tie', () => {
    const t = tessellateProfile({ outer: polygonLoop([[0, 0], [1, 1], [1, 0], [0, 1]]), holes: [] });
    expect(t.errors[0]).toMatch(/intersects itself/);
  });

  it('rejects holes outside, crossing or nested', () => {
    const outer = rectLoop(0, 0, 1, 1);
    expect(tessellateProfile({ outer, holes: [rectLoop(2, 2, 3, 3)] }).errors[0]).toMatch(/outside/);
    expect(tessellateProfile({ outer, holes: [rectLoop(0.5, 0.5, 1.5, 1.5)] }).errors[0]).toMatch(/crosses/);
    expect(tessellateProfile({ outer, holes: [rectLoop(0.1, 0.1, 0.9, 0.9), rectLoop(0.3, 0.3, 0.6, 0.6)] }).errors[0]).toMatch(/nested/);
  });

  it('rejects an empty area', () => {
    const t = tessellateProfile({ outer: polygonLoop([[0, 0], [1, 0], [2, 0]]), holes: [] });
    expect(t.errors[0]).toMatch(/no area/);
  });
});
