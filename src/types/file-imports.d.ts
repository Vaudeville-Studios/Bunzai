/** A native library imported `with { type: "file" }` is its path: on disk from source, inside the executable once compiled. */
declare module "*.so" {
  const path: string;
  export default path;
}

declare module "webview-bun/build/libwebview.dll" {
  const path: string;
  export default path;
}
/** Bun's file loader resolves this package export to a path in development and an embedded asset when compiled. */
declare module "@jitl/quickjs-wasmfile-release-sync/wasm" {
  const path: string;
  export default path;
}
