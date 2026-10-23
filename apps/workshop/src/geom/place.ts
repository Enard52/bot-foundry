import type { Quat, Transform, V3 } from '@botfoundry/model';

/**
 * Pose for a part dropped on a surface: its local +z (the mount face normal in the catalog) is
 * turned onto the surface normal, so the mount face lies on the surface and the part stands out of it.
 * Shortest-arc quaternion from (0, 0, 1) to the normal (Stan Melax, "The shortest arc quaternion").
 */
export function placementPose(point: V3, normal: V3): Transform {
  const l = Math.hypot(normal[0], normal[1], normal[2]) || 1;
  const nx = normal[0] / l, ny = normal[1] / l, nz = normal[2] / l;
  let q: Quat;
  if (nz < -0.999999) {
    q = [1, 0, 0, 0];
  } else {
    // cross((0,0,1), n) = (-ny, nx, 0); w = 1 + dot
    const w = 1 + nz;
    const m = Math.hypot(-ny, nx, 0, w);
    q = [-ny / m, nx / m, 0, w / m];
  }
  return { position: [point[0], point[1], point[2]], rotation: q };
}

/** Rotate a vector by a unit quaternion. */
export function rotateVector(q: Quat, v: V3): V3 {
  const [x, y, z, w] = q;
  const tx = 2 * (y * v[2] - z * v[1]);
  const ty = 2 * (z * v[0] - x * v[2]);
  const tz = 2 * (x * v[1] - y * v[0]);
  return [
    v[0] + w * tx + (y * tz - z * ty),
    v[1] + w * ty + (z * tx - x * tz),
    v[2] + w * tz + (x * ty - y * tx),
  ];
}
