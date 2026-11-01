/** Public package-boundary tests exercise the shipped theme validators on combined executable packages. */
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { RELEASE_JS_LIMITS } from "../../sandbox/javascript/limits";
import { extensionPackageSchema } from "./package";
import { decodeExtensionPackageInput, inspectExtensionPackage } from "./package-validation";

const root = new URL("../examples/bunzai.theme.encore/", import.meta.url);
const text = (path: string): string => readFileSync(new URL(path, root), "utf8");
const binary = (path: string): string => readFileSync(new URL(path, root)).toString("base64");

function combinedPackage() {
  const source = JSON.parse(text("manifest.json")) as Record<string, unknown>;
  const { schemaVersion: _v, id, version, name, requests, appearance, assets, styles, fonts, slots } = source;
  const theme = { requests, appearance, assets, styles, fonts, slots };
  return {
    manifest: { schemaVersion: 1, id, version, name, description: "Fixture", author: "Test", api: { major: 1, minMinor: 0, maxMinor: 0 }, requirements: [], contributions: [], theme },
    files: {
      "assets/ticket-bun.svg": text("assets/ticket-bun.svg"), "assets/ticket-frame.svg": text("assets/ticket-frame.svg"),
      "assets/crest.png": binary("assets/crest.png"), "assets/starfield.png": binary("assets/starfield.png"),
      "fonts/silkscreen-700.woff2": binary("fonts/silkscreen-700.woff2"), "styles.css": text("styles.css"),
    }, licenseText: text("LICENSE.txt"),
  };
}

test("combined package schema carries checked text and canonical binary theme assets", async () => {
  const pkg = combinedPackage();
  const parsed = extensionPackageSchema.safeParse(pkg);
  if (!parsed.success) throw new Error(parsed.error.message);
  const result = await inspectExtensionPackage(pkg);
  expect(result.theme?.derivedScopes).toContain("appearance.fonts");
  expect(result.theme?.assets.some((asset) => asset.mediaType === "image/png")).toBe(true);
  expect(result.theme?.fonts).toHaveLength(1);
});

test("package boundary rejects malformed SVG and unbounded or unknown settings fields", async () => {
  const badTheme = combinedPackage();
  badTheme.files["assets/ticket-bun.svg"] = "<svg><script>alert(1)</script></svg>";
  await expect(inspectExtensionPackage(badTheme)).rejects.toThrow();
  const base = combinedPackage();
  const badSettings = { ...base, manifest: { ...base.manifest, settings: { enabled: true, extra: true }, settingsSchema: { type: "object", properties: { enabled: { type: "boolean" } }, required: ["enabled"] } } };
  await expect(inspectExtensionPackage(badSettings)).rejects.toThrow();
  const properties = Object.fromEntries(Array.from({ length: 65 }, (_, index) => [`setting-${index}`, { type: "boolean" }]));
  expect(extensionPackageSchema.safeParse({ ...base, manifest: { ...base.manifest, settingsSchema: { type: "object", properties } } }).success).toBe(false);
});

test("legacy theme packages adapt as inert packages without an entry or runtime requirements", async () => {
  const current = combinedPackage();
  const { schemaVersion: _schema, id, version, name, description: _description, author: _author, api: _api, requirements: _requirements, contributions: _contributions, theme } = current.manifest;
  const legacy = { manifest: { schemaVersion: 2, id, version, name, ...theme }, assets: current.files, licenseText: current.licenseText };
  const result = await inspectExtensionPackage(legacy);
  expect(result.package.manifest.entry).toBeUndefined();
  expect(result.package.manifest.requirements).toEqual([]);
  expect(result.package.manifest.contributions).toEqual([]);
  expect(result.theme?.name).toBe("Encore");
});

test("package inspector rejects an entry larger than the actual JavaScript guest source limit", async () => {
  const manifest = { schemaVersion: 1 as const, id: "test.entry", version: "1.0.0", name: "Entry", description: "", author: "", api: { major: 1, minMinor: 0, maxMinor: 0 }, entry: "main.js" as const, requirements: [], contributions: [] };
  await expect(inspectExtensionPackage({ manifest, files: { "main.js": "x".repeat(RELEASE_JS_LIMITS.sourceBytes + 1) } })).rejects.toThrow("source-size");
});

test("manifest contribution IDs use a bounded host-safe token grammar", async () => {
  const source = { manifest: { schemaVersion: 1 as const, id: "example.tokens", version: "1.0.0", name: "Tokens", description: "", author: "test",
    api: { major: 1, minMinor: 0, maxMinor: 0 }, entry: "main.js" as const, requirements: [],
    contributions: [{ type: "command" as const, id: "read:notes.v1", label: "Read", operation: "api.describe" }] }, files: { "main.js": "" } };
  await expect(decodeExtensionPackageInput(source)).resolves.toBeDefined();
  for (const id of ["read notes", "read\nnotes", "\u001b[31mrun", "x".repeat(81)]) {
    await expect(decodeExtensionPackageInput({ ...source, manifest: { ...source.manifest, contributions: [{ ...source.manifest.contributions[0]!, id }] } })).rejects.toThrow();
  }
});
