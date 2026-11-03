/**
 * Shared Bun browser-bundle helpers for the desktop bake and static Pages build. `bundleBrowser`
 * defaults to today's unminified, dev-React-shaped output (build-pages.ts and build-site.ts rely on
 * that default and are not part of this change); callers that want the packaged bake's production
 * React pass `opts` explicitly (scripts/build-desktop.ts).
 */
import { REACT_EXTERNALS, VENDOR_SPECS } from "../src/ui/vendor/specs";
import { appAssetPlugin } from "../src/ui/app-asset-plugin";
export { REACT_EXTERNALS, VENDOR_SPECS };

/** `Bun.build`'s `define`, set when a bundle should compile away React's dev-only branches (dead
 * warnings, the `.development` build of react/react-dom) - the desktop bake's shape. */
export const PROD_REACT_DEFINE: Record<string, string> = { "process.env.NODE_ENV": '"production"' };

export interface BundleOptions {
  /** Whitespace/identifier minification. Off by default (build-pages/build-site keep readable output). */
  minify?: boolean;
  /** Compile-time `process.env.*` substitutions, e.g. `PROD_REACT_DEFINE`. */
  define?: Record<string, string>;
}

/** Fold Bun's separate CSS-module artifact into its owning JavaScript module. */
export async function withCssInjected(outputs: Bun.BuildArtifact[]): Promise<string> {
  let js = "";
  let css = "";
  for (const output of outputs) {
    if (output.path.endsWith(".css")) css += await output.text();
    else js += await output.text();
  }
  if (!css) return js;
  const inject =
    `{const s=document.createElement("style");s.dataset.vaudeModuleCss="1";` +
    `s.textContent=${JSON.stringify(css)};document.head.append(s);}\n`;
  return inject + js;
}

export async function bundleBrowser(
  entry: string,
  external: string[] = REACT_EXTERNALS,
  opts: BundleOptions = {},
): Promise<string> {
  const built = await Bun.build({
    entrypoints: [entry],
    target: "browser",
    format: "esm",
    external,
    plugins: [appAssetPlugin],
    minify: opts.minify,
    define: opts.define,
  });
  if (!built.success) {
    throw new Error(`bundle failed for ${entry}: ${built.logs.map((log) => log.message).join("; ")}`);
  }
  return withCssInjected(built.outputs);
}
