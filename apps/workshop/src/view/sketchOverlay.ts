import * as THREE from 'three';
import type { Design } from '@botfoundry/model';
import type { Selection } from '../state/store.ts';
import { clearGroup, loopLine } from './lines.ts';
import { COLORS, type Viewport } from './viewport.ts';

/** Draws the outlines of the design's sketches in the 3D view; the selected sketch is brighter. */
export class SketchOverlay {
  private readonly group = new THREE.Group();
  private readonly vp: Viewport;

  constructor(vp: Viewport) {
    this.vp = vp;
    vp.scene.add(this.group);
  }

  update(design: Design, selection: Selection, visible: boolean): void {
    clearGroup(this.group);
    this.group.visible = visible;
    if (!visible) return this.vp.requestRender();
    for (const sketch of design.sketches) {
      const selected = selection.kind === 'sketch' && selection.id === sketch.id;
      for (const profile of sketch.profiles) {
        for (const loop of [profile.outer, ...profile.holes]) {
          this.group.add(loopLine(sketch.plane, loop, selected ? COLORS.amber : 0xb98a2e, selected ? 1 : 0.55));
        }
      }
    }
    this.vp.requestRender();
  }
}
