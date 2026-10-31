/** UI relay regressions for native picker, read chunks and reviewed writes. */
import { afterEach, expect, test } from "bun:test";
import { sha256HexBytes } from "../../core/sha256";
import { createExtensionFileRegistry, type NativeFileHandle } from "./file-handles";
import { answerExtensionFileAction, pickExtensionFile, type ExtensionFileActionApi } from "./file-actions";
import type { PendingExtensionFileAction } from "../../extensions/contracts/file-actions";

const principal = { storeId: "store", packageId: "demo.files", packageDigest: "a".repeat(64), grantRevision: 2, runEpoch: 3 };
const nativeFile = (name: string, initial: Uint8Array) => {
  let data = new Uint8Array(initial);
  let stamp = 1;
  return {
    name,
    async getFile() {
      const copy = new Uint8Array(data);
      const blob = new Blob([copy]);
      return { size: copy.byteLength, lastModified: stamp, type: "text/plain", slice: (start = 0, end = copy.length) => blob.slice(start, end) };
    },
    async createWritable() { return { write: async (bytes: Uint8Array) => { data = new Uint8Array(bytes); stamp++; }, close: async () => undefined, abort: async () => undefined }; },
    data: () => data,
  };
};
const registry = () => createExtensionFileRegistry({ id: () => "handle-1" });
const ticket = (value: Partial<PendingExtensionFileAction> & Record<string, unknown>): PendingExtensionFileAction => ({
  id: "ticket-1", packageId: principal.packageId, packageName: "Files", principal, expiresAt: 10,
  ...value,
} as PendingExtensionFileAction);
const saved = ["isSecureContext", "showOpenFilePicker", "showDirectoryPicker"] as const;
const prior = new Map(saved.map((key) => [key, (globalThis as unknown as Record<string, unknown>)[key]]));
afterEach(() => { for (const key of saved) { const value = prior.get(key); if (value === undefined) delete (globalThis as unknown as Record<string, unknown>)[key]; else (globalThis as unknown as Record<string, unknown>)[key] = value; } });

test("native selection keeps the handle in the local registry and returns only opaque metadata", async () => {
  const picked = nativeFile("notes.txt", new TextEncoder().encode("safe"));
  Object.assign(globalThis, { isSecureContext: true, showOpenFilePicker: async () => [picked] });
  const files = registry();
  const result = await pickExtensionFile(ticket({ operation: "files.pick", action: "pick", mode: "read" }) as Extract<PendingExtensionFileAction, { action: "pick" }>, files);
  expect(result).toMatchObject({ status: "picked", handle: { id: "handle-1", name: "notes.txt", mode: "read" } });
  expect(Object.keys(result.status === "picked" ? result.handle : {})).not.toContain("native");
  expect(files.has("handle-1", principal, ["read"])).toBe(true);
});

test("picker access fails closed without a secure context and the required native picker", async () => {
  Object.assign(globalThis, { isSecureContext: false });
  await expect(pickExtensionFile(ticket({ operation: "files.pick", action: "pick", mode: "read" }) as Extract<PendingExtensionFileAction, { action: "pick" }>, registry())).rejects.toThrow(/secure desktop window/);
  Object.assign(globalThis, { isSecureContext: true });
  await expect(pickExtensionFile(ticket({ operation: "files.pick", action: "pick", mode: "read" }) as Extract<PendingExtensionFileAction, { action: "pick" }>, registry())).rejects.toThrow(/unavailable in this desktop window/);
});

test("read sends ordered bounded byte chunks and never places bytes in the ticket", async () => {
  const bytes = new Uint8Array(40_000).fill(7);
  const file = nativeFile("large.txt", bytes);
  const files = registry(); await files.register(file as unknown as NativeFileHandle, principal, "read");
  const request: PendingExtensionFileAction = ticket({ operation: "files.read", action: "read", handleId: "handle-1", maxBytes: 50_000, fileName: "large.txt" });
  const chunks: { offset: number; total: number; length: number; final: boolean }[] = [];
  const api: ExtensionFileActionApi = {
    beginFileWrite: async () => true,
    answerFileAction: async () => true,
    completeFileReadChunk: async (_id, offset, total, part, final) => { chunks.push({ offset, total, length: part.length, final }); return true; },
    fileWriteChunk: async () => null,
  };
  expect(await answerExtensionFileAction(request, files, api)).toBe(true);
  expect(chunks).toEqual([{ offset: 0, total: 40_000, length: 32_768, final: false }, { offset: 32_768, total: 40_000, length: 7_232, final: true }]);
});

test("write reassembles digest-bound chunks and writes only the matching reviewed snapshot", async () => {
  const bytes = new TextEncoder().encode("new");
  const file = nativeFile("draft.txt", new TextEncoder().encode("old"));
  const files = registry(); await files.register(file as unknown as NativeFileHandle, principal, "overwrite");
  const before = await files.snapshotForWrite("handle-1", principal);
  const digest = sha256HexBytes(bytes);
  const request: PendingExtensionFileAction = ticket({ operation: "files.write.apply", action: "write", handleId: "handle-1", fileName: "draft.txt", mode: "overwrite", current: before, proposedDigest: digest, proposedBytes: bytes.length });
  const api: ExtensionFileActionApi = {
    beginFileWrite: async () => true,
    answerFileAction: async (_id, result) => result.status === "written" && result.digest === digest,
    completeFileReadChunk: async () => false,
    fileWriteChunk: async (_id, offset) => ({ offset, totalBytes: bytes.length, bytes: bytes.slice(offset), final: true, digest }),
  };
  expect(await answerExtensionFileAction(request, files, api)).toBe(true);
  expect(new TextDecoder().decode(file.data())).toBe("new");
});

test("stale service admission prevents the trusted UI from starting native file I/O", async () => {
  const bytes = new TextEncoder().encode("new"), file = nativeFile("draft.txt", new TextEncoder().encode("old"));
  const files = registry(); const handle = await files.register(file as unknown as NativeFileHandle, principal, "overwrite");
  const current = await files.snapshotForWrite(handle.id, principal), digest = sha256HexBytes(bytes);
  const request: PendingExtensionFileAction = ticket({ operation: "files.write.apply", action: "write", handleId: handle.id, fileName: handle.name, mode: "overwrite", current, proposedDigest: digest, proposedBytes: bytes.length });
  const answers: string[] = [];
  const api: ExtensionFileActionApi = {
    beginFileWrite: async () => false,
    answerFileAction: async (_id, answer) => { answers.push(answer.status); return true; },
    completeFileReadChunk: async () => false,
    fileWriteChunk: async (_id, offset) => ({ offset, totalBytes: bytes.length, bytes: bytes.slice(offset), final: true, digest }),
  };
  await expect(answerExtensionFileAction(request, files, api)).rejects.toThrow(/no longer approved/);
  expect(answers).toEqual(["cancelled"]);
  expect(new TextDecoder().decode(file.data())).toBe("old");
});

test("writer close errors report an ambiguous outcome and never claim success", async () => {
  const previous = new TextEncoder().encode("old"), bytes = new TextEncoder().encode("new"), digest = sha256HexBytes(bytes);
  const blob = new Blob([previous]);
  const native = { name: "draft.txt", async getFile() { return { size: previous.length, lastModified: 1, type: "text/plain", slice: () => blob }; }, async createWritable() { return { write: async () => undefined, close: async () => { throw new Error("close failed"); }, abort: async () => undefined }; } };
  const files = registry(); const handle = await files.register(native as unknown as NativeFileHandle, principal, "overwrite");
  const current = await files.snapshotForWrite(handle.id, principal);
  const request: PendingExtensionFileAction = ticket({ operation: "files.write.apply", action: "write", handleId: handle.id, fileName: handle.name, mode: "overwrite", current, proposedDigest: digest, proposedBytes: bytes.length });
  const answers: string[] = [];
  const api: ExtensionFileActionApi = {
    beginFileWrite: async () => true,
    answerFileAction: async (_id, answer) => { answers.push(answer.status); return true; },
    completeFileReadChunk: async () => false,
    fileWriteChunk: async (_id, offset) => ({ offset, totalBytes: bytes.length, bytes: bytes.slice(offset), final: true, digest }),
  };
  await expect(answerExtensionFileAction(request, files, api)).rejects.toThrow(/outcome is uncertain/);
  expect(answers).toEqual(["ambiguous"]);
});

test("lost written receipt attempts an ambiguous fallback instead of reporting success", async () => {
  const bytes = new TextEncoder().encode("new"), digest = sha256HexBytes(bytes), file = nativeFile("draft.txt", new TextEncoder().encode("old"));
  const files = registry(); const handle = await files.register(file as unknown as NativeFileHandle, principal, "overwrite");
  const current = await files.snapshotForWrite(handle.id, principal);
  const request: PendingExtensionFileAction = ticket({ operation: "files.write.apply", action: "write", handleId: handle.id, fileName: handle.name, mode: "overwrite", current, proposedDigest: digest, proposedBytes: bytes.length });
  const answers: string[] = [];
  const api: ExtensionFileActionApi = {
    beginFileWrite: async () => true,
    answerFileAction: async (_id, answer) => { answers.push(answer.status); return answer.status === "ambiguous"; },
    completeFileReadChunk: async () => false,
    fileWriteChunk: async (_id, offset) => ({ offset, totalBytes: bytes.length, bytes: bytes.slice(offset), final: true, digest }),
  };
  await expect(answerExtensionFileAction(request, files, api)).rejects.toThrow(/completion receipt could not be confirmed/);
  expect(answers).toEqual(["written", "ambiguous"]);
  expect(new TextDecoder().decode(file.data())).toBe("new");
});

test("create mode uses a host-generated unique name in a user-selected directory", async () => {
  let exists = false, createCalls = 0; let created: ReturnType<typeof nativeFile> | undefined;
  Object.assign(globalThis, { isSecureContext: true, showDirectoryPicker: async () => ({ getFileHandle: async (name: string, options: { create: boolean }) => {
    if (!exists && !options.create) throw new DOMException("not found", "NotFoundError");
    if (options.create) { exists = true; createCalls++; created = nativeFile(name, new Uint8Array()); }
    return created!;
  } }) });
  const files = registry();
  const result = await pickExtensionFile(ticket({ operation: "files.pick", action: "pick", mode: "create", suggestedName: "report.txt" }) as Extract<PendingExtensionFileAction, { action: "pick" }>, files);
  expect(result).toMatchObject({ status: "picked", handle: { mode: "create" } });
  expect(createCalls).toBe(0);
  if (result.status === "picked") {
    expect(result.handle.name).toMatch(/^report \(Bunzai [a-f0-9-]{8}-[a-f0-9-]{4}-[a-f0-9-]{4}-[a-f0-9-]{4}-[a-f0-9-]{12}\)\.txt$/u);
    const current = await files.snapshotForWrite(result.handle.id, principal);
    await files.commitWrite(result.handle.id, principal, new TextEncoder().encode("created"), { current, proposedDigest: sha256HexBytes(new TextEncoder().encode("created")) });
  }
  expect(createCalls).toBe(1);
  expect(new TextDecoder().decode(created!.data())).toBe("created");
});
