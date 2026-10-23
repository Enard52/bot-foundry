import type { Body, BooleanOp, Design, Feature, Id, MaterialId, V2 } from '@botfoundry/model';
import { addBody, addFeature, allIds, nextId } from '../state/ops.ts';
import type { Selection } from '../state/store.ts';

export type FeatureKind = 'extrude' | 'revolve';
export type StructureKind = 'plate' | 'billet' | 'tube';

/** Everything the "new feature" dialog collects, in SI units. */
export interface FeatureDraft {
  sketchId: Id;
  kind: FeatureKind;
  op: BooleanOp;
  /** body to add to / subtract from; null for a new body */
  target: Id | null;
  name: string;
  material: MaterialId;
  structure: StructureKind;
  thickness: number;
  wall: number;
  distance: number;
  taper: number;
  symmetric: boolean;
  angle: number;
  axis: { origin: V2; direction: V2 };
}

export function defaultDraft(d: Design, sketchId: Id, kind: FeatureKind): FeatureDraft {
  return {
    sketchId, kind,
    op: 'new', target: null,
    name: `Body ${d.bodies.length + 1}`,
    material: 'al6061', structure: kind === 'revolve' ? 'billet' : 'plate', thickness: 0.006, wall: 0.002,
    distance: 0.006, taper: 0, symmetric: false,
    angle: 2 * Math.PI, axis: { origin: [0, 0], direction: [0, 1] },
  };
}

/** Plates are extruded exactly their thickness; the dialog hides the distance for them. */
export function distanceIsThickness(draft: FeatureDraft): boolean {
  return draft.kind === 'extrude' && draft.op === 'new' && draft.structure === 'plate';
}

/** Turn a draft into a design edit. Returns the design unchanged when the draft is unusable. */
export function applyDraft(d: Design, draft: FeatureDraft): { design: Design; selection: Selection } | { error: string } {
  if (!d.sketches.some((s) => s.id === draft.sketchId)) return { error: 'The sketch no longer exists.' };
  const taken = allIds(d);
  const featureId = nextId('feature', taken);
  taken.add(featureId);

  let feature: Feature;
  if (draft.kind === 'extrude') {
    const distance = distanceIsThickness(draft) ? Math.abs(draft.thickness) : draft.distance;
    if (!(Math.abs(distance) > 0)) return { error: 'The extrude distance must not be zero.' };
    feature = {
      kind: 'extrude', id: featureId, sketch: draft.sketchId, distance, op: draft.op,
      ...(draft.taper !== 0 ? { taper: draft.taper } : {}),
      ...(draft.symmetric ? { symmetric: true } : {}),
    };
  } else {
    if (!(draft.angle > 0)) return { error: 'The revolve angle must be positive.' };
    feature = { kind: 'revolve', id: featureId, sketch: draft.sketchId, axis: draft.axis, angle: draft.angle, op: draft.op };
  }

  if (draft.op === 'new') {
    if (draft.structure === 'plate' && !(draft.thickness > 0)) return { error: 'The plate thickness must be positive.' };
    if (draft.structure === 'plate' && draft.kind === 'revolve') return { error: 'A plate is an extruded sheet; choose billet or tube for a revolved body.' };
    const id = nextId('body', taken);
    const body: Body = {
      id, name: draft.name.trim() || id, material: draft.material,
      structure: draft.structure === 'plate' ? { kind: 'plate', thickness: draft.thickness } : draft.structure === 'tube' ? { kind: 'tube', wall: draft.wall } : { kind: 'billet' },
      features: [feature],
    };
    return { design: addBody(d, body), selection: { kind: 'body', id } };
  }
  if (!draft.target || !d.bodies.some((b) => b.id === draft.target)) return { error: 'Pick the body to modify.' };
  return { design: addFeature(d, draft.target, feature), selection: { kind: 'feature', body: draft.target, id: featureId } };
}
