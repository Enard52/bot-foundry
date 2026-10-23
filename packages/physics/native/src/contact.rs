// Frictional contact manifolds, a port of the solver half of src/contact.ts (after the reference
// Manifold in avbd-demo3d, Giles, MIT): three rows per point, linearised at the start of the
// substep (AVBD Sec. 4), normal force clamped to push only and friction to the Coulomb cone.
// Collision and the carry-over of multipliers by feature key stay in TypeScript, which writes the
// manifold fields of the store directly.

use crate::joint::dq;
use crate::math::*;
use crate::store::*;
use crate::system::{stamp_row, Sys};

/// Freeze manifold m's Jacobians and offsets at x⁻ and warm-start it; false when it is empty.
#[inline(never)]
pub fn prepare(s: &mut Store, p: &Params, m: usize) -> bool {
    let n = at!(s.m_count, m) as usize;
    if n == 0 {
        return false;
    }
    let a = at!(s.m_a, m) as usize;
    let b = at!(s.m_b, m) as usize;
    let decay = p.alpha * p.gamma;
    let k0 = at!(s.m_k0, m);
    let qa = q4(&s.b_rot, a);
    let qb = q4(&s.b_rot, b);
    let pa = v3(&s.b_pos, a);
    let pb = v3(&s.b_pos, b);
    for i in 0..n {
        let raw = rotate(qa, v3(&s.m_ra, 4 * m + i));
        let rbw = rotate(qb, v3(&s.m_rb, 4 * m + i));
        let xa = [pa[0] + raw[0], pa[1] + raw[1], pa[2] + raw[2]];
        let xb = [pb[0] + rbw[0], pb[1] + rbw[1], pb[2] + rbw[2]];
        for r in 0..3 {
            let row = v3(&s.m_basis, 3 * m + r);
            let c0 = row[0] * (xa[0] - xb[0]) + row[1] * (xa[1] - xb[1]) + row[2] * (xa[2] - xb[2]);
            // a speculative gap is kept exactly; only penetration and anchor drift are softened
            let q = 12 * m + i * 3 + r;
            at_mut!(s.m_c0, q) = if r == 0 && c0 > 0.0 { c0 } else { (1.0 - p.alpha) * c0 };
            let o = q * 6;
            let t = cross(raw, row);
            let ja = [row[0], row[1], row[2], t[0], t[1], t[2]];
            let t = cross(rbw, row);
            let jb = [-row[0], -row[1], -row[2], -t[0], -t[1], -t[2]];
            s.m_ja[o..o + 6].copy_from_slice(&ja);
            s.m_jb[o..o + 6].copy_from_slice(&jb);
            for k in 0..6 {
                at_mut!(s.m_jat, 72 * m + 12 * k + i * 3 + r) = ja[k];
                at_mut!(s.m_jbt, 72 * m + 12 * k + i * 3 + r) = jb[k];
            }
            at_mut!(s.m_lambda, q) = at!(s.m_lambda, q) * decay;
            at_mut!(s.m_pen, q) = p.warm(at!(s.m_pen, q), k0, p.contact_penalty_min);
        }
    }
    true
}

/// C and F = K·C + λ of every row of manifold m, before clamping.
#[cfg(not(target_feature = "simd128"))]
#[inline(always)]
fn evaluate_rows(s: &Store, m: usize, n: usize, dqa: &[f64; 6], dqb: &[f64; 6]) -> ([f64; 12], [f64; 12]) {
    let mut c = [0.0; 12];
    let mut f = [0.0; 12];
    for q in 0..3 * n {
        let o = (12 * m + q) * 6;
        let mut cc = at!(s.m_c0, 12 * m + q);
        for k in 0..6 {
            cc += at!(s.m_ja, o + k) * dqa[k] + at!(s.m_jb, o + k) * dqb[k];
        }
        c[q] = cc;
        f[q] = at!(s.m_pen, 12 * m + q) * cc + at!(s.m_lambda, 12 * m + q);
    }
    (c, f)
}

/// evaluate_rows with two rows per f64x2 lane pair, each lane doing exactly the scalar
/// operations of its row (so bit-identical); a pair past the last row computes an unused one.
#[cfg(target_feature = "simd128")]
#[inline(always)]
fn evaluate_rows(s: &Store, m: usize, n: usize, dqa: &[f64; 6], dqb: &[f64; 6]) -> ([f64; 12], [f64; 12]) {
    use core::arch::wasm32::*;
    let mut c = [0.0; 12];
    let mut f = [0.0; 12];
    debug_assert!(72 * m + 72 <= s.m_jat.len() && 12 * m + 12 <= s.m_c0.len());
    // SAFETY: every load stays inside manifold m's 12 rows (q + 1 < 12) and 72 Jacobian entries
    unsafe {
        let ja = s.m_jat.as_ptr().add(72 * m);
        let jb = s.m_jbt.as_ptr().add(72 * m);
        let c0 = s.m_c0.as_ptr().add(12 * m);
        let pen = s.m_pen.as_ptr().add(12 * m);
        let lam = s.m_lambda.as_ptr().add(12 * m);
        let da = [f64x2_splat(dqa[0]), f64x2_splat(dqa[1]), f64x2_splat(dqa[2]), f64x2_splat(dqa[3]), f64x2_splat(dqa[4]), f64x2_splat(dqa[5])];
        let db = [f64x2_splat(dqb[0]), f64x2_splat(dqb[1]), f64x2_splat(dqb[2]), f64x2_splat(dqb[3]), f64x2_splat(dqb[4]), f64x2_splat(dqb[5])];
        let mut q = 0;
        while q < 3 * n {
            let mut cc = v128_load(c0.add(q) as *const v128);
            for k in 0..6 {
                let a = f64x2_mul(v128_load(ja.add(12 * k + q) as *const v128), da[k]);
                let b = f64x2_mul(v128_load(jb.add(12 * k + q) as *const v128), db[k]);
                cc = f64x2_add(cc, f64x2_add(a, b));
            }
            let ff = f64x2_add(f64x2_mul(v128_load(pen.add(q) as *const v128), cc), v128_load(lam.add(q) as *const v128));
            v128_store(c.as_mut_ptr().add(q) as *mut v128, cc);
            v128_store(f.as_mut_ptr().add(q) as *mut v128, ff);
            q += 2;
        }
    }
    (c, f)
}

/// Clamp point i's force: the normal pushes only, friction stays in the Coulomb cone. Returns
/// whether the friction was inside the cone.
#[inline(always)]
fn clamp(f: &mut [f64; 12], i: usize, friction: f64) -> bool {
    let q = 3 * i;
    if f[q] > 0.0 {
        f[q] = 0.0;
    }
    let bound = -f[q] * friction;
    let ft = (f[q + 1] * f[q + 1] + f[q + 2] * f[q + 2]).sqrt();
    if ft > bound && ft > 0.0 {
        let sc = bound / ft;
        f[q + 1] = f[q + 1] * sc;
        f[q + 2] = f[q + 2] * sc;
        return false;
    }
    true
}

#[inline(never)]
pub fn stamp(s: &Store, m: usize, body: usize, sys: &mut Sys) {
    let a = at!(s.m_a, m) as usize;
    let b = at!(s.m_b, m) as usize;
    let jac = if body == a { &s.m_ja } else { &s.m_jb };
    let n = at!(s.m_count, m) as usize;
    let (_, mut f) = evaluate_rows(s, m, n, &dq(s, a), &dq(s, b));
    let friction = at!(s.m_friction, m);
    for i in 0..n {
        // a point stamps its stiffness even while its force is clamped to zero (see contact.ts)
        clamp(&mut f, i, friction);
        for r in 0..3 {
            let q = 12 * m + i * 3 + r;
            let o = q * 6;
            debug_assert!(o + 6 <= jac.len());
            // SAFETY: q is one of manifold m's rows, so its six Jacobian entries are in the store
            let row: &[f64; 6] = unsafe { &*(jac.as_ptr().add(o) as *const [f64; 6]) };
            stamp_row(sys, row, at!(s.m_pen, q), f[i * 3 + r]);
        }
    }
}

#[inline(never)]
pub fn dual(s: &mut Store, p: &Params, m: usize) {
    let a = at!(s.m_a, m) as usize;
    let b = at!(s.m_b, m) as usize;
    let n = at!(s.m_count, m) as usize;
    let (c, mut f) = evaluate_rows(s, m, n, &dq(s, a), &dq(s, b));
    let stick_tol = p.stick_speed * p.dt;
    let friction = at!(s.m_friction, m);
    let k0 = at!(s.m_k0, m);
    for i in 0..n {
        let in_cone = clamp(&mut f, i, friction);
        let q = 12 * m + i * 3;
        for r in 0..3 {
            at_mut!(s.m_lambda, q + r) = f[i * 3 + r];
        }
        if f[i * 3] < 0.0 {
            at_mut!(s.m_pen, q) = p.ramp(at!(s.m_pen, q), c[i * 3].abs(), p.contact_beta, k0);
        }
        if in_cone {
            at_mut!(s.m_pen, q + 1) = p.ramp(at!(s.m_pen, q + 1), c[i * 3 + 1].abs(), p.contact_beta, k0);
            at_mut!(s.m_pen, q + 2) = p.ramp(at!(s.m_pen, q + 2), c[i * 3 + 2].abs(), p.contact_beta, k0);
            at_mut!(s.m_stick, 4 * m + i) = if (c[i * 3 + 1] * c[i * 3 + 1] + c[i * 3 + 2] * c[i * 3 + 2]).sqrt() < stick_tol { 1 } else { 0 };
        } else {
            at_mut!(s.m_stick, 4 * m + i) = 0;
        }
    }
}
