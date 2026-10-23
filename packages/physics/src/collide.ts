import type { Body } from './body.ts';
import type { Hull } from './hull.ts';
import { rotate, vec3 } from './math.ts';
import { pairKey } from './robot.ts';

// Narrowphase: convex hull vs convex hull by the separating-axis test with face clipping
// (D. Gregorius, "The Separating Axis Test between Convex Polyhedra", GDC 2013), and hull vs the
// ground plane y = 0. Each produces a manifold of at most four points, each a pair of world points
// (one on each surface) plus a feature key so the solver can warm-start a point across substeps.

export const MAX_CONTACTS = 4;

export interface ContactOut {
  count: number;
  /** unit normal pointing from B to A */
  normal: Float64Array;
  /** world points on A and on B, flat xyz × MAX_CONTACTS */
  pA: Float64Array;
  pB: Float64Array;
  feature: Float64Array;
}

export function createContactOut(): ContactOut {
  return {
    count: 0,
    normal: new Float64Array(3),
    pA: new Float64Array(3 * MAX_CONTACTS),
    pB: new Float64Array(3 * MAX_CONTACTS),
    feature: new Float64Array(MAX_CONTACTS),
  };
}

/** Refresh a body's world-space hull vertices and face normals once per substep. */
export function refreshWorldHulls(body: Body, stamp: number): void {
  if (body.worldStamp === stamp) return;
  body.worldStamp = stamp;
  const p = body.pos;
  for (let h = 0; h < body.hulls.length; h++) {
    const hull = body.hulls[h]!;
    const wv = body.worldVerts[h]!;
    const wn = body.worldNormals[h]!;
    for (let i = 0; i < hull.count; i++) {
      T[0] = hull.verts[i * 3]!;
      T[1] = hull.verts[i * 3 + 1]!;
      T[2] = hull.verts[i * 3 + 2]!;
      rotate(T, body.rot, T);
      wv[i * 3] = T[0]! + p[0]!;
      wv[i * 3 + 1] = T[1]! + p[1]!;
      wv[i * 3 + 2] = T[2]! + p[2]!;
    }
    for (let f = 0; f < hull.faces.length; f++) {
      rotate(T, body.rot, hull.faces[f]!.normal);
      wn[f * 3] = T[0]!;
      wn[f * 3 + 1] = T[1]!;
      wn[f * 3 + 2] = T[2]!;
    }
  }
}

const T = vec3();
const EA = vec3();
const EB = vec3();
const AXIS = vec3();

interface FaceQuery {
  sep: number;
  face: number;
}
const faceA: FaceQuery = { sep: 0, face: 0 };
const faceB: FaceQuery = { sep: 0, face: 0 };
const edge = { sep: 0, dirA: 0, dirB: 0, nx: 0, ny: 0, nz: 0 };

/** Largest separation of B's vertices from A's face planes. */
function queryFaces(ha: Hull, va: Float64Array, na: Float64Array, hb: Hull, vb: Float64Array, out: FaceQuery, margin: number): void {
  out.sep = -Infinity;
  out.face = 0;
  for (let f = 0; f < ha.faces.length; f++) {
    const nx = na[f * 3]!, ny = na[f * 3 + 1]!, nz = na[f * 3 + 2]!;
    const v0 = ha.faces[f]!.verts[0]!;
    const d = nx * va[v0 * 3]! + ny * va[v0 * 3 + 1]! + nz * va[v0 * 3 + 2]!;
    let min = Infinity;
    for (let i = 0; i < hb.count; i++) {
      const s = nx * vb[i * 3]! + ny * vb[i * 3 + 1]! + nz * vb[i * 3 + 2]!;
      if (s < min) min = s;
    }
    const sep = min - d;
    if (sep > out.sep) {
      out.sep = sep;
      out.face = f;
      if (sep > margin) return;
    }
  }
}

/** Largest separation along the cross products of edge directions, axis oriented from A to B. */
function queryEdges(A: Body, ha: Hull, va: Float64Array, B: Body, hb: Hull, vb: Float64Array, margin: number): void {
  edge.sep = -Infinity;
  for (let i = 0; i < ha.edgeDirs.length / 3; i++) {
    T[0] = ha.edgeDirs[i * 3]!;
    T[1] = ha.edgeDirs[i * 3 + 1]!;
    T[2] = ha.edgeDirs[i * 3 + 2]!;
    rotate(EA, A.rot, T);
    for (let j = 0; j < hb.edgeDirs.length / 3; j++) {
      T[0] = hb.edgeDirs[j * 3]!;
      T[1] = hb.edgeDirs[j * 3 + 1]!;
      T[2] = hb.edgeDirs[j * 3 + 2]!;
      rotate(EB, B.rot, T);
      let nx = EA[1]! * EB[2]! - EA[2]! * EB[1]!;
      let ny = EA[2]! * EB[0]! - EA[0]! * EB[2]!;
      let nz = EA[0]! * EB[1]! - EA[1]! * EB[0]!;
      const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
      if (len < 1e-6) continue; // parallel edges: covered by the face axes
      nx /= len;
      ny /= len;
      nz /= len;
      let minA = Infinity, maxA = -Infinity, minB = Infinity, maxB = -Infinity;
      for (let k = 0; k < ha.count; k++) {
        const s = nx * va[k * 3]! + ny * va[k * 3 + 1]! + nz * va[k * 3 + 2]!;
        if (s < minA) minA = s;
        if (s > maxA) maxA = s;
      }
      for (let k = 0; k < hb.count; k++) {
        const s = nx * vb[k * 3]! + ny * vb[k * 3 + 1]! + nz * vb[k * 3 + 2]!;
        if (s < minB) minB = s;
        if (s > maxB) maxB = s;
      }
      const s1 = minB - maxA, s2 = minA - maxB;
      const sep = s1 >= s2 ? s1 : s2;
      if (sep > edge.sep) {
        const sign = s1 >= s2 ? 1 : -1;
        edge.sep = sep;
        edge.dirA = i;
        edge.dirB = j;
        edge.nx = nx * sign;
        edge.ny = ny * sign;
        edge.nz = nz * sign;
        if (sep > margin) return;
      }
    }
  }
}

// candidate contact points before reduction: point on the incident surface, its depth, feature key
const cand: { x: number; y: number; z: number; depth: number; id: number }[] = [];
let poly: { x: number; y: number; z: number; id: number }[] = [];
let polyNext: { x: number; y: number; z: number; id: number }[] = [];

/**
 * Hull `ia` of body A against hull `ib` of body B. Returns the contact count written to out.
 * Face contacts win ties against edge contacts so resting stacks keep stable face manifolds.
 */
export function collideHulls(A: Body, ia: number, B: Body, ib: number, margin: number, out: ContactOut): number {
  out.count = 0;
  const ha = A.hulls[ia]!, hb = B.hulls[ib]!;
  const va = A.worldVerts[ia]!, vb = B.worldVerts[ib]!;
  const na = A.worldNormals[ia]!, nb = B.worldNormals[ib]!;

  queryFaces(ha, va, na, hb, vb, faceA, margin);
  if (faceA.sep > margin) return 0;
  queryFaces(hb, vb, nb, ha, va, faceB, margin);
  if (faceB.sep > margin) return 0;
  queryEdges(A, ha, va, B, hb, vb, margin);
  if (edge.sep > margin) return 0;

  const tol = 0.25 * margin;
  const faceSep = Math.max(faceA.sep, faceB.sep);
  if (edge.sep > faceSep + tol) return edgeContact(ha, va, hb, vb, out);
  if (faceB.sep > faceA.sep + tol) return faceContact(false, hb, vb, nb, faceB.face, ha, va, A, margin, out);
  return faceContact(true, ha, va, na, faceA.face, hb, vb, B, margin, out);
}

function faceContact(
  refIsA: boolean,
  hr: Hull,
  vr: Float64Array,
  nr: Float64Array,
  refFace: number,
  hi: Hull,
  vi: Float64Array,
  inc: Body,
  margin: number,
  out: ContactOut,
): number {
  const nx = nr[refFace * 3]!, ny = nr[refFace * 3 + 1]!, nz = nr[refFace * 3 + 2]!;
  const face = hr.faces[refFace]!;
  const r0 = face.verts[0]!;
  const d = nx * vr[r0 * 3]! + ny * vr[r0 * 3 + 1]! + nz * vr[r0 * 3 + 2]!;

  // incident face: the one most anti-parallel to the reference normal
  const ni = inc.worldNormals[inc.hulls.indexOf(hi)]!;
  let incFace = 0, best = Infinity;
  for (let f = 0; f < hi.faces.length; f++) {
    const s = ni[f * 3]! * nx + ni[f * 3 + 1]! * ny + ni[f * 3 + 2]! * nz;
    if (s < best) {
      best = s;
      incFace = f;
    }
  }
  poly.length = 0;
  for (const v of hi.faces[incFace]!.verts) poly.push({ x: vi[v * 3]!, y: vi[v * 3 + 1]!, z: vi[v * 3 + 2]!, id: v });

  // clip against the side planes of the reference face (Sutherland-Hodgman)
  const rv = face.verts;
  for (let e = 0; e < rv.length && poly.length > 0; e++) {
    const a = rv[e]!, b = rv[(e + 1) % rv.length]!;
    const ex = vr[b * 3]! - vr[a * 3]!, ey = vr[b * 3 + 1]! - vr[a * 3 + 1]!, ez = vr[b * 3 + 2]! - vr[a * 3 + 2]!;
    // outward side normal: edge × n for a counter-clockwise face
    const sx = ey * nz - ez * ny, sy = ez * nx - ex * nz, sz = ex * ny - ey * nx;
    const so = sx * vr[a * 3]! + sy * vr[a * 3 + 1]! + sz * vr[a * 3 + 2]!;
    polyNext.length = 0;
    for (let k = 0; k < poly.length; k++) {
      const p = poly[k]!, q = poly[(k + 1) % poly.length]!;
      const dp = sx * p.x + sy * p.y + sz * p.z - so;
      const dq = sx * q.x + sy * q.y + sz * q.z - so;
      if (dp <= 0) polyNext.push(p);
      if ((dp < 0 && dq > 0) || (dp > 0 && dq < 0)) {
        const t = dp / (dp - dq);
        polyNext.push({
          x: p.x + t * (q.x - p.x),
          y: p.y + t * (q.y - p.y),
          z: p.z + t * (q.z - p.z),
          id: ((e + 1) * 1024) + (p.id % 1024),
        });
      }
    }
    const swap = poly;
    poly = polyNext;
    polyNext = swap;
  }

  cand.length = 0;
  for (const p of poly) {
    const depth = nx * p.x + ny * p.y + nz * p.z - d;
    if (depth <= margin) cand.push({ x: p.x, y: p.y, z: p.z, depth, id: p.id });
  }
  if (cand.length === 0) return 0;
  const base = ((refIsA ? 1 : 2) * 4096 + refFace) * 4096 + incFace;
  // normal from B to A: the reference normal points out of the reference body
  const s = refIsA ? -1 : 1;
  out.normal[0] = s * nx;
  out.normal[1] = s * ny;
  out.normal[2] = s * nz;
  return emitReduced(out, nx, ny, nz, refIsA, base);
}

/** Pick at most four candidates (deepest, farthest, largest triangle, most outside it) and emit them. */
function emitReduced(out: ContactOut, nx: number, ny: number, nz: number, incidentIsB: boolean, base: number): number {
  const pick = PICK;
  let count = 0;
  if (cand.length <= MAX_CONTACTS) {
    for (let i = 0; i < cand.length; i++) pick[count++] = i;
  } else {
    let i0 = 0;
    for (let i = 1; i < cand.length; i++) if (cand[i]!.depth < cand[i0]!.depth) i0 = i;
    const c0 = cand[i0]!;
    let i1 = -1, bestD = -1;
    for (let i = 0; i < cand.length; i++) {
      const c = cand[i]!;
      const dd = (c.x - c0.x) ** 2 + (c.y - c0.y) ** 2 + (c.z - c0.z) ** 2;
      if (dd > bestD) {
        bestD = dd;
        i1 = i;
      }
    }
    const c1 = cand[i1]!;
    let i2 = -1, bestA = -Infinity;
    for (let i = 0; i < cand.length; i++) {
      const a = Math.abs(triArea(c0, c1, cand[i]!, nx, ny, nz));
      if (a > bestA) {
        bestA = a;
        i2 = i;
      }
    }
    const c2 = cand[i2]!;
    const orient = triArea(c0, c1, c2, nx, ny, nz) >= 0 ? 1 : -1;
    let i3 = -1, bestOut = Infinity;
    for (let i = 0; i < cand.length; i++) {
      if (i === i0 || i === i1 || i === i2) continue;
      const c = cand[i]!;
      const m = Math.min(
        orient * triArea(c0, c1, c, nx, ny, nz),
        orient * triArea(c1, c2, c, nx, ny, nz),
        orient * triArea(c2, c0, c, nx, ny, nz),
      );
      if (m < bestOut) {
        bestOut = m;
        i3 = i;
      }
    }
    pick[count++] = i0;
    pick[count++] = i1;
    if (i2 !== i0 && i2 !== i1) pick[count++] = i2;
    if (i3 >= 0) pick[count++] = i3;
  }
  for (let k = 0; k < count; k++) {
    const c = cand[pick[k]!]!;
    // c lies on the incident surface; its projection onto the reference plane is the other point
    const px = c.x - c.depth * nx, py = c.y - c.depth * ny, pz = c.z - c.depth * nz;
    const inc = incidentIsB ? out.pB : out.pA;
    const ref = incidentIsB ? out.pA : out.pB;
    inc[k * 3] = c.x;
    inc[k * 3 + 1] = c.y;
    inc[k * 3 + 2] = c.z;
    ref[k * 3] = px;
    ref[k * 3 + 1] = py;
    ref[k * 3 + 2] = pz;
    out.feature[k] = base * 2097152 + c.id;
  }
  out.count = count;
  return count;
}
const PICK = new Int32Array(MAX_CONTACTS);

function triArea(
  a: { x: number; y: number; z: number },
  b: { x: number; y: number; z: number },
  c: { x: number; y: number; z: number },
  nx: number,
  ny: number,
  nz: number,
): number {
  const ux = b.x - a.x, uy = b.y - a.y, uz = b.z - a.z;
  const vx = c.x - a.x, vy = c.y - a.y, vz = c.z - a.z;
  return (uy * vz - uz * vy) * nx + (uz * vx - ux * vz) * ny + (ux * vy - uy * vx) * nz;
}

function edgeContact(ha: Hull, va: Float64Array, hb: Hull, vb: Float64Array, out: ContactOut): number {
  const nx = edge.nx, ny = edge.ny, nz = edge.nz;
  // the supporting edges: A's farthest along n, B's farthest against it
  let ea = -1, eb = -1, best = -Infinity;
  for (let k = 0; k < ha.edges.length; k++) {
    const e = ha.edges[k]!;
    if (e.dir !== edge.dirA) continue;
    const s = nx * (va[e.i0 * 3]! + va[e.i1 * 3]!) + ny * (va[e.i0 * 3 + 1]! + va[e.i1 * 3 + 1]!) + nz * (va[e.i0 * 3 + 2]! + va[e.i1 * 3 + 2]!);
    if (s > best) {
      best = s;
      ea = k;
    }
  }
  best = Infinity;
  for (let k = 0; k < hb.edges.length; k++) {
    const e = hb.edges[k]!;
    if (e.dir !== edge.dirB) continue;
    const s = nx * (vb[e.i0 * 3]! + vb[e.i1 * 3]!) + ny * (vb[e.i0 * 3 + 1]! + vb[e.i1 * 3 + 1]!) + nz * (vb[e.i0 * 3 + 2]! + vb[e.i1 * 3 + 2]!);
    if (s < best) {
      best = s;
      eb = k;
    }
  }
  if (ea < 0 || eb < 0) return 0;
  const A0 = ha.edges[ea]!, B0 = hb.edges[eb]!;
  closestSegments(va, A0.i0, A0.i1, vb, B0.i0, B0.i1, out.pA, out.pB);
  out.normal[0] = -nx;
  out.normal[1] = -ny;
  out.normal[2] = -nz;
  // edge features live in their own (negative) key range
  out.feature[0] = -1 - (ea * 65536 + eb);
  out.count = 1;
  return 1;
}

/** Closest points between segments p0p1 (in va) and q0q1 (in vb); Ericson, Real-Time Collision Detection 5.1.9. */
function closestSegments(
  va: Float64Array,
  p0: number,
  p1: number,
  vb: Float64Array,
  q0: number,
  q1: number,
  outA: Float64Array,
  outB: Float64Array,
): void {
  const px = va[p0 * 3]!, py = va[p0 * 3 + 1]!, pz = va[p0 * 3 + 2]!;
  const qx = vb[q0 * 3]!, qy = vb[q0 * 3 + 1]!, qz = vb[q0 * 3 + 2]!;
  const d1x = va[p1 * 3]! - px, d1y = va[p1 * 3 + 1]! - py, d1z = va[p1 * 3 + 2]! - pz;
  const d2x = vb[q1 * 3]! - qx, d2y = vb[q1 * 3 + 1]! - qy, d2z = vb[q1 * 3 + 2]! - qz;
  const rx = px - qx, ry = py - qy, rz = pz - qz;
  const a = d1x * d1x + d1y * d1y + d1z * d1z;
  const e = d2x * d2x + d2y * d2y + d2z * d2z;
  const f = d2x * rx + d2y * ry + d2z * rz;
  const c = d1x * rx + d1y * ry + d1z * rz;
  const b = d1x * d2x + d1y * d2y + d1z * d2z;
  const denom = a * e - b * b;
  let s = denom > 1e-18 ? clamp01((b * f - c * e) / denom) : 0;
  let t = (b * s + f) / e;
  if (t < 0) {
    t = 0;
    s = clamp01(-c / a);
  } else if (t > 1) {
    t = 1;
    s = clamp01((b - c) / a);
  }
  outA[0] = px + d1x * s;
  outA[1] = py + d1y * s;
  outA[2] = pz + d1z * s;
  outB[0] = qx + d2x * t;
  outB[1] = qy + d2y * t;
  outB[2] = qz + d2z * t;
}

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

/** Hull `ia` of body A against the ground plane y = 0 (body B is the ground). */
export function collideGround(A: Body, ia: number, margin: number, out: ContactOut): number {
  out.count = 0;
  const hull = A.hulls[ia]!;
  const v = A.worldVerts[ia]!;
  cand.length = 0;
  for (let i = 0; i < hull.count; i++) {
    const y = v[i * 3 + 1]!;
    if (y <= margin) cand.push({ x: v[i * 3]!, y, z: v[i * 3 + 2]!, depth: y, id: i });
  }
  if (cand.length === 0) return 0;
  out.normal[0] = 0;
  out.normal[1] = 1;
  out.normal[2] = 0;
  // the ground is the reference surface (normal +y); the hull's vertices are incident on A
  return emitReduced(out, 0, 1, 0, false, 0);
}

/**
 * Broadphase and narrowphase for a whole world: sweep-and-prune along the axis where the bodies
 * spread most (bounding spheres), then SAT per hull pair and hull vs ground. `emit` is called for
 * every hull pair in contact, in a fixed order, with the result in `out`. Pairs that share a live
 * connection (counted in `linked` by pairKey) do not collide.
 */
export function collideAll(
  bodyList: readonly Body[],
  ground: Body | null,
  linked: ReadonlyMap<number, number>,
  margin: number,
  stamp: number,
  out: ContactOut,
  emit: (A: Body, ha: number, B: Body, hb: number) => void,
): void {
  const bodies = bodyList.filter((b) => b.hulls.length > 0);
  const axis = spreadAxis(bodies);
  const reach = (b: Body) => b.radius + margin;
  bodies.sort((u, v) => u.pos[axis]! - reach(u) - (v.pos[axis]! - reach(v)) || u.index - v.index);

  for (let i = 0; i < bodies.length; i++) {
    const A0 = bodies[i]!;
    const maxX = A0.pos[axis]! + reach(A0);
    for (let j = i + 1; j < bodies.length; j++) {
      const B0 = bodies[j]!;
      if (B0.pos[axis]! - reach(B0) > maxX) break;
      if (A0.isStatic && B0.isStatic) continue;
      const r = A0.radius + B0.radius + margin;
      const dx = A0.pos[0]! - B0.pos[0]!, dy = A0.pos[1]! - B0.pos[1]!, dz = A0.pos[2]! - B0.pos[2]!;
      if (dx * dx + dy * dy + dz * dz > r * r) continue;
      if ((linked.get(pairKey(A0, B0)) ?? 0) > 0) continue;
      const [A, B] = A0.index < B0.index ? [A0, B0] : [B0, A0];
      refreshWorldHulls(A, stamp);
      refreshWorldHulls(B, stamp);
      for (let ha = 0; ha < A.hulls.length; ha++) {
        for (let hb = 0; hb < B.hulls.length; hb++) {
          if (collideHulls(A, ha, B, hb, margin, out) === 0) continue;
          emit(A, ha, B, hb);
        }
      }
    }
  }

  if (ground) {
    for (const A of bodyList) {
      if (A.isStatic || A.hulls.length === 0 || A.pos[1]! - A.radius > margin) continue;
      refreshWorldHulls(A, stamp);
      for (let ha = 0; ha < A.hulls.length; ha++) {
        if (collideGround(A, ha, margin, out) === 0) continue;
        emit(A, ha, ground, 0);
      }
    }
  }
}

/** The axis (0, 1, 2) along which body centres have the largest variance. */
function spreadAxis(bodies: Body[]): number {
  const n = bodies.length;
  if (n < 2) return 0;
  let best = 0, bestVar = -1;
  for (let k = 0; k < 3; k++) {
    let sum = 0, sum2 = 0;
    for (const b of bodies) {
      const x = b.pos[k]!;
      sum += x;
      sum2 += x * x;
    }
    const v = sum2 / n - (sum / n) ** 2;
    if (v > bestVar) {
      bestVar = v;
      best = k;
    }
  }
  return best;
}
