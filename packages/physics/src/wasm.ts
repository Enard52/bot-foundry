// Loads the WebAssembly solver core (wasm/solver.wasm, built from native/) once per process.
// Node (Vitest, the bench) reads the file next to the package; a bundled browser build fetches the
// asset URL that Vite resolves from the `?url` import below, which is never reached under Node.

export interface SolverExports {
  memory: WebAssembly.Memory;
  world_new(): number;
  world_free(w: number): void;
  /** 0, or an ERR_* status code (see ABI_ERRORS in wasm-world.ts) with nothing changed */
  world_reserve(w: number, bodies: number, joints: number, manifolds: number, hulls: number, verts: number, faces: number, faceVerts: number, edges: number, dirs: number): number;
  world_version(w: number): number;
  world_caps(w: number): number;
  world_layout(w: number): number;
  world_layout_signature(): number;
  world_layout_signature_len(): number;
  world_add_ground(w: number): void;
  /** 0, or an ERR_* status code (see ABI_ERRORS in wasm-world.ts) with no substep taken */
  world_step(w: number, bodies: number, joints: number): number;
}

let loading: Promise<SolverExports> | undefined;
let loaded: SolverExports | undefined;

const isNode = (): boolean => {
  const proc = (globalThis as { process?: { versions?: { node?: string } } }).process;
  return typeof proc?.versions?.node === 'string';
};

async function wasmBytes(): Promise<BufferSource> {
  if (isNode()) {
    // a computed specifier keeps bundlers and the DOM-only type check away from Node's fs
    const fs = 'node:fs/promises';
    const { readFile } = (await import(/* @vite-ignore */ fs)) as { readFile(path: URL): Promise<Uint8Array<ArrayBuffer>> };
    return readFile(new URL('../wasm/solver.wasm', import.meta.url));
  }
  const { default: url } = await import('../wasm/solver.wasm?url');
  const res = await fetch(url);
  if (!res.ok) throw new Error(`solver.wasm: HTTP ${res.status}`);
  return res.arrayBuffer();
}

/** Load and instantiate the WebAssembly solver; createWorld({ backend: 'wasm' }) needs it first. */
export function loadWasmSolver(): Promise<void> {
  loading ??= (async () => {
    const { instance } = await WebAssembly.instantiate(await wasmBytes(), {});
    // a plain copy of the exports object, so a profiler can wrap single calls
    loaded = { ...instance.exports } as unknown as SolverExports;
    return loaded;
  })();
  return loading.then(() => undefined);
}

/** The loaded solver exports; throws if loadWasmSolver has not finished. */
export function wasmSolver(): SolverExports {
  if (!loaded) throw new Error("the WebAssembly solver is not loaded: await loadWasmSolver() before createWorld({ backend: 'wasm' })");
  return loaded;
}
