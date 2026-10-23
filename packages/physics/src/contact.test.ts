import type { Quat } from '@botfoundry/model';
import { describe, expect, it } from 'vitest';
import { AT_ORIGIN, boxPart, model } from './fixtures.ts';
import { createWorld } from './world.ts';

const yaw = (a: number): Quat => [0, Math.sin(a / 2), 0, Math.cos(a / 2)];
const distance = (a: readonly number[], b: readonly number[]) => Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!);

describe('contact', () => {
  it('a box resting on the ground drifts under 1 mm over 5 s', () => {
    const world = createWorld();
    world.addGround();
    world.addRobot(model('box', [boxPart('box', [0.2, 0.1, 0.3], [0, 0.05, 0])]), AT_ORIGIN);
    const start = world.bodies()[0]!.position;
    for (let i = 0; i < 5000; i++) world.step();
    const end = world.bodies()[0]!;
    expect(distance(end.position, start)).toBeLessThan(1e-3);
    expect(Math.hypot(...end.linearVelocity)).toBeLessThan(1e-3);
  });

  it('a box rotated about the vertical rests too', () => {
    const world = createWorld();
    world.addGround();
    world.addRobot(model('box', [boxPart('box', [0.2, 0.1, 0.3], [0, 0, 0])]), { position: [0.1, 0.05, -0.2], rotation: yaw(0.7) });
    const start = world.bodies()[0]!.position;
    for (let i = 0; i < 2000; i++) world.step();
    expect(distance(world.bodies()[0]!.position, start)).toBeLessThan(1e-3);
  });

  it('a dropped box lands and settles at its resting height', () => {
    const world = createWorld();
    world.addGround();
    world.addRobot(model('box', [boxPart('box', [0.1, 0.1, 0.1], [0, 0, 0])]), { position: [0, 0.3, 0], rotation: [0, 0, 0, 1] });
    for (let i = 0; i < 2000; i++) world.step();
    const b = world.bodies()[0]!;
    expect(b.position[1]).toBeCloseTo(0.05, 3);
    expect(Math.hypot(b.position[0], b.position[2])).toBeLessThan(1e-3);
  });

  it('a 5-box stack, offset and twisted, stays standing for 5 s', () => {
    const world = createWorld();
    world.addGround();
    for (let i = 0; i < 5; i++) {
      world.addRobot(model(`box${i}`, [boxPart('box', [0.1, 0.1, 0.1], [0, 0, 0])]), {
        position: [(i % 2 ? 1 : -1) * 0.003, 0.05 + 0.1005 * i, 0.002 * i],
        rotation: yaw(0.03 * i),
      });
    }
    const start = world.bodies().map((b) => b.position);
    for (let i = 0; i < 5000; i++) world.step();
    const end = world.bodies();
    for (let i = 0; i < 5; i++) {
      const p = end[i]!.position, s = start[i]!;
      expect(Math.hypot(p[0] - s[0], p[2] - s[2])).toBeLessThan(2e-3);
      expect(p[1]).toBeCloseTo(0.05 + 0.1 * i, 3);
      expect(Math.hypot(...end[i]!.linearVelocity)).toBeLessThan(1e-3);
    }
  });

  it('friction holds a box on a slope under the friction angle and lets it slide above', () => {
    // tilting gravity is the same as tilting the ground; a36 on the steel floor has μ = 0.4
    const slide = (angle: number) => {
      const world = createWorld({ gravity: [9.81 * Math.sin(angle), -9.81 * Math.cos(angle), 0] });
      world.addGround();
      world.addRobot(model('box', [boxPart('box', [0.1, 0.1, 0.1], [0, 0.05, 0])]), AT_ORIGIN);
      for (let i = 0; i < 1000; i++) world.step();
      return world.bodies()[0]!.position[0];
    };
    expect(Math.abs(slide(Math.atan(0.3)))).toBeLessThan(1e-3);
    // above the friction angle it slides with x = ½ g (sin θ − μ cos θ) t²; recover μ from x after 1 s.
    // With 4 iterations the stiffness of a saturated friction row adds a little drag (about 5 %).
    const theta = Math.atan(0.5);
    const x = slide(theta);
    const mu = (Math.sin(theta) - (2 * x) / 9.81) / Math.cos(theta);
    expect(Math.abs(mu / 0.4 - 1)).toBeLessThan(0.1);
  });
});
