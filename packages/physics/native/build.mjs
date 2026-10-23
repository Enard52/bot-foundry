// Rebuilds wasm/solver.wasm from this crate: `pnpm --filter @botfoundry/physics build:wasm`.
// Needs a Rust toolchain with the wasm32-unknown-unknown target; no other tools.
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const crate = dirname(fileURLToPath(import.meta.url));
const out = join(crate, '..', 'wasm', 'solver.wasm');
const built = join(crate, 'target', 'wasm32-unknown-unknown', 'release', 'botfoundry_solver.wasm');

// simd128 is the 128-bit WebAssembly SIMD every current browser and Node since 16 runs
const res = spawnSync('cargo', ['build', '--release', '--locked', '--target', 'wasm32-unknown-unknown'], {
  cwd: crate,
  stdio: 'inherit',
  env: { ...process.env, RUSTFLAGS: '-C target-feature=+simd128' },
});
if (res.error) throw res.error;
if (res.status !== 0) process.exit(res.status ?? 1);
mkdirSync(dirname(out), { recursive: true });
copyFileSync(built, out);
console.log(`wrote ${out} (${statSync(out).size} bytes)`);
