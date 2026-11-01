/** Verifies that the trusted page registry never grants a native handle across principal changes. */
import { expect, test } from "bun:test";
import { createExtensionFileRegistry, type ExtensionFilePrincipal, type NativeFileHandle } from "./file-handles";

const owner: ExtensionFilePrincipal = { storeId: "store", packageId: "demo.files", packageDigest: "a".repeat(64), grantRevision: 2, runEpoch: 4 };
function fileHandle(name: string, initial: Uint8Array) {
  let data = new Uint8Array(initial); let lastModified = 10; let writes = 0;
  const native = {
    name,
    async getFile() { const copy = new Uint8Array(data); const blob = new Blob([copy]); return { size: copy.byteLength, type: "text/plain", lastModified, slice: (start = 0, end = copy.byteLength) => blob.slice(start, end) }; },
    async createWritable() { return { write: async (next: Uint8Array) => { data = new Uint8Array(next); writes++; lastModified++; }, close: async () => undefined, abort: async () => undefined }; },
  };
  return { native: native as unknown as NativeFileHandle, writes: () => writes, data: () => data };
}
function deferred() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => { release = resolve; });
  return { promise, release };
}
const registry = () => { let id = 0; return createExtensionFileRegistry({ id: () => `opaque-${++id}`, now: () => 1 }); };

test("read handles return bounded bytes only to the bound digest, grant revision and run epoch", async () => {
  const files = registry(); const target = fileHandle("notes.txt", new TextEncoder().encode("safe"));
  const info = await files.register(target.native, owner, "read");
  expect(info).toEqual({ id: "opaque-1", name: "notes.txt", size: 4, mediaType: "text/plain", mode: "read" });
  expect(files.has(info.id, owner, ["read"])).toBe(true);
  expect(files.has(info.id, { ...owner, runEpoch: 5 }, ["read"])).toBe(false);
  expect(Object.keys(info)).not.toContain("path");
  expect(new TextDecoder().decode(await files.read(info.id, owner, 4))).toBe("safe");
  await expect(files.read(info.id, owner, 3)).rejects.toThrow(/approved read limit/);
  await expect(files.read(info.id, { ...owner, packageDigest: "b".repeat(64) }, 4)).rejects.toThrow(/no longer available/);
  await expect(files.read(info.id, { ...owner, runEpoch: 5 }, 4)).rejects.toThrow(/no longer available/);
  await expect(files.read(info.id, { ...owner, grantRevision: 3 }, 4)).rejects.toThrow(/no longer available/);
});

test("write previews bind the current file and proposed bytes; mutations or stale handles deny writes", async () => {
  const files = registry(); const target = fileHandle("draft.txt", new TextEncoder().encode("old"));
  const info = await files.register(target.native, owner, "overwrite"); const proposed = new TextEncoder().encode("new");
  const review = await files.previewWrite(info.id, owner, proposed);
  expect(review.proposedBytes).toBe(3); expect(review.current.size).toBe(3);
  await expect(files.commitWrite(info.id, owner, new TextEncoder().encode("different"), review)).rejects.toThrow(/changed after review/);
  expect(target.writes()).toBe(0);
  await files.commitWrite(info.id, owner, proposed, review);
  expect(new TextDecoder().decode(target.data())).toBe("new"); expect(target.writes()).toBe(1);
  const stale = await files.previewWrite(info.id, owner, new TextEncoder().encode("last"));
  await target.native.createWritable().then(async (writer) => { await writer.write(new TextEncoder().encode("external")); await writer.close(); });
  await expect(files.commitWrite(info.id, owner, new TextEncoder().encode("last"), stale)).rejects.toThrow(/selected file changed/);
  expect(target.writes()).toBe(2);
});

test("revocation while snapshot is reading prevents writer creation", async () => {
  const files = registry(); const selected = fileHandle("paused.txt", new TextEncoder().encode("old"));
  let pause = false, entered = deferred(), release = deferred(), writers = 0;
  const native = { ...selected.native, async getFile() { if (pause) { entered.release(); await release.promise; } return selected.native.getFile(); }, async createWritable() { writers++; return selected.native.createWritable(); } } as NativeFileHandle;
  const info = await files.register(native, owner, "overwrite");
  const proposed = new TextEncoder().encode("new"), review = await files.previewWrite(info.id, owner, proposed);
  pause = true;
  const writing = files.commitWrite(info.id, owner, proposed, review);
  await entered.promise;
  files.invalidatePackage(owner.packageId); release.release();
  await expect(writing).rejects.toThrow(/no longer available/);
  expect(writers).toBe(0);
});

test("revocation during a staged write aborts before close", async () => {
  const files = registry(); const selected = fileHandle("paused-write.txt", new TextEncoder().encode("old"));
  const entered = deferred(), release = deferred(); let aborts = 0, closes = 0;
  const native = { ...selected.native, async createWritable() { return {
    async write() { entered.release(); await release.promise; }, async close() { closes++; }, async abort() { aborts++; },
  }; } } as NativeFileHandle;
  const info = await files.register(native, owner, "overwrite");
  const proposed = new TextEncoder().encode("new"), review = await files.previewWrite(info.id, owner, proposed);
  const writing = files.commitWrite(info.id, owner, proposed, review);
  await entered.promise;
  files.invalidatePackage(owner.packageId); release.release();
  await expect(writing).rejects.toThrow(/no longer available/);
  expect(aborts).toBe(1); expect(closes).toBe(0);
});

test("create mode starts empty and package invalidation or close disposes opaque handles", async () => {
  const files = registry();
  await expect(files.register(fileHandle("exists.txt", new TextEncoder().encode("x")).native, owner, "create")).rejects.toThrow(/start empty/);
  const info = await files.register(fileHandle("new.txt", new Uint8Array()).native, owner, "create");
  expect(files.size).toBe(1); expect(files.invalidatePackage(owner.packageId)).toBe(1); expect(files.size).toBe(0);
  await expect(files.read(info.id, owner, 10)).rejects.toThrow(/no longer available/);
  files.register(fileHandle("next.txt", new Uint8Array()).native, owner, "create"); files.close(); expect(files.size).toBe(0);
});

test("host handle registry enforces capacity and expires stale native references", async () => {
  let time = 0, next = 0;
  const files = createExtensionFileRegistry({ id: () => `opaque-${++next}`, now: () => time });
  for (let index = 0; index < 64; index++) await files.register(fileHandle(`file-${index}.txt`, new Uint8Array()).native, owner, "read");
  await expect(files.register(fileHandle("overflow.txt", new Uint8Array()).native, owner, "read")).rejects.toThrow(/limit is full/);
  time = 30 * 60_000;
  expect(files.size).toBe(0);
  const renewed = await files.register(fileHandle("renewed.txt", new Uint8Array()).native, owner, "read");
  expect(renewed.id).toBe("opaque-65");
});
