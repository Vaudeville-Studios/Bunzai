/** The one folder-driven source inventory for dev and packaged theme contributions. */
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type { PackagedAssets } from "../ui/assets";
import type { ThemePackageInput } from "./theme-contract";

/** Read only manifest-listed local files (SVG and CSS as text, PNG, WebP and woff2 as base64); the contract parser validates their contents and limits. */
function packagedPackages(source: Record<string, ThemePackageInput> | undefined): ThemePackageInput[] {
  return Object.entries(source ?? {}).map(([id, input]) => {
    if ((input.manifest as { id?: unknown })?.id !== id) throw new Error("theme inventory identity mismatch");
    return input;
  });
}
async function sourcePackages(url: URL, skipExtensionExamples = false): Promise<ThemePackageInput[]> {
  const root = fileURLToPath(url);
  const out: ThemePackageInput[] = [];
  let dirs;
  try { dirs = await readdir(root, { withFileTypes: true }); } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return out;
    throw error;
  }
  for (const dir of dirs) {
    if (!dir.isDirectory()) continue;
    const base = root + dir.name + "/";
    const readText = async (path: string, cap: number): Promise<string> => {
      const bytes = await readFile(base + path);
      if (bytes.byteLength > cap) throw new Error("theme inventory file over limit");
      return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    };
    const manifest = JSON.parse(await readText("manifest.json", 512_000)) as { id?: unknown; assets?: { path?: string }[]; fonts?: { path?: string }[]; styles?: unknown };
    if (manifest.id !== dir.name) throw new Error("theme folder identity mismatch");
    if (skipExtensionExamples && (manifest as { schemaVersion?: unknown }).schemaVersion === 1) continue;
    const assets: Record<string, string> = {};
    const readBinary = async (path: string, cap: number): Promise<string> => {
      const bytes = await readFile(base + path);
      if (bytes.byteLength > cap) throw new Error("theme inventory file over limit");
      return Buffer.from(bytes).toString("base64");
    };
    for (const asset of manifest.assets ?? []) {
      if (typeof asset.path !== "string" || !/^assets\/[a-z0-9][a-z0-9._-]*\.(svg|png|webp)$/.test(asset.path)) throw new Error("invalid theme asset path");
      assets[asset.path] = asset.path.endsWith(".svg") ? await readText(asset.path, 96_000) : await readBinary(asset.path, 128_000);
    }
    for (const font of manifest.fonts ?? []) {
      if (typeof font.path !== "string" || !/^fonts\/[a-z0-9][a-z0-9._-]*\.woff2$/.test(font.path)) throw new Error("invalid theme font path");
      assets[font.path] = await readBinary(font.path, 128_000);
    }
    if (manifest.styles === "styles.css") assets["styles.css"] = await readText("styles.css", 64_000);
    let licenseText: string | undefined;
    try { licenseText = await readText("LICENSE.txt", 64_000); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    out.push({ manifest, assets, ...(licenseText === undefined ? {} : { licenseText }) });
  }
  return out;
}
export const themeInventory = (packaged?: PackagedAssets): Promise<ThemePackageInput[]> =>
  packaged ? Promise.resolve(packagedPackages(packaged.themePackages)) : sourcePackages(new URL("./themes/", import.meta.url));
export const exampleThemeInventory = (packaged?: PackagedAssets): Promise<ThemePackageInput[]> =>
  packaged ? Promise.resolve(packagedPackages(packaged.exampleThemePackages)) : sourcePackages(new URL("./examples/", import.meta.url), true);
