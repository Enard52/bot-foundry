// Incremental evaluation benchmark. Run from packages/cad:
//   node --experimental-strip-types bench/booleans.ts
// Gate: median incremental evaluate (one carved motor moved) under 16 ms, one frame at 60 Hz.

import { createKernel } from '../src/kernel.ts';
import { sampleDesign } from '../src/samples.ts';

const GATE_MS = 16;
const MOVES = 50;

function percentile(sorted: number[], p: number): number {
  const i = Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1);
  return sorted[Math.max(0, i)] as number;
}

const kernel = await createKernel();
const design = sampleDesign();

// warm the WASM module and the JIT on a throwaway kernel so the cold number is the kernel's, not the runtime's
{
  const warm = await createKernel();
  warm.evaluate(design);
  warm.dispose();
}

const t0 = performance.now();
const cold = kernel.evaluate(design);
const coldWall = performance.now() - t0;

const motor = design.components.find((c) => c.id === 'motor-right');
if (!motor) throw new Error('sample design has no motor-right');
const home = motor.pose.position;

const times: number[] = [];
const touched: number[] = [];
for (let i = 1; i <= MOVES; i++) {
  // slide the motor along its axle by up to 3 mm and back, so each step is a new pose
  const dz = 0.003 * Math.sin((i * Math.PI) / 8);
  motor.pose = { ...motor.pose, position: [home[0] + 0.001 * Math.cos(i), home[1], home[2] + dz] };
  const s = performance.now();
  kernel.evaluate(design);
  times.push(performance.now() - s);
  touched.push(kernel.stats().bodiesEvaluated.length);
}
const sorted = [...times].sort((a, b) => a - b);
const median = percentile(sorted, 0.5);
const p95 = percentile(sorted, 0.95);

console.log(`bodies: ${cold.bodies.length}, components: ${cold.components.length}`);
console.log(`cold evaluate: ${coldWall.toFixed(1)} ms wall (${cold.timeMs.toFixed(1)} ms reported)`);
console.log(`incremental evaluate over ${MOVES} moves of motor-right (bodies re-evaluated per move: ${Math.min(...touched)}..${Math.max(...touched)})`);
console.log(`  median: ${median.toFixed(2)} ms`);
console.log(`  p95:    ${p95.toFixed(2)} ms`);
console.log(`  min/max: ${sorted[0]?.toFixed(2)} / ${sorted[sorted.length - 1]?.toFixed(2)} ms`);
console.log(`gate (median < ${GATE_MS} ms): ${median < GATE_MS ? 'PASS' : 'FAIL'}`);

kernel.dispose();
if (median >= GATE_MS) throw new Error(`gate failed: median ${median.toFixed(2)} ms >= ${GATE_MS} ms`);
