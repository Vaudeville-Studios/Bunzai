/** Keep Bun packaging from reading outside a selected extension source tree. */
import { expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bundleCapturedExtension, bundleExtensionEntry, captureExtensionBundle } from "./extension-bundler";

function fixture(): { root: string; source: string; outside: string; cleanup(): void } {
  const root = mkdtempSync(join(tmpdir(), "bunzai-extension-bundle-"));
  const source = join(root, "package");
  const outside = join(root, "outside");
  mkdirSync(source); mkdirSync(outside);
  writeFileSync(join(outside, "secret.txt"), "PRIVATE_FILE_CONTENT_91c0b6");
  writeFileSync(join(source, "manifest.json"), "{}");
  return { root, source, outside, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

test("bundles a local module and the exact trusted SDK source", async () => {
  const item = fixture();
  try {
    writeFileSync(join(item.source, "main.js"), 'import { helper } from "./helper.js"; import { bunzai } from "bunzai-extension-sdk"; bunzai.call("api.describe", {}); console.log(helper);');
    writeFileSync(join(item.source, "helper.js"), 'export const helper = "ok";');
    const bundle = await bundleExtensionEntry(item.source, "main.js");
    expect(bundle).toContain("api.describe");
    expect(bundle).toContain("ok");
  } finally { item.cleanup(); }
});

test("Bun receives the captured bytes if a source file changes after graph validation", async () => {
  const item = fixture();
  try {
    writeFileSync(join(item.source, "main.js"), 'import { helper } from "./helper.js"; console.log(helper);');
    writeFileSync(join(item.source, "helper.js"), 'export const helper = "captured-original";');
    const snapshot = captureExtensionBundle(item.source, "main.js");
    writeFileSync(join(item.source, "helper.js"), 'export const helper = "changed-after-capture";');
    const bundle = await bundleCapturedExtension(snapshot);
    expect(bundle).toContain("captured-original");
    expect(bundle).not.toContain("changed-after-capture");
  } finally { item.cleanup(); }
});

test("rejects relative outside imports without returning imported contents", async () => {
  const item = fixture();
  try {
    for (const source of [
      'import "../outside/secret.txt";',
      'import/**/"../outside/secret.txt";',
      'import { value } from/**/"../outside/secret.txt";',
      'export { value } from "../outside/secret.txt";',
    ]) {
      writeFileSync(join(item.source, "main.js"), source);
      await expect(bundleExtensionEntry(item.source, "main.js")).rejects.toThrow("escapes the package");
    }
  } catch (error) {
    expect(String(error)).not.toContain("PRIVATE_FILE_CONTENT_91c0b6");
    throw error;
  } finally { item.cleanup(); }
});

test("rejects file symlink and directory junction imports that resolve outside", async () => {
  const fileLink = fixture();
  let fileSymlinkAvailable = true;
  try {
    try { symlinkSync(join(fileLink.outside, "secret.txt"), join(fileLink.source, "secret-link.txt"), "file"); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "EPERM") fileSymlinkAvailable = false; else throw error; }
    if (fileSymlinkAvailable) {
      writeFileSync(join(fileLink.source, "main.js"), 'import "./secret-link.txt";');
      await expect(bundleExtensionEntry(fileLink.source, "main.js")).rejects.toThrow("escapes the package");
    }
  } catch (error) {
    expect(String(error)).not.toContain("PRIVATE_FILE_CONTENT_91c0b6");
    throw error;
  } finally { fileLink.cleanup(); }

  const directoryLink = fixture();
  try {
    // Junctions are available on Windows without file-symlink privilege and prove resolved containment.
    symlinkSync(directoryLink.outside, join(directoryLink.source, "linked"), "junction");
    writeFileSync(join(directoryLink.source, "main.js"), 'import "./linked/secret.txt";');
    await expect(bundleExtensionEntry(directoryLink.source, "main.js")).rejects.toThrow("escapes the package");
  } catch (error) {
    expect(String(error)).not.toContain("PRIVATE_FILE_CONTENT_91c0b6");
    throw error;
  } finally { directoryLink.cleanup(); }
});
