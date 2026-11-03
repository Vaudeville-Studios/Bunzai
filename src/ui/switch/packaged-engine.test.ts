/** A release download that runs past its cap is cut off, and the connection is let go. */
import { afterEach, expect, test } from "bun:test";
import { downloadAllowed, stagePackagedApp } from "./packaged-engine";
import { mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

test("a real-sized app download larger than the former 250 MiB cap succeeds", async () => {
  const chunk = new Uint8Array(8 * 1024 * 1024);
  let remaining = 38;
  const body = new ReadableStream<Uint8Array>({ pull(controller) {
    if (remaining-- > 0) controller.enqueue(chunk); else controller.close();
  } });
  globalThis.fetch = (async () => new Response(body, { status: 200 })) as unknown as typeof fetch;
  const outcome = await downloadAllowed("https://github.com/x/y/releases/download/v1/Bunzai.exe").then((bytes) => bytes.byteLength, (error: unknown) => error);
  expect(outcome).toBe(304 * 1024 * 1024);
});

test("a download past the cap is refused and its stream is cancelled", async () => {
  const chunk = new Uint8Array(8 * 1024 * 1024);
  const state = { cancelled: false };
  const body = new ReadableStream<Uint8Array>({ pull: (c) => c.enqueue(chunk), cancel() { state.cancelled = true; } });
  globalThis.fetch = (async () => new Response(body, { status: 200 })) as unknown as typeof fetch;
  const failure = await downloadAllowed("https://github.com/x/y/releases/download/v1/a.exe").then(() => null, (e: unknown) => e);
  expect((failure as Error).message).toMatch(/larger than expected/);
  expect(state.cancelled).toBe(true);
});

test("verified app staging replaces a prior file completely", async () => {
  const directory = await mkdtemp(join(tmpdir(), "bunzai-update-stage-"));
  try {
    const path = join(directory, "app");
    await writeFile(path, "old app");
    await stagePackagedApp(path, new TextEncoder().encode("verified app"));
    expect(await readFile(path, "utf8")).toBe("verified app");
    if (process.platform !== "win32") expect((await stat(path)).mode & 0o777).toBe(0o700);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test.skipIf(process.platform === "win32")("POSIX staging replaces a final symlink without overwriting its target", async () => {
  const directory = await mkdtemp(join(tmpdir(), "bunzai-update-link-"));
  try {
    const target = join(directory, "other");
    const staged = join(directory, "app");
    await writeFile(target, "keep me");
    await symlink(target, staged);
    await stagePackagedApp(staged, new TextEncoder().encode("verified app"));
    expect(await readFile(target, "utf8")).toBe("keep me");
    expect(await readFile(staged, "utf8")).toBe("verified app");
  } finally { await rm(directory, { recursive: true, force: true }); }
});
