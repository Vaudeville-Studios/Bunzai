/** Packaged helper authority never falls back to unsigned files placed beside the app. */
import { expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { SettingsStore } from "../studio/settings";
import { createSidecarManager } from "./remote/sidecar-manager";
import { handleRemoteRoutes, setupRemoteAccess, sidecarCandidates } from "./server-remote";

async function selection(packaged: boolean, included: boolean) {
  const dir = await mkdtemp(join(tmpdir(), "bunzai-helper-selection-"));
  const originalExec = process.execPath;
  const originalFetch = globalThis.fetch;
  const name = process.platform === "win32" ? "sidecar.exe" : "sidecar";
  const sibling = join(dir, "sidecar", name);
  const bundled = included ? join(dir, "verified-bundled") : undefined;
  await mkdir(join(dir, "sidecar"));
  await writeFile(sibling, "archive member: never executed");
  if (bundled) await writeFile(bundled, "verified fixture: never executed");
  process.execPath = join(dir, "Bunzai.exe");
  const settings = new SettingsStore(dir);
  let spawned: string | undefined;
  const options = {
    settings, studioDir: dir, packaged, bundledSidecar: bundled,
    makeHandler: () => async () => new Response("fixture"),
    createSidecar: (input: Parameters<typeof createSidecarManager>[0]) => createSidecarManager({
      ...input, spawn: (command: unknown) => { spawned = Array.isArray(command) && typeof command[0] === "string" ? command[0] : undefined; throw new Error("audit mock: no execution"); },
    }),
  };
  const handle = setupRemoteAccess(options);
  globalThis.fetch = Object.assign(async () => { throw new Error("test: downloads are forbidden"); }, { preconnect: originalFetch.preconnect });
  try {
    const before = handle.remote.getState();
    handle.remote.enable();
    const status = await handleRemoteRoutes(new Request("http://localhost/api/remote/helper/status"), "/api/remote/helper/status", { ...options, remote: handle.remote });
    const download = await handleRemoteRoutes(new Request("http://localhost/api/remote/helper/download", { method: "POST" }), "/api/remote/helper/download", { ...options, remote: handle.remote, packaged: true });
    return { spawned, before, status: await status!.json(), downloadStatus: download!.status, bundled, source: sidecarCandidates().find(existsSync) };
  } finally { globalThis.fetch = originalFetch; handle.stop(); process.execPath = originalExec; await rm(dir, { recursive: true, force: true }); }
}

test("a packaged app selects its verified bundle instead of an unsigned sibling", async () => {
  const result = await selection(true, true);
  expect(result.before.phase).toBe("off");
  expect(result.spawned).toBe(result.bundled);
  expect(result.status).toMatchObject({ installed: true, offered: false });
  expect(result.downloadStatus).toBe(409);
});

test("failed bundled preparation cannot fall back to a planted sibling", async () => {
  const result = await selection(true, false);
  expect(result.before.phase).toBe("unavailable");
  expect(result.spawned).toBeUndefined();
  expect(result.status).toMatchObject({ installed: false, offered: false });
  expect(result.downloadStatus).toBe(409);
});

test("source runs retain their deliberate developer helper locations", async () => {
  const result = await selection(false, false);
  expect(result.before.phase).toBe("off");
  expect(result.spawned).toBe(result.source);
});
