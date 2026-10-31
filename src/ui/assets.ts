/**
 * Packaged-assets contract: the difference between dev and shipped software, isolated to ONE seam.
 * Dev mode: the server discovers apps and bundles on the fly (drop-in modularity live).
 * Packaged mode (Bunzai.exe): a build step bakes the same artifacts into a generated module, because
 * a compiled binary has no source tree to scan. Same server, same routes, same bytes either way.
 */
export interface PackagedAssets {
  indexHtml: string;
  tokensCss: string;
  /** the house fonts (theme/fonts.ts), file name -> base64 woff2 */
  fontsB64: Record<string, string>;
  bootJs: string;
  /** Served icon filename to base64 bytes, baked from the shared icon inventory. */
  iconsB64: Record<string, string>;
  /** app id -> browser bundle */
  apps: Record<string, string>;
  /** the dock manifest list, pre-collected */
  manifests: unknown[];
  /** host-authenticated theme source packages, folded in at build time with their admitted asset bytes */
  themePackages?: Record<string, { manifest: unknown; assets: Record<string, string>; licenseText?: string }>;
  /** shipped examples are discoverable but never entitlements until digest-bound approval */
  exampleThemePackages?: Record<string, { manifest: unknown; assets: Record<string, string>; licenseText?: string }>;
  /** the same committed docs corpus GitHub exposes, baked for the in-app Help reader */
  docs: import("./docs-types").PackagedDocs;
  /** setup step id -> browser bundle (same drop-in mechanism as apps) */
  setupSteps: Record<string, string>;
  /** tour id -> bundle; the record is required even though individual apps may omit a tour */
  tours: Record<string, string>;
  /** shared platform bundles (react, jsx-runtime, react-dom-client) served at /vendor/<name>.js;
   * every other bundle marks these external and resolves them through the page's import map so
   * exactly ONE React instance exists (two copies = null-dispatcher hook crashes) */
  vendor: Record<string, string>;
  /** browser-bundled sealed Lua worker (optional; dev serves live from src/sandbox/lua/worker.ts) */
  sandboxWorkerJs?: string;
  /** browser-bundled regex worker, served only by the sandbox authority */
  regexWorkerJs?: string;
  /** QuickJS guest wrapper bundle and interpreter bytes; served only by the sandbox authority */
  extensionWorkerJs?: string;
  extensionFrameJs?: string;
  extensionFrameHtml?: string;
  quickJsWasmB64?: string;
}

/** One served-icon inventory shared by development, desktop packaging and the static browser studio. */
export const ICON_FILES = {
  "favicon.ico": ["vaude.ico", "image/x-icon"],
  "icon-192.png": ["vaude-192.png", "image/png"],
  "icon-256.png": ["vaude-256.png", "image/png"],
  "icon-512.png": ["vaude-512.png", "image/png"],
} as const;

export const INSTALL_ICON_SIZES = [192, 512] as const;

/** Desktop and static Browser Studio share the install descriptor; only the deployment-relative scope differs. */
export function studioWebManifest(base: "/" | "./") {
  return {
    name: "Bunzai.", short_name: "Bunzai.", id: base, start_url: base, scope: base, display: "standalone",
    icons: INSTALL_ICON_SIZES.map((size) => ({ src: `${base}icon-${size}.png`, sizes: `${size}x${size}`, type: "image/png", purpose: "any maskable" })),
    background_color: "#111113", // hardcode-ok: manifest literal matching the generated install icon ground
    theme_color: "#e11d48", // hardcode-ok: manifest literal matching the host accent
  };
}
