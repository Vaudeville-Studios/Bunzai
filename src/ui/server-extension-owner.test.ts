/** Route-owner concurrency uses an isolated in-memory extension store. */
import { expect, test } from "bun:test";
import { memoryExtensionStore } from "../stage/store/memory/extension-store";
import type { OpenedLibrary, LibraryHandle } from "./library-root";
import { createExtensionRouteOwner } from "./server-extension-owner";
import { createContentStore } from "../stage/store/content-store";
import { memoryDocumentBackend } from "../stage/store/memory/document-backend";

test("concurrent route requests share exactly one fenced runtime for an opened library", async () => {
  const extensionStore = memoryExtensionStore();
  const opened = { state: "unlocked", extensionStore, content: createContentStore(memoryDocumentBackend()) } as unknown as OpenedLibrary;
  const library = { studioDir: "fixture", opened: () => opened, onLockChange: () => () => undefined, onRestore: () => () => undefined } as unknown as LibraryHandle;
  const owner = createExtensionRouteOwner(library, () => "http://127.0.0.1:9000");
  const [left, right] = await Promise.all([owner.get(), owner.get()]);
  expect(left).not.toBeNull();
  expect(right).toBe(left);
  await owner.close();
  const acquired = await extensionStore.acquireRuntimeFence("00000000-0000-4000-8000-000000000001", Date.now(), 30_000);
  expect(acquired).not.toBeNull();
});

test("locking during startup closes the stale service and releases its lease", async () => {
  const store = memoryExtensionStore();
  let announceStart!: () => void;
  let releaseStart!: () => void;
  const entered = new Promise<void>((resolve) => { announceStart = resolve; });
  const barrier = new Promise<void>((resolve) => { releaseStart = resolve; });
  const extensionStore = { ...store, async acquireRuntimeFence(owner: string, now: number, ttl: number) {
    announceStart();
    await barrier;
    return store.acquireRuntimeFence(owner, now, ttl);
  } };
  const opened = { state: "unlocked", extensionStore, content: createContentStore(memoryDocumentBackend()) } as unknown as OpenedLibrary;
  let onLock: ((state: "locked" | "unlocked") => void) | undefined;
  const library = { studioDir: "fixture", opened: () => opened, onLockChange: (callback: typeof onLock) => { onLock = callback; return () => undefined; }, onRestore: () => () => undefined } as unknown as LibraryHandle;
  const owner = createExtensionRouteOwner(library, () => "http://127.0.0.1:9000");
  const startup = owner.get();
  await entered;
  onLock?.("locked");
  releaseStart();
  expect(await startup).toBeNull();
  await owner.close();
  const replacement = await store.acquireRuntimeFence("00000000-0000-4000-8000-000000000002", Date.now(), 30_000);
  expect(replacement).not.toBeNull();
  if (replacement) await store.releaseRuntimeFence(replacement);
});
