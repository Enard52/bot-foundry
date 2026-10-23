// Collision detection and the manifold set, a port of src/collide.ts (collideAll and the
// narrowphase) and of Manifold.update in src/contact.ts. Narrowphase: the separating-axis test
// between convex hulls with face clipping (D. Gregorius, "The Separating Axis Test between Convex
// Polyhedra", GDC 2013) and hull vs the ground plane y = 0. Every comparison, tie-break and
// arithmetic expression follows the TypeScript, so contacts, feature keys and the solve order match.

use std::collections::BTreeMap;

use crate::math::*;
use crate::store::*;

pub const MAX_CONTACTS: usize = 4;
const MAX_HULLS: u64 = 64;
const MAX_BODIES: u64 = 65536;
/// the ground's index in manifold and pair keys (slot 0 in the store)
const GROUND_INDEX: u64 = MAX_BODIES - 1;

pub struct ContactOut {
    pub count: usize,
    /// unit normal pointing from B to A
    pub normal: V3,
    pub pa: [V3; MAX_CONTACTS],
    pub pb: [V3; MAX_CONTACTS],
    pub feature: [f64; MAX_CONTACTS],
}

#[derive(Clone, Copy)]
struct Cand {
    p: V3,
    depth: f64,
    id: u32,
}

#[derive(Clone, Copy)]
struct PolyPoint {
    p: V3,
    id: u32,
}

/// Collision state that lives across substeps but is never read by TypeScript.
pub struct Collision {
    pub stamp: u32,
    pub ground: bool,
    /// manifold key → slot; iterated in key order, which is the solve order
    manifolds: BTreeMap<u64, u32>,
    free: Vec<u32>,
    next_slot: u32,
    /// per body slot: (other slot, live connection count); connected bodies do not collide
    linked: Vec<Vec<(u32, u32)>>,
    linked_joints: usize,
    order: Vec<(f64, u32)>,
    poly: Vec<PolyPoint>,
    poly_next: Vec<PolyPoint>,
    cand: Vec<Cand>,
    dirs_b: Vec<V3>,
    stale: Vec<u64>,
}

struct FaceQuery {
    sep: f64,
    face: usize,
}

struct EdgeQuery {
    sep: f64,
    dir_a: usize,
    dir_b: usize,
    n: V3,
}

#[inline(always)]
fn index_of(slot: usize) -> u64 {
    if slot == 0 {
        GROUND_INDEX
    } else {
        slot as u64 - 1
    }
}

impl Collision {
    pub fn new() -> Collision {
        Collision {
            stamp: 0,
            ground: false,
            manifolds: BTreeMap::new(),
            free: Vec::new(),
            next_slot: 0,
            linked: Vec::new(),
            linked_joints: 0,
            order: Vec::new(),
            poly: Vec::with_capacity(64),
            poly_next: Vec::with_capacity(64),
            cand: Vec::with_capacity(64),
            dirs_b: Vec::with_capacity(16),
            stale: Vec::new(),
        }
    }

    /// Count connections added since the last call as links (they are never broken when added).
    pub fn link_new_joints(&mut self, s: &Store, joints: usize) {
        for j in self.linked_joints..joints {
            let (a, b) = (at!(s.j_a, j), at!(s.j_b, j));
            self.relink(a.min(b), a.max(b), 1);
        }
        self.linked_joints = self.linked_joints.max(joints);
    }

    pub fn unlink(&mut self, s: &Store, j: usize) {
        let (a, b) = (at!(s.j_a, j), at!(s.j_b, j));
        self.relink(a.min(b), a.max(b), -1);
    }

    fn relink(&mut self, lo: u32, hi: u32, delta: i32) {
        if self.linked.len() <= lo as usize {
            self.linked.resize_with(lo as usize + 1, Vec::new);
        }
        let list = &mut self.linked[lo as usize];
        match list.iter_mut().find(|e| e.0 == hi) {
            Some(e) => e.1 = (e.1 as i32 + delta) as u32,
            None => list.push((hi, delta.max(0) as u32)),
        }
    }

    fn linked(&self, a: usize, b: usize) -> bool {
        let (lo, hi) = (a.min(b), a.max(b) as u32);
        self.linked.get(lo).is_some_and(|list| list.iter().any(|&(o, n)| o == hi && n > 0))
    }
}

/// Run collision for slots 1..=bodies and refresh the manifold set; writes the active manifold
/// slots in key order to s.active and returns their count. `grow` must make room for at least the
/// given number of manifold slots (it may move every field of the store).
pub fn collide(c: &mut Collision, s: &mut Store, p: &Params, bodies: usize, grow: &mut dyn FnMut(&mut Store, usize)) -> usize {
    c.stamp += 1;
    let stamp = c.stamp;
    let margin = p.margin;
    let mut out = ContactOut { count: 0, normal: [0.0; 3], pa: [[0.0; 3]; 4], pb: [[0.0; 3]; 4], feature: [0.0; 4] };

    // broadphase: sweep and prune along the axis where the bodies spread most; sorted by the
    // interval start, ties by index, as collideAll's comparator orders them
    let mut order = std::mem::take(&mut c.order);
    order.clear();
    for i in 1..=bodies {
        if at!(s.b_hull_n, i) > 0 {
            order.push((0.0, i as u32));
        }
    }
    let axis = spread_axis(s, &order);
    let reach = |s: &Store, i: usize| at!(s.b_radius, i) + margin;
    for e in order.iter_mut() {
        let i = e.1 as usize;
        // `+ 0.0` turns -0.0 into 0.0, so total_cmp ties exactly where the TypeScript comparator
        // (`a − b || index`) does; total_cmp is a total order even for NaN, which partial_cmp is
        // not (sort_unstable_by may trap on an inconsistent order)
        e.0 = at!(s.b_pos, 3 * i + axis) - reach(s, i) + 0.0;
    }
    order.sort_unstable_by(|u, v| u.0.total_cmp(&v.0).then(u.1.cmp(&v.1)));

    for oi in 0..order.len() {
        let a0 = order[oi].1 as usize;
        let max_x = at!(s.b_pos, 3 * a0 + axis) + reach(s, a0);
        for &(start, b0) in &order[oi + 1..] {
            let b0 = b0 as usize;
            if start > max_x {
                break;
            }
            if at!(s.b_mass, a0) == 0.0 && at!(s.b_mass, b0) == 0.0 {
                continue;
            }
            let r = at!(s.b_radius, a0) + at!(s.b_radius, b0) + margin;
            let (pa, pb) = (v3(&s.b_pos, a0), v3(&s.b_pos, b0));
            let (dx, dy, dz) = (pa[0] - pb[0], pa[1] - pb[1], pa[2] - pb[2]);
            if dx * dx + dy * dy + dz * dz > r * r {
                continue;
            }
            if c.linked(a0, b0) {
                continue;
            }
            let (a, b) = if a0 < b0 { (a0, b0) } else { (b0, a0) };
            refresh_world_hulls(s, a, stamp);
            refresh_world_hulls(s, b, stamp);
            refresh_world_normals(s, a, stamp);
            refresh_world_normals(s, b, stamp);
            for ha in 0..at!(s.b_hull_n, a) as usize {
                for hb in 0..at!(s.b_hull_n, b) as usize {
                    if collide_hulls(c, s, a, ha, b, hb, margin, &mut out) == 0 {
                        continue;
                    }
                    emit(c, s, p, a, ha, b, hb, &out, grow);
                }
            }
        }
    }
    c.order = order;

    if c.ground {
        for a in 1..=bodies {
            if at!(s.b_mass, a) == 0.0 || at!(s.b_hull_n, a) == 0 || at!(s.b_pos, 3 * a + 1) - at!(s.b_radius, a) > margin {
                continue;
            }
            refresh_world_hulls(s, a, stamp);
            for ha in 0..at!(s.b_hull_n, a) as usize {
                if collide_ground(c, s, a, ha, margin, &mut out) == 0 {
                    continue;
                }
                emit(c, s, p, a, ha, 0, 0, &out, grow);
            }
        }
    }

    // keep what collision reported this substep, in key order
    let mut n = 0;
    c.stale.clear();
    for (&key, &slot) in &c.manifolds {
        if at!(s.m_seen, slot as usize) == stamp {
            at_mut!(s.active, n) = slot;
            n += 1;
        } else {
            c.stale.push(key);
        }
    }
    for k in 0..c.stale.len() {
        let key = c.stale[k];
        if let Some(slot) = c.manifolds.remove(&key) {
            c.free.push(slot);
        }
    }
    n
}

fn spread_axis(s: &Store, order: &[(f64, u32)]) -> usize {
    let n = order.len();
    if n < 2 {
        return 0;
    }
    let mut best = 0;
    let mut best_var = -1.0;
    for k in 0..3 {
        let mut sum = 0.0;
        let mut sum2 = 0.0;
        for &(_, i) in order {
            let x = at!(s.b_pos, 3 * i as usize + k);
            sum += x;
            sum2 += x * x;
        }
        let m = sum / n as f64;
        let v = sum2 / n as f64 - m * m;
        if v > best_var {
            best_var = v;
            best = k;
        }
    }
    best
}

/// World-space hull vertices of body i, once per substep (refreshWorldHulls in collide.ts).
fn refresh_world_hulls(s: &mut Store, i: usize, stamp: u32) {
    if at!(s.b_stamp, i) == stamp {
        return;
    }
    at_mut!(s.b_stamp, i) = stamp;
    let p = v3(&s.b_pos, i);
    let q = q4(&s.b_rot, i);
    let h0 = at!(s.b_hull_off, i) as usize;
    for h in h0..h0 + at!(s.b_hull_n, i) as usize {
        let v0 = at!(s.h_vert_off, h) as usize;
        for v in v0..v0 + at!(s.h_count, h) as usize {
            let t = rotate(q, v3(&s.hv_local, v));
            set3(&mut s.hv_world, v, [t[0] + p[0], t[1] + p[1], t[2] + p[2]]);
        }
    }
}

/// World-space face normals of body i, once per substep. Only hull-vs-hull tests read them, so a
/// body that only touches the ground never pays for them; the values are the ones collide.ts
/// computes in refreshWorldHulls.
fn refresh_world_normals(s: &mut Store, i: usize, stamp: u32) {
    if at!(s.b_nstamp, i) == stamp {
        return;
    }
    at_mut!(s.b_nstamp, i) = stamp;
    let q = q4(&s.b_rot, i);
    let h0 = at!(s.b_hull_off, i) as usize;
    for h in h0..h0 + at!(s.b_hull_n, i) as usize {
        let f0 = at!(s.h_face_off, h) as usize;
        for f in f0..f0 + at!(s.h_face_n, h) as usize {
            let t = rotate(q, v3(&s.f_normal, f));
            set3(&mut s.f_world, f, t);
        }
    }
}

/// A hull's pools: first vertex, vertex count, first face, face count.
#[derive(Clone, Copy)]
struct HullRef {
    v0: usize,
    nv: usize,
    f0: usize,
    nf: usize,
}

fn hull_ref(s: &Store, body: usize, h: usize) -> (usize, HullRef) {
    let hi = at!(s.b_hull_off, body) as usize + h;
    let r = HullRef {
        v0: at!(s.h_vert_off, hi) as usize,
        nv: at!(s.h_count, hi) as usize,
        f0: at!(s.h_face_off, hi) as usize,
        nf: at!(s.h_face_n, hi) as usize,
    };
    (hi, r)
}

#[inline(always)]
fn face_first_vert(s: &Store, f: usize) -> usize {
    at!(s.fv, at!(s.f_vert_off, f) as usize) as usize
}

/// Largest separation of B's vertices from A's face planes.
fn query_faces(s: &Store, ha: HullRef, hb: HullRef, margin: f64) -> FaceQuery {
    let mut out = FaceQuery { sep: f64::NEG_INFINITY, face: 0 };
    for f in 0..ha.nf {
        let n = v3(&s.f_world, ha.f0 + f);
        let v0 = v3(&s.hv_world, ha.v0 + face_first_vert(s, ha.f0 + f));
        let d = n[0] * v0[0] + n[1] * v0[1] + n[2] * v0[2];
        let mut min = f64::INFINITY;
        for i in 0..hb.nv {
            let v = v3(&s.hv_world, hb.v0 + i);
            let sv = n[0] * v[0] + n[1] * v[1] + n[2] * v[2];
            if sv < min {
                min = sv;
            }
        }
        let sep = min - d;
        if sep > out.sep {
            out.sep = sep;
            out.face = f;
            if sep > margin {
                return out;
            }
        }
    }
    out
}

/// Largest separation along the cross products of edge directions, axis oriented from A to B.
fn query_edges(c: &mut Collision, s: &Store, a: usize, ia: usize, ha: HullRef, b: usize, ib: usize, hb: HullRef, margin: f64) -> EdgeQuery {
    let mut out = EdgeQuery { sep: f64::NEG_INFINITY, dir_a: 0, dir_b: 0, n: [0.0; 3] };
    let qa = q4(&s.b_rot, a);
    let qb = q4(&s.b_rot, b);
    let (da0, dan) = (at!(s.h_dir_off, ia) as usize, at!(s.h_dir_n, ia) as usize);
    let (db0, dbn) = (at!(s.h_dir_off, ib) as usize, at!(s.h_dir_n, ib) as usize);
    c.dirs_b.clear();
    for j in 0..dbn {
        c.dirs_b.push(rotate(qb, v3(&s.d, db0 + j)));
    }
    for i in 0..dan {
        let ea = rotate(qa, v3(&s.d, da0 + i));
        for j in 0..dbn {
            let eb = c.dirs_b[j];
            let mut nx = ea[1] * eb[2] - ea[2] * eb[1];
            let mut ny = ea[2] * eb[0] - ea[0] * eb[2];
            let mut nz = ea[0] * eb[1] - ea[1] * eb[0];
            let len = (nx * nx + ny * ny + nz * nz).sqrt();
            if len < 1e-6 {
                continue; // parallel edges: covered by the face axes
            }
            nx /= len;
            ny /= len;
            nz /= len;
            let (mut min_a, mut max_a, mut min_b, mut max_b) = (f64::INFINITY, f64::NEG_INFINITY, f64::INFINITY, f64::NEG_INFINITY);
            for k in 0..ha.nv {
                let v = v3(&s.hv_world, ha.v0 + k);
                let sv = nx * v[0] + ny * v[1] + nz * v[2];
                if sv < min_a {
                    min_a = sv;
                }
                if sv > max_a {
                    max_a = sv;
                }
            }
            for k in 0..hb.nv {
                let v = v3(&s.hv_world, hb.v0 + k);
                let sv = nx * v[0] + ny * v[1] + nz * v[2];
                if sv < min_b {
                    min_b = sv;
                }
                if sv > max_b {
                    max_b = sv;
                }
            }
            let s1 = min_b - max_a;
            let s2 = min_a - max_b;
            let sep = if s1 >= s2 { s1 } else { s2 };
            if sep > out.sep {
                let sign = if s1 >= s2 { 1.0 } else { -1.0 };
                out.sep = sep;
                out.dir_a = i;
                out.dir_b = j;
                out.n = [nx * sign, ny * sign, nz * sign];
                if sep > margin {
                    return out;
                }
            }
        }
    }
    out
}

/// Hull ha of body a against hull hb of body b; returns the contact count written to out.
/// Face contacts win ties against edge contacts so resting stacks keep stable face manifolds.
fn collide_hulls(c: &mut Collision, s: &Store, a: usize, ha: usize, b: usize, hb: usize, margin: f64, out: &mut ContactOut) -> usize {
    out.count = 0;
    let (ia, ra) = hull_ref(s, a, ha);
    let (ib, rb) = hull_ref(s, b, hb);
    let face_a = query_faces(s, ra, rb, margin);
    if face_a.sep > margin {
        return 0;
    }
    let face_b = query_faces(s, rb, ra, margin);
    if face_b.sep > margin {
        return 0;
    }
    let edge = query_edges(c, s, a, ia, ra, b, ib, rb, margin);
    if edge.sep > margin {
        return 0;
    }
    let tol = 0.25 * margin;
    let face_sep = js_max(face_a.sep, face_b.sep);
    if edge.sep > face_sep + tol {
        return edge_contact(s, ia, ra, ib, rb, &edge, out);
    }
    if face_b.sep > face_a.sep + tol {
        return face_contact(c, s, false, rb, face_b.face, ra, margin, out);
    }
    face_contact(c, s, true, ra, face_a.face, rb, margin, out)
}

fn face_contact(c: &mut Collision, s: &Store, ref_is_a: bool, hr: HullRef, ref_face: usize, hi: HullRef, margin: f64, out: &mut ContactOut) -> usize {
    let n = v3(&s.f_world, hr.f0 + ref_face);
    let (nx, ny, nz) = (n[0], n[1], n[2]);
    let rf = hr.f0 + ref_face;
    let rv0 = at!(s.f_vert_off, rf) as usize;
    let rvn = at!(s.f_vert_n, rf) as usize;
    let r0 = v3(&s.hv_world, hr.v0 + at!(s.fv, rv0) as usize);
    let d = nx * r0[0] + ny * r0[1] + nz * r0[2];

    // incident face: the one most anti-parallel to the reference normal
    let mut inc_face = 0;
    let mut best = f64::INFINITY;
    for f in 0..hi.nf {
        let ni = v3(&s.f_world, hi.f0 + f);
        let sv = ni[0] * nx + ni[1] * ny + ni[2] * nz;
        if sv < best {
            best = sv;
            inc_face = f;
        }
    }
    c.poly.clear();
    let inf = hi.f0 + inc_face;
    let iv0 = at!(s.f_vert_off, inf) as usize;
    for k in 0..at!(s.f_vert_n, inf) as usize {
        let v = at!(s.fv, iv0 + k);
        c.poly.push(PolyPoint { p: v3(&s.hv_world, hi.v0 + v as usize), id: v });
    }

    // clip against the side planes of the reference face (Sutherland-Hodgman)
    let mut e = 0;
    while e < rvn && !c.poly.is_empty() {
        let va = v3(&s.hv_world, hr.v0 + at!(s.fv, rv0 + e) as usize);
        let vb = v3(&s.hv_world, hr.v0 + at!(s.fv, rv0 + (e + 1) % rvn) as usize);
        let (ex, ey, ez) = (vb[0] - va[0], vb[1] - va[1], vb[2] - va[2]);
        // outward side normal: edge × n for a counter-clockwise face
        let (sx, sy, sz) = (ey * nz - ez * ny, ez * nx - ex * nz, ex * ny - ey * nx);
        let so = sx * va[0] + sy * va[1] + sz * va[2];
        c.poly_next.clear();
        let len = c.poly.len();
        for k in 0..len {
            let pp = c.poly[k];
            let qq = c.poly[(k + 1) % len];
            let (p, q) = (pp.p, qq.p);
            let dp = sx * p[0] + sy * p[1] + sz * p[2] - so;
            let dq = sx * q[0] + sy * q[1] + sz * q[2] - so;
            if dp <= 0.0 {
                c.poly_next.push(pp);
            }
            if (dp < 0.0 && dq > 0.0) || (dp > 0.0 && dq < 0.0) {
                let t = dp / (dp - dq);
                c.poly_next.push(PolyPoint {
                    p: [p[0] + t * (q[0] - p[0]), p[1] + t * (q[1] - p[1]), p[2] + t * (q[2] - p[2])],
                    id: ((e as u32 + 1) * 1024) + (pp.id % 1024),
                });
            }
        }
        std::mem::swap(&mut c.poly, &mut c.poly_next);
        e += 1;
    }

    c.cand.clear();
    for k in 0..c.poly.len() {
        let pp = c.poly[k];
        let depth = nx * pp.p[0] + ny * pp.p[1] + nz * pp.p[2] - d;
        if depth <= margin {
            c.cand.push(Cand { p: pp.p, depth, id: pp.id });
        }
    }
    if c.cand.is_empty() {
        return 0;
    }
    let base = (((if ref_is_a { 1 } else { 2 }) * 4096 + ref_face as u64) * 4096 + inc_face as u64) as f64;
    // normal from B to A: the reference normal points out of the reference body
    let sg = if ref_is_a { -1.0 } else { 1.0 };
    out.normal = [sg * nx, sg * ny, sg * nz];
    emit_reduced(&c.cand, out, nx, ny, nz, ref_is_a, base)
}

#[inline(always)]
fn tri_area(a: V3, b: V3, c: V3, nx: f64, ny: f64, nz: f64) -> f64 {
    let (ux, uy, uz) = (b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    let (vx, vy, vz) = (c[0] - a[0], c[1] - a[1], c[2] - a[2]);
    (uy * vz - uz * vy) * nx + (uz * vx - ux * vz) * ny + (ux * vy - uy * vx) * nz
}

/// Pick at most four candidates (deepest, farthest, largest triangle, most outside it) and emit them.
fn emit_reduced(cand: &[Cand], out: &mut ContactOut, nx: f64, ny: f64, nz: f64, incident_is_b: bool, base: f64) -> usize {
    let mut pick = [0usize; MAX_CONTACTS];
    let mut count = 0;
    if cand.len() <= MAX_CONTACTS {
        for i in 0..cand.len() {
            pick[count] = i;
            count += 1;
        }
    } else {
        let mut i0 = 0;
        for i in 1..cand.len() {
            if cand[i].depth < cand[i0].depth {
                i0 = i;
            }
        }
        let c0 = cand[i0].p;
        // each search below sets its index at the first candidate unless every value is NaN; the
        // fallback keeps the index in range then (the picks are garbage, but nothing traps)
        let mut i1 = i0;
        let mut best_d = -1.0;
        for (i, ci) in cand.iter().enumerate() {
            let c = ci.p;
            let (dx, dy, dz) = (c[0] - c0[0], c[1] - c0[1], c[2] - c0[2]);
            let dd = dx * dx + dy * dy + dz * dz;
            if dd > best_d {
                best_d = dd;
                i1 = i;
            }
        }
        let c1 = cand[i1].p;
        let mut i2 = i0;
        let mut best_a = f64::NEG_INFINITY;
        for (i, ci) in cand.iter().enumerate() {
            let a = tri_area(c0, c1, ci.p, nx, ny, nz).abs();
            if a > best_a {
                best_a = a;
                i2 = i;
            }
        }
        let c2 = cand[i2].p;
        let orient = if tri_area(c0, c1, c2, nx, ny, nz) >= 0.0 { 1.0 } else { -1.0 };
        let mut i3 = usize::MAX;
        let mut best_out = f64::INFINITY;
        for (i, ci) in cand.iter().enumerate() {
            if i == i0 || i == i1 || i == i2 {
                continue;
            }
            let c = ci.p;
            let m = js_min(
                js_min(orient * tri_area(c0, c1, c, nx, ny, nz), orient * tri_area(c1, c2, c, nx, ny, nz)),
                orient * tri_area(c2, c0, c, nx, ny, nz),
            );
            if m < best_out {
                best_out = m;
                i3 = i;
            }
        }
        pick[0] = i0;
        pick[1] = i1;
        count = 2;
        if i2 != i0 && i2 != i1 {
            pick[count] = i2;
            count += 1;
        }
        if i3 != usize::MAX {
            pick[count] = i3;
            count += 1;
        }
    }
    for k in 0..count {
        let c = cand[pick[k]];
        // c lies on the incident surface; its projection onto the reference plane is the other point
        let proj = [c.p[0] - c.depth * nx, c.p[1] - c.depth * ny, c.p[2] - c.depth * nz];
        if incident_is_b {
            out.pb[k] = c.p;
            out.pa[k] = proj;
        } else {
            out.pa[k] = c.p;
            out.pb[k] = proj;
        }
        out.feature[k] = base * 2097152.0 + c.id as f64;
    }
    out.count = count;
    count
}

fn edge_contact(s: &Store, ia: usize, ha: HullRef, ib: usize, hb: HullRef, edge: &EdgeQuery, out: &mut ContactOut) -> usize {
    let [nx, ny, nz] = edge.n;
    // the supporting edges: A's farthest along n, B's farthest against it
    let support = |hull: usize, h: HullRef, dir: usize, max: bool| -> Option<(usize, usize, usize)> {
        let e0 = at!(s.h_edge_off, hull) as usize;
        let mut found = None;
        let mut best = if max { f64::NEG_INFINITY } else { f64::INFINITY };
        for k in 0..at!(s.h_edge_n, hull) as usize {
            if at!(s.e, 3 * (e0 + k) + 2) as usize != dir {
                continue;
            }
            let i0 = at!(s.e, 3 * (e0 + k)) as usize;
            let i1 = at!(s.e, 3 * (e0 + k) + 1) as usize;
            let p0 = v3(&s.hv_world, h.v0 + i0);
            let p1 = v3(&s.hv_world, h.v0 + i1);
            let sv = nx * (p0[0] + p1[0]) + ny * (p0[1] + p1[1]) + nz * (p0[2] + p1[2]);
            if (max && sv > best) || (!max && sv < best) {
                best = sv;
                found = Some((k, i0, i1));
            }
        }
        found
    };
    let (Some((ea, a0, a1)), Some((eb, b0, b1))) = (support(ia, ha, edge.dir_a, true), support(ib, hb, edge.dir_b, false)) else {
        return 0;
    };
    let (pa, pb) = closest_segments(
        v3(&s.hv_world, ha.v0 + a0),
        v3(&s.hv_world, ha.v0 + a1),
        v3(&s.hv_world, hb.v0 + b0),
        v3(&s.hv_world, hb.v0 + b1),
    );
    out.pa[0] = pa;
    out.pb[0] = pb;
    out.normal = [-nx, -ny, -nz];
    // edge features live in their own (negative) key range
    out.feature[0] = -1.0 - (ea as f64 * 65536.0 + eb as f64);
    out.count = 1;
    1
}

#[inline(always)]
fn clamp01(x: f64) -> f64 {
    if x < 0.0 {
        0.0
    } else if x > 1.0 {
        1.0
    } else {
        x
    }
}

/// Closest points between segments p0p1 and q0q1; Ericson, Real-Time Collision Detection 5.1.9.
fn closest_segments(p0: V3, p1: V3, q0: V3, q1: V3) -> (V3, V3) {
    let (px, py, pz) = (p0[0], p0[1], p0[2]);
    let (qx, qy, qz) = (q0[0], q0[1], q0[2]);
    let (d1x, d1y, d1z) = (p1[0] - px, p1[1] - py, p1[2] - pz);
    let (d2x, d2y, d2z) = (q1[0] - qx, q1[1] - qy, q1[2] - qz);
    let (rx, ry, rz) = (px - qx, py - qy, pz - qz);
    let a = d1x * d1x + d1y * d1y + d1z * d1z;
    let e = d2x * d2x + d2y * d2y + d2z * d2z;
    let f = d2x * rx + d2y * ry + d2z * rz;
    let c = d1x * rx + d1y * ry + d1z * rz;
    let b = d1x * d2x + d1y * d2y + d1z * d2z;
    let denom = a * e - b * b;
    let mut s = if denom > 1e-18 { clamp01((b * f - c * e) / denom) } else { 0.0 };
    let mut t = (b * s + f) / e;
    if t < 0.0 {
        t = 0.0;
        s = clamp01(-c / a);
    } else if t > 1.0 {
        t = 1.0;
        s = clamp01((b - c) / a);
    }
    ([px + d1x * s, py + d1y * s, pz + d1z * s], [qx + d2x * t, qy + d2y * t, qz + d2z * t])
}

/// Hull ha of body a against the ground plane y = 0.
fn collide_ground(c: &mut Collision, s: &Store, a: usize, ha: usize, margin: f64, out: &mut ContactOut) -> usize {
    out.count = 0;
    let (_, h) = hull_ref(s, a, ha);
    c.cand.clear();
    for i in 0..h.nv {
        let v = v3(&s.hv_world, h.v0 + i);
        if v[1] <= margin {
            c.cand.push(Cand { p: v, depth: v[1], id: i as u32 });
        }
    }
    if c.cand.is_empty() {
        return 0;
    }
    out.normal = [0.0, 1.0, 0.0];
    // the ground is the reference surface (normal +y); the hull's vertices are incident on A
    emit_reduced(&c.cand, out, 0.0, 1.0, 0.0, false, 0.0)
}

/// Find or create the manifold of (a, ha, b, hb) and merge this substep's contacts into it.
#[allow(clippy::too_many_arguments)]
fn emit(c: &mut Collision, s: &mut Store, p: &Params, a: usize, ha: usize, b: usize, hb: usize, out: &ContactOut, grow: &mut dyn FnMut(&mut Store, usize)) {
    let key = ((index_of(a) * MAX_HULLS + ha as u64) * MAX_BODIES + index_of(b)) * MAX_HULLS + hb as u64;
    let slot = match c.manifolds.get(&key) {
        Some(&slot) => slot as usize,
        None => {
            let slot = match c.free.pop() {
                Some(slot) => slot as usize,
                None => {
                    let slot = c.next_slot as usize;
                    c.next_slot += 1;
                    if slot >= s.m_count.len() {
                        grow(s, slot + 1);
                    }
                    slot
                }
            };
            c.manifolds.insert(key, slot as u32);
            at_mut!(s.m_a, slot) = a as u32;
            at_mut!(s.m_b, slot) = b as u32;
            at_mut!(s.m_count, slot) = 0;
            // as in the Manifold constructor (contact.ts)
            let (fa, fb) = (at!(s.b_friction, a), at!(s.b_friction, b));
            at_mut!(s.m_friction, slot) = if b == 0 { fa } else { (fa * fb).sqrt() };
            let ma = if at!(s.b_mass, a) == 0.0 { f64::INFINITY } else { at!(s.b_mass, a) };
            let mb = if at!(s.b_mass, b) == 0.0 { f64::INFINITY } else { at!(s.b_mass, b) };
            let m = js_min(ma, mb);
            at_mut!(s.m_k0, slot) = if m.is_finite() { m / (p.dt * p.dt) } else { 0.0 };
            slot
        }
    };
    at_mut!(s.m_seen, slot) = c.stamp;
    merge(s, slot, out, a, b);
}

/// Manifold.update (contact.ts): take this substep's points, carrying penalty, multiplier and the
/// stick flag over by feature key, and the anchors of points that stuck.
fn merge(s: &mut Store, m: usize, out: &ContactOut, a: usize, b: usize) {
    let mut pen = [0.0; 12];
    let mut lam = [0.0; 12];
    let mut ra = [[0.0; 3]; 4];
    let mut rb = [[0.0; 3]; 4];
    let mut stick = [0u32; 4];
    let old = at!(s.m_count, m) as usize;
    let (qa, qb) = (q4(&s.b_rot, a), q4(&s.b_rot, b));
    let (pa, pb) = (v3(&s.b_pos, a), v3(&s.b_pos, b));
    for i in 0..out.count {
        let mut found = None;
        for j in 0..old {
            if at!(s.m_feature, 4 * m + j) == out.feature[i] {
                found = Some(j);
                break;
            }
        }
        if let Some(j) = found {
            for r in 0..3 {
                pen[i * 3 + r] = at!(s.m_pen, 12 * m + j * 3 + r);
                lam[i * 3 + r] = at!(s.m_lambda, 12 * m + j * 3 + r);
            }
            stick[i] = at!(s.m_stick, 4 * m + j);
        }
        match found {
            Some(j) if at!(s.m_stick, 4 * m + j) != 0 => {
                ra[i] = v3(&s.m_ra, 4 * m + j);
                rb[i] = v3(&s.m_rb, 4 * m + j);
            }
            _ => {
                let (xa, xb) = (out.pa[i], out.pb[i]);
                ra[i] = rotate_inv(qa, [xa[0] - pa[0], xa[1] - pa[1], xa[2] - pa[2]]);
                rb[i] = rotate_inv(qb, [xb[0] - pb[0], xb[1] - pb[1], xb[2] - pb[2]]);
            }
        }
    }
    let n = out.count;
    at_mut!(s.m_count, m) = n as u32;
    for i in 0..n {
        at_mut!(s.m_feature, 4 * m + i) = out.feature[i];
        at_mut!(s.m_stick, 4 * m + i) = stick[i];
        set3(&mut s.m_ra, 4 * m + i, ra[i]);
        set3(&mut s.m_rb, 4 * m + i, rb[i]);
        for r in 0..3 {
            at_mut!(s.m_pen, 12 * m + i * 3 + r) = pen[i * 3 + r];
            at_mut!(s.m_lambda, 12 * m + i * 3 + r) = lam[i * 3 + r];
        }
    }
    let (t1, t2) = tangent_basis(out.normal);
    set3(&mut s.m_basis, 3 * m, out.normal);
    set3(&mut s.m_basis, 3 * m + 1, t1);
    set3(&mut s.m_basis, 3 * m + 2, t2);
}

#[cfg(test)]
mod tests {
    use super::*;

    fn out() -> ContactOut {
        ContactOut { count: 0, normal: [0.0; 3], pa: [[0.0; 3]; 4], pb: [[0.0; 3]; 4], feature: [0.0; 4] }
    }

    // more than four candidates, none of them finite: every search's comparison is false
    #[test]
    fn emit_reduced_survives_all_nan_candidates() {
        let cand: Vec<Cand> = (0..9).map(|i| Cand { p: [f64::NAN; 3], depth: f64::NAN, id: i }).collect();
        let n = emit_reduced(&cand, &mut out(), 0.0, 1.0, 0.0, false, 0.0);
        assert!(n <= MAX_CONTACTS);
    }

    // the broadphase sort key order must be what the TypeScript comparator gives finite values,
    // -0.0 and 0.0 tying; and sorting NaN keys must not panic however many there are
    #[test]
    fn sweep_order_matches_the_reference_comparator_and_survives_nan() {
        let cmp = |u: &(f64, u32), v: &(f64, u32)| u.0.total_cmp(&v.0).then(u.1.cmp(&v.1));
        let keys = [-1.5, -0.0 + 0.0, 0.0, 2.0, 1e-300, -1e300];
        for &a in &keys {
            for &b in &keys {
                let reference = if a - b != 0.0 { (a - b).partial_cmp(&0.0).unwrap() } else { 1u32.cmp(&2) };
                assert_eq!(cmp(&(a, 1), &(b, 2)), reference, "{a} vs {b}");
            }
        }
        let mut order: Vec<(f64, u32)> = (0..200).map(|i| (if i % 7 == 0 { f64::NAN } else { (i * 37 % 11) as f64 }, i)).collect();
        order.sort_unstable_by(cmp);
        assert_eq!(order.len(), 200);
    }
}
