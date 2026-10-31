/** Memory ExtensionStore parity tests for revision fencing, namespaced data and quotas. */
import { expect, test } from "bun:test";
import { memoryExtensionStore } from "./extension-store";
import type { ExtensionBudgetReservation } from "../../contracts/extension-store";

const owner = "00000000-0000-4000-8000-000000000001";
test("CAS storage and a revoked lease reject stale revisions and writes", async () => {
  let now = 1_000; const store = memoryExtensionStore(() => now);
  const fence = await store.acquireRuntimeFence(owner, now, 30_000);
  expect(fence).toEqual({ owner, epoch: 1, recoveryRequired: false });
  expect(await store.acquireRuntimeFence("00000000-0000-4000-8000-000000000002", now + 1, 30_000)).toBeNull();
  expect(await store.compareAndSaveData("example.extension", "prefs", { mode: "quiet" }, -1, fence!)).toBe("saved");
  expect(await store.compareAndSaveData("example.extension", "prefs", { mode: "loud" }, -1, fence!)).toBe("stale");
  expect(await store.readData("example.extension", "prefs")).toEqual({ value: { mode: "quiet" }, revision: 0 });
  now += 30_001;
  const next = await store.acquireRuntimeFence("00000000-0000-4000-8000-000000000002", now, 30_000);
  expect(next).toEqual({ owner: "00000000-0000-4000-8000-000000000002", epoch: 2, recoveryRequired: true });
  await expect(store.deleteData("example.extension", "prefs", 0, fence!)).rejects.toThrow("fence is stale");
});

test("budget requests are reserved before use, then settle bounded actual bytes and tokens", async () => {
  const store = memoryExtensionStore(() => 1_000); const fence = await store.acquireRuntimeFence(owner, 1_000, 30_000);
  const limits = { requests: 3, bytes: 100, tokens: 20 };
  const reservation: ExtensionBudgetReservation = { packageId: "example.extension", operation: "content.read", grantRevision: 2, id: "receipt-1", bytes: 40, tokens: 5 };
  expect(await store.reserveBudget({ ...reservation, operation: "logs.readOwn", id: "mixed-case-id", bytes: 1 }, limits, fence!)).toBe(true);
  expect(await store.settleBudget("example.extension", "mixed-case-id", 1, 0, fence!)).toBe(true);
  await expect(store.reserveBudget({ ...reservation, operation: "logs.ReadOwn", id: "invalid-id", bytes: 1 }, limits, fence!)).rejects.toThrow("invalid extension budget reservation");
  expect(await store.reserveBudget(reservation, limits, fence!)).toBe(true);
  expect(await store.reserveBudget({ ...reservation, id: "receipt-2", bytes: 61, tokens: 16 }, limits, fence!)).toBe(false);
  expect(await store.settleBudget("example.extension", reservation.id, 40, 5, fence!)).toBe(true);
  expect(await store.reserveBudget({ ...reservation, id: "receipt-3", bytes: 60, tokens: 15 }, limits, fence!)).toBe(true);
  expect(await store.finalizeAbandonedBudget("example.extension", fence!)).toBe(1);
  expect(await store.reserveBudget({ ...reservation, id: "receipt-4", bytes: 1, tokens: 0 }, limits, fence!)).toBe(false);
});

test("receipt IDs allow one immutable admitted-to-final transition only", async () => {
  const store = memoryExtensionStore(() => 1_000); const fence = await store.acquireRuntimeFence(owner, 1_000, 30_000);
  const admitted = { id: "receipt-settle", packageId: "example.extension", operation: "content.read", effect: "read" as const, status: "admitted" as const, createdAt: 1_000, resourceCount: 0 };
  const completed = { ...admitted, status: "completed" as const };
  await store.appendReceipt(admitted, fence!);
  await store.appendReceipt(completed, fence!);
  await store.appendReceipt(completed, fence!);
  await expect(store.appendReceipt({ ...completed, status: "denied" }, fence!)).rejects.toThrow("receipt ID was reused");
  await expect(store.appendReceipt({ ...completed, createdAt: 1_001 }, fence!)).rejects.toThrow("receipt ID was reused");
  expect(await store.listReceipts("example.extension", null, 10)).toEqual([completed]);
});

test("package and per-package extension data bounds fail closed", async () => {
  const store = memoryExtensionStore(() => 1_000); const fence = await store.acquireRuntimeFence(owner, 1_000, 30_000);
  await expect(store.savePackage({ digest: "a".repeat(64), bytes: new Uint8Array(8_000_001) }, fence!)).rejects.toThrow("invalid extension package bytes");
  const value = "x".repeat(62_000);
  for (let i = 0; i < 80; i++) expect(await store.compareAndSaveData("example.extension", `key-${i}`, value, -1, fence!)).toBe("saved");
  await expect(store.compareAndSaveData("example.extension", "key-over", value, -1, fence!)).rejects.toThrow("extension data storage limit reached");
});

test("memory data commits enforce current enabled grant authority, not only the lease", async () => {
  const store = memoryExtensionStore(() => 1_000); const fence = await store.acquireRuntimeFence(owner, 1_000, 30_000);
  const control = { id: "example.extension", revision: 0, packageDigest: "a".repeat(64), policyFingerprint: "b".repeat(64), grantRevision: 1,
    grants: [{ operation: "storage.set", resources: [], fields: [], methods: [], destinations: [], duration: "persistent" as const, budget: { requests: 10, bytes: 100_000, tokens: 0 } }],
    themeScopes: [], eventSubscriptions: [], registeredCommands: [], promptFailures: [], suspendedPromptIds: [], hostTrusted: false, enabled: true, recoveryRequired: false, dataVersion: 0, legacyThemeImport: "complete" as const };
  expect(await store.compareAndSaveControl(control, -1, fence!)).toBe("saved");
  const commit = { ...fence!, packageId: control.id, packageDigest: control.packageDigest, policyFingerprint: control.policyFingerprint,
    grantRevision: control.grantRevision, operation: "storage.set", access: { resources: [], fields: [], methods: [], destinations: [] }, now: () => 1_000 };
  await expect(store.compareAndSaveData(control.id, "outside-grant", { enabled: true }, -1,
    { ...commit, access: { ...commit.access, fields: ["admin"] } })).rejects.toThrow("exceeds the live grant");
  await expect(store.compareAndSaveData(control.id, "missing-snapshot", { enabled: true }, -1,
    { ...commit, access: undefined })).rejects.toThrow("missing or exceeds");
  expect(await store.compareAndSaveData(control.id, "prefs", { enabled: true }, -1, commit)).toBe("saved");
  expect(await store.compareAndSaveControl({ ...control, enabled: false, revision: 1 }, 0, fence!)).toBe("saved");
  await expect(store.compareAndSaveData(control.id, "prefs", { enabled: false }, 0, commit)).rejects.toThrow("authority changed");
  expect(await store.readData(control.id, "prefs")).toEqual({ value: { enabled: true }, revision: 0 });
});

test("operational logs are package scoped, bounded and commit fenced", async () => {
  const store = memoryExtensionStore(() => 1_000); const fence = await store.acquireRuntimeFence(owner, 1_000, 30_000);
  const control = { id: "example.extension", revision: 0, packageDigest: "a".repeat(64), policyFingerprint: "b".repeat(64), grantRevision: 1,
    grants: [{ operation: "logs.write", resources: [], fields: ["logs"], methods: [], destinations: [], duration: "persistent" as const, budget: { requests: 10, bytes: 100_000, tokens: 0 } }],
    themeScopes: [], eventSubscriptions: [], registeredCommands: [], promptFailures: [], suspendedPromptIds: [], hostTrusted: false, enabled: true, recoveryRequired: false, dataVersion: 0, legacyThemeImport: "complete" as const };
  expect(await store.compareAndSaveControl(control, -1, fence!)).toBe("saved");
  const commit = { ...fence!, packageId: control.id, packageDigest: control.packageDigest, policyFingerprint: control.policyFingerprint,
    grantRevision: control.grantRevision, operation: "logs.write", access: { resources: [], fields: ["logs"], methods: [], destinations: [] }, now: () => 1_000 };
  await expect(store.appendLog(control.id, { id: "l1", createdAt: 1_000, level: "info", message: "ok" }, { ...commit, operation: "storage.set" })).rejects.toThrow("authority changed");
  await expect(store.appendLog(control.id, { id: "l2", createdAt: 1_000, level: "info", message: "\u{1F642}".repeat(257) }, commit)).rejects.toThrow("size limit");
  await store.appendLog(control.id, { id: "l1", createdAt: 1_000, level: "info", message: "ok" }, commit);
  expect(await store.listLogs(control.id, null, 10)).toEqual({ records: [{ id: "l1", createdAt: 1_000, level: "info", message: "ok" }], nextCursor: null });
});
