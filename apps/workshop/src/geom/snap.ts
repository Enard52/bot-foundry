import type { V2 } from '@botfoundry/model';

export type SnapKind = 'endpoint' | 'grid' | 'none';

export interface SnapResult {
  point: V2;
  kind: SnapKind;
}

export interface SnapOptions {
  /** grid pitch, m; 0 disables the grid */
  grid: number;
  /** points the cursor locks onto when within `radius` */
  endpoints: readonly V2[];
  /** capture distance for endpoints, m (a few pixels at the current zoom) */
  radius: number;
}

/** Grid steps for the sketcher: 1 mm, or 5 mm with Shift. */
export const GRID_FINE = 0.001;
export const GRID_COARSE = 0.005;

export function snapPoint(raw: V2, opts: SnapOptions): SnapResult {
  let best: V2 | null = null;
  let bestD = opts.radius;
  for (const e of opts.endpoints) {
    const d = Math.hypot(e[0] - raw[0], e[1] - raw[1]);
    if (d <= bestD) {
      best = e;
      bestD = d;
    }
  }
  if (best) return { point: best, kind: 'endpoint' };
  if (opts.grid > 0) {
    const g = opts.grid;
    return { point: [Math.round(raw[0] / g) * g, Math.round(raw[1] / g) * g], kind: 'grid' };
  }
  return { point: raw, kind: 'none' };
}

export interface TypedInput {
  /** m */
  length: number;
  /** rad from the sketch u axis, when given */
  angle?: number;
}

/**
 * Parse what the user typed while drawing a segment. Lengths are millimetres; "25" is a length
 * along the cursor direction and "25,45" (or "25<45") adds an angle in degrees from the u axis.
 */
export function parseTyped(text: string): TypedInput | null {
  const m = /^\s*(-?\d*\.?\d+)\s*(?:[,<]\s*(-?\d*\.?\d+))?\s*$/.exec(text);
  if (!m) return null;
  const length = Number(m[1]) / 1000;
  if (!Number.isFinite(length) || length === 0) return null;
  return m[2] === undefined ? { length } : { length, angle: (Number(m[2]) * Math.PI) / 180 };
}

/** Two numbers in millimetres, for rectangle width and height. */
export function parsePair(text: string): [number, number] | null {
  const m = /^\s*(-?\d*\.?\d+)\s*[,x×]\s*(-?\d*\.?\d+)\s*$/.exec(text);
  if (!m) return null;
  const a = Number(m[1]) / 1000, b = Number(m[2]) / 1000;
  return a !== 0 && b !== 0 ? [a, b] : null;
}
