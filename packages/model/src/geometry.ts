// All geometry is plain JSON in SI units (metres, radians).

export type Id = string;
export type V2 = readonly [number, number];
export type V3 = readonly [number, number, number];
/** Unit quaternion [x, y, z, w]. */
export type Quat = readonly [number, number, number, number];

export interface Transform {
  position: V3;
  rotation: Quat;
}

export const IDENTITY: Transform = { position: [0, 0, 0], rotation: [0, 0, 0, 1] };

/** A datum plane. Sketch coordinates (u, v) map to origin + u * xAxis + v * (normal × xAxis). */
export interface Plane {
  origin: V3;
  normal: V3;
  xAxis: V3;
}

export const PLANE_XY: Plane = { origin: [0, 0, 0], normal: [0, 0, 1], xAxis: [1, 0, 0] };
export const PLANE_XZ: Plane = { origin: [0, 0, 0], normal: [0, 1, 0], xAxis: [1, 0, 0] };
export const PLANE_YZ: Plane = { origin: [0, 0, 0], normal: [1, 0, 0], xAxis: [0, 1, 0] };

/**
 * One segment of a closed loop, ending at `to`. `bulge` follows the DXF polyline convention:
 * tan(sweep / 4), positive for counter-clockwise arcs, 0 (or absent) for a straight line.
 */
export interface Segment {
  to: V2;
  bulge?: number;
}

/** A closed loop: starts at `start`, the last segment must end back at `start`. */
export interface Loop {
  start: V2;
  segments: Segment[];
}

/** A region to extrude or revolve: one outer boundary and any number of holes. */
export interface Profile {
  outer: Loop;
  holes: Loop[];
}

/** Symmetric 3x3 inertia tensor [Ixx, Iyy, Izz, Ixy, Ixz, Iyz] in kg·m². */
export type Sym3 = readonly [number, number, number, number, number, number];

export interface MassProperties {
  /** kg */
  mass: number;
  /** m³ */
  volume: number;
  /** centre of mass, design frame */
  com: V3;
  /** about the centre of mass, design-frame axes */
  inertia: Sym3;
}

/** Triangle mesh for rendering and collision preprocessing. */
export interface MeshData {
  positions: number[];
  indices: number[];
}

/** A convex hull for collision, vertices in the design frame. */
export interface ConvexHull {
  vertices: V3[];
}

/** Simple solids used by component geometry and keep-out envelopes, in the component's local frame. */
export type Primitive =
  | { kind: 'box'; size: V3; at: V3 }
  | { kind: 'cylinder'; radius: number; length: number; axis: 'x' | 'y' | 'z'; at: V3 };
