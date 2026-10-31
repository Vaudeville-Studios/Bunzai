/** A native library imported `with { type: "file" }` is its path: on disk from source, inside the executable once compiled. */
declare module "*.so" {
  const path: string;
  export default path;
}

declare module "webview-bun/build/libwebview.dll" {
  const path: string;
  export default path;
}
