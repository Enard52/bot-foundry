// Substep cost of the solver core, both backends side by side. Run from packages/physics:
//   node --experimental-strip-types bench/step.ts
// Every scenario runs at dt = 1/1000 s with 4 iterations. Each backend builds its own world, steps
// it through the same warm-up (which also lets V8 optimise both), then reports the mean wall time
// per substep. Loading and compiling the WebAssembly module happens once before any timing.
// Gate S1: two robots (about 300 bodies and 1,000 bolts, on the ground) under 0.5 ms per substep,
// judged on two scenarios, each run 7 times on fresh worlds with the verdict on the median:
//   resting  the robots standing on the ground, timed over substeps 200-1200
//   dynamic  the same robots dropped from 10 cm, timed over substeps 100-500 (the plates reach the
//            ground at about substep 170, then settle)

import { availableParallelism, loadavg } from 'node:os';
import type { WorldOptions } from '../src/index.ts';
import { chains, pile, robots, type Scenario } from '../src/scenarios.ts';
import { loadWasmSolver } from '../src/wasm.ts';

const BACKENDS: NonNullable<WorldOptions['backend']>[] = ['ts', 'wasm'];
const GATE_MS = 0.5;

function measure(s: Scenario, backend: NonNullable<WorldOptions['backend']>, warmup: number, steps: number): number {
  const world = s.build({ backend });
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

await loadWasmSolver();
console.log(`node ${process.version}, dt = 1 ms, 4 iterations, load average ${loadavg()[0]!.toFixed(1)} on ${availableParallelism()} cores`);
console.log(`${'scenario'.padEnd(50)} bodies joints     ts ms/substep   wasm ms/substep  speed-up`);
for (const [s, warmup, steps] of scenarios) {
  const [ts, wasm] = BACKENDS.map((b) => measure(s, b, warmup, steps)) as [number, number];
  console.log(
    `${s.name.padEnd(50)} ${String(s.bodies).padStart(6)} ${String(s.constraints).padStart(6)} ${ts.toFixed(3).padStart(16)} ${wasm.toFixed(3).padStart(17)} ${(ts / wasm).toFixed(1).padStart(8)}x`,
  );
}

// Gate S1. A single mean on one run moves with whatever else the machine is doing, so each gate
// scenario is run GATE_RUNS times, alternating backends, and judged on the median.
const GATE_RUNS = 7;
const gates: { label: string; scenario: Scenario; warmup: number; steps: number }[] = [
  { label: 'resting: two robots on the ground, substeps 200-1200', scenario: robots(), warmup: 200, steps: 1000 },
  { label: 'dynamic: dropped from 10 cm, substeps 100-500', scenario: robots(true, 0.1), warmup: 100, steps: 400 },
];

const median = (xs: number[]): number => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;

console.log(`\ngate S1: ${GATE_RUNS} runs per backend on fresh worlds, ms per substep`);
console.log(`${'scenario'.padEnd(56)} backend    median       min       max`);
const verdicts: string[] = [];
for (const { label, scenario, warmup, steps } of gates) {
  const runs: Record<string, number[]> = { ts: [], wasm: [] };
  for (let r = 0; r < GATE_RUNS; r++) {
    for (const b of BACKENDS) runs[b]!.push(measure(scenario, b, warmup, steps));
  }
  for (const b of BACKENDS) {
    const t = runs[b]!;
    console.log(`${(b === 'ts' ? label : '').padEnd(56)} ${b.padEnd(7)} ${median(t).toFixed(3).padStart(9)} ${Math.min(...t).toFixed(3).padStart(9)} ${Math.max(...t).toFixed(3).padStart(9)}`);
  }
  const m = median(runs.wasm!);
  verdicts.push(`gate S1 ${label.split(':')[0]} (wasm median): ${m.toFixed(3)} ms per substep, target under ${GATE_MS} ms: ${m < GATE_MS ? 'met' : 'not met'}`);
}
console.log(`\n${verdicts.join('\n')}`);
