// Substep cost of the solver core. Run from packages/physics:
//   node --experimental-strip-types bench/step.ts
// Every scenario runs at dt = 1/1000 s with 4 iterations and reports the mean wall time per
// substep after a warm-up. Gate S1: two robots' worth (about 300 bodies and 1000 constraints)
// under 0.5 ms per substep.

import type { Connection, PhysPart } from '@botfoundry/model';
import { AT_ORIGIN, bolt, boxPart, model } from '../src/fixtures.ts';
import type { World } from '../src/index.ts';
import { createWorld } from '../src/world.ts';

interface Scenario {
  name: string;
  build(): World;
  bodies: number;
  constraints: number;
}

const S = 0.1;

/** N boxes in a grid of columns standing on the ground, 1 mm apart, so the pile is all contacts. */
function pile(n: number): Scenario {
  const side = Math.ceil(Math.sqrt(n / 10));
  return {
    name: `pile of ${n} boxes`,
    bodies: n,
    constraints: 0,
    build() {
      const world = createWorld({ dt: 1 / 1000, iterations: 4 });
      world.addGround();
      for (let i = 0; i < n; i++) {
        const col = i % (side * side), layer = Math.floor(i / (side * side));
        const x = (col % side) * (S + 0.001), z = Math.floor(col / side) * (S + 0.001);
        world.addRobot(model(`b${i}`, [boxPart('b', [S, S, S], [0, 0, 0])]), {
          position: [x, S / 2 + layer * (S + 0.001), z],
          rotation: [0, 0, 0, 1],
        });
      }
      return world;
    },
  };
}

/** Chains of 20 links joined by fixed joints, each hanging from a static anchor: n links in all. */
function chains(n: number): Scenario {
  const perChain = 20;
  const count = Math.round(n / perChain);
  return {
    name: `${count} chains × ${perChain} fixed joints`,
    bodies: count * perChain,
    constraints: count * perChain,
    build() {
      const world = createWorld({ dt: 1 / 1000, iterations: 4 });
      for (let c = 0; c < count; c++) {
        const parts: PhysPart[] = [boxPart('anchor', [0.05, 0.05, 0.05], [0, 0, 0], { mass: 0 })];
        const joints: Connection[] = [];
        let prev = 'anchor';
        for (let k = 0; k < perChain; k++) {
          const id = `l${k}`;
          // links run sideways, so the chain is a cantilever loaded in bending
          parts.push(boxPart(id, [0.05, 0.02, 0.02], [0.05 * (k + 1), 0, 0], { mass: 0.2 }));
          joints.push({ kind: 'joint', id: `j${k}`, joint: 'fixed', a: prev, b: id, anchor: [0.05 * k + 0.025, 0, 0] });
          prev = id;
        }
        world.addRobot(model(`chain${c}`, parts, joints), { position: [0, 2, 0.1 * c], rotation: [0, 0, 0, 1] });
      }
      return world;
    },
  };
}

/**
 * A robot-like assembly: a 10 × 15 grid of small plates on the ground, each bolted to its eight
 * neighbours (275 edge bolts and 252 diagonal ones), with two robots side by side.
 */
function robots(ground = true): Scenario {
  const nx = 10, nz = 15, cell = 0.04;
  const parts: PhysPart[] = [];
  const conns: Connection[] = [];
  const id = (i: number, k: number) => `p${i}_${k}`;
  for (let i = 0; i < nx; i++) {
    for (let k = 0; k < nz; k++) parts.push(boxPart(id(i, k), [cell, 0.01, cell], [i * cell, 0.005, k * cell], { mass: 0.15 }));
  }
  for (let i = 0; i < nx; i++) {
    for (let k = 0; k < nz; k++) {
      const links: [number, number][] = [[1, 0], [0, 1], [1, 1], [1, -1]];
      for (const [di, dk] of links) {
        const i2 = i + di, k2 = k + dk;
        if (i2 < 0 || i2 >= nx || k2 < 0 || k2 >= nz) continue;
        const at: [number, number, number] = [(i + i2) * cell / 2, 0.005, (k + k2) * cell / 2];
        conns.push(bolt(`${id(i, k)}-${id(i2, k2)}`, id(i, k), id(i2, k2), at, [0, 1, 0]));
      }
    }
  }
  return {
    name: ground ? 'two robots: 2 × 150 bolted plates on the ground' : 'the same two robots in free fall (no contacts)',
    bodies: 2 * parts.length,
    constraints: 2 * conns.length,
    build() {
      const world = createWorld({ dt: 1 / 1000, iterations: 4 });
      if (ground) world.addGround();
      world.addRobot(model('a', parts, conns), AT_ORIGIN);
      world.addRobot(model('b', parts, conns), { position: [0.6, 0, 0], rotation: [0, 0, 0, 1] });
      return world;
    },
  };
}

function measure(s: Scenario, warmup: number, steps: number): number {
  const world = s.build();
  for (let i = 0; i < warmup; i++) world.step();
  const t0 = performance.now();
  for (let i = 0; i < steps; i++) world.step();
  return (performance.now() - t0) / steps;
}

const scenarios: [Scenario, number, number][] = [
  [robots(), 200, 1000],
  [robots(false), 200, 1000],
  [pile(200), 100, 300],
  [pile(1000), 50, 100],
  [pile(2000), 20, 50],
  [chains(200), 100, 500],
  [chains(1000), 50, 200],
  [chains(2000), 20, 100],
];

console.log(`node ${process.version}, dt = 1 ms, 4 iterations`);
for (const [s, warmup, steps] of scenarios) {
  const ms = measure(s, warmup, steps);
  console.log(`${s.name.padEnd(50)} ${String(s.bodies).padStart(5)} bodies ${String(s.constraints).padStart(5)} joints  ${ms.toFixed(3).padStart(8)} ms/substep`);
}
