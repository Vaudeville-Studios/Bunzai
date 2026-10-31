/** Test local package checks against isolated fixtures without evaluating guest code. */
import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RELEASE_JS_LIMITS } from "../src/sandbox/javascript/limits";

function fixture(): string {
  const directory = mkdtempSync(join(tmpdir(), "bunzai-extension-check-"));
  writeFileSync(join(directory, "manifest.json"), JSON.stringify({
    schemaVersion: 1, id: "example.checker", version: "1.0.0", name: "Checker",
    description: "", author: "test", api: { major: 1, minMinor: 0, maxMinor: 0 },
    requirements: [], contributions: [],
  }));
  return directory;
}

test("check accepts a valid inert package and rejects an unknown operation", () => {
  const directory = fixture();
  try {
    const good = Bun.spawnSync(["bun", "run", "scripts/extension-check.ts", directory, "--json"]);
    expect(good.exitCode).toBe(0);
    expect(JSON.parse(good.stdout.toString()).ok).toBe(true);
    const manifest = JSON.parse(readFileSync(join(directory, "manifest.json"), "utf8"));
    manifest.entry = "main.js";
    manifest.requirements = [{ operation: "guessed.secret", resources: [], fields: [], methods: [], destinations: [], purpose: "test", required: false }];
    writeFileSync(join(directory, "manifest.json"), JSON.stringify(manifest));
    writeFileSync(join(directory, "main.js"), "throw new Error('must not execute')");
    const bad = Bun.spawnSync(["bun", "run", "scripts/extension-check.ts", directory, "--json"]);
    expect(bad.exitCode).toBe(1);
    expect(JSON.parse(bad.stdout.toString()).error).toContain("unknown or unavailable operation");
    manifest.requirements = [];
    manifest.api.major = 99;
    writeFileSync(join(directory, "manifest.json"), JSON.stringify(manifest));
    const incompatible = Bun.spawnSync(["bun", "run", "scripts/extension-check.ts", directory, "--json"]);
    expect(incompatible.exitCode).toBe(1);
    expect(JSON.parse(incompatible.stdout.toString()).error).toContain("incompatible extension API");
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("check rejects an entry over the packaged guest source ceiling", () => {
  const directory = fixture();
  try {
    const manifest = JSON.parse(readFileSync(join(directory, "manifest.json"), "utf8"));
    manifest.entry = "main.js";
    writeFileSync(join(directory, "manifest.json"), JSON.stringify(manifest));
    writeFileSync(join(directory, "main.js"), "x".repeat(RELEASE_JS_LIMITS.sourceBytes + 1));
    const result = Bun.spawnSync(["bun", "run", "scripts/extension-check.ts", directory, "--json"]);
    expect(result.exitCode).toBe(1);
    expect(JSON.parse(result.stdout.toString()).error).toContain("source-size");
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
