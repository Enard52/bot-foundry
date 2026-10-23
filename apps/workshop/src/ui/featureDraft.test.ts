import { describe, expect, it } from 'vitest';
import { createKernel, rectProfile } from '@botfoundry/cad';
import { PLANE_XZ, type Design } from '@botfoundry/model';
import { addSketch, emptyDesign } from '../state/ops.ts';
import { applyDraft, defaultDraft } from './featureDraft.ts';

const withSketch = (): Design =>
  addSketch(emptyDesign(), { id: 'sketch-1', name: 'Sketch 1', plane: PLANE_XZ, profiles: [rectProfile(-0.05, -0.05, 0.05, 0.05)] });

function must<T extends object>(r: T | { error: string }): T {
  if ('error' in r) throw new Error(r.error);
  return r;
}

describe('applyDraft', () => {
  it('makes a plate body whose first extrude is the thickness, and the kernel accepts it', async () => {
    const d = withSketch();
    const draft = { ...defaultDraft(d, 'sketch-1', 'extrude'), thickness: 0.008, distance: 0.5 };
    const { design, selection } = must(applyDraft(d, draft));
    expect(selection).toEqual({ kind: 'body', id: 'body-1' });
    const kernel = await createKernel();
    const ev = kernel.evaluate(design);
    expect(ev.bodies[0]?.errors).toEqual([]);
    // 100 mm x 100 mm x 8 mm of 6061: 0.01 * 0.008 * 2700
    expect(ev.bodies[0]?.mass.mass).toBeCloseTo(0.1 * 0.1 * 0.008 * 2700, 4);
    kernel.dispose();
  });

  it('adds a subtracting extrude to an existing body', async () => {
    const d0 = withSketch();
    const first = must(applyDraft(d0, defaultDraft(d0, 'sketch-1', 'extrude')));
    const d1 = addSketch(first.design, { id: 'sketch-2', name: 'Sketch 2', plane: { origin: [0, 0.006, 0], normal: [0, 1, 0], xAxis: [1, 0, 0] }, profiles: [rectProfile(-0.01, -0.01, 0.01, 0.01)] });
    const cut = { ...defaultDraft(d1, 'sketch-2', 'extrude'), op: 'subtract' as const, target: 'body-1', distance: -0.006 };
    const second = must(applyDraft(d1, cut));
    expect(second.selection).toEqual({ kind: 'feature', body: 'body-1', id: 'feature-2' });
    const kernel = await createKernel();
    const ev = kernel.evaluate(second.design);
    expect(ev.bodies[0]?.errors).toEqual([]);
    const full = 0.1 * 0.1 * 0.006 * 2700;
    expect(ev.bodies[0]?.mass.mass).toBeCloseTo(full - 0.02 * 0.02 * 0.006 * 2700, 4);
    kernel.dispose();
  });

  it('revolves a billet about the sketch y axis', async () => {
    const d = addSketch(emptyDesign(), { id: 'sketch-1', name: 'S', plane: { origin: [0, 0, 0], normal: [0, 0, 1], xAxis: [1, 0, 0] }, profiles: [rectProfile(0, 0, 0.02, 0.05)] });
    const draft = { ...defaultDraft(d, 'sketch-1', 'revolve'), structure: 'billet' as const };
    const { design } = must(applyDraft(d, draft));
    const kernel = await createKernel();
    const ev = kernel.evaluate(design);
    expect(ev.bodies[0]?.errors).toEqual([]);
    // cylinder r = 20 mm, h = 50 mm; the kernel's polygonal circle is a little under (about 1 %)
    expect(ev.bodies[0]?.mass.mass).toBeGreaterThan(Math.PI * 0.02 ** 2 * 0.05 * 2700 * 0.98);
    expect(ev.bodies[0]?.mass.mass).toBeLessThan(Math.PI * 0.02 ** 2 * 0.05 * 2700 * 1.001);
    kernel.dispose();
  });

  it('defaults a revolve to a billet, since a plate is an extruded sheet', () => {
    const d = withSketch();
    expect(defaultDraft(d, 'sketch-1', 'revolve').structure).toBe('billet');
    expect(defaultDraft(d, 'sketch-1', 'extrude').structure).toBe('plate');
  });

  it('rejects unusable drafts with a message', () => {
    const d = withSketch();
    expect(applyDraft(d, defaultDraft(d, 'nope', 'extrude'))).toHaveProperty('error');
    const bad = applyDraft(d, { ...defaultDraft(d, 'sketch-1', 'extrude'), op: 'add' });
    expect('error' in bad && bad.error).toMatch(/Pick the body/);
    const plateRevolve = applyDraft(d, { ...defaultDraft(d, 'sketch-1', 'revolve'), structure: 'plate' });
    expect('error' in plateRevolve && plateRevolve.error).toMatch(/billet or tube/);
  });
});
