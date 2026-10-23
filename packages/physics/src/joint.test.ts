import type { Connection, Quat } from '@botfoundry/model';
import { describe, expect, it } from 'vitest';
import { AT_ORIGIN, boxPart, model } from './fixtures.ts';
import { createWorld } from './world.ts';

const G = 9.81;
const aboutZ = (a: number): Quat => [0, 0, Math.sin(a / 2), Math.cos(a / 2)];

/** A rod of length L hung from a static anchor by a joint at the origin, tilted by `tilt` about z. */
function pendulum(joint: Connection, L: number, tilt: number, width = 0.02) {
  const world = createWorld();
  world.addRobot(
    model('pendulum', [
      boxPart('anchor', [0.05, 0.05, 0.05], [0, 0.025, 0], { mass: 0 }),
      boxPart('rod', [width, L, width], [0, -L / 2, 0], { mass: 1 }),
    ], [joint]),
    { position: [0, 0, 0], rotation: aboutZ(tilt) },
  );
  return world;
}

/** Times (s) at which x crosses zero going negative, linearly interpolated within a substep. */
function downCrossings(world: ReturnType<typeof createWorld>, steps: number, dt = 1e-3): number[] {
  const crossings: number[] = [];
  let prev = world.bodies()[1]!.position[0];
  for (let i = 1; i <= steps; i++) {
    world.step();
    const x = world.bodies()[1]!.position[0];
    if (prev > 0 && x <= 0) crossings.push((i - 1 + prev / (prev - x)) * dt);
    prev = x;
  }
  return crossings;
}

const hinge = (limits?: [number, number]): Connection => ({
  kind: 'joint', id: 'h', joint: 'hinge', a: 'anchor', b: 'rod', anchor: [0, 0, 0], axis: [0, 0, 1], ...(limits ? { limits } : {}),
});

describe('joints', () => {
  it("a hinge pendulum's small-angle period is within 2 % of the compound-pendulum value", () => {
    const L = 0.5, w = 0.02;
    // T = 2π √(I_pivot / (m g d)): the rod's own inertia about the pivot, d = L/2
    const iPivot = (L * L + w * w) / 12 + (L / 2) ** 2;
    const expected = 2 * Math.PI * Math.sqrt(iPivot / (G * L / 2));
    const crossings = downCrossings(pendulum(hinge(), L, 0.05, w), 8000);
    expect(crossings.length).toBeGreaterThanOrEqual(5);
    const measured = (crossings[crossings.length - 1]! - crossings[0]!) / (crossings.length - 1);
    expect(Math.abs(measured / expected - 1)).toBeLessThan(0.02);
  });

  it('a hinge keeps the rod in its plane and the pivot on its anchor', () => {
    const world = pendulum(hinge(), 0.5, 0.4);
    for (let i = 0; i < 3000; i++) world.step();
    const rod = world.bodies()[1]!;
    expect(Math.abs(rod.position[2])).toBeLessThan(1e-6);
    // the COM stays L/2 from the pivot
    expect(Math.hypot(rod.position[0], rod.position[1])).toBeCloseTo(0.25, 5);
  });

  it('a hinge limit stops the swing and holds the rod against the stop', () => {
    // released 0.3 rad from vertical; limits are measured from that pose, so the lower stop at
    // −0.1 rad holds the rod at 0.2 rad from vertical where it would otherwise swing to −0.3
    const angle = (world: ReturnType<typeof createWorld>) => {
      const p = world.bodies()[1]!.position;
      return Math.atan2(p[0], -p[1]);
    };
    const limited = pendulum(hinge([-0.1, 0.1]), 0.5, 0.3);
    const free = pendulum(hinge(), 0.5, 0.3);
    let minLimited = Infinity, minFree = Infinity;
    for (let i = 0; i < 3000; i++) {
      limited.step();
      free.step();
      minLimited = Math.min(minLimited, angle(limited));
      minFree = Math.min(minFree, angle(free));
    }
    expect(minFree).toBeLessThan(-0.29);
    expect(minLimited).toBeGreaterThan(0.2 - 0.005);
    expect(angle(limited)).toBeCloseTo(0.2, 3);
  });

  it('a ball joint pendulum swings in any plane with its period', () => {
    const L = 0.5, w = 0.02;
    const ball: Connection = { kind: 'joint', id: 'b', joint: 'ball', a: 'anchor', b: 'rod', anchor: [0, 0, 0] };
    const crossings = downCrossings(pendulum(ball, L, 0.05, w), 6000);
    const iPivot = (L * L + w * w) / 12 + (L / 2) ** 2;
    const expected = 2 * Math.PI * Math.sqrt(iPivot / (G * L / 2));
    const measured = (crossings[crossings.length - 1]! - crossings[0]!) / (crossings.length - 1);
    expect(Math.abs(measured / expected - 1)).toBeLessThan(0.02);
  });

  it('a slider lets a block fall along its axis and nowhere else, and stops it at its limit', () => {
    const world = createWorld();
    world.addRobot(
      model('slider', [
        boxPart('rail', [0.05, 0.05, 0.05], [0, 1, 0], { mass: 0 }),
        boxPart('carriage', [0.05, 0.05, 0.05], [0, 0.9, 0], { mass: 2 }),
      ], [{ kind: 'joint', id: 's', joint: 'slider', a: 'rail', b: 'carriage', anchor: [0, 0.9, 0], axis: [1, -1, 0], limits: [-1, 0.2] }]),
      AT_ORIGIN,
    );
    for (let i = 0; i < 1500; i++) world.step();
    const c = world.bodies()[1]!;
    // along (1, −1, 0)/√2 by at most 0.2 m: x = 0.2/√2, y = 0.9 − 0.2/√2
    expect(c.position[0]).toBeCloseTo(0.2 / Math.SQRT2, 3);
    expect(c.position[1]).toBeCloseTo(0.9 - 0.2 / Math.SQRT2, 3);
    expect(Math.abs(c.position[2])).toBeLessThan(1e-6);
    expect(Math.hypot(...c.angularVelocity)).toBeLessThan(1e-3);
  });

  it('a fixed joint holds a cantilever without sagging', () => {
    const world = createWorld();
    world.addRobot(
      model('cantilever', [
        boxPart('wall', [0.1, 0.1, 0.1], [0, 1, 0], { mass: 0 }),
        boxPart('arm', [0.5, 0.02, 0.02], [0.3, 1, 0], { mass: 3 }),
      ], [{ kind: 'joint', id: 'f', joint: 'fixed', a: 'wall', b: 'arm', anchor: [0.05, 1, 0] }]),
      AT_ORIGIN,
    );
    for (let i = 0; i < 2000; i++) world.step();
    const arm = world.bodies()[1]!;
    expect(arm.position[1]).toBeCloseTo(1, 4);
    const c = world.connections()[0]!;
    expect(c.utilisation).toBe(0);
    expect(c.broken).toBe(false);
  });
});
