// The solver state as struct-of-arrays in linear memory: one array per field, indexed by body slot,
// joint index or manifold slot, with vector fields stored as consecutive components. TypeScript
// reads the table of field addresses (world_layout) and keeps a typed-array view on each field, so
// model setup and collision write straight into these arrays. FIELDS in src/wasm-world.ts lists the
// same fields in the same order, and checks them against LAYOUT_SIGNATURE.

#[derive(Clone, Copy)]
pub enum Group {
    One,
    Body,
    BodyPlusOne,
    Joint,
    Manifold,
    Adjacency,
    Hull,
    HullVert,
    Face,
    FaceVert,
    Edge,
    Dir,
}

/// Capacities: bodies (with the ground's slot 0), joints, manifold slots, then the collision
/// geometry pools: hulls, hull vertices, faces, face vertex indices, edges, edge directions.
pub struct Caps(pub [usize; 9]);

/// The largest any one capacity may be, and the most memory the store may take: world_reserve
/// refuses more (a request that large would wrap the size arithmetic or run the memory out).
pub const MAX_CAP: usize = 1 << 24;
pub const MAX_STORE_BYTES: u64 = 1 << 30;

impl Caps {
    fn group(&self, g: Group) -> usize {
        let c = &self.0;
        match g {
            Group::One => 1,
            Group::Body => c[0],
            Group::BodyPlusOne => c[0] + 1,
            Group::Joint => c[1],
            Group::Manifold => c[2],
            Group::Adjacency => 2 * c[1] + 2 * c[2],
            Group::Hull => c[3],
            Group::HullVert => c[4],
            Group::Face => c[5],
            Group::FaceVert => c[6],
            Group::Edge => c[7],
            Group::Dir => c[8],
        }
    }
}

macro_rules! store {
    ($($name:ident: $t:ty, $grp:ident, $w:expr;)*) => {
        pub struct Store { $(pub $name: Vec<$t>,)* }

        impl Store {
            pub fn new() -> Store {
                Store { $($name: Vec::new(),)* }
            }

            /// Grow every field to the capacities, keeping what is stored.
            pub fn resize(&mut self, caps: &Caps) {
                $(self.$name.resize(caps.group(Group::$grp) * $w, <$t>::default());)*
            }

            pub fn table(&self, out: &mut Vec<u32>) {
                out.clear();
                $(out.push(self.$name.as_ptr() as usize as u32);)*
            }
        }

        /// Bytes the whole store takes at these capacities, in u64 so a huge request cannot wrap.
        /// The caps must already be below MAX_CAP, so that Caps::group itself cannot overflow.
        pub fn store_bytes(caps: &Caps) -> u64 {
            0 $(+ caps.group(Group::$grp) as u64 * $w as u64 * core::mem::size_of::<$t>() as u64)*
        }

        /// One `name:type:group:width` entry per field, comma-terminated, in declaration order, for
        /// the TypeScript side to check against its own FIELDS table.
        pub const LAYOUT_SIGNATURE: &str = concat!($(stringify!($name), ":", stringify!($t), ":", stringify!($grp), ":", stringify!($w), ",",)*);
    };
}

store! {
    params: f64, One, 16;

    // bodies; slot 0 is the ground, part i of the world is slot i + 1; mass 0 marks a static body
    b_pos: f64, Body, 3;
    b_rot: f64, Body, 4;
    b_vel: f64, Body, 3;
    b_ang: f64, Body, 3;
    b_prev_vel: f64, Body, 3;
    b_pos0: f64, Body, 3;
    b_rot0: f64, Body, 4;
    b_ipos: f64, Body, 3;
    b_irot: f64, Body, 4;
    b_inertia: f64, Body, 9;
    b_iworld: f64, Body, 9;
    // M/h² and the lower triangle of I_world/h², fixed for the substep
    b_mh2: f64, Body, 7;
    b_mass: f64, Body, 1;
    // [x − x₀, θ ⊖ θ₀], refreshed whenever the body moves
    b_dq: f64, Body, 6;
    // collision: the body's hulls, bounding radius about the COM, friction, and the substep its
    // world-space hull vertices and face normals were last computed in
    b_hull_off: u32, Body, 1;
    b_hull_n: u32, Body, 1;
    b_radius: f64, Body, 1;
    b_friction: f64, Body, 1;
    b_stamp: u32, Body, 1;
    b_nstamp: u32, Body, 1;

    // joints and the connections they realise, in creation order
    j_a: u32, Joint, 1;
    j_b: u32, Joint, 1;
    j_kind: u32, Joint, 1;
    j_flags: u32, Joint, 1;
    j_broken: u32, Joint, 1;
    j_ra: f64, Joint, 3;
    j_rb: f64, Joint, 3;
    j_axis_a: f64, Joint, 3;
    j_axis_b: f64, Joint, 3;
    j_perp1a: f64, Joint, 3;
    j_perp2a: f64, Joint, 3;
    j_perp1b: f64, Joint, 3;
    j_qrel: f64, Joint, 4;
    j_k0: f64, Joint, 2;
    j_stiff: f64, Joint, 2;
    j_limits: f64, Joint, 2;
    // per row group: penalty, multiplier, and α times the error at the start of the substep
    // (every use of that error is the stabilised C − α·C₀, so the product is stored once)
    j_point_k: f64, Joint, 1;
    j_point_lambda: f64, Joint, 3;
    j_point_c0: f64, Joint, 3;
    j_lock_k: f64, Joint, 1;
    j_lock_lambda: f64, Joint, 3;
    j_lock_c0: f64, Joint, 3;
    j_axis_k: f64, Joint, 2;
    j_axis_lambda: f64, Joint, 2;
    j_axis_c0: f64, Joint, 2;
    j_slide_k: f64, Joint, 2;
    j_slide_lambda: f64, Joint, 2;
    j_slide_c0: f64, Joint, 2;
    j_limit: f64, Joint, 4;
    j_limit_ja: f64, Joint, 6;
    j_limit_jb: f64, Joint, 6;
    // world-frame quantities that depend on one body's rotation, refreshed when that body moves:
    // the anchors r_A, r_B, q_A ⊗ q_rel and the lock error, perp_1,2 on A and the axis on B
    j_raw: f64, Joint, 3;
    j_rbw: f64, Joint, 3;
    j_qaq: f64, Joint, 4;
    j_lockc: f64, Joint, 3;
    j_u: f64, Joint, 6;
    j_v: f64, Joint, 3;
    c_rating: u32, Joint, 1;
    c_rating_v: f64, Joint, 2;
    c_axis: f64, Joint, 3;
    c_out: f64, Joint, 3;

    // contact manifolds, by slot; collision fills a, b, count, feature, ra, rb, basis and carries
    // penalty, lambda and stick across substeps
    m_a: u32, Manifold, 1;
    m_b: u32, Manifold, 1;
    m_count: u32, Manifold, 1;
    m_stick: u32, Manifold, 4;
    m_friction: f64, Manifold, 1;
    m_k0: f64, Manifold, 1;
    m_feature: f64, Manifold, 4;
    m_ra: f64, Manifold, 12;
    m_rb: f64, Manifold, 12;
    m_basis: f64, Manifold, 9;
    m_c0: f64, Manifold, 12;
    m_pen: f64, Manifold, 12;
    m_lambda: f64, Manifold, 12;
    m_ja: f64, Manifold, 72;
    m_jb: f64, Manifold, 72;
    // the same Jacobians transposed, column k of all 12 rows together, for two rows per SIMD lane pair
    m_jat: f64, Manifold, 72;
    m_jbt: f64, Manifold, 72;
    m_seen: u32, Manifold, 1;
    active: u32, Manifold, 1;

    // convex hulls as in src/hull.ts, packed into pools; vertex indices are local to their hull
    h_count: u32, Hull, 1;
    h_vert_off: u32, Hull, 1;
    h_face_off: u32, Hull, 1;
    h_face_n: u32, Hull, 1;
    h_edge_off: u32, Hull, 1;
    h_edge_n: u32, Hull, 1;
    h_dir_off: u32, Hull, 1;
    h_dir_n: u32, Hull, 1;
    hv_local: f64, HullVert, 3;
    hv_world: f64, HullVert, 3;
    f_normal: f64, Face, 3;
    f_world: f64, Face, 3;
    f_vert_off: u32, Face, 1;
    f_vert_n: u32, Face, 1;
    fv: u32, FaceVert, 1;
    e: u32, Edge, 3;
    d: f64, Dir, 3;

    broken_out: u32, Joint, 1;
    adj_off: u32, BodyPlusOne, 1;
    adj_cur: u32, BodyPlusOne, 1;
    adj: u32, Adjacency, 1;
}

// joint kinds and flags, as written by src/wasm-world.ts
pub const KIND_HINGE: u32 = 1;
pub const KIND_SLIDER: u32 = 2;
pub const F_POINT: u32 = 1;
pub const F_LOCK: u32 = 2;
pub const F_AXIS: u32 = 4;
pub const F_SLIDE: u32 = 8;
pub const F_LIMITS: u32 = 16;
pub const RATING_BOLT: u32 = 1;
pub const RATING_WELD: u32 = 2;

pub struct Params {
    pub dt: f64,
    pub iterations: u32,
    pub g: [f64; 3],
    pub alpha: f64,
    pub gamma: f64,
    pub beta_lin: f64,
    pub beta_ang: f64,
    pub penalty_min: f64,
    pub contact_beta: f64,
    pub contact_penalty_min: f64,
    pub penalty_max: f64,
    pub margin: f64,
    pub stick_speed: f64,
}

impl Params {
    pub fn read(p: &[f64]) -> Params {
        Params {
            dt: p[0],
            iterations: p[1] as u32,
            g: [p[2], p[3], p[4]],
            alpha: p[5],
            gamma: p[6],
            beta_lin: p[7],
            beta_ang: p[8],
            penalty_min: p[9],
            contact_beta: p[10],
            contact_penalty_min: p[11],
            penalty_max: p[12],
            margin: p[13],
            stick_speed: p[14],
        }
    }

    /// Warm-start a penalty for a new substep (AVBD Eq. 19).
    #[inline(always)]
    pub fn warm(&self, k: f64, k0: f64, min: f64) -> f64 {
        let v = k * self.gamma;
        let lo = min * k0;
        let hi = self.penalty_max * k0;
        if v < lo {
            lo
        } else if v > hi {
            hi
        } else {
            v
        }
    }

    /// Ramp a penalty by the remaining error (AVBD Eq. 16).
    #[inline(always)]
    pub fn ramp(&self, k: f64, abs_c: f64, beta: f64, k0: f64) -> f64 {
        let v = k + beta * k0 * abs_c;
        let hi = self.penalty_max * k0;
        if v > hi {
            hi
        } else {
            v
        }
    }
}

// Unchecked element access for the hot loops. Every index is below the capacity that
// world_reserve sized the field to (TypeScript only passes counts within it), and debug builds
// still check.
macro_rules! at {
    ($v:expr, $i:expr) => {{
        let i = $i;
        debug_assert!(i < $v.len());
        unsafe { *$v.get_unchecked(i) }
    }};
}
macro_rules! at_mut {
    ($v:expr, $i:expr) => {
        *{
            let i = $i;
            debug_assert!(i < $v.len());
            unsafe { $v.get_unchecked_mut(i) }
        }
    };
}
pub(crate) use {at, at_mut};

#[inline(always)]
pub fn v3(s: &[f64], i: usize) -> [f64; 3] {
    debug_assert!(3 * i + 2 < s.len());
    unsafe { [*s.get_unchecked(3 * i), *s.get_unchecked(3 * i + 1), *s.get_unchecked(3 * i + 2)] }
}

#[inline(always)]
pub fn q4(s: &[f64], i: usize) -> [f64; 4] {
    debug_assert!(4 * i + 3 < s.len());
    unsafe { [*s.get_unchecked(4 * i), *s.get_unchecked(4 * i + 1), *s.get_unchecked(4 * i + 2), *s.get_unchecked(4 * i + 3)] }
}

#[inline(always)]
pub fn set3(s: &mut [f64], i: usize, v: [f64; 3]) {
    debug_assert!(3 * i + 2 < s.len());
    unsafe {
        *s.get_unchecked_mut(3 * i) = v[0];
        *s.get_unchecked_mut(3 * i + 1) = v[1];
        *s.get_unchecked_mut(3 * i + 2) = v[2];
    }
}

#[inline(always)]
pub fn set4(s: &mut [f64], i: usize, v: [f64; 4]) {
    debug_assert!(4 * i + 3 < s.len());
    unsafe {
        *s.get_unchecked_mut(4 * i) = v[0];
        *s.get_unchecked_mut(4 * i + 1) = v[1];
        *s.get_unchecked_mut(4 * i + 2) = v[2];
        *s.get_unchecked_mut(4 * i + 3) = v[3];
    }
}
