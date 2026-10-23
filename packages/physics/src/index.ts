import type { Id, PhysicalModel, Quat, Transform, V3 } from '@botfoundry/model';

// Public API of the solver. Deterministic: the same inputs in the same order give bit-identical states.

export interface WorldOptions {
  /** fixed substep, s; default 1/1000 */
  dt?: number;
  /** solver iterations per substep; default 4 */
  iterations?: number;
  gravity?: V3;
  /**
   * 'ts' (default) runs the reference solver in TypeScript; 'wasm' runs the same solver in
   * WebAssembly, several times faster and bit-identical, after `await loadWasmSolver()`.
   */
  backend?: 'ts' | 'wasm';
}

export interface BodyState {
  id: Id;
  position: V3;
  rotation: Quat;
  linearVelocity: V3;
  angularVelocity: V3;
}

export interface ConnectionState {
  id: Id;
  /** force carried this substep, N, split along and across the connection axis */
  axial: number;
  shear: number;
  /** utilisation against its rating; ≥ 1 means it failed */
  utilisation: number;
  broken: boolean;
}

export interface RobotHandle {
  id: Id;
  parts: Id[];
}

export interface World {
  /** add a compiled robot at a pose; returns handles to its parts */
  addRobot(model: PhysicalModel, pose: Transform): RobotHandle;
  /** static arena geometry: an infinite ground plane at y = 0 for now */
  addGround(): void;
  /** advance one fixed substep */
  step(): void;
  bodies(): BodyState[];
  connections(): ConnectionState[];
  /** stable hash of the full state, for determinism tests and desync detection */
  hash(): string;
}

export { createWorld } from './world.ts';
export { loadWasmSolver } from './wasm.ts';
