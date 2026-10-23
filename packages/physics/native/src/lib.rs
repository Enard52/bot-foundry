// WebAssembly core of the Bot Foundry solver: raw C-ABI exports over linear memory, no bindings
// generator. Each world is a heap object addressed by the pointer world_new returns; TypeScript
// (src/wasm-world.ts) reads world_layout for the address of every field and keeps typed-array
// views on them. Fields move only in world_reserve, or in world_step when contacts need more
// manifold slots; both bump world_version, and any allocation can also grow the memory, so the
// TypeScript side rebuilds its views whenever the version or the memory buffer changes.
//
// Boundary: every export that takes a count from JavaScript (world_reserve, world_step) checks it
// against the allocated capacities and returns a status code, 0 for success, instead of reading
// out of bounds. The checks run once at entry; the inner loops index unchecked. The world pointer
// itself is a handle the caller must keep valid (world_free on it exactly once).
//
// Determinism: fixed iteration order everywhere, ordered maps only (no hash map is iterated), no
// clock and no randomness; f64 arithmetic in the TypeScript backend's operation order.

mod collide;
mod contact;
mod joint;
mod math;
mod store;
mod system;
mod world;

use world::{World, OK};

#[no_mangle]
pub extern "C" fn world_new() -> *mut World {
    Box::into_raw(Box::new(World::new()))
}

/// # Safety
/// `w` must come from world_new and not have been freed.
#[no_mangle]
pub unsafe extern "C" fn world_free(w: *mut World) {
    drop(Box::from_raw(w));
}

/// Grow capacities: body slots (with the ground's slot 0), joints, manifold slots, hulls, hull
/// vertices, faces, face vertex indices, edges and edge directions. Fields may move. Returns 0, or
/// ERR_CAPACITY (and changes nothing) if the request is past MAX_CAP or MAX_STORE_BYTES.
/// # Safety
/// `w` must come from world_new and not have been freed.
#[no_mangle]
#[allow(clippy::too_many_arguments)]
pub unsafe extern "C" fn world_reserve(w: *mut World, bodies: u32, joints: u32, manifolds: u32, hulls: u32, verts: u32, faces: u32, face_verts: u32, edges: u32, dirs: u32) -> u32 {
    let want = [bodies, joints, manifolds, hulls, verts, faces, face_verts, edges, dirs].map(|x| x as usize);
    let code = (*w).check_reserve(&want);
    if code == OK {
        (*w).reserve(&want);
    }
    code
}

/// Changes whenever fields may have moved (a reserve, or manifold slots growing during a step).
/// # Safety
/// `w` must come from world_new and not have been freed.
#[no_mangle]
pub unsafe extern "C" fn world_version(w: *mut World) -> u32 {
    (*w).version
}

/// Current capacities, in world_reserve's order, as 9 u32s at the returned address.
/// # Safety
/// `w` must come from world_new and not have been freed.
#[no_mangle]
pub unsafe extern "C" fn world_caps(w: *mut World) -> *const u32 {
    let c = &(*w).caps.0;
    let out = &mut (*w).caps_out;
    for i in 0..9 {
        out[i] = c[i] as u32;
    }
    out.as_ptr()
}

/// Add the ground plane y = 0 (slot 0).
/// # Safety
/// `w` must come from world_new and not have been freed.
#[no_mangle]
pub unsafe extern "C" fn world_add_ground(w: *mut World) {
    (*w).col.ground = true;
}

/// Address of the field address table: one u32 per field, in world_layout_signature order.
/// # Safety
/// `w` must come from world_new and not have been freed.
#[no_mangle]
pub unsafe extern "C" fn world_layout(w: *mut World) -> *const u32 {
    (*w).layout.as_ptr()
}

/// Address of the layout signature, world_layout_signature_len bytes of UTF-8: one
/// `name:type:group:width` entry per field, comma-terminated, generated from the store! table.
#[no_mangle]
pub extern "C" fn world_layout_signature() -> *const u8 {
    store::LAYOUT_SIGNATURE.as_ptr()
}

#[no_mangle]
pub extern "C" fn world_layout_signature_len() -> u32 {
    store::LAYOUT_SIGNATURE.len() as u32
}

/// One substep for body slots 1..=bodies and joints 0..joints. Returns 0, or the first failed
/// check (ERR_BODIES, ERR_JOINTS, ERR_JOINT_BODY, ERR_HULL_POOL) without stepping. The connections
/// that broke are read from the j_broken field.
/// # Safety
/// `w` must come from world_new and not have been freed.
#[no_mangle]
pub unsafe extern "C" fn world_step(w: *mut World, bodies: u32, joints: u32) -> u32 {
    let (bodies, joints) = (bodies as usize, joints as usize);
    let code = (*w).check_step(bodies, joints);
    if code == OK {
        (*w).step(bodies, joints);
    }
    code
}
