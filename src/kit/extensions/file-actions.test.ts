/** Purpose: exercise Terminal file tickets against isolated temporary files and opaque handles. */
import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTerminalFileActions } from "./file-actions";
import { EXTENSION_FILE_HANDLE_TTL_MS, MAX_SELECTED_FILE_BYTES } from "../../extensions/contracts/limits";

const principal = { storeId: "terminal-fixture", packageId: "demo.files", packageDigest: "a".repeat(64), apiMajor: 1, policyFingerprint: "b".repeat(64), grantRevision: 1, runEpoch: 1 };
let serial = 0;
const create = () => createTerminalFileActions({ now: Date.now, id: () => `file-ticket-${++serial}` });
const waitFor = async (port: ReturnType<typeof createTerminalFileActions>, action: string) => {
  for (let attempt = 0; attempt < 100; attempt++) {
    const ticket = port.pending().find((item) => item.action === action);
    if (ticket) return ticket;
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
  throw new Error(`no pending ${action} ticket`);
};

test("Terminal selects a host path, then returns only an opaque handle and bounded bytes", async () => {
  const dir = await mkdtemp(join(tmpdir(), "bunzai-extension-read-")), path = join(dir, "sample.txt"), files = create();
  await writeFile(path, "host-selected contents");
  try {
    const selectedPromise = files.port.pick({ packageName: "Fixture", principal, mode: "read", signal: new AbortController().signal });
    const pick = await waitFor(files, "pick");
    await files.process(pick.id, path);
    const handle = await selectedPromise;
    if (!handle) throw new Error("host file selection did not return an opaque handle");
    expect(handle).toMatchObject({ name: "sample.txt", mode: "read", size: 22 });
    expect(JSON.stringify(handle)).not.toContain(path);
    const readPromise = files.port.read({ packageName: "Fixture", principal, handleId: handle!.id, maxBytes: 100, signal: new AbortController().signal });
    await files.process((await waitFor(files, "read")).id);
    const bytes = await readPromise;
    if (!bytes) throw new Error("host-selected file read did not return bytes");
    expect(new TextDecoder().decode(bytes)).toBe("host-selected contents");
  } finally { files.close(); await rm(dir, { recursive: true, force: true }); }
});

test("Terminal writes only staged bytes and reports snapshot drift as cancelled", async () => {
  const dir = await mkdtemp(join(tmpdir(), "bunzai-extension-write-")), createdPath = join(dir, "new.txt"), existingPath = join(dir, "existing.txt"), files = create();
  await writeFile(existingPath, "before");
  try {
    const createPromise = files.port.pick({ packageName: "Fixture", principal, mode: "create", signal: new AbortController().signal });
    const createPick = await waitFor(files, "pick"); await files.process(createPick.id, createdPath);
    const createHandle = await createPromise;
    const bytes = new TextEncoder().encode("created by approved extension");
    const previewPromise = files.port.previewWrite({ packageName: "Fixture", principal, handleId: createHandle!.id, bytes, signal: new AbortController().signal });
    await files.process((await waitFor(files, "preview-write")).id);
    const preview = await previewPromise;
    const staged = files.port.stageWrite({ packageName: "Fixture", principal, previewId: preview!.previewId, signal: new AbortController().signal });
    const writePromise = files.port.write({ packageName: "Fixture", principal, previewId: preview!.previewId, signal: new AbortController().signal });
    await files.process(staged.id);
    await expect(writePromise).resolves.toBe("written");
    expect(new TextDecoder().decode(await readFile(createdPath))).toBe("created by approved extension");

    const overwritePromise = files.port.pick({ packageName: "Fixture", principal, mode: "overwrite", signal: new AbortController().signal });
    const overwritePick = await waitFor(files, "pick"); await files.process(overwritePick.id, existingPath);
    const existing = await overwritePromise;
    const overwritePreviewPromise = files.port.previewWrite({ packageName: "Fixture", principal, handleId: existing!.id, bytes: new TextEncoder().encode("replacement"), signal: new AbortController().signal });
    await files.process((await waitFor(files, "preview-write")).id);
    const overwritePreview = await overwritePreviewPromise;
    const overwriteTicket = files.port.stageWrite({ packageName: "Fixture", principal, previewId: overwritePreview!.previewId, signal: new AbortController().signal });
    const overwriteWrite = files.port.write({ packageName: "Fixture", principal, previewId: overwritePreview!.previewId, signal: new AbortController().signal });
    await writeFile(existingPath, "changed elsewhere");
    await files.process(overwriteTicket.id);
    await expect(overwriteWrite).resolves.toBe("cancelled");
    expect(new TextDecoder().decode(await readFile(existingPath))).toBe("changed elsewhere");
  } finally { files.close(); await rm(dir, { recursive: true, force: true }); }
});

test("expired opaque handles are pruned before enforcing the per-runtime handle cap", async () => {
  let now = 1_000;
  const dir = await mkdtemp(join(tmpdir(), "bunzai-extension-expiry-")), path = join(dir, "sample.txt");
  const files = createTerminalFileActions({ now: () => now, id: () => `expired-${++serial}` });
  await writeFile(path, "selected");
  const pickOne = async () => {
    const pending = files.port.pick({ packageName: "Fixture", principal, mode: "read", signal: new AbortController().signal });
    await files.process((await waitFor(files, "pick")).id, path);
    return pending;
  };
  try {
    for (let index = 0; index < 64; index++) await pickOne();
    now += EXTENSION_FILE_HANDLE_TTL_MS + 1;
    await expect(pickOne()).resolves.toMatchObject({ name: "sample.txt", mode: "read" });
  } finally { files.close(); await rm(dir, { recursive: true, force: true }); }
});

test("revocation during staged-byte hashing prevents a native file write", async () => {
  const dir = await mkdtemp(join(tmpdir(), "bunzai-extension-revoke-write-")), path = join(dir, "new.txt"), files = create();
  try {
    const picked = files.port.pick({ packageName: "Fixture", principal, mode: "create", signal: new AbortController().signal });
    await files.process((await waitFor(files, "pick")).id, path);
    const handle = await picked;
    const bytes = new TextEncoder().encode("must not be written after revocation");
    const previewPromise = files.port.previewWrite({ packageName: "Fixture", principal, handleId: handle!.id, bytes, signal: new AbortController().signal });
    await files.process((await waitFor(files, "preview-write")).id);
    const preview = await previewPromise;
    const ticket = files.port.stageWrite({ packageName: "Fixture", principal, previewId: preview!.previewId, signal: new AbortController().signal });
    const writing = files.port.write({ packageName: "Fixture", principal, previewId: preview!.previewId, signal: new AbortController().signal });
    const processing = files.process(ticket.id);
    files.port.invalidatePackage(principal.packageId);
    await processing;
    await expect(writing).resolves.toBe("cancelled");
    await expect(readFile(path)).rejects.toThrow();
  } finally { files.close(); await rm(dir, { recursive: true, force: true }); }
});

test("oversized host selections are rejected from file metadata before allocating a read buffer", async () => {
  const dir = await mkdtemp(join(tmpdir(), "bunzai-extension-too-large-")), path = join(dir, "large.bin"), files = create();
  try {
    await writeFile(path, new Uint8Array(MAX_SELECTED_FILE_BYTES + 1));
    const picked = files.port.pick({ packageName: "Fixture", principal, mode: "read", signal: new AbortController().signal });
    await files.process((await waitFor(files, "pick")).id, path);
    await expect(picked).resolves.toBeNull();
  } finally { files.close(); await rm(dir, { recursive: true, force: true }); }
});
