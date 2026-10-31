/** Browser-memory ChatStore writes recheck the current package authority at the mutation door. */
import { expect, test } from "bun:test";
import { CAST, SNAP } from "../../contracts/chat-store.contract-rig";
import { memoryChatStore } from "../chat-store";
import { memoryExtensionStore } from "./extension-store";

test("a revoked extension cannot append to a memory ChatStore take", async () => {
  const now = 1_000, owner = "00000000-0000-4000-8000-000000000001";
  const extensions = memoryExtensionStore(() => now);
  const lease = await extensions.acquireRuntimeFence(owner, now, 30_000);
  if (!lease) throw new Error("fixture runtime lease unavailable");
  const chats = memoryChatStore(() => now, () => crypto.randomUUID(), { authorizeExtensionCommit: (context) => extensions.assertCommitContext(context) });
  const chat = await chats.createChat({ title: "Fixture", cast: CAST, snapshot: SNAP });
  const branch = (await chats.listBranches(chat.id))[0]!;
  const control = { id: "fixture.extension", revision: 0, packageDigest: "a".repeat(64), policyFingerprint: "b".repeat(64), grantRevision: 1,
    grants: [{ operation: "messages.send", resources: [{ kind: "scene", id: chat.id }, { kind: "take", id: branch.id }], fields: ["message.content"], methods: [], destinations: [], duration: "persistent" as const, budget: { requests: 4, bytes: 20_000, tokens: 0 } }],
    themeScopes: [], eventSubscriptions: [], registeredCommands: [], promptFailures: [], suspendedPromptIds: [], hostTrusted: false, enabled: true, recoveryRequired: false, dataVersion: 0, legacyThemeImport: "complete" as const };
  expect(await extensions.compareAndSaveControl(control, -1, lease)).toBe("saved");
  const commit = { owner: lease.owner, epoch: lease.epoch, packageId: control.id, packageDigest: control.packageDigest, policyFingerprint: control.policyFingerprint,
    grantRevision: control.grantRevision, operation: "messages.send", access: { resources: [{ kind: "scene", id: chat.id }, { kind: "take", id: branch.id }], fields: ["message.content"], methods: [], destinations: [] }, now: () => now };
  const saved = await chats.appendMessage(branch.id, { role: "user", content: "before revoke" }, { expectedVersion: branch.version }, commit);
  expect(saved?.swipes[0]?.content).toBe("before revoke");
  expect(await extensions.compareAndSaveControl({ ...control, enabled: false, revision: 1 }, 0, lease)).toBe("saved");
  await expect(chats.appendMessage(branch.id, { role: "user", content: "after revoke" }, { expectedVersion: 2 }, commit)).rejects.toThrow("authority changed");
  expect((await chats.readMessages(branch.id, { limit: 10 })).messages.map((item) => item.swipes[0]?.content)).toEqual(["before revoke"]);
});

test("a revoked extension cannot create a new memory ChatStore scene", async () => {
  const now = 3_000, owner = "00000000-0000-4000-8000-000000000003";
  const extensions = memoryExtensionStore(() => now);
  const lease = await extensions.acquireRuntimeFence(owner, now, 30_000);
  if (!lease) throw new Error("fixture runtime lease unavailable");
  const control = { id: "fixture.extension", revision: 0, packageDigest: "a".repeat(64), policyFingerprint: "b".repeat(64), grantRevision: 1,
    grants: [{ operation: "scenes.create", resources: [{ kind: "character", id: "ada" }], fields: ["scene.create"], methods: [], destinations: [], duration: "persistent" as const, budget: { requests: 4, bytes: 20_000, tokens: 0 } }],
    themeScopes: [], eventSubscriptions: [], registeredCommands: [], promptFailures: [], suspendedPromptIds: [], hostTrusted: false, enabled: true, recoveryRequired: false, dataVersion: 0, legacyThemeImport: "complete" as const };
  expect(await extensions.compareAndSaveControl(control, -1, lease)).toBe("saved");
  const chats = memoryChatStore(() => now, () => crypto.randomUUID(), { authorizeExtensionCommit: (context) => extensions.assertCommitContext(context) });
  const commit = { owner: lease.owner, epoch: lease.epoch, packageId: control.id, packageDigest: control.packageDigest, policyFingerprint: control.policyFingerprint,
    grantRevision: control.grantRevision, operation: "scenes.create", access: { resources: [{ kind: "character", id: "ada" }], fields: ["scene.create"], methods: [], destinations: [] }, now: () => now };
  await chats.createChat({ title: "Created", cast: CAST, snapshot: SNAP }, commit);
  expect(await extensions.compareAndSaveControl({ ...control, enabled: false, revision: 1 }, 0, lease)).toBe("saved");
  await expect(chats.createChat({ title: "Must not persist", cast: CAST, snapshot: SNAP }, commit)).rejects.toThrow("authority changed");
  expect((await chats.listChats()).chats).toHaveLength(1);
});

test("an extension cannot append committed scene state while the take has an active turn", async () => {
  const now = 2_000, owner = "00000000-0000-4000-8000-000000000002";
  const extensions = memoryExtensionStore(() => now);
  const lease = await extensions.acquireRuntimeFence(owner, now, 30_000);
  if (!lease) throw new Error("fixture runtime lease unavailable");
  const chats = memoryChatStore(() => now, () => crypto.randomUUID(), { authorizeExtensionCommit: (context) => extensions.assertCommitContext(context) });
  const chat = await chats.createChat({ title: "Fixture", cast: CAST, snapshot: SNAP });
  const branch = (await chats.listBranches(chat.id))[0]!;
  const [message] = await chats.appendMessages(branch.id, [{ role: "user", content: "Before turn" }]) ?? [];
  const control = { id: "fixture.extension", revision: 0, packageDigest: "a".repeat(64), policyFingerprint: "b".repeat(64), grantRevision: 1,
    grants: [
      { operation: "state.write.apply", resources: [{ kind: "scene", id: chat.id }, { kind: "take", id: branch.id }], fields: ["state"], methods: [], destinations: [], duration: "persistent" as const, budget: { requests: 4, bytes: 20_000, tokens: 0 } },
      { operation: "turns.start", resources: [{ kind: "scene", id: chat.id }, { kind: "host-connection", id: "conn" }], fields: ["turn.run", "model.prompt"], methods: [], destinations: ["connection:conn"], duration: "persistent" as const, budget: { requests: 4, bytes: 20_000, tokens: 0 } },
    ],
    themeScopes: [], eventSubscriptions: [], registeredCommands: [], promptFailures: [], suspendedPromptIds: [], hostTrusted: false, enabled: true, recoveryRequired: false, dataVersion: 0, legacyThemeImport: "complete" as const };
  expect(await extensions.compareAndSaveControl(control, -1, lease)).toBe("saved");
  const commit = { owner: lease.owner, epoch: lease.epoch, packageId: control.id, packageDigest: control.packageDigest, policyFingerprint: control.policyFingerprint,
    grantRevision: control.grantRevision, operation: "state.write.apply", access: { resources: [{ kind: "scene", id: chat.id }, { kind: "take", id: branch.id }], fields: ["state"], methods: [], destinations: [] }, now: () => now };
  const turnCommit = { ...commit, operation: "turns.start", access: { resources: [{ kind: "scene", id: chat.id }, { kind: "host-connection", id: "conn" }], fields: ["turn.run", "model.prompt"], methods: [], destinations: ["connection:conn"] } };
  const delta = [{ slot: "ext:fixture.extension:memory", path: ["count"], value: 1, at: now }];
  expect(await chats.recordExtensionMessageDeltas(commit, branch.id, message!.id, delta)).toBe(true);
  const active = await chats.beginTurn(branch.id, { kind: "reply" }, undefined, turnCommit);
  if (!active) throw new Error("fixture turn could not open");
  await expect(chats.recordExtensionMessageDeltas(commit, branch.id, message!.id, [{ ...delta[0]!, value: 2 }])).rejects.toThrow("while a turn is active");
  expect(await chats.appendPendingExtensionDeltas(active.id, control.id, active.baseVersion, [{ ...delta[0]!, value: 2 }], commit)).toBe(true);
  expect(await chats.sceneState(branch.id)).toMatchObject({ "ext:fixture.extension:memory": { count: { value: 1 } } });
  expect(await chats.dropTurn(active.id)).toBe(true);
  expect(await chats.sceneState(branch.id)).toMatchObject({ "ext:fixture.extension:memory": { count: { value: 1 } } });
  const firstParty = await chats.beginTurn(branch.id, { kind: "reply" });
  if (!firstParty) throw new Error("fixture first-party turn could not open");
  expect(await chats.appendPendingExtensionDeltas(firstParty.id, control.id, firstParty.baseVersion, [{ ...delta[0]!, value: 3 }], commit)).toBe(false);
  expect(await chats.dropTurn(firstParty.id)).toBe(true);
});
