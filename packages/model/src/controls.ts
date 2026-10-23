import type { Id } from './geometry.ts';

// The control graph: inputs, blocks and outputs wired together. Every signal is a number in -1..1
// (outputs clamp to that range). Humans, AI pilots and scripts all drive a robot through the same
// named inputs, so nobody gets a privileged path to the actuators.

export type ControlNode =
  | { id: Id; kind: 'input'; name: string }
  | { id: Id; kind: 'curve'; deadzone: number; expo: number; invert: boolean }
  | { id: Id; kind: 'mix'; weights: number[] }
  | { id: Id; kind: 'rate-limit'; perSecond: number }
  | { id: Id; kind: 'toggle' }
  | {
      id: Id; kind: 'pid';
      kp: number; ki: number; kd: number;
      /** derivative low-pass time constant, s */
      derivativeFilter: number;
      outMin: number; outMax: number;
    }
  | { id: Id; kind: 'sensor'; component: Id; quantity: 'speed' | 'angle' | 'rate' | 'current' };

export interface ControlOutput {
  /** a speed controller or actuator component instance */
  component: Id;
  /** which control node drives it */
  from: Id;
}

/** Named inputs a pilot can drive, e.g. "drive", "turn", "weapon". Bindings to keys and axes live in the app. */
export interface ControlGraph {
  nodes: ControlNode[];
  /** edge from one node's output to another node's input slot */
  edges: { from: Id; to: Id; slot: number }[];
  outputs: ControlOutput[];
}

export const EMPTY_CONTROLS: ControlGraph = { nodes: [], edges: [], outputs: [] };
