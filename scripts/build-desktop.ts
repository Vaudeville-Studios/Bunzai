/**
 * Build the native desktop app for this host: Bunzai.exe on Windows, bunzai-<os>-<arch> elsewhere.
 * 1. Bake the UI assets (index/tokens/boot + every discovered app bundle + manifests) into
 *    src/generated/packaged-assets.ts.
 * 2. Bake a STATIC format registry into src/generated/packaged-formats.ts (a compiled binary cannot
 *    glob; the generator preserves drop-in truth by regenerating from the folder scan every build).
 * 3. bun build --compile src/desktop.ts -> dist/Bunzai.exe with the bunny-b icon, console hidden.
 * Run: bun run scripts/build-desktop.ts
 */
import { mkdir } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { docsAssetMime, parseDocsIndex, resolveDocPage } from "../src/ui/docs-corpus";
import type { DocFigure, PackagedDocAsset } from "../src/ui/docs-types";
import { ICON_FILES } from "../src/ui/assets";
import { FONT_FILES } from "../src/ui/theme/fonts";
import { bundleBrowser, PROD_REACT_DEFINE, VENDOR_SPECS, type BundleOptions } from "./ui-bundle";
import { bakeFormatRegistry } from "./format-bake";
import { exampleThemeInventory, themeInventory } from "../src/extensions/theme-inventory";
import { inspectThemePackage } from "../src/extensions/theme-contract";
import { bakeSidecar, SIDECAR_PLACEHOLDER } from "./sidecar-bake";

const root = fileURLToPath(new URL("..", import.meta.url));
const uiDir = join(root, "src", "ui");
const genDir = join(root, "src", "generated");
await mkdir(genDir, { recursive: true });

// Release knobs: --cli-targets=bun-linux-x64,... compiles the CLI (same bake) per target;
// --no-desktop skips the host's native desktop app; native window libraries are host-specific.
const cliTargets = (process.argv.find((a) => a.startsWith("--cli-targets="))?.split("=")[1] ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const skipDesktop = process.argv.includes("--no-desktop");
const desktopOutfile = process.argv.find((a) => a.startsWith("--desktop-outfile="))?.slice("--desktop-outfile=".length);
if (desktopOutfile !== undefined) {
  const outputPath = resolve(root, desktopOutfile);
  const outputRelative = relative(root, outputPath);
  if (!desktopOutfile || isAbsolute(desktopOutfile) || outputRelative === ".." || outputRelative.startsWith(`..${sep}`) || isAbsolute(outputRelative)) {
    throw new Error("--desktop-outfile must be a non-empty relative path inside the repository");
  }
}
// --kit compiles the Kit terminal app for THIS runner's own platform. Unlike the CLI it cannot be
// cross-compiled: @opentui ships a native rendering library per platform, and a --target build fails
// to resolve the one it is not running on. So Kit is built where it will run, on each OS's runner.
const buildKit = process.argv.includes("--kit");

// The bake ships production React: minified, dev-only
// warnings and the `.development` build compiled away. `bun run dev` and its own bundling in
// src/ui/server-static.ts are untouched - this affects only what scripts/build-desktop.ts bakes.
const PROD: BundleOptions = { minify: true, define: PROD_REACT_DEFINE };

// -- 1. UI assets -----------------------------------------------------------------------------------

/** The react family stays OUT of every app/boot bundle; the page's import map resolves these to
 * the single /vendor copies (one React per page - two copies crash hooks with a null dispatcher). */
/** name -> entry stub + externals. One family bundle (react + both jsx runtimes inlined against a
 * single React copy - Bun's external "react" also externalizes react/* subpaths, so separate
 * runtime stubs self-alias through the import map); the renderer links against the family. */
const appsGlob = new Bun.Glob("*/index.{ts,tsx}");
const appIds: string[] = [];
const apps: Record<string, string> = {};
const manifests: unknown[] = [];
for await (const rel of appsGlob.scan({ cwd: join(uiDir, "apps") })) {
  const id = rel.split(/[\\/]/)[0]!;
  if (id.startsWith("_")) continue;
  appIds.push(id);
  const entry = join(uiDir, "apps", rel);
  apps[id] = await bundleBrowser(entry, undefined, PROD);
  const mod = (await import(entry)) as { default?: { manifest?: unknown } };
  if (mod.default?.manifest) manifests.push(mod.default.manifest);
}

const stepsGlob = new Bun.Glob("*/index.{ts,tsx}");
const stepIds: string[] = [];
const setupSteps: Record<string, string> = {};
for await (const rel of stepsGlob.scan({ cwd: join(uiDir, "setup", "steps") })) {
  const id = rel.split(/[\\/]/)[0]!;
  if (id.startsWith("_")) continue;
  stepIds.push(id);
  setupSteps[id] = await bundleBrowser(join(uiDir, "setup", "steps", rel), undefined, PROD);
}

const toursGlob = new Bun.Glob("*/index.{ts,tsx}");
const tourIds: string[] = [];
const tours: Record<string, string> = {};
for await (const rel of toursGlob.scan({ cwd: join(uiDir, "tours") })) {
  const id = rel.split(/[\\/]/)[0]!;
  if (id.startsWith("_")) continue;
  tourIds.push(id);
  tours[id] = await bundleBrowser(join(uiDir, "tours", rel), undefined, PROD);
}

const vendor: Record<string, string> = {};
for (const [name, spec] of Object.entries(VENDOR_SPECS)) {
  vendor[name] = await bundleBrowser(fileURLToPath(spec.entryUrl), spec.external, PROD);
}

// Wasmoon has guarded Node-only dynamic imports. They are unreachable in a browser worker, but Bun must
// leave them external while producing the browser bundle.
const sandboxWorkerJs = await bundleBrowser(join(root, "src", "sandbox", "lua", "worker.ts"), [
  "module", "url", "fs", "path", "child_process", "crypto",
], PROD);
const regexWorkerJs = await bundleBrowser(join(root, "src", "sandbox", "regex", "worker.ts"), undefined, PROD);
const extensionWorkerJs = await bundleBrowser(join(root, "src", "sandbox", "javascript", "worker.ts"), [], PROD);
const extensionFrameJs = await bundleBrowser(join(root, "src", "sandbox", "javascript", "extension-frame.ts"), [], PROD);
const extensionFrameHtml = await Bun.file(join(root, "src", "sandbox", "javascript", "extension-frame.html")).text();
const quickJsWasmB64 = Buffer.from(await Bun.file(join(root, "node_modules", "@jitl", "quickjs-wasmfile-release-sync", "dist", "emscripten-module.wasm")).arrayBuffer()).toString("base64");

const docsIndexRaw = await Bun.file(join(root, "docs", "generated", "docs-index.json")).json();
const docsIndex = parseDocsIndex(docsIndexRaw);
if (!docsIndex) throw new Error("docs bake: generated docs index is invalid");
const docPages: Record<string, string> = {};
for (const record of docsIndex.docs) {
  const path = resolveDocPage(root, docsIndex, record.id);
  if (!path) throw new Error(`docs bake: refused page path for ${record.id}`);
  docPages[record.id] = await Bun.file(path).text();
}
const docFiguresRaw = await Bun.file(join(root, "docs", "generated", "figures.json")).json();
if (!Array.isArray(docFiguresRaw)) throw new Error("docs bake: generated figure manifest is invalid");
const docFigures = docFiguresRaw as DocFigure[];
const docAssetPaths = new Set<string>(docFigures.map((figure) => figure.svg));
const mediaGlob = new Bun.Glob("**/*");
for await (const rel of mediaGlob.scan({ cwd: join(root, "docs", "media"), onlyFiles: true })) {
  docAssetPaths.add(`docs/media/${rel.replaceAll("\\", "/")}`);
}
const docAssets: Record<string, PackagedDocAsset> = {};
for (const path of docAssetPaths) {
  const mime = docsAssetMime(path);
  if (!mime) continue;
  const file = Bun.file(join(root, ...path.split("/")));
  if (!await file.exists()) throw new Error(`docs bake: missing asset ${path}`);
  docAssets[path] = { mime, b64: Buffer.from(await file.arrayBuffer()).toString("base64") };
}

const themePackages: Record<string, { manifest: unknown; assets: Record<string, string>; licenseText?: string }> = {};
const exampleThemePackages: Record<string, { manifest: unknown; assets: Record<string, string>; licenseText?: string }> = {};
for (const input of await themeInventory()) {
  const id = (input.manifest as { id?: unknown }).id;
  if (typeof id !== "string" || themePackages[id]) throw new Error("theme bake: duplicate or invalid package id");
  await inspectThemePackage(input, id);
  themePackages[id] = { manifest: input.manifest, assets: input.assets as Record<string, string>, ...(typeof input.licenseText === "string" ? { licenseText: input.licenseText } : {}) };
}
for (const input of await exampleThemeInventory()) {
  const id = (input.manifest as { id?: unknown }).id;
  if (typeof id !== "string" || exampleThemePackages[id] || themePackages[id]) throw new Error("theme bake: duplicate or invalid example id");
  await inspectThemePackage(input);
  exampleThemePackages[id] = { manifest: input.manifest, assets: input.assets as Record<string, string>, ...(typeof input.licenseText === "string" ? { licenseText: input.licenseText } : {}) };
}

const assets = {
  indexHtml: await Bun.file(join(uiDir, "index.html")).text(),
  tokensCss: await Bun.file(join(uiDir, "theme", "tokens.css")).text(),
  fontsB64: Object.fromEntries(
    await Promise.all(FONT_FILES.map(async (f) => [f, Buffer.from(await Bun.file(join(uiDir, "theme", "fonts", f)).arrayBuffer()).toString("base64")] as const)),
  ),
  bootJs: await bundleBrowser(join(uiDir, "boot.ts"), undefined, PROD),
  vendor,
  iconsB64: Object.fromEntries(await Promise.all(Object.entries(ICON_FILES).map(async ([name, [file]]) => [name, Buffer.from(await Bun.file(join(root, "build", file)).arrayBuffer()).toString("base64")]))),
  apps,
  manifests,
  themePackages,
  exampleThemePackages,
  docs: { index: docsIndex, pages: docPages, figures: docFigures, assets: docAssets },
  setupSteps,
  tours,
  sandboxWorkerJs,
  regexWorkerJs,
  extensionWorkerJs,
  extensionFrameJs,
  extensionFrameHtml,
  quickJsWasmB64,
};
// The repo carries a null PLACEHOLDER at this path (a committed bake goes stale silently; null
// cannot lie). The real bake exists only for the duration of the compile and is restored after.
const PLACEHOLDER =
  `/**\n` +
  ` * PLACEHOLDER - the real module is baked by scripts/build-desktop.ts at build time and restored to\n` +
  ` * this placeholder afterwards, so the repo never carries (or claims to carry) a real asset bake.\n` +
  ` * A committed bake goes stale the moment any UI file changes; null cannot lie. desktop.ts refuses\n` +
  ` * to start on null with instructions, instead of shipping yesterday's UI silently.\n` +
  ` */\n` +
  `import type { PackagedAssets } from "../ui/assets";\n` +
  `export const PACKAGED_ASSETS: PackagedAssets | null = null;\n`;
await Bun.write(
  join(genDir, "packaged-assets.ts"),
  `/** GENERATED by scripts/build-desktop.ts - do not edit. */\n` +
    `import type { PackagedAssets } from "../ui/assets";\n` +
    `export const PACKAGED_ASSETS: PackagedAssets | null = ${JSON.stringify(assets)};\n`,
);
console.log(
  `baked ui assets (${appIds.length} apps: ${appIds.join(", ")}; ` +
    `${stepIds.length} setup steps: ${stepIds.join(", ")}; ` +
    `${tourIds.length} tours: ${tourIds.join(", ")}; ` +
    `${docsIndex.count} docs, ${Object.keys(docAssets).length} doc assets)`,
);

// -- 1b. BOOT SMOKE: the build proves the page can boot before anyone claims done -------------------
// Three first-boot crashes taught this: tsc + tests never exercise module RESOLUTION in the page.
// So the build (a) EXECUTES each vendor bundle and asserts the named exports the app relies on,
// and (b) asserts every bare import in every baked bundle has an import-map entry. Fail = no exe.
// jsxDEV is deliberately absent: the bake runs production React (PROD above), and production
// react/jsx-dev-runtime exports jsxDEV as `undefined` (react-family.ts re-exports it verbatim).
// Requiring it here would fail every bake on a correct, intentional value.
const REQUIRED_VENDOR_EXPORTS: Record<string, string[]> = {
  "react-family": [
    "createElement", "useState", "useEffect", "Fragment", "jsx", "jsxs",
    "__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE",
  ],
  "react-dom-client": ["createRoot", "createPortal", "flushSync"],
  strength: ["passwordStrength"],
};
const importMapMatch = /<script type="importmap">\s*([\s\S]*?)<\/script>/.exec(assets.indexHtml);
if (!importMapMatch) throw new Error("smoke: index.html carries no import map");
const importMapKeys = Object.keys((JSON.parse(importMapMatch[1]!) as { imports: Record<string, string> }).imports);

const smokeDir = join(root, "dist", ".smoke");
await mkdir(smokeDir, { recursive: true });
/** Reproduce the PAGE's linkage: vendor bundles must resolve the react family to OUR built stubs
 * (as the import map does), never to node_modules - the internals-drop crash slipped a smoke that
 * linked against node_modules react. Bare specifiers rewrite to the sibling smoke files. */
const linkToStubs = (code: string): string =>
  code
    .replace(/from\s*["']react\/jsx-dev-runtime["']/g, 'from"./react-family.mjs"')
    .replace(/from\s*["']react\/jsx-runtime["']/g, 'from"./react-family.mjs"')
    .replace(/from\s*["']react["']/g, 'from"./react-family.mjs"');
for (const name of Object.keys(REQUIRED_VENDOR_EXPORTS)) {
  await Bun.write(join(smokeDir, `${name}.mjs`), linkToStubs(vendor[name]!));
}
for (const [name, wanted] of Object.entries(REQUIRED_VENDOR_EXPORTS)) {
  const mod = (await import(pathToFileURL(join(smokeDir, `${name}.mjs`)).href)) as Record<string, unknown>;
  const missing = wanted.filter((exp) => mod[exp] === undefined);
  if (missing.length) {
    throw new Error(`smoke: /vendor/${name}.js lacks export(s) ${missing.join(", ")} - the page would crash at boot`);
  }
}

// PRODUCTION REACT GATE (R3/D1): react.development.js and react-dom-client.development.js both carry
// their own filename in a header comment, so the dev build always leaves a ".development" substring
// in the unminified output; the minified, NODE_ENV=production build strips it (verified against both
// vendor bundles while writing this check). If this ever fires, the bake silently regressed to dev
// React - every keystroke and long task the "silly fast" plan measured depends on this not happening.
for (const [name, code] of Object.entries(vendor)) {
  if (code.includes(".development")) {
    throw new Error(`smoke: vendor bundle "${name}" ships a development React build - the desktop bake must run production React`);
  }
}

const bareSpecifiers = (code: string): string[] => {
  const out = new Set<string>();
  const re = /from\s*["']([^"'\n]+)["']|import\s*\(\s*["']([^"'\n]+)["']\s*\)/g;
  for (let m = re.exec(code); m; m = re.exec(code)) {
    const spec = (m[1] ?? m[2])!;
    if (spec.startsWith("./") || spec.startsWith("../") || spec.startsWith("/") || spec.startsWith("http")) continue;
    if (!/^[@\w][\w@/.-]*$/.test(spec)) continue; // module-shaped only: skips prose/concat inside bundled strings
    out.add(spec);
  }
  return [...out];
};
const allBundles: Record<string, string> = {
  boot: assets.bootJs,
  ...Object.fromEntries(Object.entries(apps).map(([k, v]) => [`app:${k}`, v])),
  ...Object.fromEntries(Object.entries(setupSteps).map(([k, v]) => [`step:${k}`, v])),
  ...Object.fromEntries(Object.entries(tours).map(([k, v]) => [`tour:${k}`, v])),
  ...Object.fromEntries(Object.entries(vendor).map(([k, v]) => [`vendor:${k}`, v])),
};

// Every app/step/tour uses the automatic JSX runtime, which resolves to react/jsx-dev-runtime in a
// dev build and react/jsx-runtime in a production one - PROD's NODE_ENV define is what picks the
// production one (verified: an app bundle built with PROD carries zero "jsx-dev-runtime" references
// and zero jsxDEV identifiers). If a future Bun upgrade ever stops honoring that define for the JSX
// transform, this catches it before boot.js or a page bundle ships a call to an export the vendor
// bundle no longer provides (react-family's own jsxDEV is undefined in production - see above).
for (const [name, code] of Object.entries(allBundles)) {
  if (code.includes("jsx-dev-runtime")) {
    throw new Error(`smoke: bundle "${name}" still references react/jsx-dev-runtime - the desktop bake must run production React`);
  }
}
for (const [name, code] of Object.entries(allBundles)) {
  const uncovered = bareSpecifiers(code).filter((s) => !importMapKeys.includes(s));
  if (uncovered.length) {
    throw new Error(`smoke: bundle "${name}" imports bare ${uncovered.join(", ")} with no import-map entry - the page would crash at boot`);
  }
}
console.log(`boot smoke passed (${Object.keys(REQUIRED_VENDOR_EXPORTS).length} vendor graphs executed, ${Object.keys(allBundles).length} bundles resolution-checked)`);

// -- 2. static format registry ----------------------------------------------------------------------

const formatIds = await bakeFormatRegistry(root);
console.log(`baked static format registry (${formatIds.length} families: ${formatIds.join(", ")})`);

// The remote-access helper is NOT pinned here. Its hashes live in src/ui/remote/sidecar-pins.ts, committed
// and updated by `bun scripts/pin-sidecar.ts <tag>`. Computing them during the build was the earlier
// design and it quietly split the product in two: only a CI-built binary carried a pin, so the helper
// download worked for packaged users and silently did not for anyone running from source.

// -- 3. compile -------------------------------------------------------------------------------------

// The Claude Agent SDK is proprietary and optional (see package.json optionalDependencies, license-audit.ts).
// Kept external so no release binary inlines it; the provider reports a clear message when it is absent.
const NO_PROPRIETARY_SDK = ["--external", "@anthropic-ai/claude-agent-sdk"];
const javascriptWorker = join(root, "src", "sandbox", "javascript", "worker.ts");

await mkdir(join(root, "dist"), { recursive: true });
const desktopDefaultOut = process.platform === "win32" ? "dist/Bunzai.exe" : `dist/bunzai-${process.platform}-${process.arch}`;
try {
  if (!skipDesktop) {
    await bakeSidecar(root, `${process.platform}-${process.arch}`);
    const compile = Bun.spawnSync(
      [
        process.execPath, "build", "--compile", ...NO_PROPRIETARY_SDK,
        join(root, "src", "desktop.ts"),
        // the window worker MUST ride as its own entrypoint; without it the exe compiles fine and
        // then boots headless (worker ModuleNotFound at runtime, console hidden, no window)
        join(root, "src", "desktop-window.ts"),
        // QuickJS guest code runs in this terminable Bun worker in compiled desktop mode.
        javascriptWorker,
        // the stage's background lane (src/stage/worker-lane.ts) starts these workers by the same
        // rule; lane-probe.ts is the packaged probe for both
        join(root, "src", "stage", "store", "sqlite", "maintenance-worker.ts"),
        join(root, "src", "stage", "crypto", "password-worker.ts"),
        join(root, "src", "stage", "store", "cold-read-worker.ts"),
        join(root, "src", "stage", "search", "search-worker.ts"),
        "--outfile", join(root, desktopOutfile ?? desktopDefaultOut),
        ...(process.platform === "win32" ? [`--windows-icon=${join(root, "build", "vaude.ico")}`, "--windows-hide-console"] : []),
      ],
      { cwd: root, stdout: "inherit", stderr: "inherit" },
    );
    if (compile.exitCode !== 0) throw new Error("compile failed");
    console.log(`${desktopOutfile ?? desktopDefaultOut} ready`);
  }
  for (const target of cliTargets) {
    await bakeSidecar(root, target);
    const short = target.replace(/^bun-/, "");
    // "cli" is in the name on purpose. These are terminal tools, and a Windows user who
    // double-clicks a bare `bunzai-windows-x64.exe` sees a console flash and vanish, which reads
    // as a broken app rather than a program that wants arguments. The filename is the first and
    // cheapest place to say what this is.
    const out = join(root, "dist", `bunzai-cli-${short}${short.startsWith("windows") ? ".exe" : ""}`);
    const compile = Bun.spawnSync(
      [process.execPath, "build", "--compile", ...NO_PROPRIETARY_SDK, `--target=${target}`, join(root, "src", "cli.ts"), javascriptWorker, "--outfile", out],
      { cwd: root, stdout: "inherit", stderr: "inherit" },
    );
    if (compile.exitCode !== 0) throw new Error(`cli compile failed for ${target}`);
    console.log(`${out} ready`);
  }

  if (buildKit) {
    await bakeSidecar(root, `${process.platform}-${process.arch}`);
    // Host platform only, and named for it, since this binary cannot be built anywhere else.
    const arch = process.arch === "arm64" ? "arm64" : "x64";
    const os = process.platform === "win32" ? "windows" : process.platform === "darwin" ? "darwin" : "linux";
    const out = join(root, "dist", `bunzai-kit-${os}-${arch}${os === "windows" ? ".exe" : ""}`);
    const compile = Bun.spawnSync(
      [process.execPath, "build", "--compile", ...NO_PROPRIETARY_SDK, join(root, "src", "kit", "index.tsx"),
        javascriptWorker, join(root, "src", "sandbox", "regex", "worker.ts"), "--outfile", out],
      { cwd: root, stdout: "inherit", stderr: "inherit" },
    );
    // A cross-target opentui miss exits 0 while writing nothing, so the file is the real check.
    if (compile.exitCode !== 0) throw new Error("kit compile failed");
    if (!await Bun.file(out).exists()) throw new Error(`kit compile produced no binary at ${out}`);
    console.log(`${out} ready`);
  }
} finally {
  // win or lose, the worktree goes back to the placeholder: the bake lives in the exe, not the repo
  await Bun.write(join(genDir, "packaged-assets.ts"), PLACEHOLDER);
  await Bun.write(join(genDir, "packaged-sidecar.ts"), SIDECAR_PLACEHOLDER);
}
