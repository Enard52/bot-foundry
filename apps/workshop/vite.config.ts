import { defineConfig } from 'vite';

export default defineConfig({
  // manifold-3d ships its own .wasm loader; pre-bundling would break the relative URL of the binary
  optimizeDeps: { exclude: ['manifold-3d'] },
  build: { target: 'es2022', chunkSizeWarningLimit: 1500 },
  server: { port: 5174, strictPort: true },
});
