/**
 * The disk-write list: every source file that writes to disk is
 * named here with the reason its write is safe. A new file that writes fails this test until it is
 * added with a reason, so library content can never start landing on disk in the clear unnoticed.
 */
import { expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const WRITES: Record<string, string> = {
  // The folder seam: only the folder export writes through it; the library never does.
  "src/studio/atomic-file.ts": "the folder backend's atomic writes, behind StudioFs",
  "src/studio/fs-backend.ts": "the folder backend, behind StudioFs",
  "src/studio/exports.ts": "exports: real files the person asked for, on purpose outside the library",
  "src/studio/folder-export.ts": "the folder export: plain files the person asked for, into a new or empty folder outside the studio",
  "src/studio/folder-export-held.ts": "the folder export's held writer: one big piece written into the same person-chosen export folder, picture by picture",
  "src/kit/sessions/store.ts": "Kit transcripts: sealed in the library when one is open; plain files only without one",
  // Temporary files, deleted when their job ends; the temp sweep clears any a crash strands.
  "src/ui/server-staging.ts": "staged import entities, sealed with an in-memory key",
  "src/ui/server-engine.ts": "the uploaded archive (the person's own file), owner-only, deleted after use",
  "src/ui/server-body.ts": "the uploaded archive (the person's own file), owner-only, deleted after use",
  "src/core/preset/render/scratch.ts": "preset text for an outside engine that reads a file, deleted at once",
  "src/kit/render/clipboard-read.ts": "a pasted image, deleted after sending",
  "src/kit/providers/claude-cli.ts": "an MCP config for the Claude CLI; no library content",
  "src/kit/tools/preset-verify-export.ts": "an export the person asked for, verified in a temp folder",
  // Exports and outputs the person asked for.
  "src/cli-io.ts": "CLI output to a path the person chose",
  // No library content.
  "src/desktop-webview-lib.ts": "bundled native-library bytes only, atomically cached in a verified per-user platform directory; existing entries require exact bytes and metadata, and contain no library content",
  "src/desktop-boot-report.ts": "reports of a failed start: the error's kind, message, and stack; never a file's text",
  "src/kit/providers/vault.ts": "provider secrets, sealed by the key vault",
  "src/kit/keystore/backends/identity-write.ts": "exclusive key-vault identity file creation and partial-write cleanup",
  "src/studio/test-temp-dir.ts": "test-only temporary fixture directories, removed in finally",
  "src/ui/server-asset-staging.ts": "bounded staged uploads sealed with a per-process AES key; cleanup removes temporary ciphertext",
  "src/kit/keystore/backends/keychain-key.ts": "the keychain lock file: a random token, no content",
  "src/stage/crypto/device-vault.ts": "this computer's id and its sealed check",
  "src/kit/mcp/config.ts": "MCP server settings",
  "src/kit/tools/safety/gate-store.ts": "Kit's safety mode setting",
  "src/ui/remote/aux-install.ts": "the downloaded remote-access helper",
  "src/ui/switch/packaged-engine.ts": "a downloaded app version",
  // Build and test tooling, never shipped as a runtime path.
  "src/stage/store/sqlite/snapshots.ts": "snapshots: zeroes a crashed run's leftover partial copies before removing them",
  "src/stage/store/sqlite/snapshot-jobs.ts": "snapshots: sealed cells copied byte for byte, no computer's key copy; a restore's scratch copy is deleted after",
  "src/stage/store/sqlite/health-test-support.ts": "the health check tests' temp folders, removed after each test",
  "src/stage/store/fake-snapshot-rig.ts": "the snapshot tests' temp folders, removed after each test",
  "src/stage/store/sqlite/lane-probe.ts": "the compiled-binary probe's throwaway database",
  "src/formats/_fixtures/lumiverse-archive/materialize.ts": "test fixture tooling",
  "src/ui/fake-server-chats-rig.ts": "the scene route tests' temp folders, removed after each test",
};

const WRITE =
  /Bun\.write\(|writeFile(Sync)?\(|appendFile(Sync)?\(|createWriteStream\(|mkdtemp(Sync)?\(|writeAtomicReplace\(|writeExclusive\(|writeSync\(|copyFile(Sync)?\(|\bcp(Sync)?\(|openSync\([^)]*"(w|a|wx)|open\([^)]*"(w|a|wx)"/;

function sources(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) sources(path, out);
    else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) out.push(path);
  }
  return out;
}

const writers = () => sources("src").filter((f) => f !== "src/studio/fs-contract.ts" && WRITE.test(readFileSync(f, "utf8")));

test("every source file that writes to disk is on the list, with the reason it is safe", () => {
  expect(writers().filter((f) => !(f in WRITES))).toEqual([]);
});

test("the list names only files that exist and still write", () => {
  const now = new Set(writers());
  expect(Object.keys(WRITES).filter((f) => !existsSync(join(f)) || !now.has(f))).toEqual([]);
});
