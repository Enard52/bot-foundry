// Vector and quaternion helpers, a line-for-line port of src/math.ts. Every expression keeps the
// TypeScript evaluation order: f64 +, -, *, / and sqrt are correctly rounded in both IEEE 754
// implementations, Rust does not contract a * b + c into a fused multiply-add, and so each result
// is bit-identical to the TypeScript backend's. Quaternions are [x, y, z, w].

pub type V3 = [f64; 3];
pub type Q = [f64; 4];

#[inline(always)]
pub fn dot(a: V3, b: V3) -> f64 {
    a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}

#[inline(always)]
pub fn cross(a: V3, b: V3) -> V3 {
    [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
}

/// q · v · q*
#[inline(always)]
pub fn rotate(q: Q, v: V3) -> V3 {
    let (qx, qy, qz, qw) = (q[0], q[1], q[2], q[3]);
    let (vx, vy, vz) = (v[0], v[1], v[2]);
    let tx = 2.0 * (qy * vz - qz * vy);
    let ty = 2.0 * (qz * vx - qx * vz);
    let tz = 2.0 * (qx * vy - qy * vx);
    [
        vx + qw * tx + (qy * tz - qz * ty),
        vy + qw * ty + (qz * tx - qx * tz),
        vz + qw * tz + (qx * ty - qy * tx),
    ]
}

/// q* · v · q, the inverse rotation.
#[inline(always)]
pub fn rotate_inv(q: Q, v: V3) -> V3 {
    rotate([-q[0], -q[1], -q[2], q[3]], v)
}

/// Two unit vectors completing n to a right-handed orthonormal basis (same branch as math.ts).
#[inline(always)]
pub fn tangent_basis(n: V3) -> (V3, V3) {
    let t = if n[0].abs() > n[2].abs() { [-n[1], n[0], 0.0] } else { [0.0, -n[2], n[1]] };
    let l = dot(t, t).sqrt();
    let s = if l > 0.0 { 1.0 / l } else { 0.0 };
    let t1 = [t[0] * s, t[1] * s, t[2] * s];
    (t1, cross(n, t1))
}

#[inline(always)]
pub fn quat_mul(a: Q, b: Q) -> Q {
    let (ax, ay, az, aw) = (a[0], a[1], a[2], a[3]);
    let (bx, by, bz, bw) = (b[0], b[1], b[2], b[3]);
    [
        aw * bx + ax * bw + ay * bz - az * by,
        aw * by - ax * bz + ay * bw + az * bx,
        aw * bz + ax * by - ay * bx + az * bw,
        aw * bw - ax * bx - ay * by - az * bz,
    ]
}

#[inline(always)]
pub fn quat_normalize(q: Q) -> Q {
    let l = (q[0] * q[0] + q[1] * q[1] + q[2] * q[2] + q[3] * q[3]).sqrt();
    let s = if l > 0.0 { 1.0 / l } else { 0.0 };
    [q[0] * s, q[1] * s, q[2] * s, q[3] * s]
}

/// normalize(q + ½ (s·w, 0) ⊗ q), the AVBD reference's `quat + float3`.
#[inline(always)]
pub fn quat_add_rotation(q: Q, w: V3, s: f64) -> Q {
    let wx = 0.5 * s * w[0];
    let wy = 0.5 * s * w[1];
    let wz = 0.5 * s * w[2];
    let (qx, qy, qz, qw) = (q[0], q[1], q[2], q[3]);
    quat_normalize([
        qx + (wy * qz - wz * qy + wx * qw),
        qy + (wz * qx - wx * qz + wy * qw),
        qz + (wx * qy - wy * qx + wz * qw),
        qw - (wx * qx + wy * qy + wz * qz),
    ])
}

/// 2 · vec(a ⊗ b*) on the short arc, the AVBD reference's `quat - quat`.
#[inline(always)]
pub fn quat_diff(a: Q, b: Q) -> V3 {
    let (ax, ay, az, aw) = (a[0], a[1], a[2], a[3]);
    let (bx, by, bz, bw) = (-b[0], -b[1], -b[2], b[3]);
    let x = aw * bx + ax * bw + ay * bz - az * by;
    let y = aw * by - ax * bz + ay * bw + az * bx;
    let z = aw * bz + ax * by - ay * bx + az * bw;
    let w = aw * bw - ax * bx - ay * by - az * bz;
    let s = if w < 0.0 { -2.0 } else { 2.0 };
    [x * s, y * s, z * s]
}

/// I_world = R I_local Rᵀ, both row-major 3x3.
#[inline(always)]
pub fn world_inertia(q: Q, s: &[f64]) -> [f64; 9] {
    let (x, y, z, w) = (q[0], q[1], q[2], q[3]);
    let (xx, yy, zz) = (x * x, y * y, z * z);
    let (xy, xz, yz) = (x * y, x * z, y * z);
    let (wx, wy, wz) = (w * x, w * y, w * z);
    let r = [
        1.0 - 2.0 * (yy + zz),
        2.0 * (xy - wz),
        2.0 * (xz + wy),
        2.0 * (xy + wz),
        1.0 - 2.0 * (xx + zz),
        2.0 * (yz - wx),
        2.0 * (xz - wy),
        2.0 * (yz + wx),
        1.0 - 2.0 * (xx + yy),
    ];
    let mut t = [0.0; 9];
    for i in 0..3 {
        for j in 0..3 {
            t[i * 3 + j] = r[i * 3] * s[j] + r[i * 3 + 1] * s[3 + j] + r[i * 3 + 2] * s[6 + j];
        }
    }
    let mut out = [0.0; 9];
    for i in 0..3 {
        for j in 0..3 {
            out[i * 3 + j] = t[i * 3] * r[j * 3] + t[i * 3 + 1] * r[j * 3 + 1] + t[i * 3 + 2] * r[j * 3 + 2];
        }
    }
    out
}

/// ECMAScript Math.min for two non-NaN numbers, including min(+0, −0) = −0.
#[inline(always)]
pub fn js_min(a: f64, b: f64) -> f64 {
    if a < b {
        a
    } else if b < a {
        b
    } else if a.is_sign_negative() {
        a
    } else {
        b
    }
}

/// ECMAScript Math.max for two non-NaN numbers, including max(+0, −0) = +0.
#[inline(always)]
pub fn js_max(a: f64, b: f64) -> f64 {
    if a > b {
        a
    } else if b > a {
        b
    } else if a.is_sign_negative() {
        b
    } else {
        a
    }
}

const PI: f64 = 3.141592653589793;
const HALF_PI: f64 = 1.5707963267948966;

/// atan2 from +, *, / and sqrt only; see datan2 in math.ts for the reduction.
pub fn datan2(y: f64, x: f64) -> f64 {
    if x == 0.0 && y == 0.0 {
        return 0.0;
    }
    let ax = x.abs();
    let ay = y.abs();
    let swap = ay > ax;
    let mut t = if swap { ax / ay } else { ay / ax };
    t = t / (1.0 + (1.0 + t * t).sqrt());
    t = t / (1.0 + (1.0 + t * t).sqrt());
    let t2 = t * t;
    let mut s = 0.0;
    let mut k = 19;
    while k >= 1 {
        s = 1.0 / (k as f64) - t2 * s;
        k -= 2;
    }
    let mut a = 4.0 * t * s;
    if swap {
        a = HALF_PI - a;
    }
    if x < 0.0 {
        a = PI - a;
    }
    if y < 0.0 {
        -a
    } else {
        a
    }
}
