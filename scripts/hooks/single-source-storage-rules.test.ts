/** Storage-write rule fixtures; the live scan remains in single-source-core.test.ts. */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { reviewedTerminalFileActionProtocol } from "./single-source-storage-protocol";
import { appDataWriteOutsideHome } from "./single-source-storage-rules";
describe("appDataWriteOutsideHome", () => {
  test("allows atomic-file.ts itself", () => {
    expect(appDataWriteOutsideHome("src/studio/atomic-file.ts", 'import { rename } from "node:fs/promises";', new Set())).toBeNull();
  });

  test("flags a bare writeFileSync import elsewhere", () => {
    const hit = appDataWriteOutsideHome("src/studio/settings.ts", 'import { writeFileSync } from "node:fs";', new Set());
    expect(hit).toContain("writeAtomicReplace");
  });

  test("flags asynchronous named and namespace writeFile calls", () => {
    expect(appDataWriteOutsideHome("src/studio/settings.ts", 'import { writeFile as save } from "node:fs/promises"; await save(path, data);', new Set()))
      .toContain("writeFile");
    expect(appDataWriteOutsideHome("src/studio/settings.ts", 'import * as fs from "node:fs/promises"; await fs.writeFile(path, data);', new Set()))
      .toContain("writeFile");
    expect(appDataWriteOutsideHome("src/studio/settings.ts", 'import * as fs from "node:fs"; await fs.promises.writeFile(path, data);', new Set()))
      .toContain("writeFile");
  });

  test("ignores an unrelated same-named method, not a node:fs import", () => {
    expect(appDataWriteOutsideHome("src/ui/apps/scenes/scenes-list.tsx", "onSave={(t) => rename(id, t)}", new Set())).toBeNull();
  });

  test("ignores a commented-out import", () => {
    expect(appDataWriteOutsideHome("src/x.ts", '// import { renameSync } from "node:fs";', new Set())).toBeNull();
  });

  test("catches namespace and awaited dynamic filesystem writes without flagging reads", () => {
    expect(appDataWriteOutsideHome("src/studio/settings.ts", 'import * as fs from "node:fs/promises"; await fs.rename(a, b);', new Set()))
      .toContain("rename");
    expect(appDataWriteOutsideHome("src/studio/settings.ts", 'const fs = await import("node:fs"); await fs.promises.writeFileSync(a, b);', new Set()))
      .toContain("writeFileSync");
    expect(appDataWriteOutsideHome("src/studio/settings.ts", 'import * as fs from "node:fs/promises"; await fs.readFile(a);', new Set()))
      .toBeNull();
    expect(appDataWriteOutsideHome("src/studio/settings.ts", 'import * as fs from "node:fs/promises"; await fs.readdir(a);', new Set()))
      .toBeNull();
  });

  test("does not classify script-generated source publication as app-data storage", () => {
    expect(appDataWriteOutsideHome("scripts/helpers.ts", 'import { writeFileSync } from "node:fs"; writeFileSync(path, text);', new Set()))
      .toBeNull();
  });

  test("retains only the exact reviewed temporary and verified staging callsites", () => {
    const reviewed: [string, string][] = [
      ["src/core/preset/render/scratch.ts", 'const dir = await mkdtemp(join(tmpdir(), "bunzai-macro-lab-")); const preset = join(dir, `scratch.${req.engine}.json`); await writeFile(preset, scratchWireFile(req.engine, req.text), "utf8");'],
      ["src/ui/server-staging.ts", 'const dir = await mkdtemp(join(tmpdir(), "bunzai-import-staged-")); const sealed = JSON.stringify(aesSeal(STAGING_KEY, text, `${token}:${key}`)); const path = join(dir, `${key}.sealed`); await writeFile(path, sealed, { mode: 0o600 });'],
      ["src/kit/tools/preset-verify-export.ts", 'const dir = await mkdtemp(join(tmpdir(), "hoplight-verify-")); const path = join(dir, "preset.json"); await writeFile(path, text, "utf8");'],
      ["src/formats/_fixtures/lumiverse-archive/materialize.ts", 'const root = await mkdtemp(join(tmpdir(), "bunzai-lvbak-")); if (unsafeName(name)) throw new Error("unsafe"); const target = join(root, name); await writeFile(target, data);'],
      ["src/kit/providers/claude-cli.ts", 'const dir = await mkdtemp(join(tmpdir(), "bunzai-mcp-")); const path = join(dir, "config.json"); await writeFile(path, JSON.stringify({ mcpServers: {} }), { mode: 0o600, flag: "wx" });'],
      ["src/ui/switch/packaged-engine.ts", 'const stageDir = join(exeDir, ".bunzai-update"); if (!expected || got !== expected) throw new Error(); const staged = join(stageDir, assetName); await writeFile(staged, bytes);'],
    ];
    for (const [path, source] of reviewed) {
      expect(appDataWriteOutsideHome(path, `import { writeFile } from "node:fs/promises"; ${source}`, new Set())).toBeNull();
    }
    expect(appDataWriteOutsideHome(
      "src/core/preset/render/scratch.ts",
      'import { writeFile } from "node:fs/promises"; const dir = await mkdtemp(join(tmpdir(), "bunzai-macro-lab-")); const preset = join(dir, `scratch.${req.engine}.json`); await writeFile(preset, scratchWireFile(req.engine, req.text), "utf8"); await writeFile(other, text);',
      new Set(),
    )).toContain("writeAtomicReplace");
    expect(appDataWriteOutsideHome(
      "src/core/preset/render/scratch.ts",
      'import { writeFile } from "node:fs/promises"; import { writeFileSync } from "node:fs"; const dir = await mkdtemp(join(tmpdir(), "bunzai-macro-lab-")); const preset = join(dir, `scratch.${req.engine}.json`); await writeFile(preset, scratchWireFile(req.engine, req.text), "utf8"); writeFileSync(other, text);',
      new Set(),
    )).toContain("writeAtomicReplace");
    expect(appDataWriteOutsideHome(
      "src/core/preset/render/scratch.ts",
      'import { writeFile, writeFile as save } from "node:fs/promises"; const dir = await mkdtemp(join(tmpdir(), "bunzai-macro-lab-")); const preset = join(dir, `scratch.${req.engine}.json`); await writeFile(preset, scratchWireFile(req.engine, req.text), "utf8"); await save(appData, data);',
      new Set(),
    )).toContain("writeAtomicReplace");
    expect(appDataWriteOutsideHome(
      "src/kit/providers/claude-cli.ts",
      'import { writeFile } from "node:fs/promises"; const dir = await mkdtemp(join(tmpdir(), "bunzai-mcp-")); const path = join(dir, "config.json"); await writeFile(path, JSON.stringify({ mcpServers: {} }), { mode: 0o600 });',
      new Set(),
    )).toContain("writeAtomicReplace");
    expect(appDataWriteOutsideHome(
      "src/ui/switch/packaged-engine.ts",
      'import { writeFile } from "node:fs/promises"; const stageDir = join(exeDir, ".bunzai-update"); const staged = join(stageDir, assetName); if (!expected || got !== expected) throw new Error(); await writeFile(staged, bytes);',
      new Set(),
    )).toContain("writeAtomicReplace");
  });

  test("allows only the bounded Terminal opaque-handle file protocol", () => {
    const path = "src/kit/extensions/file-actions.ts";
    const source = readFileSync(path, "utf8");
    expect(reviewedTerminalFileActionProtocol(path, source)).toBe(true);
    expect(reviewedTerminalFileActionProtocol(path, `${source}\nawait open(otherPath, \"w\");`)).toBe(false);
  });
});

/**
 * Live-repo scan. Every entry names the specific write protocol it retains; ownership is not an
 * exemption. The UI migrations for library-root, aux-install and identity-file are covered by the
 * same live scan as this platform subtree.
 */
