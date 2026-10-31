/** SQLite extension persistence, fencing, encryption and revision boundary tests. */
import { afterEach, expect, test } from "bun:test";
import type { ExtensionBudgetReservation, StoredExtensionControl } from "../../contracts/extension-store";
import { freshDatabase, testCipher } from "./test-support";
import type { StageDatabase } from "./database";
import { sqliteExtensionStore } from "./extension-store";
import { attachRowFingerprints } from "./row-fingerprints";

const open: StageDatabase[] = [];
afterEach(() => { for (const db of open.splice(0)) db.close(); });
const uuid = (n: string): string => `00000000-0000-4000-8000-${n.padStart(12, "0")}`;
const digest = async (bytes: Uint8Array): Promise<string> => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes.slice().buffer as ArrayBuffer)), (byte) => byte.toString(16).padStart(2, "0")).join("");
const control = (revision: number, digestValue: string): StoredExtensionControl => ({ id: "example.extension", revision, packageDigest: digestValue, policyFingerprint: "b".repeat(64), grantRevision: 0, grants: [], themeScopes: [], eventSubscriptions: [], registeredCommands: [], promptFailures: [], suspendedPromptIds: [], hostTrusted: false, enabled: false, recoveryRequired: false, dataVersion: 1, legacyThemeImport: "pending" });

test("extension bytes, control and own data persist sealed with compare-and-update", async () => {
  const database = freshDatabase(open); const cipher = testCipher(); attachRowFingerprints(database, cipher); const store = sqliteExtensionStore(database, cipher);
  const fence = await store.acquireRuntimeFence(uuid("1"), Date.now(), 30_000);
  expect(fence).not.toBeNull();
  const bytes = new TextEncoder().encode("fixture package source"); const packageDigest = await digest(bytes);
  await store.savePackage({ digest: packageDigest, bytes }, fence!);
  expect(await store.readPackage(packageDigest)).toEqual({ digest: packageDigest, bytes });
  expect(await store.compareAndSaveControl(control(0, packageDigest), -1, fence!)).toBe("saved");
  expect(await store.compareAndSaveControl(control(1, packageDigest), -1, fence!)).toBe("stale");
  expect(await store.compareAndSaveData("example.extension", "prefs", { theme: "paper" }, -1, fence!)).toBe("saved");
  expect(await store.readData("example.extension", "prefs")).toEqual({ value: { theme: "paper" }, revision: 0 });
  expect(await store.listDataKeys("example.extension", 10)).toEqual(["prefs"]);
  expect(database.statement("SELECT body_cell FROM extension_packages").get()).not.toMatchObject({ body_cell: bytes.toString() });
});

test("receipt IDs allow one immutable admitted-to-final transition only", async () => {
  const database = freshDatabase(open); const cipher = testCipher(); attachRowFingerprints(database, cipher); const store = sqliteExtensionStore(database, cipher);
  const fence = await store.acquireRuntimeFence(uuid("11"), Date.now(), 30_000);
  const admitted = { id: "receipt-settle", packageId: "example.extension", operation: "content.read", effect: "read" as const, status: "admitted" as const, createdAt: 1_000, resourceCount: 0 };
  const completed = { ...admitted, status: "completed" as const };
  await store.appendReceipt(admitted, fence!);
  await store.appendReceipt(completed, fence!);
  await store.appendReceipt(completed, fence!);
  await expect(store.appendReceipt({ ...completed, status: "denied" }, fence!)).rejects.toThrow("receipt ID was reused");
  await expect(store.appendReceipt({ ...completed, createdAt: 1_001 }, fence!)).rejects.toThrow("receipt ID was reused");
  expect(await store.listReceipts("example.extension", null, 10)).toEqual([completed]);
  expect(database.statement("SELECT body_cell FROM extension_receipts").all()).toHaveLength(1);
});

test("only the live monotonically fenced owner may commit and rollback cannot acquire", async () => {
  let now = 10_000; const database = freshDatabase(open); const cipher = testCipher(); attachRowFingerprints(database, cipher); const store = sqliteExtensionStore(database, cipher, () => now);
  const first = await store.acquireRuntimeFence(uuid("1"), now, 30_000);
  expect(first?.recoveryRequired).toBe(false);
  expect(await store.acquireRuntimeFence(uuid("2"), now + 1, 30_000)).toBeNull();
  expect(await store.renewRuntimeFence(first!, now - 1, 30_000)).toBeNull();
  now += 30_001;
  const second = await store.acquireRuntimeFence(uuid("2"), now, 30_000);
  expect(second?.epoch).toBe(first!.epoch + 1);
  expect(second?.recoveryRequired).toBe(true);
  const bytes = new TextEncoder().encode("fixture"); const packageDigest = await digest(bytes);
  await expect(store.savePackage({ digest: packageDigest, bytes }, first!)).rejects.toThrow("fence is stale");
  await store.savePackage({ digest: packageDigest, bytes }, second!);
});

test("budget admissions and settlements are atomic and cumulative", async () => {
  const database = freshDatabase(open); const cipher = testCipher(); attachRowFingerprints(database, cipher); const store = sqliteExtensionStore(database, cipher);
  const fence = await store.acquireRuntimeFence(uuid("3"), Date.now(), 30_000);
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

test("extension data mutations validate package grant context inside their SQLite commit transaction", async () => {
  const now = Date.now();
  const database = freshDatabase(open); const cipher = testCipher(); attachRowFingerprints(database, cipher); const store = sqliteExtensionStore(database, cipher, () => now);
  const fence = await store.acquireRuntimeFence(uuid("8"), now, 30_000);
  expect(fence).not.toBeNull();
  const bytes = new TextEncoder().encode("fixture package"); const packageDigest = await digest(bytes);
  await store.savePackage({ digest: packageDigest, bytes }, fence!);
  const current = { ...control(0, packageDigest), id: "example.extension", policyFingerprint: "c".repeat(64), grantRevision: 1, enabled: true,
    grants: [{ operation: "storage.set", resources: [], fields: ["data"], methods: [], destinations: [], duration: "persistent" as const, budget: { requests: 3, bytes: 5_000, tokens: 0 } }] };
  expect(await store.compareAndSaveControl(current, -1, fence!)).toBe("saved");
  const context = { owner: fence!.owner, epoch: fence!.epoch, packageId: current.id, packageDigest, policyFingerprint: current.policyFingerprint,
    grantRevision: current.grantRevision, operation: "storage.set", access: { resources: [], fields: ["data"], methods: [], destinations: [] }, now: () => now };
  expect(await store.compareAndSaveData(current.id, "key", "first", -1, context)).toBe("saved");
  expect(await store.readData(current.id, "key")).toEqual({ value: "first", revision: 0 });
  expect(await store.compareAndSaveControl({ ...current, enabled: false, revision: 1 }, 0, fence!)).toBe("saved");
  await expect(store.compareAndSaveData(current.id, "key", "second", 0, context)).rejects.toThrow("authority changed");
  expect(await store.readData(current.id, "key")).toEqual({ value: "first", revision: 0 });
});

test("operational logs are encrypted, package scoped and authority fenced", async () => {
  const now = Date.now(); const database = freshDatabase(open); const cipher = testCipher(); attachRowFingerprints(database, cipher);
  const store = sqliteExtensionStore(database, cipher, () => now); const fence = await store.acquireRuntimeFence(uuid("9"), now, 30_000);
  const pkgDigest = await digest(new TextEncoder().encode("fixture")); await store.savePackage({ digest: pkgDigest, bytes: new TextEncoder().encode("fixture") }, fence!);
  const current = { ...control(0, pkgDigest), id: "example.extension", policyFingerprint: "c".repeat(64), grantRevision: 1, enabled: true,
    grants: [{ operation: "logs.write", resources: [], fields: ["logs"], methods: [], destinations: [], duration: "persistent" as const, budget: { requests: 3, bytes: 5_000, tokens: 0 } }] };
  expect(await store.compareAndSaveControl(current, -1, fence!)).toBe("saved");
  const context = { owner: fence!.owner, epoch: fence!.epoch, packageId: current.id, packageDigest: pkgDigest, policyFingerprint: current.policyFingerprint,
    grantRevision: current.grantRevision, operation: "logs.write", access: { resources: [], fields: ["logs"], methods: [], destinations: [] }, now: () => now };
  await store.appendLog(current.id, { id: "log-1", createdAt: now, level: "warn", message: "fixture only" }, context);
  expect(await store.listLogs(current.id, null, 5)).toEqual({ records: [{ id: "log-1", createdAt: now, level: "warn", message: "fixture only" }], nextCursor: null });
  expect(database.statement("SELECT body_cell FROM extension_logs").get()).not.toMatchObject({ body_cell: "fixture only" });
  await store.compareAndSaveControl({ ...current, enabled: false, revision: 1 }, 0, fence!);
  await expect(store.appendLog(current.id, { id: "log-2", createdAt: now, level: "info", message: "denied" }, context)).rejects.toThrow("authority changed");
});

test("uninstall atomically clears user-owned package state and deletes unreferenced package bytes", async () => {
  const database = freshDatabase(open); const cipher = testCipher(); attachRowFingerprints(database, cipher); const store = sqliteExtensionStore(database, cipher);
  const fence = await store.acquireRuntimeFence(uuid("10"), Date.now(), 30_000);
  const bytes = new TextEncoder().encode("uninstall fixture"); const packageDigest = await digest(bytes);
  await store.savePackage({ digest: packageDigest, bytes }, fence!);
  expect(await store.compareAndSaveControl(control(0, packageDigest), -1, fence!)).toBe("saved");
  expect(await store.compareAndSaveData("example.extension", "private", { secret: "fixture" }, -1, fence!)).toBe("saved");
  expect(await store.removeInstalled("example.extension", 0, fence!)).toBe("saved");
  expect(await store.readControl("example.extension")).toBeNull();
  expect(await store.readData("example.extension", "private")).toBeNull();
  expect(await store.readPackage(packageDigest)).toBeNull();
  expect(await store.removeInstalled("example.extension", 0, fence!)).toBe("stale");
});

test("swapped encrypted rows are detected on read and controls reject unknown keys", async () => {
  const database = freshDatabase(open); const cipher = testCipher(); attachRowFingerprints(database, cipher); const store = sqliteExtensionStore(database, cipher);
  const fence = await store.acquireRuntimeFence(uuid("4"), Date.now(), 30_000);
  const firstBytes = new TextEncoder().encode("first package"); const secondBytes = new TextEncoder().encode("second package");
  const firstDigest = await digest(firstBytes); const secondDigest = await digest(secondBytes);
  await store.savePackage({ digest: firstDigest, bytes: firstBytes }, fence!);
  await store.savePackage({ digest: secondDigest, bytes: secondBytes }, fence!);
  await store.compareAndSaveControl({ ...control(0, firstDigest), id: "first.extension" }, -1, fence!);
  await store.compareAndSaveControl({ ...control(0, secondDigest), id: "second.extension" }, -1, fence!);
  const bodyA = database.statement("SELECT body_cell FROM extension_packages WHERE digest = ?").get(firstDigest) as { body_cell: string };
  const bodyB = database.statement("SELECT body_cell FROM extension_packages WHERE digest = ?").get(secondDigest) as { body_cell: string };
  database.statement("UPDATE extension_packages SET body_cell = ? WHERE digest = ?").run(bodyB.body_cell, firstDigest);
  expect(await store.readPackage(firstDigest).then(() => false, () => true)).toBe(true);
  database.statement("UPDATE extension_packages SET body_cell = ? WHERE digest = ?").run(bodyA.body_cell, firstDigest);
  const controlA = database.statement("SELECT body_cell FROM extension_controls WHERE id_hash = ?").get(cipher.index("first.extension")) as { body_cell: string };
  const controlB = database.statement("SELECT body_cell FROM extension_controls WHERE id_hash = ?").get(cipher.index("second.extension")) as { body_cell: string };
  database.statement("UPDATE extension_controls SET body_cell = ? WHERE id_hash = ?").run(controlB.body_cell, cipher.index("first.extension"));
  expect(await store.readControl("first.extension").then(() => false, () => true)).toBe(true);
  await expect(store.compareAndSaveControl({ ...control(1, firstDigest), extra: true } as never, 0, fence!)).rejects.toThrow();
  database.statement("UPDATE extension_controls SET body_cell = ? WHERE id_hash = ?").run(controlA.body_cell, cipher.index("first.extension"));
});
