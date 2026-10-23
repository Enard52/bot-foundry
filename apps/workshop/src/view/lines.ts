import * as THREE from 'three';
import type { Loop, Plane, V2 } from '@botfoundry/model';
import { sampleLoop } from '../geom/arc.ts';
import { planeBasis, planeToWorld } from '../geom/plane.ts';

// Line helpers shared by the sketch overlay and the sketch tool. Lines ignore depth so a sketch
// stays visible through the bodies it will cut.

export function lineMaterial(color: number, opacity = 1): THREE.LineBasicMaterial {
  return new THREE.LineBasicMaterial({ color, transparent: true, opacity, depthTest: false });
}

export function polyline(plane: Plane, pts: readonly V2[], color: number, opacity = 1): THREE.Line {
  const verts = pts.flatMap((p) => planeToWorld(plane, p));
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  const line = new THREE.Line(geo, lineMaterial(color, opacity));
  line.renderOrder = 10;
  line.raycast = () => {};
  return line;
}

export function loopLine(plane: Plane, loop: Loop, color: number, opacity = 1): THREE.Line {
  return polyline(plane, sampleLoop(loop), color, opacity);
}

export function pointMarkers(plane: Plane, pts: readonly V2[], color: number, size = 6): THREE.Points {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pts.flatMap((p) => planeToWorld(plane, p)), 3));
  const mat = new THREE.PointsMaterial({ color, size, sizeAttenuation: false, depthTest: false, transparent: true });
  const points = new THREE.Points(geo, mat);
  points.renderOrder = 11;
  points.raycast = () => {};
  return points;
}

/** Remove and free everything in a group. */
export function clearGroup(group: THREE.Object3D): void {
  for (const child of [...group.children]) {
    group.remove(child);
    child.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose();
      const mat = m.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
      else mat?.dispose();
    });
  }
}

export { planeBasis };
