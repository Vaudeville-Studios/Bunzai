/** SQLite StateStore commit fencing for extension scene-state writes. */
import { afterEach, expect, test } from "bun:test";
import type { StoredExtensionControl } from "../../contracts/extension-store";
import { sqliteExtensionStore } from "./extension-store";
import { sqliteStateStore } from "./state-store";
import type { StageDatabase } from "./database";
import { freshDatabase, testCipher } from "./test-support";

const open: StageDatabase[] = [];
afterEach(() => { for (const database of open.splice(0)) database.close(); });
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

test("state document CAS is fenced by the installed extension authority in the transaction", async () => {
  let now = 1_000;
  const database = freshDatabase(open);
  const cipher = testCipher();
  const extensions = sqliteExtensionStore(database, cipher, () => now);
  const state = sqliteStateStore(database, cipher);
  const readVersioned = state.readVersioned;
  const compareAndWrite = state.compareAndWrite;
  if (!readVersioned || !compareAndWrite) throw new Error("fixture state store lacks extension CAS support");
  const lease = await extensions.acquireRuntimeFence(uuid(1), now, 30_000);
  if (!lease) throw new Error("fixture runtime lease unavailable");
  const control: StoredExtensionControl = { id: "fixture.extension", revision: 0, packageDigest: "a".repeat(64), policyFingerprint: "b".repeat(64), grantRevision: 1,
    grants: [{ operation: "collections.create", resources: [{ kind: "library", id: "library" }], fields: ["collections"], methods: [], destinations: [],
      duration: "persistent", budget: { requests: 4, bytes: 20_000, tokens: 0 } }], themeScopes: [], eventSubscriptions: [], registeredCommands: [], promptFailures: [], suspendedPromptIds: [], hostTrusted: false,
    enabled: true, recoveryRequired: false, dataVersion: 0, legacyThemeImport: "complete" };
  expect(await extensions.compareAndSaveControl(control, -1, lease)).toBe("saved");
  const commit = { ...lease, packageId: control.id, packageDigest: control.packageDigest, policyFingerprint: control.policyFingerprint,
    grantRevision: control.grantRevision, operation: "collections.create", access: { resources: [{ kind: "library", id: "library" }], fields: ["collections"], methods: [], destinations: [] }, now: () => now };
  expect(await readVersioned("collections")).toEqual({ text: null, revision: -1 });
  expect(await compareAndWrite("collections", "{}", -1, commit)).toBe("saved");
  expect(await readVersioned("collections")).toEqual({ text: "{}", revision: 0 });
  expect(await compareAndWrite("collections", "{\"other\":true}", -1, commit)).toBe("stale");
  expect(await compareAndWrite("collections", "{\"next\":true}", 0, commit)).toBe("saved");
  expect(await extensions.compareAndSaveControl({ ...control, revision: 1, enabled: false }, 0, lease)).toBe("saved");
  await expect(compareAndWrite("collections", "{\"forbidden\":true}", 1, commit)).rejects.toThrow("authority changed");
  expect(await state.read("collections")).toBe("{\"next\":true}");
  expect(await extensions.compareAndSaveControl({ ...control, revision: 2 }, 1, lease)).toBe("saved");
  now += 30_001;
  const takeover = await extensions.acquireRuntimeFence(uuid(2), now, 30_000);
  expect(takeover?.epoch).toBe(lease.epoch + 1);
  await expect(compareAndWrite("collections", "{\"forbidden\":true}", 1, commit)).rejects.toThrow("fence is stale");
  expect(await state.read("collections")).toBe("{\"next\":true}");
  now++;
});
