import Module from 'manifold-3d';
import type { ManifoldToplevel } from 'manifold-3d';

let loading: Promise<ManifoldToplevel> | undefined;

const isNode = (): boolean => {
  const proc = (globalThis as { process?: { versions?: { node?: string } } }).process;
  return typeof proc?.versions?.node === 'string';
};

/**
 * Load manifold-3d once. Node (Vitest, the bench) lets the module find its own .wasm next to
 * manifold.js; a bundled browser build needs the asset URL, which Vite resolves from the `?url`
 * import below. The dynamic import is never reached under Node.
 */
export function loadManifold(): Promise<ManifoldToplevel> {
  loading ??= (async () => {
    let wasm: ManifoldToplevel;
    if (isNode()) {
      wasm = await Module();
    } else {
      const { default: url } = await import('manifold-3d/manifold.wasm?url');
      wasm = await Module({ locateFile: () => url });
    }
    wasm.setup();
    return wasm;
  })();
  return loading;
}
