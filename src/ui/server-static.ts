/**
 * UI server static/dev plumbing: drop-in module discovery, CSS-module bundling, vendor bundles,
 * and live-reload watch. Extracted from server.ts (behavior-preserving).
 *
 * Bundles are memoized until the file watcher below invalidates them, and
 * ship production React when BUNZAI_UI_PROD_REACT=1 (set by scripts/vaude-browser.ts; `bun run dev`
 * never sets it, so it keeps development React).
 */
import { isFontFile } from "./theme/fonts";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { watch as watchFs } from "node:fs";
import { ICON_FILES, studioWebManifest, type PackagedAssets } from "./assets";
import { err, textResponse } from "./server-security";
import { REACT_EXTERNALS, VENDOR_SPECS } from "./vendor/specs";
import { appAssetPlugin } from "./app-asset-plugin";

export interface DiscoveredModule {
  id: string;
  entrypoint: string;
}

/** Folders-as-schema scan: <baseDir>/<id>/index.{ts,tsx}, _-prefixed skipped (templates/shared).
 * .tsx is the dev-mode twin of scripts/build-desktop.ts's widened glob (ADR-008 conversion): apps
 * and setup steps convert to React one folder at a time, and the dev server must keep finding both
 * shapes mid-conversion, or every converted folder 404s until the whole run lands. */
export async function discoverModules(baseRel: string): Promise<DiscoveredModule[]> {
  const baseDir = fileURLToPath(new URL(baseRel, import.meta.url));
  const glob = new Bun.Glob("*/index.{ts,tsx}");
  const found: DiscoveredModule[] = [];
  for await (const rel of glob.scan({ cwd: baseDir })) {
    const id = rel.split(/[\\/]/)[0]!;
    if (id.startsWith("_")) continue;
    found.push({ id, entrypoint: join(baseDir, rel) });
  }
  return found.sort((a, b) => a.id.localeCompare(b.id));
}

export const discoverApps = (): Promise<DiscoveredModule[]> => discoverModules("./apps/");
export const discoverSetupSteps = (): Promise<DiscoveredModule[]> => discoverModules("./setup/steps/");
// tours ride the SAME drop-in mechanism: src/ui/tours/<appId>/index.tsx (the shared _-prefixed infra
// files - tour-contract, tour-core - are not <id>/index folders, so the glob never sees them)
export const discoverTours = (): Promise<DiscoveredModule[]> => discoverModules("./tours/");

/**
 * Production React for THIS dev-mode server process: set
 * only by the "Bunzai (Browser)" shortcut (scripts/vaude-browser.ts), never by `bun run dev`, so the
 * plain dev server keeps development React's warnings and readable stacks. Read once at module load -
 * one process serves one React build for its whole life, matching the packaged exe's own bake.
 */
export const PROD_REACT = process.env.BUNZAI_UI_PROD_REACT === "1";
const PROD_REACT_DEFINE: Record<string, string> = { "process.env.NODE_ENV": '"production"' };
const prodBuildOpts: { minify?: true; define?: Record<string, string> } = PROD_REACT
  ? { minify: true, define: PROD_REACT_DEFINE }
  : {};

/**
 * Dev-bundle memo: `bundleModule`/`bundleVendor`/`/boot.js` used to rebundle on every request (fine
 * unminified, ~20ms; the production build below is slower and not worth repeating between edits).
 * Each cache entry is stamped with the generation it was built at; `invalidateDevBundleCache` (called
 * by the file watcher below, or directly by a test) bumps the generation and every stale entry misses
 * on its next read. The packaged exe never reads this - its bundles are baked once at build time.
 */
let bundleGeneration = 0;
export function invalidateDevBundleCache(): void {
  bundleGeneration++;
}
const moduleCache = new Map<string, { generation: number; code: string }>();
const vendorCache = new Map<string, { generation: number; code: string }>();
let bootCache: { generation: number; code: string } | null = null;

/** CSS Modules emit SEPARATE css artifacts; the stylesheet rides inside the module's JS as a
 * head-injected <style> (mirrors scripts/build-desktop.ts - the unstyled-interiors bug). */
export async function withCssInjected(outputs: Bun.BuildArtifact[]): Promise<string> {
  let js = "";
  let css = "";
  for (const out of outputs) {
    if (out.path.endsWith(".css")) css += await out.text();
    else js += await out.text();
  }
  if (!css) return js;
  const inject =
    `{const s=document.createElement("style");s.dataset.vaudeModuleCss="1";` +
    `s.textContent=${JSON.stringify(css)};document.head.append(s);}\n`;
  return inject + js; // statements before import declarations are legal ESM (imports hoist)
}

/** Bundle one module for the browser (dev serves live edits). Memoized until the watcher fires - see
 * "Dev-bundle memo" above. The packaged exe never calls this - its bundles are baked. */
export async function bundleModule(mod: DiscoveredModule): Promise<string> {
  // Keyed on the entrypoint, not mod.id: apps, setup steps, and tours are separate id namespaces
  // that legitimately reuse names (a "library" app and a "library" tour both exist today), and the
  // entrypoint path is the only thing that is actually unique across all three.
  const cached = moduleCache.get(mod.entrypoint);
  if (cached && cached.generation === bundleGeneration) return cached.code;
  // Captured BEFORE the build starts: an edit that invalidates mid-build must not let the result of
  // that stale build get stamped with the new generation and served as if it were fresh.
  const generation = bundleGeneration;
  const built = await Bun.build({
    entrypoints: [mod.entrypoint],
    target: "browser",
    format: "esm",
    external: REACT_EXTERNALS,
    plugins: [appAssetPlugin],
    ...prodBuildOpts,
  });
  if (!built.success || built.outputs.length === 0) {
    throw new Error(`ui: module "${mod.id}" failed to bundle: ${built.logs.map((l) => l.message).join("; ")}`);
  }
  const code = await withCssInjected(built.outputs);
  moduleCache.set(mod.entrypoint, { generation, code });
  return code;
}

/** Dev-serve a shared vendor bundle (packaged mode reads the baked copy instead). Memoized like
 * `bundleModule`. */
export async function bundleVendor(name: string): Promise<string | null> {
  const spec = VENDOR_SPECS[name];
  if (!spec) return null; // deny by absence: only the known vendor names exist
  const cached = vendorCache.get(name);
  if (cached && cached.generation === bundleGeneration) return cached.code;
  const generation = bundleGeneration; // captured before the build - see bundleModule's comment
  const built = await Bun.build({
    entrypoints: [fileURLToPath(spec.entryUrl)],
    target: "browser",
    format: "esm",
    external: spec.external,
    ...prodBuildOpts,
  });
  if (!built.success || built.outputs.length === 0) return null;
  const code = await built.outputs[0]!.text();
  vendorCache.set(name, { generation, code });
  return code;
}

// -- dev live-reload (dev server only; the packaged exe has no source tree to watch) ----------------

const devClients = new Set<ReadableStreamDefaultController<Uint8Array>>();
let watching = false;
const SSE = new TextEncoder();

/** One id per server process. The hello frame carries it so a page that reconnects after a server
 * restart can offer the person an explicit update without replacing their live workspace. */
const DEV_BOOT_ID = crypto.randomUUID();

/** The dev watch root: all of src, not just src/ui, because an app bundle pulls in core, stage,
 * entities, studio and formats too; a narrower root let an engine edit serve a stale memoized bundle. */
export const DEV_WATCH_ROOT = fileURLToPath(new URL("../", import.meta.url));

/** Watch src and announce an available update (debounced; editors fire in bursts). */
export function startDevWatch(): void {
  if (watching) return;
  watching = true;
  let timer: ReturnType<typeof setTimeout> | null = null;
  watchFs(DEV_WATCH_ROOT, { recursive: true }, (_type, filename) => {
    // Only real source files reload the page; editor lockfiles, swap files, and Windows watcher
    // noise do not. A null filename (Windows sometimes omits it) is allowed through - losing a
    // legitimate reload is worse than an extra one.
    if (filename !== null && !/\.(ts|tsx|css|html|png)$/i.test(String(filename))) return;
    // Test files never ship in a bundle; editing one must not reload open pages.
    if (filename !== null && /\.test\.tsx?$/i.test(String(filename))) return;
    // Invalidate the dev-bundle memo the instant a source file changes - not debounced with the
    // reload below, so a request that lands mid-burst still gets fresh code, not a stale build from
    // before the edit.
    invalidateDevBundleCache();
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      for (const client of devClients) {
        try {
          client.enqueue(SSE.encode("data: reload\n\n"));
        } catch {
          devClients.delete(client);
        }
      }
      // 600ms trailing quiet: an edit BURST (agent or human saving several files) folds into ONE
      // reload instead of a flashing storm; 120ms fired between keystroke-spaced saves.
    }, 600);
  });
}

/** Manifests come from the modules themselves (server imports them once; they are DOM-free at top level). */
export async function appManifests(apps: DiscoveredModule[]): Promise<unknown[]> {
  const manifests: unknown[] = [];
  for (const app of apps) {
    const mod = (await import(app.entrypoint)) as { default?: { manifest?: unknown } };
    if (mod.default?.manifest) manifests.push(mod.default.manifest);
  }
  return manifests;
}

/** Open a live-reload SSE response (dev only). */
export function createDevReloadResponse(): Response {
  let ctrl: ReadableStreamDefaultController<Uint8Array>;
  let heartbeat: ReturnType<typeof setInterval>;
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      ctrl = c;
      devClients.add(c);
      c.enqueue(SSE.encode(`data: hello ${DEV_BOOT_ID}\n\n`));
      // keepalive comment under the server's idleTimeout (120s), or Bun chops the quiet stream
      // mid-flight (ERR_INCOMPLETE_CHUNKED_ENCODING) and live-reload dies until the tab reloads
      heartbeat = setInterval(() => {
        try {
          c.enqueue(SSE.encode(": ping\n\n"));
        } catch {
          clearInterval(heartbeat);
          devClients.delete(c);
        }
      }, 30_000);
    },
    cancel() {
      clearInterval(heartbeat);
      devClients.delete(ctrl);
    },
  });
  return new Response(stream, {
    headers: { "content-type": "text/event-stream", "cache-control": "no-cache" },
  });
}

export const staticFile = (rel: string, type: string): Response =>
  new Response(Bun.file(fileURLToPath(new URL(rel, import.meta.url))), {
    // no-store: heuristically cached local assets survived server restarts as stale UI
    headers: { "content-type": type, "cache-control": "no-store" },
  });

/** no-store response for served bytes (local + free, and heuristic caching served week-old bundles). */
const noStore = (body: string, type: string, extra?: Record<string, string>): Response =>
  textResponse(body, type, { "cache-control": "no-store", ...extra });

/**
 * Static + bundled asset routes: everything the browser loads that is NOT the HTML shell (the shell
 * needs session-meta injection, so it stays in createHandler). Returns null for any non-asset path so
 * the caller's route table continues. Behavior-preserving move out of server.ts.
 */
export async function handleAssetRoutes(
  p: string,
  packaged?: PackagedAssets,
): Promise<Response | null> {
  // The house fonts, by name from the one list (theme/fonts.ts); any other name is not served.
  if (p.startsWith("/fonts/")) {
    const name = p.slice("/fonts/".length);
    if (!isFontFile(name)) return null;
    const type = "font/woff2";
    if (packaged) {
      const b64 = packaged.fontsB64[name];
      return b64 !== undefined ? new Response(Buffer.from(b64, "base64"), { headers: { "content-type": type } }) : null;
    }
    return staticFile(`./theme/fonts/${name}`, type);
  }
  if (p === "/tokens.css") {
    return packaged ? noStore(packaged.tokensCss, "text/css; charset=utf-8") : staticFile("./theme/tokens.css", "text/css; charset=utf-8");
  }
  const icon = Object.hasOwn(ICON_FILES, p.slice(1)) ? ICON_FILES[p.slice(1) as keyof typeof ICON_FILES] : undefined;
  if (icon) {
    const [file, type] = icon;
    const encoded = packaged?.iconsB64[p.slice(1)];
    if (packaged && encoded === undefined) return err("the packaged icon is missing", 404);
    const asset = packaged ? Buffer.from(encoded!, "base64") : Bun.file(fileURLToPath(new URL(`../../build/${file}`, import.meta.url)));
    return new Response(asset, { headers: { "content-type": type } });
  }
  if (p === "/app.webmanifest") {
    return noStore(
      JSON.stringify(studioWebManifest("/")),
      "application/manifest+json",
    );
  }
  if (p === "/boot.js") {
    if (packaged) return noStore(packaged.bootJs, "text/javascript");
    if (bootCache && bootCache.generation === bundleGeneration) {
      return new Response(bootCache.code, { headers: { "content-type": "text/javascript", "cache-control": "no-store" } });
    }
    const generation = bundleGeneration; // captured before the build - see bundleModule's comment
    const built = await Bun.build({
      entrypoints: [fileURLToPath(new URL("./boot.ts", import.meta.url))],
      target: "browser",
      format: "esm",
      external: REACT_EXTERNALS,
      ...prodBuildOpts,
    });
    if (!built.success) return err("boot bundle failed", 500);
    // the shell's own CSS Modules (Stamp, dialogs, tags) ride in the boot bundle as separate css
    // artifacts; without this they serve style-less in dev while the packaged exe (bundleBrowser)
    // injects - the unstyled-Import-stamp split. Boot goes through the SAME injector now.
    const code = await withCssInjected(built.outputs);
    bootCache = { generation, code };
    return new Response(code, { headers: { "content-type": "text/javascript", "cache-control": "no-store" } });
  }
  if (p.startsWith("/vendor/") && p.endsWith(".js")) {
    const name = p.slice("/vendor/".length, -".js".length);
    if (packaged) {
      const code = packaged.vendor[name];
      return code !== undefined ? noStore(code, "text/javascript") : err("no such vendor bundle", 404);
    }
    const code = await bundleVendor(name);
    return code !== null ? noStore(code, "text/javascript") : err("no such vendor bundle", 404);
  }

  // Sealed Lua Stage (browser): wasmoon glue.wasm + worker bundle. Never evaluate card code here.
  if (p === "/sandbox/glue.wasm") {
    const wasmPath = fileURLToPath(new URL("../../node_modules/wasmoon/dist/glue.wasm", import.meta.url));
    return new Response(Bun.file(wasmPath), {
      headers: {
        "content-type": "application/wasm",
        "cache-control": "public, max-age=86400",
      },
    });
  }
  if (p === "/sandbox/worker.js") {
    if (packaged?.sandboxWorkerJs) {
      return noStore(packaged.sandboxWorkerJs, "text/javascript; charset=utf-8");
    }
    const entry = fileURLToPath(new URL("../sandbox/lua/worker.ts", import.meta.url));
    const built = await Bun.build({
      entrypoints: [entry],
      target: "browser",
      format: "esm",
    });
    if (!built.success || built.outputs.length === 0) {
      return err(`sandbox worker bundle failed: ${built.logs.map((l) => l.message).join("; ")}`, 500);
    }
    return new Response(await built.outputs[0]!.text(), {
      headers: { "content-type": "text/javascript; charset=utf-8" },
    });
  }
  if (p === "/sandbox/regex-worker.js") {
    if (packaged?.regexWorkerJs) {
      return noStore(packaged.regexWorkerJs, "text/javascript; charset=utf-8");
    }
    const entry = fileURLToPath(new URL("../sandbox/regex/worker.ts", import.meta.url));
    const built = await Bun.build({ entrypoints: [entry], target: "browser", format: "esm" });
    if (!built.success || built.outputs.length === 0) {
      return err(`regex worker bundle failed: ${built.logs.map((log) => log.message).join("; ")}`, 500);
    }
    return new Response(await built.outputs[0]!.text(), {
      headers: { "content-type": "text/javascript; charset=utf-8" },
    });
  }

  return null;
}
