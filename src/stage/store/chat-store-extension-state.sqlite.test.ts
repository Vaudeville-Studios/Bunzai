/** SQLite authority-fence regression for extension-owned scene-state deltas. */
import { afterEach, expect, test } from "bun:test";
import type { StoredExtensionControl } from "../contracts/extension-store";
import { sqliteChatStore } from "./sqlite-chat-store";
import { sqliteExtensionStore } from "./sqlite/extension-store";
import type { StageDatabase } from "./sqlite/database";
import { freshDatabase, testCipher } from "./sqlite/test-support";

const open: StageDatabase[] = [];
afterEach(() => { for (const database of open.splice(0)) database.close(); });
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

test("extension scene slots are package-namespaced and SQLite commit is bound to live grants", async () => {
  const now = Date.now();
  const database = freshDatabase(open);
  const cipher = testCipher();
  const chats = sqliteChatStore(database, cipher);
  const chat = await chats.createChat({ title: "Fixture", cast: { character: { id: "ada", version: 1 } }, snapshot: { character: { name: "Ada" } } });
  const [message] = await chats.appendMessages(chat.activeBranchId, [{ role: "user", content: "hello" }]) ?? [];
  const extensions = sqliteExtensionStore(database, cipher, () => now);
  const lease = await extensions.acquireRuntimeFence(uuid(1), now, 30_000);
  const bytes = new TextEncoder().encode("fixture");
  const digest = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), (byte) => byte.toString(16).padStart(2, "0")).join("");
  await extensions.savePackage({ digest, bytes }, lease!);
  const control: StoredExtensionControl = { id: "fixture.extension", revision: 0, packageDigest: digest, policyFingerprint: "c".repeat(64), grantRevision: 1,
    grants: [{ operation: "state.write.apply", resources: [{ kind: "scene", id: chat.id }, { kind: "take", id: chat.activeBranchId }], fields: ["state"], methods: [], destinations: [], duration: "persistent", budget: { requests: 4, bytes: 10_000, tokens: 0 } }],
    themeScopes: [], eventSubscriptions: [], registeredCommands: [], promptFailures: [], suspendedPromptIds: [], hostTrusted: false, enabled: true, recoveryRequired: false, dataVersion: 0, legacyThemeImport: "complete" };
  expect(await extensions.compareAndSaveControl(control, -1, lease!)).toBe("saved");
  const commit = { owner: lease!.owner, epoch: lease!.epoch, packageId: control.id, packageDigest: digest, policyFingerprint: control.policyFingerprint,
    grantRevision: control.grantRevision, operation: "state.write.apply", access: { resources: [{ kind: "scene", id: chat.id }, { kind: "take", id: chat.activeBranchId }], fields: ["state"], methods: [], destinations: [] }, now: () => now };
  const delta = [{ slot: "ext:fixture.extension:memory", path: ["count"] as string[], value: 1, at: now }];
  expect(await chats.recordExtensionMessageDeltas(commit, chat.activeBranchId, message!.id, [...delta])).toBe(true);
  expect(await chats.sceneState(chat.activeBranchId)).toMatchObject({ "ext:fixture.extension:memory": { count: { value: 1 } } });
  const activeTurn = await chats.beginTurn(chat.activeBranchId, { kind: "reply" });
  if (!activeTurn) throw new Error("fixture turn could not open");
  await expect(chats.recordExtensionMessageDeltas(commit, chat.activeBranchId, message!.id, [{ ...delta[0]!, path: ["count"], value: 2 }])).rejects.toThrow("while a turn is active");
  expect(await chats.sceneState(chat.activeBranchId)).toMatchObject({ "ext:fixture.extension:memory": { count: { value: 1 } } });
  expect(await chats.dropTurn(activeTurn.id)).toBe(true);
  expect(await extensions.compareAndSaveControl({ ...control, enabled: false, revision: 1 }, 0, lease!)).toBe("saved");
  await expect(chats.recordExtensionMessageDeltas(commit, chat.activeBranchId, message!.id, [{ ...delta[0]!, path: ["count"], value: 2 }])).rejects.toThrow("authority changed");
  expect(await chats.sceneState(chat.activeBranchId)).toMatchObject({ "ext:fixture.extension:memory": { count: { value: 1 } } });
  await expect(chats.recordExtensionMessageDeltas(commit, chat.activeBranchId, message!.id, [{ ...delta[0]!, slot: "ext:other.extension:memory" }])).rejects.toThrow("namespace");
});

test("SQLite ChatStore append rechecks package authority inside the branch transaction", async () => {
  const now = Date.now(), database = freshDatabase(open), cipher = testCipher();
  const chats = sqliteChatStore(database, cipher);
  const chat = await chats.createChat({ title: "Fixture", cast: { character: { id: "ada", version: 1 } }, snapshot: { character: { name: "Ada" } } });
  const branch = (await chats.listBranches(chat.id))[0]!;
  const extensions = sqliteExtensionStore(database, cipher, () => now);
  const lease = await extensions.acquireRuntimeFence(uuid(2), now, 30_000);
  if (!lease) throw new Error("fixture runtime lease unavailable");
  const control: StoredExtensionControl = { id: "fixture.extension", revision: 0, packageDigest: "a".repeat(64), policyFingerprint: "b".repeat(64), grantRevision: 1,
    grants: [{ operation: "messages.send", resources: [{ kind: "scene", id: chat.id }, { kind: "take", id: branch.id }], fields: ["message.content"], methods: [], destinations: [], duration: "persistent", budget: { requests: 4, bytes: 20_000, tokens: 0 } }],
    themeScopes: [], eventSubscriptions: [], registeredCommands: [], promptFailures: [], suspendedPromptIds: [], hostTrusted: false, enabled: true, recoveryRequired: false, dataVersion: 0, legacyThemeImport: "complete" };
  expect(await extensions.compareAndSaveControl(control, -1, lease)).toBe("saved");
  const commit = { owner: lease.owner, epoch: lease.epoch, packageId: control.id, packageDigest: control.packageDigest, policyFingerprint: control.policyFingerprint,
    grantRevision: control.grantRevision, operation: "messages.send", access: { resources: [{ kind: "scene", id: chat.id }, { kind: "take", id: branch.id }], fields: ["message.content"], methods: [], destinations: [] }, now: () => now };
  expect((await chats.appendMessage(branch.id, { role: "user", content: "before revoke" }, { expectedVersion: branch.version }, commit))?.swipes[0]?.content).toBe("before revoke");
  expect(await extensions.compareAndSaveControl({ ...control, enabled: false, revision: 1 }, 0, lease)).toBe("saved");
  await expect(chats.appendMessage(branch.id, { role: "user", content: "after revoke" }, { expectedVersion: 2 }, commit)).rejects.toThrow("authority changed");
  expect((await chats.readMessages(branch.id, { limit: 10 })).messages.map((item) => item.swipes[0]?.content)).toEqual(["before revoke"]);
});
