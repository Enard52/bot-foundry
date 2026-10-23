// Vite resolves `?url` imports to the hashed asset URL at build time.
declare module 'manifold-3d/manifold.wasm?url' {
  const url: string;
  export default url;
}
