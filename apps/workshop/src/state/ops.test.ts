import { describe, expect, it } from 'vitest';
import { rectLoop, sampleDesign } from '@botfoundry/cad';
import type { Body, Sketch } from '@botfoundry/model';
import { axisName } from '../geom/plane.ts';
import {
  addBody, addSketch, allIds, carvedBodies, emptyDesign, facePlanes, nextId, removeBody, removeComponent,
  removeFeature, removeSketch, setCarve, updateBody, updateFeature,
} from './ops.ts';

const sketch: Sketch = {
  id: 'sk-1', name: 'S', plane: { origin: [0, 0, 0], normal: [0, 1, 0], xAxis: [1, 0, 0] },
  profiles: [{ outer: rectLoop(0, 0, 0.1, 0.1), holes: [] }],
};
const plate: Body = {
  id: 'body-1', name: 'Plate', material: 'al6061', structure: { kind: 'plate', thickness: 0.008 },
  features: [{ kind: 'extrude', id: 'f-1', sketch: 'sk-1', distance: 0.008, op: 'new' }],
};

describe('ids', () => {
  it('finds the first free id', () => {
    expect(nextId('body', new Set(['body-1', 'body-2']))).toBe('body-3');
  });
  it('collects every id in a design', () => {
    const ids = allIds(sampleDesign());
    expect(ids.has('base')).toBe(true);
    expect(ids.has('base-ext')).toBe(true);
    expect(ids.has('motor-left')).toBe(true);
  });
});

describe('plate thickness', () => {
  const d = addBody(addSketch(emptyDesign(), sketch), plate);

  it('rewrites the first extrude when the thickness changes', () => {
    const next = updateBody(d, 'body-1', { structure: { kind: 'plate', thickness: 0.01 } });
    const f = next.bodies[0]?.features[0];
    expect(f?.kind === 'extrude' && f.distance).toBe(0.01);
  });

  it('keeps the sign of a downward extrude', () => {
    const down = updateFeature(d, 'body-1', 'f-1', { distance: -0.008 });
    const next = updateBody(down, 'body-1', { structure: { kind: 'plate', thickness: 0.006 } });
    const f = next.bodies[0]?.features[0];
    expect(f?.kind === 'extrude' && f.distance).toBe(-0.006);
  });

  it('rewrites the thickness when the first extrude changes', () => {
    const next = updateFeature(d, 'body-1', 'f-1', { distance: 0.012 });
    expect(next.bodies[0]?.structure).toEqual({ kind: 'plate', thickness: 0.012 });
  });

  it('does not mutate the input', () => {
    updateFeature(d, 'body-1', 'f-1', { distance: 0.5 });
    expect(d.bodies[0]?.features[0]).toMatchObject({ distance: 0.008 });
  });
});

describe('removal', () => {
  it('removes a body that loses its only feature', () => {
    const d = addBody(addSketch(emptyDesign(), sketch), plate);
    expect(removeFeature(d, 'body-1', 'f-1').bodies).toHaveLength(0);
  });

  it('removes features built from a deleted sketch, and the body with them', () => {
    const d = addBody(addSketch(emptyDesign(), sketch), plate);
    const next = removeSketch(d, 'sk-1');
    expect(next.sketches).toHaveLength(0);
    expect(next.bodies).toHaveLength(0);
  });

  it('cleans up references when a body goes', () => {
    const d = sampleDesign();
    const next = removeBody(d, 'wall-right');
    expect(next.components.find((c) => c.id === 'motor-right')?.mountedTo).toBeUndefined();
    expect(next.joints.some((j) => j.a === 'wall-right')).toBe(false);
    expect(next.fasteners.some((f) => f.joins.includes('wall-right'))).toBe(false);
  });

  it('cleans up carves, wiring and joints when a component goes', () => {
    const next = removeComponent(sampleDesign(), 'motor-right');
    expect(carvedBodies(next, 'motor-right')).toEqual([]);
    expect(next.wiring.some((w) => w.to.component === 'motor-right')).toBe(false);
    expect(next.joints.some((j) => j.drive === 'motor-right')).toBe(false);
  });
});

describe('carve', () => {
  it('adds a carve once per body and strips them all when off', () => {
    const d = sampleDesign();
    const on = setCarve(d, 'wheel-right', ['base', 'core'], true);
    expect(carvedBodies(on, 'wheel-right').sort()).toEqual(['base', 'core']);
    const again = setCarve(on, 'wheel-right', ['base'], true);
    expect(again.bodies.find((b) => b.id === 'base')?.features.filter((f) => f.kind === 'carve' && f.component === 'wheel-right')).toHaveLength(1);
    expect(carvedBodies(setCarve(on, 'wheel-right', [], false), 'wheel-right')).toEqual([]);
  });

  it('gives each new carve a unique feature id', () => {
    const on = setCarve(sampleDesign(), 'wheel-right', ['base', 'core', 'wedge'], true);
    const ids = on.bodies.flatMap((b) => b.features.map((f) => f.id));
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('facePlanes', () => {
  it('returns outward-facing planes at both faces of an extruded body', () => {
    const d = addBody(addSketch(emptyDesign(), sketch), plate);
    const faces = facePlanes(d, (n) => axisName(n) ?? 'sloped');
    expect(faces.map((f) => f.label)).toEqual(['Plate +Y', 'Plate -Y']);
    expect(faces[0]?.plane.origin[1]).toBeCloseTo(0.008, 12);
    expect(faces[1]?.plane.origin[1]).toBe(0);
    expect(faces[1]?.plane.normal).toEqual([-0, -1, -0]);
  });

  it('honours a downward extrude', () => {
    const d = addBody(addSketch(emptyDesign(), sketch), { ...plate, features: [{ kind: 'extrude', id: 'f-1', sketch: 'sk-1', distance: -0.008, op: 'new' }] });
    const faces = facePlanes(d, (n) => axisName(n) ?? 'sloped');
    expect(faces[0]?.plane.origin[1]).toBeCloseTo(-0.008, 12);
    expect(faces[0]?.plane.normal[1]).toBeCloseTo(-1, 12);
  });
});
