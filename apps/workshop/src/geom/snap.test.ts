import { describe, expect, it } from 'vitest';
import { GRID_COARSE, GRID_FINE, parsePair, parseTyped, snapPoint } from './snap.ts';

describe('snapPoint', () => {
  it('snaps to the 1 mm grid', () => {
    const r = snapPoint([0.0123, -0.0048], { grid: GRID_FINE, endpoints: [], radius: 0.001 });
    expect(r.kind).toBe('grid');
    expect(r.point[0]).toBeCloseTo(0.012, 12);
    expect(r.point[1]).toBeCloseTo(-0.005, 12);
  });

  it('snaps to the 5 mm grid with Shift', () => {
    const r = snapPoint([0.0123, 0.0071], { grid: GRID_COARSE, endpoints: [], radius: 0.001 });
    expect(r.point[0]).toBeCloseTo(0.01, 12);
    expect(r.point[1]).toBeCloseTo(0.005, 12);
  });

  it('prefers an endpoint inside the radius over the grid', () => {
    const r = snapPoint([0.01004, 0.0199], { grid: GRID_FINE, endpoints: [[0.0103, 0.0201]], radius: 0.001 });
    expect(r).toEqual({ point: [0.0103, 0.0201], kind: 'endpoint' });
  });

  it('ignores endpoints outside the radius and picks the nearest of several', () => {
    const far = snapPoint([0, 0], { grid: 0, endpoints: [[0.01, 0]], radius: 0.001 });
    expect(far.kind).toBe('none');
    const near = snapPoint([0, 0], { grid: 0, endpoints: [[0.0008, 0], [0.0003, 0]], radius: 0.001 });
    expect(near.point).toEqual([0.0003, 0]);
  });
});

describe('typed input', () => {
  it('reads millimetres and optional angles', () => {
    expect(parseTyped('25')).toEqual({ length: 0.025 });
    expect(parseTyped('12.5,90')?.angle).toBeCloseTo(Math.PI / 2, 12);
    expect(parseTyped('30<45')?.length).toBeCloseTo(0.03, 12);
  });
  it('rejects junk and zero', () => {
    expect(parseTyped('abc')).toBeNull();
    expect(parseTyped('0')).toBeNull();
    expect(parseTyped('')).toBeNull();
  });
  it('reads a width and height pair', () => {
    expect(parsePair('40x20')).toEqual([0.04, 0.02]);
    expect(parsePair('40')).toBeNull();
  });
});
