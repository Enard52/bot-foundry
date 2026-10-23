import type { ConvexHull, V3 } from '@botfoundry/model';

// 3D quickhull (Barber, Dobkin & Huhdanpaa 1996): every face keeps the points outside it; the
// farthest point of a face joins the hull, the faces it sees are replaced by a cap over their
// horizon, and their orphaned points are re-assigned. Taking the farthest point first is what keeps
// points that lie on a face (a hole rim on a flat side) from becoming spurious hull vertices.

const EPS = 1e-6; // 1 µm: points closer than this to the hull count as inside

interface Face {
  a: number;
  b: number;
  c: number;
  nx: number;
  ny: number;
  nz: number;
  d: number;
  alive: boolean;
  /** indices of points strictly outside this face */
  out: number[];
}

export interface HullResult {
  /** hull vertices only */
  vertices: V3[];
  /** triangles into `vertices`, counter-clockwise from outside; empty for degenerate (flat) input */
  faces: [number, number, number][];
}

function makeFace(pts: readonly V3[], a: number, b: number, c: number): Face {
  const pa = pts[a] as V3, pb = pts[b] as V3, pc = pts[c] as V3;
  const ux = pb[0] - pa[0], uy = pb[1] - pa[1], uz = pb[2] - pa[2];
  const vx = pc[0] - pa[0], vy = pc[1] - pa[1], vz = pc[2] - pa[2];
  let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
  const l = Math.hypot(nx, ny, nz) || 1;
  nx /= l; ny /= l; nz /= l;
  return { a, b, c, nx, ny, nz, d: nx * pa[0] + ny * pa[1] + nz * pa[2], alive: true, out: [] };
}

const dist = (f: Face, p: V3): number => f.nx * p[0] + f.ny * p[1] + f.nz * p[2] - f.d;

/** Monotone-chain 2D hull of coplanar points projected on their dominant plane. */
function planarHull(points: readonly V3[]): V3[] {
  // drop the axis with the smallest extent
  const ext = [0, 1, 2].map((k) => {
    let lo = Infinity, hi = -Infinity;
    for (const p of points) { lo = Math.min(lo, p[k] as number); hi = Math.max(hi, p[k] as number); }
    return hi - lo;
  });
  const drop = ext.indexOf(Math.min(...ext));
  const [u, v] = [0, 1, 2].filter((k) => k !== drop) as [number, number];
  const sorted = [...points].sort((p, q) => (p[u] as number) - (q[u] as number) || (p[v] as number) - (q[v] as number));
  const cross = (o: V3, a: V3, b: V3) =>
    ((a[u] as number) - (o[u] as number)) * ((b[v] as number) - (o[v] as number)) -
    ((a[v] as number) - (o[v] as number)) * ((b[u] as number) - (o[u] as number));
  const build = (seq: readonly V3[]): V3[] => {
    const h: V3[] = [];
    for (const p of seq) {
      while (h.length >= 2 && cross(h[h.length - 2] as V3, h[h.length - 1] as V3, p) <= 1e-18) h.pop();
      h.push(p);
    }
    h.pop();
    return h;
  };
  const lower = build(sorted);
  const upper = build([...sorted].reverse());
  return [...lower, ...upper];
}

export function quickhull(input: readonly V3[]): HullResult {
  // de-duplicate points that coincide within EPS using a coarse grid key
  const seen = new Set<string>();
  const pts: V3[] = [];
  for (const p of input) {
    const key = `${Math.round(p[0] / EPS)},${Math.round(p[1] / EPS)},${Math.round(p[2] / EPS)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    pts.push(p);
  }
  if (pts.length <= 2) return { vertices: pts, faces: [] };

  // initial tetrahedron: extreme points on x, then farthest from that line, then from that plane, then from the plane
  let i0 = 0, i1 = 0;
  for (let i = 0; i < pts.length; i++) {
    if ((pts[i] as V3)[0] < (pts[i0] as V3)[0]) i0 = i;
    if ((pts[i] as V3)[0] > (pts[i1] as V3)[0]) i1 = i;
  }
  if (i0 === i1) i1 = i0 === 0 ? 1 : 0;
  const p0 = pts[i0] as V3, p1 = pts[i1] as V3;
  const ex = p1[0] - p0[0], ey = p1[1] - p0[1], ez = p1[2] - p0[2];
  const el = Math.hypot(ex, ey, ez);
  let i2 = -1, best = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i] as V3;
    const rx = p[0] - p0[0], ry = p[1] - p0[1], rz = p[2] - p0[2];
    const cx = ey * rz - ez * ry, cy = ez * rx - ex * rz, cz = ex * ry - ey * rx;
    const d = Math.hypot(cx, cy, cz) / (el || 1);
    if (d > best) { best = d; i2 = i; }
  }
  if (i2 < 0 || best < EPS) return { vertices: [p0, p1], faces: [] }; // collinear
  const seed = makeFace(pts, i0, i1, i2);
  let i3 = -1;
  best = 0;
  for (let i = 0; i < pts.length; i++) {
    const d = Math.abs(dist(seed, pts[i] as V3));
    if (d > best) { best = d; i3 = i; }
  }
  if (i3 < 0 || best < EPS) return { vertices: planarHull(pts), faces: [] }; // coplanar

  let faces: Face[];
  if (dist(seed, pts[i3] as V3) > 0) {
    // seed normal points toward i3; flip winding so every face points outward
    faces = [makeFace(pts, i0, i2, i1), makeFace(pts, i0, i1, i3), makeFace(pts, i1, i2, i3), makeFace(pts, i2, i0, i3)];
  } else {
    faces = [seed, makeFace(pts, i0, i3, i1), makeFace(pts, i1, i3, i2), makeFace(pts, i2, i3, i0)];
  }

  const assign = (candidates: Iterable<number>, targets: readonly Face[]): void => {
    for (const i of candidates) {
      const p = pts[i] as V3;
      for (const f of targets) {
        if (dist(f, p) > EPS) {
          f.out.push(i);
          break;
        }
      }
    }
  };
  const seeds: number[] = [];
  for (let i = 0; i < pts.length; i++) if (i !== i0 && i !== i1 && i !== i2 && i !== i3) seeds.push(i);
  assign(seeds, faces);

  const pending = faces.filter((f) => f.out.length > 0);
  while (pending.length > 0) {
    const face = pending.pop() as Face;
    if (!face.alive || face.out.length === 0) continue;
    let eye = face.out[0] as number;
    let far = dist(face, pts[eye] as V3);
    for (const i of face.out) {
      const d = dist(face, pts[i] as V3);
      if (d > far) { far = d; eye = i; }
    }
    const p = pts[eye] as V3;
    const visible: Face[] = [];
    for (const f of faces) if (f.alive && dist(f, p) > EPS) visible.push(f);

    // horizon: directed edges of visible faces whose reverse edge is not in a visible face
    const edges = new Map<string, [number, number]>();
    for (const f of visible) {
      for (const [u, v] of [[f.a, f.b], [f.b, f.c], [f.c, f.a]] as [number, number][]) edges.set(`${u}_${v}`, [u, v]);
    }
    const created: Face[] = [];
    for (const [u, v] of edges.values()) {
      if (!edges.has(`${v}_${u}`)) created.push(makeFace(pts, u, v, eye));
    }
    const orphans: number[] = [];
    for (const f of visible) {
      f.alive = false;
      for (const i of f.out) if (i !== eye) orphans.push(i);
      f.out = [];
    }
    assign(orphans, created);
    faces = faces.filter((f) => f.alive).concat(created);
    for (const f of created) if (f.out.length > 0) pending.push(f);
  }

  const used = new Map<number, number>();
  const vertices: V3[] = [];
  const tris: [number, number, number][] = [];
  for (const f of faces) {
    const idx = [f.a, f.b, f.c].map((v) => {
      let k = used.get(v);
      if (k === undefined) {
        k = vertices.length;
        used.set(v, k);
        vertices.push(pts[v] as V3);
      }
      return k;
    }) as [number, number, number];
    tris.push(idx);
  }
  return { vertices, faces: tris };
}

export function convexHull(points: readonly V3[]): ConvexHull {
  return { vertices: quickhull(points).vertices };
}
