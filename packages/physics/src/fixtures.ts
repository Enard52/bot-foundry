import {
  EMPTY_CONTROLS,
  MATERIALS,
  boltRating,
  type BoltGrade,
  type BoltSize,
  type Connection,
  type MaterialId,
  type PhysPart,
  type PhysicalModel,
  type V3,
} from '@botfoundry/model';

// Hand-built physical models for tests and benchmarks: boxes, bolts and joints, without the CAD
// kernel. Not exported from the package entry point.

export interface BoxOptions {
  /** kg; 0 makes a static (immovable) part; default from the material density */
  mass?: number;
  material?: MaterialId;
}

/** A solid box part centred at `center` (design frame), axis-aligned. */
export function boxPart(id: string, size: V3, center: V3, opts: BoxOptions = {}): PhysPart {
  const material = opts.material ?? 'a36';
  const [sx, sy, sz] = size;
  const volume = sx * sy * sz;
  const mass = opts.mass ?? volume * MATERIALS[material].density;
  const vertices: V3[] = [];
  for (const dx of [-0.5, 0.5]) {
    for (const dy of [-0.5, 0.5]) {
      for (const dz of [-0.5, 0.5]) vertices.push([center[0] + dx * sx, center[1] + dy * sy, center[2] + dz * sz]);
    }
  }
  return {
    id,
    source: { kind: 'body', id },
    material,
    mass: {
      mass,
      volume,
      com: center,
      inertia: [(mass * (sy * sy + sz * sz)) / 12, (mass * (sx * sx + sz * sz)) / 12, (mass * (sx * sx + sy * sy)) / 12, 0, 0, 0],
    },
    collision: [{ vertices }],
    mesh: { positions: vertices.flat(), indices: BOX_TRIANGLES },
    structure: { kind: 'rigid' },
  };
}

// corner index = 4·ix + 2·iy + iz
const BOX_TRIANGLES = [0, 1, 3, 0, 3, 2, 4, 6, 7, 4, 7, 5, 0, 4, 5, 0, 5, 1, 2, 3, 7, 2, 7, 6, 0, 2, 6, 0, 6, 4, 1, 5, 7, 1, 7, 3];

export function bolt(id: string, a: string, b: string, position: V3, axis: V3, size: BoltSize = 'M5', grade: BoltGrade = '8.8'): Connection {
  return { kind: 'bolt', id, a, b, position, axis, rating: boltRating({ size, grade, length: 0.02 }) };
}

export function model(name: string, parts: PhysPart[], connections: Connection[] = []): PhysicalModel {
  let mass = 0;
  const com = [0, 0, 0];
  for (const p of parts) {
    mass += p.mass.mass;
    for (let i = 0; i < 3; i++) com[i]! += p.mass.mass * p.mass.com[i]!;
  }
  return {
    schema: 'botfoundry/physical@0',
    name,
    parts,
    connections,
    actuators: [],
    power: { packs: [], escs: [], wiringResistance: {} },
    controls: EMPTY_CONTROLS,
    mass: {
      mass,
      volume: parts.reduce((v, p) => v + p.mass.volume, 0),
      com: mass > 0 ? [com[0]! / mass, com[1]! / mass, com[2]! / mass] : [0, 0, 0],
      inertia: [0, 0, 0, 0, 0, 0],
    },
  };
}

export const AT_ORIGIN = { position: [0, 0, 0] as V3, rotation: [0, 0, 0, 1] as const };
