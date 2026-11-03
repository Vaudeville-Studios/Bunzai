/** Bundled helper extraction verifies bytes, isolates versions and never starts remote access. */
import { afterEach, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { prepareBundledSidecar } from "./bundled-sidecar";
import { sha256Hex } from "./aux-download";
import { handleRemoteRoutes, setupRemoteAccess } from "../server-remote";
import { SettingsStore } from "../../studio/settings";
import { createSidecarManager } from "./sidecar-manager";

const dirs: string[] = [];
afterEach(async () => { for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true }); });
async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), "bunzai-bundled-helper-")); dirs.push(dir);
  const file = join(dir, "included"); const bytes = new Uint8Array([1, 2, 3]);
  await writeFile(file, bytes);
  return { dir, bytes, helper: { platform: "win32-x64", sha256: sha256Hex(bytes), file } };
}

test("included helper is extracted once, keeps old versions and remains off", async () => {
  const { dir, bytes, helper } = await fixture();
  const path = await prepareBundledSidecar(helper, join(dir, "cache"), helper.platform);
  expect(new Uint8Array(await readFile(path!))).toEqual(bytes);
  const before = (await stat(path!)).mtimeMs;
  expect(await prepareBundledSidecar(helper, join(dir, "cache"), helper.platform)).toBe(path);
  expect((await stat(path!)).mtimeMs).toBe(before);
  await writeFile(helper.file, new Uint8Array([4, 5, 6]));
  const next = { ...helper, sha256: sha256Hex(new Uint8Array([4, 5, 6])) };
  expect(await prepareBundledSidecar(next, join(dir, "cache"), helper.platform)).not.toBe(path);
  expect(new Uint8Array(await readFile(path!))).toEqual(bytes);
  let spawned = 0;
  const handle = setupRemoteAccess({ settings: new SettingsStore(dir), studioDir: dir, bundledSidecar: path!, packaged: true,
    makeHandler: () => async () => new Response("fixture"),
    createSidecar: (options) => createSidecarManager({ ...options, spawn: (() => { spawned++; throw new Error("must stay off"); }) as typeof Bun.spawn }),
  });
  try {
    expect(handle.remote.getState().phase).toBe("off"); expect(spawned).toBe(0);
    const status = await handleRemoteRoutes(new Request("http://localhost/api/remote/helper/status"), "/api/remote/helper/status", { remote: handle.remote, settings: new SettingsStore(dir) });
    const value = await status!.json();
    expect(value).toMatchObject({ installed: true });
    expect(value).not.toHaveProperty("installedTag");
  }
  finally { handle.stop(); }
});

test("wrong target and corrupt included bytes are refused; corrupt cache is repaired from verified included bytes", async () => {
  const { dir, helper } = await fixture();
  const attempt = (value = helper, platform = helper.platform) => prepareBundledSidecar(value, join(dir, "cache"), platform).then(() => null, (error: unknown) => error);
  expect(await attempt(helper, "linux-x64")).toBeInstanceOf(Error);
  expect(await attempt({ ...helper, sha256: "a".repeat(64) })).toBeInstanceOf(Error);
  const path = await prepareBundledSidecar(helper, join(dir, "cache"), helper.platform);
  await writeFile(path!, "broken");
  expect(await prepareBundledSidecar(helper, join(dir, "cache"), helper.platform)).toBe(path);
  expect(new Uint8Array(await readFile(path!))).toEqual(new Uint8Array([1, 2, 3]));
  expect(await prepareBundledSidecar(null, dir)).toBeNull();
});

test("an unwritable cache fails without publishing a helper", async () => {
  const { dir, helper } = await fixture();
  const cache = join(dir, "not-a-directory"); await writeFile(cache, "fixture");
  const error = await prepareBundledSidecar(helper, cache, helper.platform).then(() => null, (cause: unknown) => cause);
  expect(error).toBeInstanceOf(Error);
  expect(await readFile(cache, "utf8")).toBe("fixture");
});
