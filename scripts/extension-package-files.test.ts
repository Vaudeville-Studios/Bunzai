/** Test bounded source loading and path containment with isolated package folders. */
import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readPackageSource } from "./extension-package-files";
import { RELEASE_JS_LIMITS } from "../src/sandbox/javascript/limits";

const manifest = (assets: { path: string; mediaType: "image/png" }[] = []) => ({
  schemaVersion: 1, id: "example.source", version: "1.0.0", name: "Source", description: "",
  author: "test", api: { major: 1, minMinor: 0, maxMinor: 0 },
  requirements: [], contributions: [], theme: { requests: [], appearance: {}, assets },
});

test("source reader rejects traversal before reading package files", () => {
  const root = mkdtempSync(join(tmpdir(), "bunzai-extension-files-"));
  const outside = join(root, "outside.txt");
  const source = join(root, "source");
  mkdirSync(source);
  writeFileSync(outside, "secret");
  try {
    writeFileSync(join(source, "manifest.json"), JSON.stringify(manifest([{ id: "bad", path: "assets/../outside.txt", mediaType: "image/png" }])));
    expect(() => readPackageSource(source)).toThrow("invalid manifest");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("source reader rejects directory-link escapes", () => {
  const root = mkdtempSync(join(tmpdir(), "bunzai-extension-files-"));
  const source = join(root, "source");
  const outside = join(root, "outside");
  mkdirSync(source);
  mkdirSync(outside);
  writeFileSync(join(outside, "outside.png"), "secret");
  writeFileSync(join(source, "manifest.json"), JSON.stringify(manifest([{ id: "outside", path: "assets/outside.png", mediaType: "image/png" }])));
  try {
    symlinkSync(outside, join(source, "assets"), process.platform === "win32" ? "junction" : "dir");
    expect(() => readPackageSource(source)).toThrow("escapes its source directory");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("binary assets are read as bounded base64 package data", () => {
  const root = mkdtempSync(join(tmpdir(), "bunzai-extension-files-"));
  mkdirSync(join(root, "assets"));
  writeFileSync(join(root, "manifest.json"), JSON.stringify(manifest([{ id: "pixel", path: "assets/pixel.png", mediaType: "image/png" }])));
  writeFileSync(join(root, "assets", "pixel.png"), Buffer.from([0, 1, 2, 255]));
  try {
    const source = readPackageSource(root);
    expect(source.files["assets/pixel.png"]).toBe("AAEC/w==");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("source reader rejects entries that cannot be run by the packaged JavaScript guest", () => {
  const root = mkdtempSync(join(tmpdir(), "bunzai-extension-files-"));
  const entryManifest = { ...manifest(), theme: undefined, entry: "main.js" };
  const { theme: _theme, ...plainManifest } = entryManifest;
  writeFileSync(join(root, "manifest.json"), JSON.stringify(plainManifest));
  writeFileSync(join(root, "main.js"), "x".repeat(RELEASE_JS_LIMITS.sourceBytes + 1));
  try { expect(() => readPackageSource(root)).toThrow("source-size"); }
  finally { rmSync(root, { recursive: true, force: true }); }
});
