/** Bundle selected extension source into a deterministic, non-executable package envelope. */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { decodeExtensionPackageInput } from "../src/extensions/contracts/package-validation";
import { readPackageSource } from "./extension-package-files";
import { bundleExtensionEntry } from "./extension-bundler";

const args = process.argv.slice(2);
const optionValue = (name: string): string | undefined => {
  const index = args.indexOf(name);
  const value = index < 0 ? undefined : args[index + 1];
  return value && !value.startsWith("--") ? value : undefined;
};
const sourceArg = optionValue("--source");
const outputArg = optionValue("--out");
if (args.includes("--help") || !sourceArg || !outputArg) {
  console.log("Usage: bun run extensions:pack -- --source <extension-directory> --out <artifact.json>");
  console.log("Bundles main.js with Bun, preserves declared text assets, and writes a SHA-256 envelope.");
  process.exit(args.includes("--help") ? 0 : 2);
}
const source = resolve(sourceArg);
const { manifest, files, licenseText } = readPackageSource(source);
if (manifest.entry) files["main.js"] = await bundleExtensionEntry(source, manifest.entry);
const inspected = await decodeExtensionPackageInput({ manifest, files, ...(licenseText ? { licenseText } : {}) });
const digest = inspected.digest;
const output = resolve(outputArg);
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, `${JSON.stringify({ schemaVersion: 1, digest, package: inspected.package }, null, 2)}\n`, "utf8");
console.log(`extensions:pack: wrote ${output} (${digest})`);
