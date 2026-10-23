import type { Loop, Profile, V2 } from '@botfoundry/model';

// Helpers for building sketch profiles in code (samples, tests, scripts).

/** Closed straight-sided loop through the points, in order. */
export function polygonLoop(points: readonly V2[]): Loop {
  const [first, ...rest] = points;
  if (!first || rest.length < 2) throw new Error('a polygon needs at least three points');
  return { start: first, segments: [...rest.map((to) => ({ to })), { to: first }] };
}

export function rectLoop(x0: number, y0: number, x1: number, y1: number): Loop {
  return polygonLoop([[x0, y0], [x1, y0], [x1, y1], [x0, y1]]);
}

/** Full circle as two half-turn arcs (bulge 1 = 180° counter-clockwise). */
export function circleLoop(cx: number, cy: number, r: number): Loop {
  return {
    start: [cx - r, cy],
    segments: [{ to: [cx + r, cy], bulge: 1 }, { to: [cx - r, cy], bulge: 1 }],
  };
}

export function rectProfile(x0: number, y0: number, x1: number, y1: number, holes: Loop[] = []): Profile {
  return { outer: rectLoop(x0, y0, x1, y1), holes };
}

export function circleProfile(cx: number, cy: number, r: number): Profile {
  return { outer: circleLoop(cx, cy, r), holes: [] };
}
