/** SQLite ChatStore scene creation checks extension authority inside its creation transaction. */
import { afterEach, expect, test } from "bun:test";
import type { StoredExtensionControl } from "../../contracts/extension-store";
import { CAST, SNAP } from "../../contracts/chat-store.contract-rig";
import { castSnapshotCodec } from "../cast-snapshot-codec";
import { sqliteChatStoreBackend } from "./chat-store";
import { sqliteExtensionStore } from "./extension-store";
import type { StageDatabase } from "./database";
import { freshDatabase, testCipher } from "./test-support";

const databases: StageDatabase[] = [];
afterEach(() => { for (const database of databases.splice(0)) database.close(); });

test("SQLite scene creation rejects a package revoked before its native transaction", async () => {
  let now = 10_000;
  const database = freshDatabase(databases), cipher = testCipher();
  const extensions = sqliteExtensionStore(database, cipher, () => now);
  const lease = await extensions.acquireRuntimeFence("00000000-0000-4000-8000-000000000010", now, 30_000);
  if (!lease) throw new Error("fixture runtime lease unavailable");
  const control: StoredExtensionControl = { id: "fixture.extension", revision: 0, packageDigest: "a".repeat(64), policyFingerprint: "b".repeat(64), grantRevision: 1,
    grants: [{ operation: "scenes.create", resources: [{ kind: "character", id: "ada" }], fields: ["scene.create"], methods: [], destinations: [], duration: "persistent", budget: { requests: 4, bytes: 20_000, tokens: 0 } }],
    themeScopes: [], eventSubscriptions: [], registeredCommands: [], promptFailures: [], suspendedPromptIds: [], hostTrusted: false, enabled: true, recoveryRequired: false, dataVersion: 0, legacyThemeImport: "complete" };
  expect(await extensions.compareAndSaveControl(control, -1, lease)).toBe("saved");
  const chats = sqliteChatStoreBackend(database, cipher, castSnapshotCodec, () => now);
  const commit = { owner: lease.owner, epoch: lease.epoch, packageId: control.id, packageDigest: control.packageDigest, policyFingerprint: control.policyFingerprint,
    grantRevision: control.grantRevision, operation: "scenes.create", access: { resources: [{ kind: "character", id: "ada" }], fields: ["scene.create"], methods: [], destinations: [] }, now: () => now };
  await chats.createChat({ title: "Created", cast: CAST, snapshot: SNAP }, commit);
  expect(await extensions.compareAndSaveControl({ ...control, enabled: false, revision: 1 }, 0, lease)).toBe("saved");
  await expect(chats.createChat({ title: "Must not persist", cast: CAST, snapshot: SNAP }, commit)).rejects.toThrow("authority changed");
  expect((await chats.listChats()).chats).toHaveLength(1);
});

test("pending extension state survives later turn checkpoint saves and commits with the reply", async () => {
  let now = 20_000;
  const database = freshDatabase(databases), cipher = testCipher();
  const extensions = sqliteExtensionStore(database, cipher, () => now);
  const lease = await extensions.acquireRuntimeFence("00000000-0000-4000-8000-000000000020", now, 30_000);
  if (!lease) throw new Error("fixture runtime lease unavailable");
  const chats = sqliteChatStoreBackend(database, cipher, castSnapshotCodec, () => now++);
  const chat = await chats.createChat({ title: "Pending state", cast: CAST, snapshot: SNAP });
  const branch = (await chats.listBranches(chat.id))[0]!;
  const control: StoredExtensionControl = { id: "fixture.extension", revision: 0, packageDigest: "a".repeat(64), policyFingerprint: "b".repeat(64), grantRevision: 1,
    grants: [
      { operation: "state.write.apply", resources: [{ kind: "scene", id: chat.id }, { kind: "take", id: branch.id }], fields: ["state"], methods: [], destinations: [], duration: "persistent", budget: { requests: 4, bytes: 20_000, tokens: 0 } },
      { operation: "turns.start", resources: [{ kind: "scene", id: chat.id }, { kind: "host-connection", id: "conn" }], fields: ["turn.run", "model.prompt"], methods: [], destinations: ["connection:conn"], duration: "persistent", budget: { requests: 4, bytes: 20_000, tokens: 0 } },
    ],
    themeScopes: [], eventSubscriptions: [], registeredCommands: [], promptFailures: [], suspendedPromptIds: [], hostTrusted: false, enabled: true, recoveryRequired: false, dataVersion: 0, legacyThemeImport: "complete" };
  expect(await extensions.compareAndSaveControl(control, -1, lease)).toBe("saved");
  const commit = { owner: lease.owner, epoch: lease.epoch, packageId: control.id, packageDigest: control.packageDigest, policyFingerprint: control.policyFingerprint,
    grantRevision: control.grantRevision, operation: "state.write.apply", access: { resources: [{ kind: "scene", id: chat.id }, { kind: "take", id: branch.id }], fields: ["state"], methods: [], destinations: [] }, now: () => now };
  const turnCommit = { ...commit, operation: "turns.start", access: { resources: [{ kind: "scene", id: chat.id }, { kind: "host-connection", id: "conn" }], fields: ["turn.run", "model.prompt"], methods: [], destinations: ["connection:conn"] } };
  const firstParty = await chats.beginTurn(branch.id, { kind: "reply" }, { expectedVersion: branch.version });
  if (!firstParty) throw new Error("fixture first-party turn could not open");
  expect(await chats.appendPendingExtensionDeltas(firstParty.id, control.id, branch.version,
    [{ slot: "ext:fixture.extension:memory", path: ["draft"], value: "must not stage", at: now }], commit)).toBe(false);
  expect(await chats.dropTurn(firstParty.id)).toBe(true);
  const checkpoint = await chats.beginTurn(branch.id, { kind: "reply" }, { expectedVersion: branch.version }, turnCommit);
  if (!checkpoint) throw new Error("fixture turn could not open");
  const delta = { slot: "ext:fixture.extension:memory", path: ["draft"], value: "approved", at: now };
  expect(await chats.appendPendingExtensionDeltas(checkpoint.id, control.id, branch.version, [delta], commit)).toBe(true);
  expect(await chats.saveCheckpoint(checkpoint.id, { content: "partial", deltas: [] })).not.toBeNull();
  const completed = await chats.commitTurn(checkpoint.id, { content: "complete" }, { expectedVersion: branch.version }, turnCommit);
  expect(completed).not.toBeNull();
  expect(await chats.sceneState(branch.id)).toMatchObject({ "ext:fixture.extension:memory": { draft: { value: "approved" } } });
  const currentBranch = (await chats.listBranches(chat.id))[0]!;
  const committedMessages = await chats.readMessages(currentBranch.id, { limit: 10 });
  const replyMessage = committedMessages.messages.at(-1);
  if (!replyMessage) throw new Error("fixture reply message is missing");
  const continueTurn = await chats.beginTurn(currentBranch.id, { kind: "continue", messageId: replyMessage.id }, { expectedVersion: currentBranch.version }, turnCommit);
  if (!continueTurn) throw new Error("fixture continue turn could not open");
  expect(await chats.appendPendingExtensionDeltas(continueTurn.id, control.id, currentBranch.version,
    [{ slot: "ext:fixture.extension:memory", path: ["draft"], value: "continue is unsupported", at: now }], commit)).toBe(false);
  expect(await chats.dropTurn(continueTurn.id)).toBe(true);
  const revokedTurn = await chats.beginTurn(currentBranch.id, { kind: "reply" }, { expectedVersion: currentBranch.version }, turnCommit);
  if (!revokedTurn) throw new Error("fixture second turn could not open");
  expect(await chats.appendPendingExtensionDeltas(revokedTurn.id, control.id, currentBranch.version,
    [{ slot: "ext:fixture.extension:memory", path: ["draft"], value: "must not commit", at: now }], commit)).toBe(true);
  expect(await extensions.compareAndSaveControl({ ...control, enabled: false, revision: 1 }, 0, lease)).toBe("saved");
  await expect(chats.commitTurn(revokedTurn.id, { content: "first-party recovery attempt" }, { expectedVersion: currentBranch.version })).rejects.toThrow("owns pending state");
  expect(await chats.sceneState(currentBranch.id)).toMatchObject({ "ext:fixture.extension:memory": { draft: { value: "approved" } } });
  expect(await chats.dropTurn(revokedTurn.id)).toBe(true);
});
