/** Read a selected package directory with containment, file-count and byte limits. */
import { existsSync, lstatSync, readFileSync, realpathSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { extensionManifestSchema, type ExtensionManifest } from "../src/extensions/contracts/package";
import { assertJavaScriptSource } from "../src/sandbox/javascript/limits";

const MAX_MANIFEST_BYTES = 64_000;
const MAX_FILE_BYTES = 2_000_000;
const MAX_TOTAL_BYTES = 8_000_000;
const PACKAGE_PATH = /^(?:main\.js|styles\.css|assets\/[a-z0-9][a-z0-9._-]*|fonts\/[a-z0-9][a-z0-9._-]*\.woff2)$/;
const decoder = new TextDecoder("utf-8", { fatal: true });

export function readPackageSource(directory: string): { manifest: ExtensionManifest; files: Record<string, string>; licenseText?: string } {
  const root = realpathSync(directory);
  const manifestPath = resolve(root, "manifest.json");
  if (lstatSync(manifestPath).isSymbolicLink()) throw new Error("manifest.json must not be a symbolic link");
  const manifestStat = lstatSync(manifestPath);
  if (!manifestStat.isFile() || manifestStat.size > MAX_MANIFEST_BYTES) throw new Error("manifest.json is not a bounded regular file");
  const parsedManifest = extensionManifestSchema.safeParse(JSON.parse(decoder.decode(readFileSync(manifestPath))));
  if (!parsedManifest.success) throw new Error(`invalid manifest: ${parsedManifest.error.issues[0]?.message ?? "schema mismatch"}`);
  const manifest = parsedManifest.data;
  const themeFiles = manifest.theme
    ? [...manifest.theme.assets.map((asset) => [asset.path, asset.mediaType] as const),
      ...(manifest.theme.styles ? [[manifest.theme.styles, "text/css"] as const] : []),
      ...(manifest.theme.fonts ?? []).map((font) => [font.path, font.mediaType] as const)]
    : [];
  const paths = [...themeFiles.map(([path]) => path), ...(manifest.entry ? [manifest.entry] : [])];
  if (paths.length > 129 || paths.some((path) => !PACKAGE_PATH.test(path) || isAbsolute(path))) {
    throw new Error("manifest contains an unsafe package path");
  }
  const folded = new Set<string>();
  for (const path of paths) {
    const key = path.toLowerCase();
    if (folded.has(key)) throw new Error("manifest contains a case-colliding package path");
    folded.add(key);
  }
  const files: Record<string, string> = {};
  let totalBytes = 0;
  for (const path of paths) {
    const candidate = resolve(root, path);
    const lexical = relative(root, candidate);
    if (!lexical || lexical.startsWith(`..${sep}`) || lexical === ".." || isAbsolute(lexical)) {
      throw new Error(`unsafe package path "${path}"`);
    }
    const mediaType = themeFiles.find(([declared]) => declared === path)?.[1];
    const maxBytes = path === "main.js" ? MAX_FILE_BYTES
      : mediaType === "image/svg+xml" ? 96_000
      : mediaType === "text/css" ? 64_000
      : 128_000;
    const stat = lstatSync(candidate);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > maxBytes) {
      throw new Error(`package file "${path}" is not a bounded regular file`);
    }
    const real = realpathSync(candidate);
    const realRelative = relative(root, real);
    if (!realRelative || realRelative.startsWith(`..${sep}`) || realRelative === ".." || isAbsolute(realRelative)) {
      throw new Error(`package file "${path}" escapes its source directory`);
    }
    totalBytes += stat.size;
    if (totalBytes > MAX_TOTAL_BYTES) throw new Error("package exceeds its total source size limit");
    const bytes = readFileSync(real);
    if (path === "main.js") {
      const source = decoder.decode(bytes);
      assertJavaScriptSource(source);
      files[path] = source;
    } else files[path] = mediaType === "image/svg+xml" || mediaType === "text/css"
      ? decoder.decode(bytes) : bytes.toString("base64");
  }
  const licensePath = resolve(root, "LICENSE.txt");
  let licenseText: string | undefined;
  if (existsSync(licensePath)) {
    const license = lstatSync(licensePath);
    if (!license.isFile() || license.isSymbolicLink() || license.size > 64_000) {
      throw new Error("LICENSE.txt is not a bounded regular file");
    }
    const realLicense = realpathSync(licensePath);
    const licenseRelative = relative(root, realLicense);
    if (licenseRelative !== "LICENSE.txt") throw new Error("LICENSE.txt escapes its source directory");
    licenseText = decoder.decode(readFileSync(realLicense));
  }
  return { manifest, files, ...(licenseText === undefined ? {} : { licenseText }) };
}
