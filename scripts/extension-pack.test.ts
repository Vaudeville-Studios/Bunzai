/** Test mixed package packing, canonical digest parity and durable readback. */
import { expect, test } from "bun:test";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { exampleThemeInventory } from "../src/extensions/theme-inventory";
import { createExtensionOperations } from "../src/generated/extension-operations";
import { canonicalJsonBytes, digestJson, MAX_EXTENSION_PACKAGE_BYTES } from "../src/extensions/contracts/value";
import { createExtensionService } from "../src/extensions/runtime/service";
import type { ExtensionContentServices } from "../src/extensions/contracts/operation";
import { memoryExtensionStore } from "../src/stage/store/memory/extension-store";
import type { ThemeScope } from "../src/extensions/theme-appearance";
import { RELEASE_JS_LIMITS } from "../src/sandbox/javascript/limits";
import { EXTENSION_WIRE_VERSION } from "../src/extensions/contracts/wire";
import { runJavaScriptInWorker } from "../src/sandbox/javascript/run-in-worker";

test("mixed theme and JS package digest matches preview, install and stored bytes", async () => {
  const root = mkdtempSync(join(tmpdir(), "bunzai-extension-pack-"));
  const source = join(root, "source");
  mkdirSync(source);
  const outA = join(root, "a.json");
  const outB = join(root, "b.json");
  const themePackage = (await exampleThemeInventory()).find((item) =>
    (item.manifest as { id?: string }).id === "bunzai.theme.encore");
  expect(themePackage).toBeDefined();
  const validTheme = themePackage!;
  const oldManifest = validTheme.manifest as Record<string, unknown>;
  const assets = oldManifest.assets as { id: string; path: string; mediaType: string }[];
  const manifest = {
    schemaVersion: 1, id: oldManifest.id, version: oldManifest.version, name: oldManifest.name,
    description: "Mixed package fixture", author: "test", api: { major: 1, minMinor: 0, maxMinor: 0 },
    entry: "main.js",
    requirements: [{ operation: "api.describe", resources: [], fields: [], methods: [], destinations: [], purpose: "Test metadata", required: true }],
    contributions: [{ type: "command", id: "inspect", label: "Inspect", operation: "api.describe" }],
    theme: {
      requests: oldManifest.requests, appearance: oldManifest.appearance, assets,
      ...(oldManifest.styles ? { styles: oldManifest.styles } : {}),
      ...(oldManifest.fonts ? { fonts: oldManifest.fonts } : {}),
      ...(oldManifest.slots ? { slots: oldManifest.slots } : {}),
    },
  };
  writeFileSync(join(source, "manifest.json"), JSON.stringify(manifest));
  writeFileSync(join(source, "main.js"), "import { bunzai } from 'bunzai-extension-sdk'; bunzai.extension.define({ commands: { inspect: async () => await bunzai.operations.apiDescribe({}) } });");
  const assetContent = validTheme.assets as Record<string, string>;
  const media = new Map(assets.map((asset) => [asset.path, asset.mediaType]));
  for (const [path, value] of Object.entries(assetContent)) {
    const file = join(source, path);
    mkdirSync(dirname(file), { recursive: true });
    const isText = path === "styles.css" || media.get(path) === "image/svg+xml";
    writeFileSync(file, isText ? value : Buffer.from(value, "base64"));
  }
  writeFileSync(join(source, "LICENSE.txt"), typeof validTheme.licenseText === "string" ? validTheme.licenseText : "fixture license");
  try {
    const first = Bun.spawnSync(["bun", "run", "scripts/extension-pack.ts", "--source", source, "--out", outA]);
    expect(first.exitCode).toBe(0);
    const second = Bun.spawnSync(["bun", "run", "scripts/extension-pack.ts", "--source", source, "--out", outB]);
    expect(second.exitCode).toBe(0);
    const artifact = JSON.parse(readFileSync(outA, "utf8"));
    const repeated = JSON.parse(readFileSync(outB, "utf8"));
    expect(artifact.digest).toBe(repeated.digest);
    expect(artifact.package.files["main.js"]).toContain("bunzai.call");
    expect(Object.keys(artifact.package.files).some((path) => path.startsWith("assets/"))).toBe(true);
    expect(await digestJson(artifact.package, MAX_EXTENSION_PACKAGE_BYTES)).toBe(artifact.digest);

    const content: ExtensionContentServices = { readSummary: async () => null, readBody: async () => null, listSummaries: async () => [], searchSummaries: async () => [], readFields: async () => null, readPersonaIdentity: async () => null, readLinks: async () => null, listHistory: async () => [], readHistory: async () => null, trash: async () => false, readGrave: async () => null, restore: async () => null };
    const store = memoryExtensionStore(() => 1_000);
    const runtime = createExtensionService({
      store, storeId: "isolated", host: "desktop", operations: createExtensionOperations({ content }).all(),
      now: () => 1_000, id: () => "00000000-0000-4000-8000-000000000001",
    });
    await runtime.start();
    try {
      const preview = await runtime.preview(artifact);
      expect(preview.digest).toBe(artifact.digest);
      const grants = [{ operation: "api.describe", resources: [], fields: [], methods: [], destinations: [], duration: "session" as const,
        budget: { requests: 10, bytes: MAX_EXTENSION_PACKAGE_BYTES, tokens: 0 } }];
      await runtime.install(preview.challenge, grants, (artifact.package.manifest.theme?.requests ?? []) as ThemeScope[], preview.expectedRevision);
      const stored = await store.readPackage(artifact.digest);
      expect(stored).not.toBeNull();
      expect(stored?.bytes).toEqual(canonicalJsonBytes(artifact.package, MAX_EXTENSION_PACKAGE_BYTES));
      const restored = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(stored!.bytes));
      expect(await digestJson(restored, MAX_EXTENSION_PACKAGE_BYTES)).toBe(artifact.digest);
    } finally { await runtime.close(); }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("pack rejects a source entry above the packaged guest ceiling before bundling", () => {
  const root = mkdtempSync(join(tmpdir(), "bunzai-extension-pack-limit-"));
  const source = join(root, "source");
  const output = join(root, "artifact.json");
  mkdirSync(source);
  writeFileSync(join(source, "manifest.json"), JSON.stringify({
    schemaVersion: 1, id: "example.limit", version: "1.0.0", name: "Limit", description: "", author: "test",
    api: { major: 1, minMinor: 0, maxMinor: 0 }, entry: "main.js", requirements: [], contributions: [],
  }));
  writeFileSync(join(source, "main.js"), "x".repeat(RELEASE_JS_LIMITS.sourceBytes + 1));
  try {
    const result = Bun.spawnSync(["bun", "run", "scripts/extension-pack.ts", "--source", source, "--out", output]);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr.toString()).toContain("source-size");
    expect(existsSync(output)).toBe(false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("cold-start character audit example checks and packs deterministically from a clean folder", () => {
  const root = mkdtempSync(join(tmpdir(), "bunzai-extension-cold-start-"));
  const source = join(root, "character-audit");
  const outA = join(root, "audit-a.json");
  const outB = join(root, "audit-b.json");
  cpSync(resolve(import.meta.dir, "../src/extensions/examples/bunzai.extension.character-audit"), source, { recursive: true });
  try {
    const checked = Bun.spawnSync(["bun", "run", "scripts/extension-check.ts", source, "--host", "desktop", "--json"]);
    expect(checked.exitCode).toBe(0);
    expect(JSON.parse(checked.stdout.toString()).ok).toBe(true);
    const first = Bun.spawnSync(["bun", "run", "scripts/extension-pack.ts", "--source", source, "--out", outA]);
    const second = Bun.spawnSync(["bun", "run", "scripts/extension-pack.ts", "--source", source, "--out", outB]);
    expect(first.exitCode).toBe(0);
    expect(second.exitCode).toBe(0);
    const artifact = JSON.parse(readFileSync(outA, "utf8"));
    expect(artifact.digest).toBe(JSON.parse(readFileSync(outB, "utf8")).digest);
    expect(artifact.package.files["main.js"]).toContain('"content.list"');
    expect(artifact.package.manifest.contributions).toContainEqual(expect.objectContaining({ type: "panel", id: "audit-panel" }));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("cold-start tutorial artifact runs the documented audit command through the worker bridge", async () => {
  const root = mkdtempSync(join(tmpdir(), "bunzai-extension-tutorial-run-"));
  const source = join(root, "character-audit");
  const artifactPath = join(root, "audit.json");
  cpSync(resolve(import.meta.dir, "../src/extensions/examples/bunzai.extension.character-audit"), source, { recursive: true });
  try {
    const checked = Bun.spawnSync(["bun", "run", "scripts/extension-check.ts", source, "--host", "desktop", "--json"]);
    expect(checked.exitCode).toBe(0);
    const packed = Bun.spawnSync(["bun", "run", "scripts/extension-pack.ts", "--source", source, "--out", artifactPath]);
    expect(packed.exitCode).toBe(0);
    const artifact = JSON.parse(readFileSync(artifactPath, "utf8"));
    const requests: { operation: string; args: unknown }[] = [];
    const result = await runJavaScriptInWorker(artifact.package.files["main.js"], async (request) => {
      requests.push({ operation: request.operation, args: request.args });
      return { v: EXTENSION_WIRE_VERSION, type: "reply", id: request.id, ok: true,
        value: request.operation === "content.list" ? [{ id: "mira", kind: "character", name: "Mira" }] : { changed: true } };
    }, { invocation: { kind: "command", id: "audit", input: null, commands: ["audit"], events: [] } });
    expect(requests.map(({ operation }) => operation)).toEqual(["content.list", "ui.panel.set"]);
    expect(requests[0]?.args).toEqual({ scope: { type: "library" }, kinds: ["character"], fields: ["id", "kind", "name"], limit: 20 });
    expect(requests[1]?.args).toEqual({ contributionId: "audit-panel", descriptor: { version: 1,
      root: { type: "list", items: [{ type: "text", text: "Mira" }] } } });
    expect(result).toEqual({ updated: true });
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("draft, event-panel and prompt-hook examples all check and pack from isolated copies", () => {
  const names = ["bunzai.extension.draft-writer", "bunzai.extension.event-panel", "bunzai.extension.prompt-contributor"];
  const root = mkdtempSync(join(tmpdir(), "bunzai-extension-workflows-"));
  try {
    for (const name of names) {
      const source = join(root, name);
      const artifactPath = join(root, `${name}.json`);
      cpSync(resolve(import.meta.dir, `../src/extensions/examples/${name}`), source, { recursive: true });
      const checked = Bun.spawnSync(["bun", "run", "scripts/extension-check.ts", source, "--host", "desktop", "--json"]);
      expect(checked.exitCode).toBe(0);
      expect(JSON.parse(checked.stdout.toString()).ok).toBe(true);
      const packed = Bun.spawnSync(["bun", "run", "scripts/extension-pack.ts", "--source", source, "--out", artifactPath]);
      expect(packed.exitCode).toBe(0);
      const artifact = JSON.parse(readFileSync(artifactPath, "utf8"));
      expect(artifact.package.manifest.id).toBe(name);
      expect(artifact.package.files["main.js"]).toContain("bunzai.call");
      expect(artifact.digest).toMatch(/^[0-9a-f]{64}$/);
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});
