import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createKernel, type CadKernel } from './kernel.ts';
import { sampleDesign } from './samples.ts';

let kernel: CadKernel;
beforeAll(async () => {
  kernel = await createKernel();
});
afterAll(() => kernel.dispose());

const ALL_BODIES = ['base', 'wall-right', 'wall-left', 'core', 'wedge'];

describe('per-body evaluation cache', () => {
  it('evaluates everything cold, nothing on an unchanged design', () => {
    const d = sampleDesign();
    const first = kernel.evaluate(d);
    expect(kernel.stats().bodiesEvaluated.sort()).toEqual([...ALL_BODIES].sort());
    const second = kernel.evaluate(sampleDesign()); // equal by value, not by identity
    expect(kernel.stats().bodiesEvaluated).toEqual([]);
    expect(kernel.stats().bodiesReused.sort()).toEqual([...ALL_BODIES].sort());
    expect(kernel.stats().collisionTests).toBe(0);
    expect(second.bodies[0]!.mesh).toBe(first.bodies[0]!.mesh); // same cached object
  });

  it('moving one carved component re-evaluates only the bodies it touches', () => {
    const d = sampleDesign();
    kernel.evaluate(d);
    const before = kernel.evaluate(d);
    const motor = d.components.find((c) => c.id === 'motor-right')!;
    motor.pose = { ...motor.pose, position: [motor.pose.position[0], motor.pose.position[1], motor.pose.position[2] + 0.001] };
    const after = kernel.evaluate(d);
    expect(kernel.stats().bodiesEvaluated).toEqual(['wall-right']);
    expect(kernel.stats().componentsBuilt).toEqual(['motor-right']);
    expect(after.bodies.find((b) => b.id === 'wall-right')!.mesh).not.toBe(before.bodies.find((b) => b.id === 'wall-right')!.mesh);
    for (const id of ['base', 'wall-left', 'core', 'wedge']) {
      expect(after.bodies.find((b) => b.id === id)!.mesh).toBe(before.bodies.find((b) => b.id === id)!.mesh);
    }
  });

  it('moving a component that carves two bodies re-evaluates exactly those', () => {
    const d = sampleDesign();
    kernel.evaluate(d);
    const battery = d.components.find((c) => c.id === 'battery')!;
    battery.pose = { ...battery.pose, position: [battery.pose.position[0] + 0.002, battery.pose.position[1], battery.pose.position[2]] };
    kernel.evaluate(d);
    expect(kernel.stats().bodiesEvaluated).toEqual(['core']);
  });

  it('editing a sketch re-evaluates only the bodies built from it', () => {
    const d = sampleDesign();
    kernel.evaluate(d);
    const sk = d.sketches.find((s) => s.id === 'sk-core')!;
    sk.profiles = [{ ...sk.profiles[0]!, outer: { ...sk.profiles[0]!.outer, start: [-0.006, -0.045] } }];
    // the closing segment no longer ends at the start, so the body reports it; nothing else changes
    const ev = kernel.evaluate(d);
    expect(kernel.stats().bodiesEvaluated).toEqual(['core']);
    expect(ev.bodies.find((b) => b.id === 'core')!.errors.join()).toMatch(/not closed/);
  });

  it('changing a body property (material) re-evaluates that body only', () => {
    const d = sampleDesign();
    kernel.evaluate(d);
    const base = kernel.evaluate(d).bodies.find((b) => b.id === 'base')!.mass.mass;
    d.bodies.find((b) => b.id === 'base')!.material = 'a36';
    const ev = kernel.evaluate(d);
    expect(kernel.stats().bodiesEvaluated).toEqual(['base']);
    expect(ev.bodies.find((b) => b.id === 'base')!.mass.mass).toBeCloseTo(base * (7850 / 2700), 6);
  });

  it('compile after evaluate reuses the cache', () => {
    const d = sampleDesign();
    kernel.evaluate(d);
    kernel.compile(d);
    expect(kernel.stats().bodiesEvaluated).toEqual([]);
  });

  it('forgets bodies that leave the design', () => {
    const d = sampleDesign();
    kernel.evaluate(d);
    d.bodies = d.bodies.filter((b) => b.id !== 'wedge');
    d.fasteners = d.fasteners.filter((f) => !f.joins.includes('wedge'));
    kernel.evaluate(d);
    expect(kernel.stats().bodiesEvaluated).toEqual([]);
    d.bodies.push(sampleDesign().bodies.find((b) => b.id === 'wedge')!);
    kernel.evaluate(d);
    expect(kernel.stats().bodiesEvaluated).toEqual(['wedge']);
  });

  it('rejects ids shared between a body and a component', () => {
    const d = sampleDesign();
    d.components[0]!.id = 'base';
    expect(() => kernel.evaluate(d)).toThrow(/duplicate id "base"/);
  });
});
