import { describe, expect, it } from 'vitest';
import type { V3 } from '@botfoundry/model';
import { convexHull, quickhull } from './hull.ts';

// small deterministic generator so the tests need no random seed library
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
}

describe('quickhull', () => {
  it('keeps the 8 corners of a box and drops interior points', () => {
    const pts: V3[] = [];
    for (const x of [0, 1]) for (const y of [0, 2]) for (const z of [0, 3]) pts.push([x, y, z]);
    const rand = lcg(1);
    for (let i = 0; i < 200; i++) pts.push([rand(), 2 * rand(), 3 * rand()]);
    const h = quickhull(pts);
    expect(h.vertices).toHaveLength(8);
    expect(h.faces).toHaveLength(12);
  });

  it('encloses every input point and has outward, closed topology', () => {
    const rand = lcg(7);
    const pts: V3[] = Array.from({ length: 500 }, () => [rand() - 0.5, rand() - 0.5, rand() - 0.5]);
    const { vertices, faces } = quickhull(pts);
    // closed 2-manifold: every directed edge has exactly one opposite edge
    const edges = new Map<string, number>();
    for (const [a, b, c] of faces) for (const [u, v] of [[a, b], [b, c], [c, a]] as [number, number][]) edges.set(`${u}_${v}`, 1);
    for (const key of edges.keys()) {
      const [u, v] = key.split('_');
      expect(edges.has(`${v}_${u}`)).toBe(true);
    }
    for (const p of pts) {
      for (const [a, b, c] of faces) {
        const pa = vertices[a] as V3, pb = vertices[b] as V3, pc = vertices[c] as V3;
        const n: V3 = [
          (pb[1] - pa[1]) * (pc[2] - pa[2]) - (pb[2] - pa[2]) * (pc[1] - pa[1]),
          (pb[2] - pa[2]) * (pc[0] - pa[0]) - (pb[0] - pa[0]) * (pc[2] - pa[2]),
          (pb[0] - pa[0]) * (pc[1] - pa[1]) - (pb[1] - pa[1]) * (pc[0] - pa[0]),
        ];
        const l = Math.hypot(...n);
        const d = ((p[0] - pa[0]) * n[0] + (p[1] - pa[1]) * n[1] + (p[2] - pa[2]) * n[2]) / l;
        expect(d).toBeLessThan(1e-6);
      }
    }
    // Euler: V - E + F = 2 with E = 3F/2
    expect(vertices.length - (3 * faces.length) / 2 + faces.length).toBe(2);
  });

  it('hull of points on a sphere keeps them all', () => {
    const pts: V3[] = [];
    for (let i = 0; i < 100; i++) {
      const y = 1 - (2 * (i + 0.5)) / 100;
      const r = Math.sqrt(1 - y * y);
      const a = i * 2.399963229728653;
      pts.push([r * Math.cos(a), y, r * Math.sin(a)]);
    }
    expect(quickhull(pts).vertices).toHaveLength(100);
  });

  it('handles flat and degenerate input', () => {
    const flat: V3[] = [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0], [0.5, 0.5, 0]];
    const h = convexHull(flat);
    expect(h.vertices).toHaveLength(4);
    expect(convexHull([[0, 0, 0], [1, 1, 1], [2, 2, 2]]).vertices).toHaveLength(2);
    expect(convexHull([[0, 0, 0]]).vertices).toHaveLength(1);
  });
});
