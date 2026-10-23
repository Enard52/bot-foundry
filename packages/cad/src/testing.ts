import { EMPTY_CONTROLS, type Body, type Design, type Feature, type MaterialId, type Plane, type Profile, type Sketch, type Structure } from '@botfoundry/model';

// Small builders for tests and scripts.

export function makeDesign(parts: Partial<Design> = {}): Design {
  return {
    schema: 'botfoundry/design@0',
    name: 'test',
    sketches: [],
    bodies: [],
    components: [],
    fasteners: [],
    welds: [],
    joints: [],
    wiring: [],
    controls: EMPTY_CONTROLS,
    ...parts,
  };
}

export function sketch(id: string, plane: Plane, ...profiles: Profile[]): Sketch {
  return { id, name: id, plane, profiles };
}

export function body(
  id: string, material: MaterialId, structure: Structure, ...features: Feature[]
): Body {
  return { id, name: id, material, structure, features };
}

/** Axis-aligned bounds of a flat position array. */
export function bounds(positions: readonly number[]): { min: [number, number, number]; max: [number, number, number] } {
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      const v = positions[i + k] as number;
      if (v < (min[k] as number)) min[k] = v;
      if (v > (max[k] as number)) max[k] = v;
    }
  }
  return { min, max };
}
