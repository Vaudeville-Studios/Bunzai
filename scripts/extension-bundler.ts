/** Bundles only a bounded snapshot of package files and the exact generated SDK entry. */
import { closeSync, existsSync, fstatSync, lstatSync, openSync, realpathSync, statSync, readSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep, join, extname } from "node:path";
import { assertJavaScriptSource, RELEASE_JS_LIMITS } from "../src/sandbox/javascript/limits";

const MAX_INPUTS = 130;
const MAX_INPUT_BYTES = 8_000_000;
const contained = (root: string, path: string): boolean => {
  const rel = relative(root, path);
  return rel === "" || rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
};
const sourceLoader = (path: string): "js" | "jsx" | "ts" | "tsx" => ({ ".jsx": "jsx", ".ts": "ts", ".tsx": "tsx" } as const)[extname(path)] ?? "js";

/** Read one already-resolved file through a bounded descriptor and reject changes during capture. */
function readSnapshot(path: string, maxBytes: number): string {
  const beforePath = realpathSync(path);
  const descriptor = openSync(beforePath, "r");
  try {
    const before = fstatSync(descriptor);
    if (!before.isFile() || before.size > maxBytes) throw new Error("bundle input exceeds its remaining graph byte limit");
    const bytes = Buffer.alloc(before.size + 1);
    let read = 0;
    while (read < bytes.length) {
      const count = readSync(descriptor, bytes, read, bytes.length - read, read);
      if (!count) break;
      read += count;
    }
    const after = fstatSync(descriptor);
    if (read !== before.size || after.size !== before.size || after.mtimeMs !== before.mtimeMs || realpathSync(path) !== beforePath) {
      throw new Error("bundle input changed while being read");
    }
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, read));
  } finally { closeSync(descriptor); }
}

export interface ExtensionBundleSnapshot {
  readonly root: string;
  readonly entry: string;
  readonly sdkEntry: string;
  readonly sources: ReadonlyMap<string, string>;
}

/** Capture a bounded static-import graph before Bun sees any package source. */
export function captureExtensionBundle(sourceRoot: string, entryPath: string): ExtensionBundleSnapshot {
  const root = realpathSync(sourceRoot);
  const entryCandidate = resolve(root, entryPath);
  const entry = realpathSync(entryCandidate);
  if (!contained(root, entry) || entry === root || lstatSync(entryCandidate).isSymbolicLink() || !statSync(entry).isFile()) {
    throw new Error("extension entry must be a regular file inside its source directory");
  }
  const sdkEntry = realpathSync(join(import.meta.dir, "..", "src", "extensions", "sdk", "index.ts"));
  const sources = new Map<string, string>();
  let totalBytes = 0;
  const admit = (path: string): string => {
    const real = realpathSync(path);
    if (!contained(root, real) && real !== sdkEntry) throw new Error("bundle import escapes the package and trusted SDK source");
    if (!sources.has(real)) {
      const size = statSync(real).size;
      if (sources.size >= MAX_INPUTS || totalBytes + size > MAX_INPUT_BYTES) throw new Error("bundle input graph exceeds its file or byte limit");
      const source = readSnapshot(real, MAX_INPUT_BYTES - totalBytes);
      const bytes = new TextEncoder().encode(source).byteLength;
      if (totalBytes + bytes > MAX_INPUT_BYTES) throw new Error("bundle input graph exceeds its file or byte limit");
      totalBytes += bytes;
      sources.set(real, source);
    }
    return real;
  };
  const queue = [admit(entry)];
  const visited = new Set<string>();
  const sdkImport = "bunzai-extension-sdk";
  const scanner = new Bun.Transpiler({ loader: "tsx" });
  while (queue.length) {
    const importer = queue.pop()!;
    if (visited.has(importer)) continue;
    visited.add(importer);
    for (const item of scanner.scanImports(sources.get(importer)!)) {
      if (item.kind !== "import-statement") throw new Error("dynamic and runtime require imports are not supported in extension bundles");
      if (item.path === sdkImport) { admit(sdkEntry); continue; }
      if (item.path.includes("\\") || !item.path.startsWith(".") && !isAbsolute(item.path)) {
        throw new Error("static source imports may use only relative files and the trusted SDK");
      }
      const candidate = isAbsolute(item.path) ? resolve(item.path) : resolve(dirname(importer), item.path);
      if (!contained(root, candidate)) throw new Error("bundle import escapes the package and trusted SDK source");
      if (!existsSync(candidate)) throw new Error("extension bundle imports must name an existing file explicitly");
      const resolved = admit(candidate);
      if (!visited.has(resolved)) queue.push(resolved);
    }
  }
  const sdkSource = sources.get(sdkEntry);
  if (sdkSource && /^\s*import\s+(?!type\b)/m.test(sdkSource)) throw new Error("trusted SDK entry has an unreviewed runtime dependency");
  return Object.freeze({ root, entry, sdkEntry, sources });
}

/** Bun resolves every import before loading it; only cached, prevalidated files are returned by onLoad. */
export async function bundleCapturedExtension(snapshot: ExtensionBundleSnapshot): Promise<string> {
  const { root, entry, sdkEntry, sources } = snapshot;
  const sdkImport = "bunzai-extension-sdk";
  const deny = (message: string): never => { throw new Error(message); };
  const result = await Bun.build({
    entrypoints: [entry], target: "browser", packages: "bundle", metafile: true, write: false, minify: true,
    plugins: [{ name: "bunzai-bounded-extension-inputs", setup(build) {
      build.onResolve({ filter: /.*/ }, (args) => {
        if (args.path === sdkImport) return { path: sdkEntry };
        if (!isAbsolute(args.path) && (args.path.includes("\\") || !args.path.startsWith("."))) return deny("Bun resolved an unapproved non-relative input");
        const candidate = isAbsolute(args.path) ? resolve(args.path) : resolve(args.resolveDir, args.path);
        let real: string;
        try { real = realpathSync(candidate); } catch { return deny("extension bundle import was not prevalidated"); }
        if (!contained(root, real) || !sources.has(real)) return deny("extension bundle import was not prevalidated");
        return { path: real };
      });
      build.onLoad({ filter: /.*/ }, (args) => {
        let real: string;
        try { real = realpathSync(args.path); } catch { return deny("extension bundle input changed after validation"); }
        const contents = sources.get(real);
        if (contents === undefined || !contained(root, real) && real !== sdkEntry) return deny("extension bundle input changed after validation");
        return real === sdkEntry
          ? { contents: new Bun.Transpiler({ loader: "ts", target: "browser" }).transformSync(contents), loader: "js" }
          : { contents, loader: sourceLoader(real) };
      });
    } }],
  });
  if (!result.success) throw new Error("extension source could not be bundled");
  if (!result.metafile || Object.keys(result.metafile.inputs).length > MAX_INPUTS
    || Object.values(result.metafile.inputs).some((input) => input.imports.some((item) => item.external))) {
    throw new Error("bundle contains an unresolved or over-limit runtime import");
  }
  const bundledInputs = Object.keys(result.metafile.inputs).map((path) => {
    // Bun emits cross-drive metafile paths with POSIX-relative prefixes on Windows.
    const input = process.platform === "win32" ? path.replace(/^(?:\.\.\/)+(?=[A-Za-z]:\/)/, "") : path;
    return realpathSync(resolve(input));
  });
  if (bundledInputs.some((path) => !sources.has(path))) throw new Error("bundle included an input outside the prevalidated import graph");
  const code = await result.outputs[0]?.text();
  if (code === undefined) throw new Error("Bun produced no extension bundle");
  try { assertJavaScriptSource(code); }
  catch { throw new Error(`bundled extension exceeds the ${RELEASE_JS_LIMITS.sourceBytes}-byte guest source limit`); }
  return code;
}

export async function bundleExtensionEntry(sourceRoot: string, entryPath: string): Promise<string> {
  return bundleCapturedExtension(captureExtensionBundle(sourceRoot, entryPath));
}
