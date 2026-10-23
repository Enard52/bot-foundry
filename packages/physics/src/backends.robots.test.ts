import { beforeAll, describe, it } from 'vitest';
import { compare } from './compare-backends.ts';
import { robots } from './scenarios.ts';
import { loadWasmSolver } from './wasm.ts';

// The two-robot scenarios, the slow half of the cross-backend checks, in their own file so Vitest
// runs them in parallel with the rest (backends.test.ts).

describe('backends, two robots', () => {
  beforeAll(loadWasmSolver);

  it('agree bit for bit on the two-robot bench scenario (300 bodies, 1054 bolts, on the ground)', () => {
    compare(robots());
  }, 120_000);

  it('agree bit for bit on the same robots in free fall, where bolts break', () => {
    compare(robots(false));
  }, 120_000);
});
