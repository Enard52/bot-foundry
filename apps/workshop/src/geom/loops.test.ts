import { describe, expect, it } from 'vitest';
import { circleAt, loopsToProfiles, nearestEdge, rectangleLoop } from './loops.ts';

describe('loopsToProfiles', () => {
  it('makes an inner loop a hole of the loop around it', () => {
    const outer = rectangleLoop([0, 0], [0.1, 0.1]);
    const hole = circleAt([0.05, 0.05], 0.01);
    const profiles = loopsToProfiles([hole, outer]);
    expect(profiles).toHaveLength(1);
    expect(profiles[0]?.outer).toBe(outer);
    expect(profiles[0]?.holes).toEqual([hole]);
  });

  it('keeps separate outer loops apart', () => {
    const a = rectangleLoop([0, 0], [0.05, 0.05]);
    const b = rectangleLoop([0.1, 0], [0.15, 0.05]);
    const profiles = loopsToProfiles([a, b]);
    expect(profiles).toHaveLength(2);
    expect(profiles.every((p) => p.holes.length === 0)).toBe(true);
  });

  it('starts a new profile for an island inside a hole', () => {
    const outer = rectangleLoop([0, 0], [0.2, 0.2]);
    const hole = rectangleLoop([0.05, 0.05], [0.15, 0.15]);
    const island = rectangleLoop([0.08, 0.08], [0.12, 0.12]);
    const profiles = loopsToProfiles([outer, hole, island]);
    expect(profiles).toHaveLength(2);
    const big = profiles.find((p) => p.outer === outer);
    expect(big?.holes).toEqual([hole]);
    expect(profiles.find((p) => p.outer === island)?.holes).toEqual([]);
  });

  it('puts two holes in the same profile', () => {
    const outer = rectangleLoop([0, 0], [0.1, 0.1]);
    const h1 = circleAt([0.03, 0.05], 0.01);
    const h2 = circleAt([0.07, 0.05], 0.01);
    const profiles = loopsToProfiles([outer, h1, h2]);
    expect(profiles).toHaveLength(1);
    expect(profiles[0]?.holes).toHaveLength(2);
  });
});

describe('nearestEdge', () => {
  it('finds the closest edge', () => {
    const hit = nearestEdge([rectangleLoop([0, 0], [0.1, 0.1])], [0.05, 0.002]);
    expect(hit?.from).toEqual([0, 0]);
    expect(hit?.to).toEqual([0.1, 0]);
    expect(hit?.distance).toBeCloseTo(0.002, 12);
  });
  it('returns null without loops', () => {
    expect(nearestEdge([], [0, 0])).toBeNull();
  });
});
