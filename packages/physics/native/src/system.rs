// The per-body 6x6 system of one AVBD primal step (Giles et al. 2025, Eq. 4-6), a port of
// src/system.ts: lhs is row-major with unknowns [Δx, Δθ] and only entries with row ≥ column used.

pub struct Sys {
    pub lhs: [f64; 36],
    pub rhs: [f64; 6],
}

/// lhs += k·j·jᵀ, rhs += j·f for one scalar row with Jacobian j; rows with j[r] = 0 are skipped
/// as in system.ts. Unrolled by hand: the triangular loop otherwise compiles to branchy code.
#[cfg(not(target_feature = "simd128"))]
#[inline(always)]
pub fn stamp_row(sys: &mut Sys, j: &[f64; 6], k: f64, f: f64) {
    macro_rules! row {
        ($r:expr, $($c:expr),+) => {
            let jr = j[$r];
            if jr != 0.0 {
                sys.rhs[$r] = sys.rhs[$r] + jr * f;
                let kj = k * jr;
                $(sys.lhs[$r * 6 + $c] = sys.lhs[$r * 6 + $c] + kj * j[$c];)+
            }
        };
    }
    row!(0, 0);
    row!(1, 0, 1);
    row!(2, 0, 1, 2);
    row!(3, 0, 1, 2, 3);
    row!(4, 0, 1, 2, 3, 4);
    row!(5, 0, 1, 2, 3, 4, 5);
}

/// The same stamp two columns per f64x2 lane pair. Each lane does exactly the scalar operations
/// of its entry, so results are bit-identical; rows 0, 2 and 4 also write one entry above the
/// diagonal (columns 1, 3, 5), which nothing reads.
#[cfg(target_feature = "simd128")]
#[inline(always)]
pub fn stamp_row(sys: &mut Sys, j: &[f64; 6], k: f64, f: f64) {
    use core::arch::wasm32::*;
    let jp = j.as_ptr() as *const v128;
    let lp = sys.lhs.as_mut_ptr();
    macro_rules! row {
        ($r:expr, $pairs:expr) => {
            let jr = j[$r];
            if jr != 0.0 {
                sys.rhs[$r] = sys.rhs[$r] + jr * f;
                let kj = f64x2_splat(k * jr);
                for p in 0..$pairs {
                    // SAFETY: r·6 + 2p + 1 < 36 and 2p + 1 < 6
                    unsafe {
                        let l = lp.add($r * 6 + 2 * p) as *mut v128;
                        v128_store(l, f64x2_add(v128_load(l), f64x2_mul(kj, v128_load(jp.add(p)))));
                    }
                }
            }
        };
    }
    row!(0, 1);
    row!(1, 1);
    row!(2, 2);
    row!(3, 2);
    row!(4, 3);
    row!(5, 3);
}

/// stamp_row for a purely angular row (0, 0, 0, jx, jy, jz).
#[inline(always)]
pub fn stamp_angular_row(sys: &mut Sys, jx: f64, jy: f64, jz: f64, k: f64, f: f64) {
    let lhs = &mut sys.lhs;
    let rhs = &mut sys.rhs;
    rhs[3] = rhs[3] + jx * f;
    rhs[4] = rhs[4] + jy * f;
    rhs[5] = rhs[5] + jz * f;
    lhs[21] = lhs[21] + k * jx * jx;
    lhs[27] = lhs[27] + k * jy * jx;
    lhs[28] = lhs[28] + k * jy * jy;
    lhs[33] = lhs[33] + k * jz * jx;
    lhs[34] = lhs[34] + k * jz * jy;
    lhs[35] = lhs[35] + k * jz * jz;
}

/// Solve lhs·x = −rhs by LDLᵀ (lhs is symmetric positive definite).
#[inline(always)]
pub fn solve(sys: &Sys) -> [f64; 6] {
    let a = &sys.lhs;
    let mut l = [0.0f64; 36];
    let mut d = [0.0f64; 6];
    for j in 0..6 {
        let mut dj = a[j * 6 + j];
        for k in 0..j {
            dj -= l[j * 6 + k] * l[j * 6 + k] * d[k];
        }
        d[j] = dj;
        let inv = 1.0 / dj;
        for i in j + 1..6 {
            let mut s = a[i * 6 + j];
            for k in 0..j {
                s -= l[i * 6 + k] * l[j * 6 + k] * d[k];
            }
            l[i * 6 + j] = s * inv;
        }
    }
    let b = &sys.rhs;
    let mut y = [0.0f64; 6];
    for i in 0..6 {
        let mut s = -b[i];
        for k in 0..i {
            s -= l[i * 6 + k] * y[k];
        }
        y[i] = s;
    }
    let mut out = [0.0f64; 6];
    for i in (0..6).rev() {
        let mut s = y[i] / d[i];
        for k in i + 1..6 {
            s -= l[k * 6 + i] * out[k];
        }
        out[i] = s;
    }
    out
}

/// solve() for two independent systems at once, one per f64x2 lane. Each lane performs exactly the
/// scalar operations of solve() in the same order, so each result is bit-identical to solving that
/// system alone; the two dependency chains (the divisions above all) run side by side.
#[cfg(target_feature = "simd128")]
#[inline(always)]
pub fn solve2(x: &Sys, y: &Sys) -> ([f64; 6], [f64; 6]) {
    use core::arch::wasm32::*;
    let a = |i: usize| f64x2(x.lhs[i], y.lhs[i]);
    let zero = f64x2_splat(0.0);
    let mut l = [zero; 36];
    let mut d = [zero; 6];
    for j in 0..6 {
        let mut dj = a(j * 6 + j);
        for k in 0..j {
            dj = f64x2_sub(dj, f64x2_mul(f64x2_mul(l[j * 6 + k], l[j * 6 + k]), d[k]));
        }
        d[j] = dj;
        let inv = f64x2_div(f64x2_splat(1.0), dj);
        for i in j + 1..6 {
            let mut s = a(i * 6 + j);
            for k in 0..j {
                s = f64x2_sub(s, f64x2_mul(f64x2_mul(l[i * 6 + k], l[j * 6 + k]), d[k]));
            }
            l[i * 6 + j] = f64x2_mul(s, inv);
        }
    }
    let mut v = [zero; 6];
    for i in 0..6 {
        let mut s = f64x2_neg(f64x2(x.rhs[i], y.rhs[i]));
        for k in 0..i {
            s = f64x2_sub(s, f64x2_mul(l[i * 6 + k], v[k]));
        }
        v[i] = s;
    }
    let mut out = [zero; 6];
    for i in (0..6).rev() {
        let mut s = f64x2_div(v[i], d[i]);
        for k in i + 1..6 {
            s = f64x2_sub(s, f64x2_mul(l[k * 6 + i], out[k]));
        }
        out[i] = s;
    }
    let mut ox = [0.0; 6];
    let mut oy = [0.0; 6];
    for i in 0..6 {
        ox[i] = f64x2_extract_lane::<0>(out[i]);
        oy[i] = f64x2_extract_lane::<1>(out[i]);
    }
    (ox, oy)
}

#[cfg(not(target_feature = "simd128"))]
#[inline(always)]
pub fn solve2(x: &Sys, y: &Sys) -> ([f64; 6], [f64; 6]) {
    (solve(x), solve(y))
}
