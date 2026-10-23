import { beforeAll, describe, expect, it } from 'vitest';
import { mechanism, pile } from './scenarios.ts';
import { loadWasmSolver, wasmSolver } from './wasm.ts';
import { layoutMismatch } from './wasm-world.ts';

// The edges of the WebAssembly module: the layout signature that catches a stale solver.wasm, the
// status codes the C ABI returns instead of reading out of bounds, and a NaN in the state.

type Peek = { views(): Record<string, Float64Array | Uint32Array> };
const peek = (world: unknown) => (world as Peek).views();

function signature(): string {
  const ex = wasmSolver();
  return new TextDecoder().decode(new Uint8Array(ex.memory.buffer, ex.world_layout_signature(), ex.world_layout_signature_len()));
}

describe('wasm module boundary', () => {
  beforeAll(loadWasmSolver);

  describe('layout signature', () => {
    it('matches the module that is built', () => {
      expect(layoutMismatch(signature())).toBeNull();
    });

    it('names the first field whose width, type or group differs', () => {
      const entries = signature().split(',').filter(Boolean);
      const edit = (name: string, from: string, to: string) =>
        entries.map((e) => (e.startsWith(`${name}:`) ? e.replace(from, to) : e)).join(',') + ',';
      expect(layoutMismatch(edit('b_inertia', ':9', ':3'))).toMatch(/field \d+ \(b_inertia\): the module has b_inertia:f64:Body:3, wasm-world.ts has b_inertia:f64:Body:9/);
      expect(layoutMismatch(edit('j_a', ':u32:', ':f64:'))).toMatch(/\(j_a\): the module has j_a:f64:Joint:1/);
      expect(layoutMismatch(edit('m_ra', ':Manifold:', ':Joint:'))).toMatch(/\(m_ra\): the module has m_ra:f64:Joint:12/);
      // with two differences, the earlier field is the one named
      expect(layoutMismatch(edit('d', ':3', ':4').replace('b_vel:f64:Body:3', 'b_vel:f64:Body:4'))).toMatch(/\(b_vel\)/);
    });

    it('names a field one side has and the other lacks', () => {
      const entries = signature().split(',').filter(Boolean);
      expect(layoutMismatch(entries.slice(0, -1).join(',') + ',')).toMatch(/\(adj\): the module has no such field/);
      expect(layoutMismatch(entries.join(',') + ',extra:f64:Body:1,')).toMatch(/\(extra\): wasm-world.ts has no such field/);
      expect(layoutMismatch(entries.filter((e) => !e.startsWith('b_vel:')).join(','))).toMatch(/\(b_vel\)/);
    });
  });

  describe('C ABI status codes', () => {
    const reserve = (w: number, caps: number[]) => (wasmSolver().world_reserve as (...a: number[]) => number)(w, ...caps);

    it('world_step rejects counts past the capacities and steps nothing', () => {
      const ex = wasmSolver();
      const w = ex.world_new();
      try {
        expect(reserve(w, [5, 2, 8, 0, 0, 0, 0, 0, 0])).toBe(0);
        expect(ex.world_step(w, 4, 2)).toBe(0);
        expect(ex.world_step(w, 5, 0)).toBe(1); // slots 0..=5 need 6 body slots
        expect(ex.world_step(w, 0xffffffff, 0)).toBe(1);
        expect(ex.world_step(w, 4, 3)).toBe(2);
        expect(ex.world_step(w, 0, 0xffffffff)).toBe(2);
      } finally {
        ex.world_free(w);
      }
    });

    it('world_reserve refuses an absurd request and leaves the capacities as they were', () => {
      const ex = wasmSolver();
      const w = ex.world_new();
      try {
        const caps = () => Array.from(new Uint32Array(ex.memory.buffer, ex.world_caps(w), 9));
        expect(reserve(w, [10, 10, 10, 10, 10, 10, 10, 10, 10])).toBe(0);
        const before = caps();
        const version = ex.world_version(w);
        expect(reserve(w, [0xffffffff, 0, 0, 0, 0, 0, 0, 0, 0])).toBe(5);
        expect(reserve(w, [10, 10, 0x7fffffff, 10, 10, 10, 10, 10, 10])).toBe(5);
        expect(reserve(w, [1 << 24, 1 << 24, 1 << 24, 0, 0, 0, 0, 0, 0])).toBe(5); // under MAX_CAP each, over the byte budget
        expect(caps()).toEqual(before);
        expect(ex.world_version(w)).toBe(version);
      } finally {
        ex.world_free(w);
      }
    });

    it('step throws, naming the problem, on a joint or hull index outside the arrays', () => {
      const world = mechanism().build({ backend: 'wasm' });
      world.step();
      const v = peek(world);
      const joint = v.j_a![0]!;
      v.j_a![0] = 9999;
      expect(() => world.step()).toThrow(/world_step rejected its arguments: a joint names a body slot above the body count \(code 3\)/);
      v.j_a![0] = joint;
      world.step();
      const hullOff = v.b_hull_off![1]!;
      v.b_hull_off![1] = 9999;
      expect(() => world.step()).toThrow(/a body or hull range is outside its pool \(code 4\)/);
      v.b_hull_off![1] = hullOff;
      v.h_face_n![0] = 0xffffffff;
      expect(() => world.step()).toThrow(/code 4/);
    });
  });

  describe('non-finite state', () => {
    // more than 20 bodies sort with the unstable sort that trapped on an inconsistent order
    it.each([10, 30, 60, 200])('steps %i boxes with a NaN position without trapping', (n) => {
      const world = pile(n).build({ backend: 'wasm' });
      world.step();
      peek(world).b_pos![3 * 5 + 1] = NaN;
      expect(() => {
        for (let i = 0; i < 3; i++) world.step();
      }).not.toThrow();
    });
  });
});
