import type { Loop, Profile, V2 } from '@botfoundry/model';
import { sampleLoop } from './arc.ts';

/** Even-odd point-in-polygon test. */
export function pointInPolygon(ring: readonly V2[], p: V2): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i] as V2, b = ring[j] as V2;
    if (a[1] > p[1] !== b[1] > p[1] && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}

export function polygonArea(ring: readonly V2[]): number {
  let a = 0;
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i] as V2, q = ring[(i + 1) % ring.length] as V2;
    a += p[0] * q[1] - q[0] * p[1];
  }
  return Math.abs(a / 2);
}

/**
 * Turn the closed loops of a sketch into profiles. A loop nested inside an odd number of other
 * loops is a hole of the smallest loop around it; an even depth starts a new outer boundary, so
 * an island inside a hole becomes a profile of its own.
 */
export function loopsToProfiles(loops: readonly Loop[]): Profile[] {
  const rings = loops.map((l) => sampleLoop(l));
  const areas = rings.map(polygonArea);
  const containers = rings.map((ring, i) => {
    const found: number[] = [];
    rings.forEach((other, j) => {
      if (i === j || areas[j] as number <= (areas[i] as number)) return;
      if (ring.every((p) => pointInPolygon(other, p))) found.push(j);
    });
    return found.sort((a, b) => (areas[a] as number) - (areas[b] as number));
  });
  const profiles: Profile[] = [];
  const profileOf = new Map<number, Profile>();
  const order = loops.map((_, i) => i).sort((a, b) => (containers[a] as number[]).length - (containers[b] as number[]).length);
  for (const i of order) {
    const chain = containers[i] as number[];
    if (chain.length % 2 === 0) {
      const profile: Profile = { outer: loops[i] as Loop, holes: [] };
      profiles.push(profile);
      profileOf.set(i, profile);
    } else {
      const parent = profileOf.get((chain[0] as number));
      // the immediate container is an outer loop only when its own depth is even
      const owner = parent ?? profileOf.get(chain.find((c) => profileOf.has(c)) as number);
      owner?.holes.push(loops[i] as Loop);
    }
  }
  return profiles;
}

export interface SegmentHit {
  loop: number;
  segment: number;
  from: V2;
  to: V2;
  distance: number;
}

/** Closest straight edge (arcs count as their chord) of the loops to a point, or null when there are none. */
export function nearestEdge(loops: readonly Loop[], p: V2): SegmentHit | null {
  let best: SegmentHit | null = null;
  loops.forEach((loop, li) => {
    let from = loop.start;
    loop.segments.forEach((seg, si) => {
      const d = distanceToSegment(p, from, seg.to);
      if (!best || d < best.distance) best = { loop: li, segment: si, from, to: seg.to, distance: d };
      from = seg.to;
    });
  });
  return best;
}

export function distanceToSegment(p: V2, a: V2, b: V2): number {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  const t = len2 < 1e-24 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

/** All loops of all profiles of a sketch, outer first. */
export function profileLoops(profiles: readonly Profile[]): Loop[] {
  return profiles.flatMap((p) => [p.outer, ...p.holes]);
}

/** Rectangle corners as a closed loop. */
export function rectangleLoop(a: V2, b: V2): Loop {
  const [x0, x1] = [Math.min(a[0], b[0]), Math.max(a[0], b[0])];
  const [y0, y1] = [Math.min(a[1], b[1]), Math.max(a[1], b[1])];
  return { start: [x0, y0], segments: [{ to: [x1, y0] }, { to: [x1, y1] }, { to: [x0, y1] }, { to: [x0, y0] }] };
}

/** Full circle as two half-turn arcs. */
export function circleAt(center: V2, radius: number): Loop {
  return {
    start: [center[0] - radius, center[1]],
    segments: [{ to: [center[0] + radius, center[1]], bulge: 1 }, { to: [center[0] - radius, center[1]], bulge: 1 }],
  };
}
