// Collision hull preprocessing: the contract gives a convex hull as bare vertices; contact
// generation needs its faces (as polygons, so coplanar triangles merge), edges and the set of
// distinct edge directions for the separating-axis test.

export interface HullFace {
  /** outward unit normal, body frame */
  normal: Float64Array;
  /** plane offset: normal · v = offset for every vertex v on the face */
  offset: number;
  /** vertex indices, counter-clockwise seen from outside */
  verts: number[];
}

export interface HullEdge {
  i0: number;
  i1: number;
  /** index into Hull.edgeDirs */
  dir: number;
}

export interface Hull {
  /** vertices in the body frame, flat xyz */
  verts: Float64Array;
  count: number;
  faces: HullFace[];
  edges: HullEdge[];
  /** distinct edge directions, unit, flat xyz */
  edgeDirs: Float64Array;
  /** distance from the body origin (its centre of mass) to the farthest vertex */
  radius: number;
}

/**
 * Builds face polygons by plane enumeration: every vertex triple whose plane has all other
 * vertices behind it is a face plane. O(n⁴) in the vertex count, which is fine for the small
 * hulls a convex decomposition produces and runs once per part; a quickhull can replace it.
 */
export function buildHull(points: ArrayLike<number>[]): Hull {
  const pts = dedupe(points);
  const n = pts.length / 3;
  if (n < 4) throw new Error(`collision hull needs at least 4 distinct vertices, got ${n}`);

  let extent = 0;
  for (let i = 0; i < pts.length; i++) extent = Math.max(extent, Math.abs(pts[i]!));
  const eps = 1e-9 * Math.max(extent, 1e-3);

  const planes: { nx: number; ny: number; nz: number; d: number }[] = [];
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      for (let k = j + 1; k < n; k++) {
        const ex = pts[j * 3]! - pts[i * 3]!, ey = pts[j * 3 + 1]! - pts[i * 3 + 1]!, ez = pts[j * 3 + 2]! - pts[i * 3 + 2]!;
        const fx = pts[k * 3]! - pts[i * 3]!, fy = pts[k * 3 + 1]! - pts[i * 3 + 1]!, fz = pts[k * 3 + 2]! - pts[i * 3 + 2]!;
        let nx = ey * fz - ez * fy, ny = ez * fx - ex * fz, nz = ex * fy - ey * fx;
        const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
        if (len <= eps * extent) continue;
        nx /= len;
        ny /= len;
        nz /= len;
        let d = nx * pts[i * 3]! + ny * pts[i * 3 + 1]! + nz * pts[i * 3 + 2]!;
        let above = 0, below = 0;
        for (let m = 0; m < n; m++) {
          const s = nx * pts[m * 3]! + ny * pts[m * 3 + 1]! + nz * pts[m * 3 + 2]! - d;
          if (s > eps) above++;
          else if (s < -eps) below++;
          if (above > 0 && below > 0) break;
        }
        if (above > 0 && below > 0) continue;
        if (above === 0 && below === 0) continue; // all coplanar: degenerate
        if (above > 0) {
          nx = -nx;
          ny = -ny;
          nz = -nz;
          d = -d;
        }
        if (!planes.some((p) => p.nx * nx + p.ny * ny + p.nz * nz > 1 - 1e-9 && Math.abs(p.d - d) <= eps)) {
          planes.push({ nx, ny, nz, d });
        }
      }
    }
  }
  if (planes.length < 4) throw new Error('collision hull is flat: all vertices lie in one plane');

  const faces: HullFace[] = planes.map((p) => {
    const normal = new Float64Array([p.nx, p.ny, p.nz]);
    const on: number[] = [];
    for (let m = 0; m < n; m++) {
      const s = p.nx * pts[m * 3]! + p.ny * pts[m * 3 + 1]! + p.nz * pts[m * 3 + 2]! - p.d;
      if (Math.abs(s) <= eps) on.push(m);
    }
    return { normal, offset: p.d, verts: orderPolygon(pts, on, normal) };
  });

  const edges: HullEdge[] = [];
  const dirs: number[] = [];
  const seen = new Set<number>();
  for (const f of faces) {
    for (let a = 0; a < f.verts.length; a++) {
      const i0 = f.verts[a]!, i1 = f.verts[(a + 1) % f.verts.length]!;
      const key = Math.min(i0, i1) * n + Math.max(i0, i1);
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push({ i0, i1, dir: edgeDirIndex(dirs, pts, i0, i1) });
    }
  }

  let radius = 0;
  for (let m = 0; m < n; m++) {
    radius = Math.max(radius, Math.sqrt(pts[m * 3]! ** 2 + pts[m * 3 + 1]! ** 2 + pts[m * 3 + 2]! ** 2));
  }
  return { verts: pts, count: n, faces, edges, edgeDirs: new Float64Array(dirs), radius };
}

function dedupe(points: ArrayLike<number>[]): Float64Array {
  const out: number[] = [];
  for (const p of points) {
    let dup = false;
    for (let i = 0; i < out.length; i += 3) {
      if (Math.abs(out[i]! - p[0]!) + Math.abs(out[i + 1]! - p[1]!) + Math.abs(out[i + 2]! - p[2]!) < 1e-12) {
        dup = true;
        break;
      }
    }
    if (!dup) out.push(p[0]!, p[1]!, p[2]!);
  }
  return new Float64Array(out);
}

/** Andrew's monotone chain in the face plane: counter-clockwise about the normal, collinear points dropped. */
function orderPolygon(pts: Float64Array, idx: number[], normal: Float64Array): number[] {
  // in-plane axes u, v with u × v = normal
  const nx = normal[0]!, ny = normal[1]!, nz = normal[2]!;
  let ux: number, uy: number, uz: number;
  if (Math.abs(nx) > Math.abs(nz)) {
    ux = -ny;
    uy = nx;
    uz = 0;
  } else {
    ux = 0;
    uy = -nz;
    uz = ny;
  }
  const ul = Math.sqrt(ux * ux + uy * uy + uz * uz);
  ux /= ul;
  uy /= ul;
  uz /= ul;
  const vx = ny * uz - nz * uy, vy = nz * ux - nx * uz, vz = nx * uy - ny * ux;
  const p2 = idx.map((i) => ({
    i,
    u: pts[i * 3]! * ux + pts[i * 3 + 1]! * uy + pts[i * 3 + 2]! * uz,
    v: pts[i * 3]! * vx + pts[i * 3 + 1]! * vy + pts[i * 3 + 2]! * vz,
  }));
  p2.sort((a, b) => a.u - b.u || a.v - b.v || a.i - b.i);
  const cross = (o: (typeof p2)[0], a: (typeof p2)[0], b: (typeof p2)[0]) =>
    (a.u - o.u) * (b.v - o.v) - (a.v - o.v) * (b.u - o.u);
  const lower: typeof p2 = [];
  for (const p of p2) {
    while (lower.length >= 2 && cross(lower[lower.length - 2]!, lower[lower.length - 1]!, p) <= 1e-15) lower.pop();
    lower.push(p);
  }
  const upper: typeof p2 = [];
  for (let k = p2.length - 1; k >= 0; k--) {
    const p = p2[k]!;
    while (upper.length >= 2 && cross(upper[upper.length - 2]!, upper[upper.length - 1]!, p) <= 1e-15) upper.pop();
    upper.push(p);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper).map((p) => p.i);
}

function edgeDirIndex(dirs: number[], pts: Float64Array, i0: number, i1: number): number {
  let x = pts[i1 * 3]! - pts[i0 * 3]!, y = pts[i1 * 3 + 1]! - pts[i0 * 3 + 1]!, z = pts[i1 * 3 + 2]! - pts[i0 * 3 + 2]!;
  const l = Math.sqrt(x * x + y * y + z * z);
  x /= l;
  y /= l;
  z /= l;
  for (let k = 0; k < dirs.length; k += 3) {
    if (Math.abs(x * dirs[k]! + y * dirs[k + 1]! + z * dirs[k + 2]!) > 1 - 1e-9) return k / 3;
  }
  dirs.push(x, y, z);
  return dirs.length / 3 - 1;
}
