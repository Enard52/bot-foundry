import { boltUtilisation, type BoltRating, type WeldRating } from '@botfoundry/model';
import type { Joint } from './joint.ts';
import { rotate, rotateInv, vec3, type Vec3 } from './math.ts';

/** What a connection is rated against: a bolt, a weld seam, or nothing (a plain joint). */
export type Rating = { kind: 'bolt'; rating: BoltRating } | { kind: 'weld'; rating: WeldRating } | { kind: 'none' };

const F = vec3(), AX = vec3();

/**
 * A connection from the model and the joint that realises it, with this substep's load readout.
 * Bolts and welds are fixed joints carrying a rating; they break after the solve in which their
 * utilisation reaches 1, so the substep that breaks them is still solved with them in place and no
 * impulse is released (PhysX breakable-joint semantics).
 */
export class Connection {
  readonly id: string;
  readonly joint: Joint;
  readonly rating: Rating;
  /** reference axis in body A's frame: for bolts it points from B's side to A's side */
  readonly axisA: Vec3;
  axial = 0;
  shear = 0;
  utilisation = 0;
  broken = false;

  constructor(id: string, joint: Joint, rating: Rating, axisWorld: Vec3 | null) {
    this.id = id;
    this.joint = joint;
    this.rating = rating;
    this.axisA = vec3();
    // kept in A's frame so it turns with the part
    if (axisWorld) rotateInv(this.axisA, joint.a.rot, axisWorld);
  }

  /**
   * Read the force the joint carried this substep and test the rating. Axial is along the axis,
   * positive when the connection is in tension (pulling B toward A's side); shear is the magnitude
   * across it. Returns true when the connection breaks now.
   */
  measure(): boolean {
    if (this.broken) {
      this.axial = 0;
      this.shear = 0;
      return false;
    }
    this.joint.forceOnB(F);
    rotate(AX, this.joint.a.rot, this.axisA);
    const axial = F[0]! * AX[0]! + F[1]! * AX[1]! + F[2]! * AX[2]!;
    const sx = F[0]! - axial * AX[0]!, sy = F[1]! - axial * AX[1]!, sz = F[2]! - axial * AX[2]!;
    const shear = Math.sqrt(sx * sx + sy * sy + sz * sz);
    this.axial = axial;
    this.shear = shear;
    switch (this.rating.kind) {
      case 'bolt':
        this.utilisation = boltUtilisation(this.rating.rating, axial, shear);
        break;
      case 'weld':
        // EN 1993-1-8 simplified method: the throat carries the resultant in shear, whatever its
        // direction relative to the seam
        this.utilisation = Math.sqrt(axial * axial + shear * shear) / this.rating.rating.strength;
        break;
      case 'none':
        this.utilisation = 0;
        break;
    }
    if (this.utilisation >= 1) {
      this.broken = true;
      this.joint.broken = true;
      return true;
    }
    return false;
  }
}
