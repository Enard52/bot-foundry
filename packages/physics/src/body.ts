import type { Hull } from './hull.ts';
import { quat, quatToMat3, rotateTensor, vec3, type Mat3, type Quat, type Vec3 } from './math.ts';

/** Anything the solver iterates: joints, rated connections and contact manifolds. */
export interface Constraint {
  readonly a: Body;
  readonly b: Body;
  /** once per substep before the iterations; false drops it for this substep */
  prepare(): boolean;
  /** add this constraint's force and stiffness to `body`'s 6x6 system */
  stamp(body: Body, sys: BodySystem): void;
  /** augmented-Lagrangian multiplier and penalty update, once per iteration */
  dual(): void;
}

/**
 * The per-body linear system of one AVBD primal step (Giles et al. 2025, Eq. 4-6):
 * lhs = M/h² + Σ Jᵀ K J (+ geometric stiffness), rhs = M/h² (x − y) + Σ Jᵀ F.
 * Unknowns ordered [Δx, Δθ]; only the lower triangle of lhs is filled and read.
 */
export interface BodySystem {
  lhs: Float64Array;
  rhs: Float64Array;
}

/**
 * A rigid body with its frame at the centre of mass. Static bodies (the ground, and parts with
 * zero mass) never move and are skipped by the primal update.
 */
export class Body {
  readonly index: number;
  readonly id: string;
  readonly isStatic: boolean;
  readonly mass: number;
  /** inertia about the COM in the body frame, row-major 3x3 */
  readonly inertiaLocal: Mat3;
  /** smallest diagonal inertia, for scaling angular penalties */
  readonly inertiaScale: number;
  readonly friction: number;
  readonly hulls: Hull[];
  /** bounding-sphere radius about the COM over all hulls */
  readonly radius: number;
  /** the infinite ground plane y = 0 */
  readonly isGround: boolean;

  readonly pos: Vec3 = vec3();
  readonly rot: Quat = quat();
  readonly vel: Vec3 = vec3();
  readonly angVel: Vec3 = vec3();

  // solver scratch, valid within one substep
  readonly pos0: Vec3 = vec3();
  readonly rot0: Quat = quat();
  readonly inertialPos: Vec3 = vec3();
  readonly inertialRot: Quat = quat();
  readonly prevVel: Vec3 = vec3();
  readonly inertiaWorld: Mat3 = new Float64Array(9);
  /** world-frame hull vertices for collision, refreshed when worldStamp is stale */
  readonly worldVerts: Float64Array[];
  readonly worldNormals: Float64Array[];
  worldStamp = -1;

  /** connections touching this body (stable across substeps until one breaks) */
  joints: Constraint[] = [];
  /** joints + this substep's contact manifolds, in deterministic order */
  constraints: Constraint[] = [];

  constructor(init: {
    index: number;
    id: string;
    mass: number;
    inertia: Mat3;
    friction: number;
    hulls: Hull[];
    isGround?: boolean;
  }) {
    this.index = init.index;
    this.id = init.id;
    this.isGround = init.isGround ?? false;
    this.isStatic = this.isGround || !(init.mass > 0);
    this.mass = this.isStatic ? 0 : init.mass;
    this.inertiaLocal = init.inertia;
    this.inertiaScale = Math.max(Math.min(init.inertia[0]!, init.inertia[4]!, init.inertia[8]!), 1e-12);
    this.friction = init.friction;
    this.hulls = init.hulls;
    this.radius = init.hulls.reduce((r, h) => Math.max(r, h.radius), 0);
    this.worldVerts = init.hulls.map((h) => new Float64Array(h.verts.length));
    this.worldNormals = init.hulls.map((h) => new Float64Array(h.faces.length * 3));
  }

  /** I_world = R I_body Rᵀ at the current rotation. */
  updateWorldInertia(): void {
    quatToMat3(TMP_R, this.rot);
    rotateTensor(this.inertiaWorld, TMP_R, this.inertiaLocal);
  }
}

const TMP_R = new Float64Array(9);
