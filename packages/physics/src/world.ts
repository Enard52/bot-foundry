import { MATERIALS, type Connection as ModelConnection, type PhysicalModel, type Transform } from '@botfoundry/model';
import { Body, type Constraint } from './body.ts';
import { collideGround, collideHulls, createContactOut, refreshWorldHulls } from './collide.ts';
import { Connection, type Rating } from './connection.ts';
import { Manifold } from './contact.ts';
import { Fnv64 } from './hash.ts';
import { buildHull } from './hull.ts';
import type { BodyState, ConnectionState, RobotHandle, World, WorldOptions } from './index.ts';
import { Joint, type JointKind } from './joint.ts';
import {
  normalize3,
  quat,
  quatAddRotation,
  quatDiff,
  quatNormalize,
  rotate,
  vec3,
  type Mat3,
  type Vec3,
} from './math.ts';
import { defaultParams, type SolverParams } from './params.ts';
import { createSystem, solveSystem } from './system.ts';

// The world: Augmented Vertex Block Descent for rigid bodies (Giles, Diaz, Yuksel, SIGGRAPH 2025,
// https://graphics.cs.utah.edu/research/projects/avbd/), structured after the authors' MIT
// avbd-demo3d. Each substep: collide, warm-start constraints, predict bodies, then a fixed number
// of Gauss-Seidel sweeps of per-body 6x6 solves (primal) each followed by a multiplier update
// (dual), then BDF1 velocities and the connection ratings check.
//
// Determinism: fixed substep and iteration count, bodies and constraints always visited in
// creation / sorted-key order, no Math.random, no clock, and no transcendental functions in state.

const MAX_HULLS = 64;
const MAX_BODIES = 65536;

export function createWorld(options: WorldOptions = {}): World {
  return new PhysicsWorld(options);
}

class PhysicsWorld implements World {
  readonly params: SolverParams;
  private readonly bodyList: Body[] = [];
  private ground: Body | null = null;
  private readonly connectionList: Connection[] = [];
  private readonly manifolds = new Map<number, Manifold>();
  private activeManifolds: Manifold[] = [];
  /** live connection count per body pair; connected bodies do not collide */
  private readonly linked = new Map<number, number>();
  private robots = 0;
  private stepCount = 0;
  private readonly sys = createSystem();
  private readonly dx = new Float64Array(6);
  private readonly contactOut = createContactOut();

  constructor(options: WorldOptions) {
    const g = options.gravity ?? [0, -9.81, 0];
    this.params = defaultParams(options.dt ?? 1 / 1000, options.iterations ?? 4, vec3(g[0], g[1], g[2]));
  }

  addGround(): void {
    if (this.ground) return;
    // the ground is not in bodyList; its index only has to differ from every part's
    this.ground = new Body({
      index: MAX_BODIES - 1,
      id: 'ground',
      mass: 0,
      inertia: new Float64Array(9),
      friction: 1,
      hulls: [],
      isGround: true,
    });
  }

  addRobot(model: PhysicalModel, pose: Transform): RobotHandle {
    const robotId = `r${this.robots++}`;
    const poseRot = quatNormalize(quat(...pose.rotation));
    const posePos = vec3(...pose.position);
    const toWorld = (p: readonly number[], out: Vec3): Vec3 => {
      rotate(out, poseRot, vec3(p[0], p[1], p[2]));
      out[0] = out[0]! + posePos[0]!;
      out[1] = out[1]! + posePos[1]!;
      out[2] = out[2]! + posePos[2]!;
      return out;
    };

    const byPart = new Map<string, Body>();
    const parts: string[] = [];
    for (const part of model.parts) {
      if (this.bodyList.length >= MAX_BODIES - 1) throw new Error(`a world holds at most ${MAX_BODIES} bodies`);
      if (part.collision.length > MAX_HULLS) throw new Error(`part ${part.id}: at most ${MAX_HULLS} collision hulls`);
      const com = part.mass.com;
      const hulls = part.collision.map((h) => buildHull(h.vertices.map((v) => [v[0] - com[0], v[1] - com[1], v[2] - com[2]])));
      const [ixx, iyy, izz, ixy, ixz, iyz] = part.mass.inertia;
      const inertia: Mat3 = new Float64Array([ixx, ixy, ixz, ixy, iyy, iyz, ixz, iyz, izz]);
      const body = new Body({
        index: this.bodyList.length,
        id: `${robotId}/${part.id}`,
        mass: part.mass.mass,
        inertia,
        friction: MATERIALS[part.material]?.friction ?? 0.5,
        hulls,
      });
      // the body frame sits at the COM with the design-frame axes, carried by the pose
      toWorld(com, body.pos);
      body.rot.set(poseRot);
      this.bodyList.push(body);
      byPart.set(part.id, body);
      parts.push(body.id);
    }

    for (const c of model.connections) this.addConnection(robotId, c, byPart, toWorld);
    // actuators, power and controls belong to later solver lanes and are ignored here
    return { id: robotId, parts };
  }

  private addConnection(
    robotId: string,
    c: ModelConnection,
    byPart: Map<string, Body>,
    toWorld: (p: readonly number[], out: Vec3) => Vec3,
  ): void {
    const a = byPart.get(c.a), b = byPart.get(c.b);
    if (!a || !b) throw new Error(`connection ${c.id}: unknown part ${a ? c.b : c.a}`);
    if (a === b) throw new Error(`connection ${c.id}: joins part ${c.a} to itself`);
    const origin = toWorld([0, 0, 0], vec3());
    const worldDir = (d: readonly number[]): Vec3 => {
      const out = toWorld(d, vec3());
      for (let i = 0; i < 3; i++) out[i] = out[i]! - origin[i]!;
      return normalize3(out, out);
    };

    let kind: JointKind = 'fixed';
    let anchor: Vec3;
    let axis: Vec3 | null = null;
    let limits: readonly [number, number] | undefined;
    let rating: Rating = { kind: 'none' };
    switch (c.kind) {
      case 'bolt': {
        anchor = toWorld(c.position, vec3());
        axis = worldDir(c.axis);
        // orient the bolt axis from B's side to A's side so tension reads positive
        const side = (a.pos[0]! - b.pos[0]!) * axis[0]! + (a.pos[1]! - b.pos[1]!) * axis[1]! + (a.pos[2]! - b.pos[2]!) * axis[2]!;
        if (side < 0) for (let i = 0; i < 3; i++) axis[i] = -axis[i]!;
        rating = { kind: 'bolt', rating: c.rating };
        break;
      }
      case 'weld': {
        if (c.path.length === 0) throw new Error(`weld ${c.id}: empty path`);
        const sum = [0, 0, 0];
        for (const p of c.path) for (let i = 0; i < 3; i++) sum[i]! += p[i]!;
        anchor = toWorld(sum.map((s) => s / c.path.length), vec3());
        const first = c.path[0]!, last = c.path[c.path.length - 1]!;
        const seam = [last[0] - first[0], last[1] - first[1], last[2] - first[2]];
        axis = seam[0]! ** 2 + seam[1]! ** 2 + seam[2]! ** 2 > 0 ? worldDir(seam) : null;
        rating = { kind: 'weld', rating: c.rating };
        break;
      }
      case 'joint': {
        kind = c.joint === 'bearing' ? 'hinge' : c.joint;
        anchor = toWorld(c.anchor, vec3());
        if (c.axis) axis = worldDir(c.axis);
        else if (kind === 'hinge' || kind === 'slider') throw new Error(`joint ${c.id}: a ${c.joint} needs an axis`);
        limits = c.limits;
        break;
      }
    }
    const joint = new Joint({ kind, a, b, anchor, axis: axis ?? undefined, limits, params: this.params });
    this.connectionList.push(new Connection(`${robotId}/${c.id}`, joint, rating, axis));
    a.joints.push(joint);
    b.joints.push(joint);
    const key = pairKey(a, b);
    this.linked.set(key, (this.linked.get(key) ?? 0) + 1);
  }

  step(): void {
    const p = this.params;
    const dt = p.dt, h2 = dt * dt;
    const g = p.gravity;
    const gLen = Math.sqrt(g[0]! * g[0]! + g[1]! * g[1]! + g[2]! * g[2]!);
    this.stepCount++;

    this.collide();

    // warm-start constraints at x⁻ (Eq. 19); per-body lists in deterministic order
    for (const body of this.bodyList) {
      body.constraints.length = 0;
      for (const j of body.joints) body.constraints.push(j);
    }
    for (const c of this.connectionList) if (!c.broken) c.joint.prepare();
    const live: Manifold[] = [];
    for (const m of this.activeManifolds) {
      if (!m.prepare()) continue;
      live.push(m);
      m.a.constraints.push(m);
      if (!m.b.isStatic) m.b.constraints.push(m);
    }
    this.activeManifolds = live;

    // predict: inertial target y (Eq. 2) and the adaptive warm start of VBD (Chen et al. 2024)
    for (const body of this.bodyList) {
      body.pos0.set(body.pos);
      body.rot0.set(body.rot);
      if (body.isStatic) continue;
      body.updateWorldInertia();
      for (let i = 0; i < 3; i++) body.inertialPos[i] = body.pos[i]! + dt * body.vel[i]! + h2 * g[i]!;
      quatAddRotation(body.inertialRot, body.rot, body.angVel, dt);
      let w = 0;
      if (gLen > 0) {
        let along = 0;
        for (let i = 0; i < 3; i++) along += ((body.vel[i]! - body.prevVel[i]!) / dt) * (g[i]! / gLen);
        w = along / gLen;
        w = w > 1 ? 1 : w > 0 ? w : 0;
      }
      for (let i = 0; i < 3; i++) body.pos[i] = body.pos[i]! + dt * body.vel[i]! + w * h2 * g[i]!;
      quatAddRotation(body.rot, body.rot, body.angVel, dt);
    }

    for (let it = 0; it < p.iterations; it++) {
      for (const body of this.bodyList) if (!body.isStatic) this.solveBody(body, h2);
      for (const c of this.connectionList) if (!c.broken) c.joint.dual();
      for (const m of this.activeManifolds) m.dual();
    }

    // BDF1 velocities
    const inv = 1 / dt;
    for (const body of this.bodyList) {
      if (body.isStatic) continue;
      body.prevVel.set(body.vel);
      for (let i = 0; i < 3; i++) body.vel[i] = (body.pos[i]! - body.pos0[i]!) * inv;
      quatDiff(body.angVel, body.rot, body.rot0);
      for (let i = 0; i < 3; i++) body.angVel[i] = body.angVel[i]! * inv;
    }

    // ratings are checked after the solve; a connection that fails stops acting next substep
    for (const c of this.connectionList) {
      if (!c.measure()) continue;
      const j = c.joint;
      j.a.joints = j.a.joints.filter((x) => x !== j);
      j.b.joints = j.b.joints.filter((x) => x !== j);
      const key = pairKey(j.a, j.b);
      this.linked.set(key, this.linked.get(key)! - 1);
    }
  }

  /** One primal step for one body: assemble and solve its 6x6 system, apply the update (Eq. 4-6). */
  private solveBody(body: Body, h2: number): void {
    const { lhs, rhs } = this.sys;
    lhs.fill(0);
    const m = body.mass / h2;
    lhs[0] = m;
    lhs[7] = m;
    lhs[14] = m;
    const I = body.inertiaWorld;
    for (let r = 0; r < 3; r++) for (let c = 0; c <= r; c++) lhs[(3 + r) * 6 + 3 + c] = I[r * 3 + c]! / h2;
    for (let i = 0; i < 3; i++) rhs[i] = m * (body.pos[i]! - body.inertialPos[i]!);
    quatDiff(D, body.rot, body.inertialRot);
    for (let r = 0; r < 3; r++) rhs[3 + r] = (I[r * 3]! * D[0]! + I[r * 3 + 1]! * D[1]! + I[r * 3 + 2]! * D[2]!) / h2;

    const cs: Constraint[] = body.constraints;
    for (let k = 0; k < cs.length; k++) cs[k]!.stamp(body, this.sys);

    const dx = this.dx;
    solveSystem(this.sys, dx);
    body.pos[0] = body.pos[0]! + dx[0]!;
    body.pos[1] = body.pos[1]! + dx[1]!;
    body.pos[2] = body.pos[2]! + dx[2]!;
    DTHETA[0] = dx[3]!;
    DTHETA[1] = dx[4]!;
    DTHETA[2] = dx[5]!;
    quatAddRotation(body.rot, body.rot, DTHETA, 1);
  }

  /**
   * Sweep-and-prune along the axis where the bodies spread most (bounding spheres), then SAT per
   * hull pair and hull vs ground; refreshes the manifold set.
   */
  private collide(): void {
    const p = this.params;
    const margin = p.margin;
    const stamp = this.stepCount;
    const out = this.contactOut;
    const bodies = this.bodyList.filter((b) => b.hulls.length > 0);
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
        if ((this.linked.get(pairKey(A0, B0)) ?? 0) > 0) continue;
        const [A, B] = A0.index < B0.index ? [A0, B0] : [B0, A0];
        refreshWorldHulls(A, stamp);
        refreshWorldHulls(B, stamp);
        for (let ha = 0; ha < A.hulls.length; ha++) {
          for (let hb = 0; hb < B.hulls.length; hb++) {
            if (collideHulls(A, ha, B, hb, margin, out) === 0) continue;
            this.manifold(A, ha, B, hb).update(out, stamp);
          }
        }
      }
    }

    const ground = this.ground;
    if (ground) {
      for (const A of this.bodyList) {
        if (A.isStatic || A.hulls.length === 0 || A.pos[1]! - A.radius > margin) continue;
        refreshWorldHulls(A, stamp);
        for (let ha = 0; ha < A.hulls.length; ha++) {
          if (collideGround(A, ha, margin, out) === 0) continue;
          this.manifold(A, ha, ground, 0).update(out, stamp);
        }
      }
    }

    const active: Manifold[] = [];
    for (const [key, m] of this.manifolds) {
      if (m.seen === stamp) active.push(m);
      else this.manifolds.delete(key);
    }
    active.sort((u, v) => u.key - v.key);
    this.activeManifolds = active;
  }

  private manifold(A: Body, ha: number, B: Body, hb: number): Manifold {
    const key = ((A.index * MAX_HULLS + ha) * MAX_BODIES + B.index) * MAX_HULLS + hb;
    let m = this.manifolds.get(key);
    if (!m) {
      m = new Manifold(A, B, key, this.params);
      this.manifolds.set(key, m);
    }
    return m;
  }

  bodies(): BodyState[] {
    return this.bodyList.map((b) => ({
      id: b.id,
      position: [b.pos[0]!, b.pos[1]!, b.pos[2]!],
      rotation: [b.rot[0]!, b.rot[1]!, b.rot[2]!, b.rot[3]!],
      linearVelocity: [b.vel[0]!, b.vel[1]!, b.vel[2]!],
      angularVelocity: [b.angVel[0]!, b.angVel[1]!, b.angVel[2]!],
    }));
  }

  connections(): ConnectionState[] {
    return this.connectionList.map((c) => ({
      id: c.id,
      axial: c.axial,
      shear: c.shear,
      utilisation: c.utilisation,
      broken: c.broken,
    }));
  }

  hash(): string {
    const h = new Fnv64();
    for (const b of this.bodyList) {
      h.floats(b.pos);
      h.floats(b.rot);
      h.floats(b.vel);
      h.floats(b.angVel);
    }
    for (const c of this.connectionList) {
      h.float(c.axial);
      h.float(c.shear);
      h.float(c.utilisation);
      h.byte(c.broken ? 1 : 0);
    }
    return h.hex();
  }
}

const D = vec3();
const DTHETA = vec3();

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

function pairKey(a: Body, b: Body): number {
  return a.index < b.index ? a.index * MAX_BODIES + b.index : b.index * MAX_BODIES + a.index;
}
