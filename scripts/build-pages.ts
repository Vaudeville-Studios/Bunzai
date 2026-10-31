/** Build what GitHub Pages publishes: the website at the root and the browser-only Studio under studio/. */
import { copyFile, cp, mkdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ICON_FILES, studioWebManifest } from "../src/ui/assets";
import { parseDocsIndex } from "../src/ui/docs-corpus";
import type { DocFigure } from "../src/ui/docs-types";
import { buildSite } from "./build-site";
import { bakeFormatRegistry } from "./format-bake";
import { bundleBrowser, VENDOR_SPECS } from "./ui-bundle";
import { exampleThemeInventory, themeInventory } from "../src/extensions/theme-inventory";
import { inspectThemePackage } from "../src/extensions/theme-contract";

const root = fileURLToPath(new URL("..", import.meta.url));
const ui = join(root, "src", "ui");
const site = join(root, "dist", "pages");
const output = join(site, "studio");

await rm(site, { recursive: true, force: true });
await mkdir(output, { recursive: true });
await bakeFormatRegistry(root);

// A self-contained classic Worker avoids module-worker/CORS fetches from the opaque Browser frame.
// QuickJS receives the shipped WASM bytes through wasmBinary; the placeholder URL is never fetched.
const extensionWorkerBuild = await Bun.build({
  entrypoints: [join(root, "src", "sandbox", "javascript", "worker.ts")],
  target: "browser", format: "iife", minify: true, define: { "import.meta.url": '"https://bunzai.invalid/quickjs.js"' },
});
if (!extensionWorkerBuild.success || extensionWorkerBuild.outputs.length !== 1) {
  throw new Error(`pages build: opaque QuickJS worker bundle failed: ${extensionWorkerBuild.logs.map((log) => log.message).join("; ")}`);
}
const extensionWorkerJs = await extensionWorkerBuild.outputs[0]!.text();
const regexWorkerBuild = await Bun.build({
  entrypoints: [join(root, "src", "sandbox", "regex", "worker.ts")],
  target: "browser", format: "iife", minify: true,
});
if (!regexWorkerBuild.success || regexWorkerBuild.outputs.length !== 1) {
  throw new Error(`pages build: opaque regex worker bundle failed: ${regexWorkerBuild.logs.map((log) => log.message).join("; ")}`);
}
const regexWorkerJs = await regexWorkerBuild.outputs[0]!.text();
const quickJsWasmBase64 = Buffer.from(await Bun.file(join(root, "node_modules", "@jitl", "quickjs-wasmfile-release-sync", "dist", "emscripten-module.wasm")).arrayBuffer()).toString("base64");

const write = async (relative: string, body: string | Uint8Array): Promise<void> => {
  const path = join(output, ...relative.split("/"));
  await mkdir(dirname(path), { recursive: true });
  await Bun.write(path, body);
};

const appGlob = new Bun.Glob("*/index.{ts,tsx}");
const manifests: unknown[] = [];
for await (const relative of appGlob.scan({ cwd: join(ui, "apps") })) {
  const id = relative.split(/[\\/]/)[0]!;
  if (id.startsWith("_")) continue;
  const entry = join(ui, "apps", relative);
  await write(`apps/${id}.js`, await bundleBrowser(entry));
  const module = await import(entry) as { default?: { manifest?: unknown } };
  if (module.default?.manifest) manifests.push(module.default.manifest);
}

const setupSteps: string[] = [];
for await (const relative of appGlob.scan({ cwd: join(ui, "setup", "steps") })) {
  const id = relative.split(/[\\/]/)[0]!;
  if (id.startsWith("_")) continue;
  setupSteps.push(id);
  await write(`setup/steps/${id}.js`, await bundleBrowser(join(ui, "setup", "steps", relative)));
}
setupSteps.sort();

for await (const relative of appGlob.scan({ cwd: join(ui, "tours") })) {
  const id = relative.split(/[\\/]/)[0]!;
  if (!id.startsWith("_")) await write(`tours/${id}.js`, await bundleBrowser(join(ui, "tours", relative)));
}

for (const [name, spec] of Object.entries(VENDOR_SPECS)) {
  await write(`vendor/${name}.js`, await bundleBrowser(fileURLToPath(spec.entryUrl), spec.external));
}

const docsIndex = parseDocsIndex(await Bun.file(join(root, "docs", "generated", "docs-index.json")).json());
if (!docsIndex) throw new Error("pages build: generated docs index is invalid");
const figuresRaw = await Bun.file(join(root, "docs", "generated", "figures.json")).json();
if (!Array.isArray(figuresRaw)) throw new Error("pages build: generated figures are invalid");
const docFigures = figuresRaw as DocFigure[];
for (const doc of docsIndex.docs) {
  const source = join(root, ...doc.path.split("/"));
  const target = join(output, ...doc.path.split("/"));
  await mkdir(dirname(target), { recursive: true });
  await copyFile(source, target);
}
await cp(join(root, "docs", "media"), join(output, "docs", "media"), { recursive: true });
await cp(join(root, "docs", "generated", "figures"), join(output, "docs", "generated", "figures"), { recursive: true });

const themePackages: Record<string, { manifest: unknown; assets: Record<string, string>; licenseText?: string }> = {};
const exampleThemePackages: Record<string, { manifest: unknown; assets: Record<string, string>; licenseText?: string }> = {};
for (const input of await themeInventory()) {
  const id = (input.manifest as { id?: unknown }).id;
  if (typeof id !== "string" || themePackages[id]) throw new Error("pages build: duplicate or invalid theme id");
  await inspectThemePackage(input, id);
  themePackages[id] = { manifest: input.manifest, assets: input.assets as Record<string, string>, ...(typeof input.licenseText === "string" ? { licenseText: input.licenseText } : {}) };
}
for (const input of await exampleThemeInventory()) {
  const id = (input.manifest as { id?: unknown }).id;
  if (typeof id !== "string" || exampleThemePackages[id] || themePackages[id]) throw new Error("pages build: duplicate or invalid example theme id");
  await inspectThemePackage(input);
  exampleThemePackages[id] = { manifest: input.manifest, assets: input.assets as Record<string, string>, ...(typeof input.licenseText === "string" ? { licenseText: input.licenseText } : {}) };
}

await write("pocket-data.js", `globalThis.__BUNZAI_POCKET_DATA__=${JSON.stringify({
  manifests,
  setupSteps,
  docsIndex,
  docFigures,
  themePackages,
  exampleThemePackages,
  browserSandbox: { workerSource: extensionWorkerJs, wasmBase64: quickJsWasmBase64, regexWorkerSource: regexWorkerJs },
})};\n`);
await write("pocket.js", await bundleBrowser(join(root, "src", "pocket", "index.ts")));
await write("search-worker.js", await bundleBrowser(join(root, "src", "pocket", "search-worker.ts")));
await write("tokens.css", await Bun.file(join(ui, "theme", "tokens.css")).text());
await cp(join(ui, "theme", "fonts"), join(output, "fonts"), { recursive: true });
await cp(join(root, "src", "site", "fonts"), join(output, "fonts"), { recursive: true });
for (const [name, [file]] of Object.entries(ICON_FILES)) await copyFile(join(root, "build", file), join(output, name));

const rawHtml = await Bun.file(join(ui, "index.html")).text();
const html = rawHtml
  .replace("<head>", '<head>\n<base href="./">\n<meta name="vaude-session" content="browser-tab">\n<meta name="bunzai-runtime" content="browser">')
  .replaceAll('href="/', 'href="./')
  .replaceAll('src="/', 'src="./')
  .replaceAll('"/vendor/', '"./vendor/')
  .replace('<script type="module" src="./boot.js"></script>', '<script src="./pocket-data.js"></script>\n<script type="module" src="./pocket.js"></script>');
await write("index.html", html);
await Bun.write(join(site, ".nojekyll"), "");
await copyFile(join(root, "build", "vaude.ico"), join(site, "favicon.ico"));
const sitePages = await buildSite(root, site);
await write("app.webmanifest", JSON.stringify(studioWebManifest("./"), null, 2));

console.log(`dist/pages ready: ${sitePages} site pages; studio/ has ${manifests.length} apps, ${setupSteps.length} setup steps, ${docsIndex.count} docs`);
