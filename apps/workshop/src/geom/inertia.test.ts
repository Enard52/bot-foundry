import { describe, expect, it } from 'vitest';
import { principalMoments } from './inertia.ts';

describe('principalMoments', () => {
  it('sorts a diagonal tensor', () => {
    expect(principalMoments([3, 1, 2, 0, 0, 0])).toEqual([1, 2, 3]);
  });

  it('diagonalises a tensor with a product term', () => {
    // [[2, 1, 0], [1, 2, 0], [0, 0, 5]] has eigenvalues 1, 3, 5
    const m = principalMoments([2, 2, 5, 1, 0, 0]);
    expect(m[0]).toBeCloseTo(1, 12);
    expect(m[1]).toBeCloseTo(3, 12);
    expect(m[2]).toBeCloseTo(5, 12);
  });

  it('preserves the trace for a full tensor', () => {
    const t = [4, 5, 6, 0.5, -0.3, 0.2] as const;
    const m = principalMoments(t);
    expect(m[0] + m[1] + m[2]).toBeCloseTo(15, 12);
  });

  it('handles a repeated eigenvalue', () => {
    const m = principalMoments([2, 2, 2, 0, 0, 0]);
    expect(m).toEqual([2, 2, 2]);
  });
});
