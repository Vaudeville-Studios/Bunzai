/** SQLite scene setting CAS checks the reviewed revision and broker commit authority in one write transaction. */
import { afterEach, expect, test } from "bun:test";
import { EXTENSION_BUDGET_PRESETS } from "../../../extensions/contracts/operation";
import { sqliteChatStoreBackend } from "./chat-store";
import { sqliteExtensionStore } from "./extension-store";
import { castSnapshotCodec } from "../cast-snapshot-codec";
import { freshDatabase, testCipher } from "./test-support";

const databases: ReturnType<typeof freshDatabase>[] = [];
afterEach(() => { for (const database of databases.splice(0)) database.close(); });

test("SQLite scene settings reject stale first-party changes and revoked extension commits", async () => {
  const now = 12_000, database = freshDatabase(databases), cipher = testCipher(), packageId = "fixture.extension";
  const extensions = sqliteExtensionStore(database, cipher, () => now), chats = sqliteChatStoreBackend(database, cipher, castSnapshotCodec, () => now);
  const chat = await chats.createChat({ title: "Fixture", cast: { character: { id: "ada", version: 1 } }, snapshot: { character: {} } });
  const lease = await extensions.acquireRuntimeFence("00000000-0000-4000-8000-000000000012", now, 30_000);
  if (!lease) throw new Error("fixture runtime lease unavailable");
  const control = { id: packageId, revision: 0, packageDigest: "a".repeat(64), policyFingerprint: "b".repeat(64), grantRevision: 1,
    grants: [{ operation: "scenes.settings.apply", resources: [{ kind: "scene", id: chat.id }], fields: ["scene.settings.prompting"], methods: [], destinations: [], duration: "persistent" as const, budget: EXTENSION_BUDGET_PRESETS.write }],
    themeScopes: [], eventSubscriptions: [], registeredCommands: [], promptFailures: [], suspendedPromptIds: [], hostTrusted: false, enabled: true, recoveryRequired: false, dataVersion: 0, legacyThemeImport: "complete" as const };
  expect(await extensions.compareAndSaveControl(control, -1, lease)).toBe("saved");
  const commit = { owner: lease.owner, epoch: lease.epoch, packageId, packageDigest: control.packageDigest, policyFingerprint: control.policyFingerprint, grantRevision: 1, operation: "scenes.settings.apply", access: { resources: [{ kind: "scene", id: chat.id }], fields: ["scene.settings.prompting"], methods: [], destinations: [] }, now: () => now };
  const selector = { group: "prompting" } as const;
  const change = { group: "prompting" as const, patch: { note: { text: "extension", position: "in_chat" as const, depth: 1, frequency: 1 } } };
  const preview = await chats.previewSceneSetting(chat.id, selector, change);
  if (!preview) throw new Error("scene fixture disappeared");
  await chats.setPrompting(chat.id, { note: { text: "first-party", position: "in_chat", depth: 2, frequency: 1 } });
  expect(await chats.applySceneSetting(chat.id, selector, change, preview.revision, commit)).toEqual({ status: "stale" });
  expect((await chats.getChat(chat.id))?.prompting?.note?.text).toBe("first-party");
  expect(await extensions.compareAndSaveControl({ ...control, enabled: false, revision: 1 }, 0, lease)).toBe("saved");
  await expect(chats.applySceneSetting(chat.id, selector, change, "0".repeat(64), commit)).rejects.toThrow("authority changed");
  expect((await chats.getChat(chat.id))?.prompting?.note?.text).toBe("first-party");
  await extensions.releaseRuntimeFence(lease);
});
