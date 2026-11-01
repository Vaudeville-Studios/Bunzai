/** SQLite compare-and-save coverage for persisted extension event subscriptions. */
import { afterEach, expect, test } from "bun:test";
import { sha256HexBytes } from "../../core/sha256";
import type { StoredExtensionControl } from "../contracts/extension-store";
import { sqliteExtensionStore } from "./sqlite/extension-store";
import type { StageDatabase } from "./sqlite/database";
import { attachRowFingerprints } from "./sqlite/row-fingerprints";
import { freshDatabase, testCipher } from "./sqlite/test-support";

const open: StageDatabase[] = [];
afterEach(() => { for (const database of open.splice(0)) database.close(); });

test("event subscription control updates require the exact live operation grant at the SQLite commit", async () => {
  let now = Date.now();
  const database = freshDatabase(open);
  const cipher = testCipher();
  attachRowFingerprints(database, cipher);
  const store = sqliteExtensionStore(database, cipher, () => now);
  const lease = await store.acquireRuntimeFence("00000000-0000-4000-8000-000000000001", now, 30_000);
  if (!lease) throw new Error("fixture lease unavailable");
  const bytes = new TextEncoder().encode("sealed fixture package");
  const packageDigest = sha256HexBytes(bytes);
  const policyFingerprint = "a".repeat(64);
  const grants: StoredExtensionControl["grants"] = ["events.subscribe", "events.unsubscribe"].map((operation) => ({
    operation, resources: [{ kind: "event", id: "scene.turn.completed" }, { kind: "scene", id: "scene-1" }], fields: ["payload"], methods: [], destinations: [],
    duration: "persistent", budget: { requests: 10, bytes: 100_000, tokens: 0 },
  }));
  const control: StoredExtensionControl = { id: "fixture.extension", revision: 0, packageDigest, policyFingerprint, grantRevision: 1, grants,
    themeScopes: [], eventSubscriptions: [], registeredCommands: [], promptFailures: [], suspendedPromptIds: [], hostTrusted: false, enabled: true, recoveryRequired: false, dataVersion: 0, legacyThemeImport: "complete" };
  await store.savePackage({ digest: packageDigest, bytes }, lease);
  expect(await store.compareAndSaveControl(control, -1, lease)).toBe("saved");
  const commit = { ...lease, packageId: control.id, packageDigest, policyFingerprint, grantRevision: 1, operation: "events.subscribe", access: { resources: [{ kind: "event", id: "scene.turn.completed" }, { kind: "scene", id: "scene-1" }], fields: ["payload"], methods: [], destinations: [] }, now: () => now };
  const next = { ...control, revision: 1, eventSubscriptions: [{ scope: "scene" as const, event: "scene.turn.completed" as const, sceneId: "scene-1" }] };
  expect(await store.compareAndSaveControl(next, 0, commit)).toBe("saved");
  const changedOperation = { ...commit, operation: "events.unknown" };
  await expect(store.compareAndSaveControl({ ...next, revision: 2 }, 1, changedOperation)).rejects.toThrow("authority changed");
  expect((await store.readControl(control.id))?.eventSubscriptions).toEqual(next.eventSubscriptions);
  now += 30_001;
  await expect(store.compareAndSaveControl({ ...next, revision: 2 }, 1, commit)).rejects.toThrow("fence is stale");
});
