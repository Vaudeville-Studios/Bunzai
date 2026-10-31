/** Broker-to-ChatStore write tests use the live memory commit fence and expected branch versions. */
import { expect, test } from "bun:test";
import { memoryChatStore } from "../../../stage/store/chat-store";
import { memoryExtensionStore } from "../../../stage/store/memory/extension-store";
import { createExtensionBroker } from "../../broker/invoke";
import { EXTENSION_BUDGET_PRESETS, bindExtensionDefinitions } from "../../contracts/operation";
import { sceneMutationOperations } from "./mutations";
import { createExtensionSceneServices } from "../../runtime/scene-services";

test("brokered message append uses a live commit fence and refuses a stale branch version", async () => {
  const now = 1_000, owner = "00000000-0000-4000-8000-000000000001", packageId = "fixture.extension";
  const extensions = memoryExtensionStore(() => now);
  const lease = await extensions.acquireRuntimeFence(owner, now, 30_000);
  if (!lease) throw new Error("fixture runtime lease unavailable");
  const chats = memoryChatStore(() => now, () => crypto.randomUUID(), { authorizeExtensionCommit: (context) => extensions.assertCommitContext(context) });
  const chat = await chats.createChat({ title: "Fixture", cast: { character: { id: "ada", version: 1 } }, snapshot: { character: {} } });
  const branch = (await chats.listBranches(chat.id))[0]!;
  const digest = "a".repeat(64), fingerprint = "b".repeat(64);
  const control = { id: packageId, revision: 0, packageDigest: digest, policyFingerprint: fingerprint, grantRevision: 1,
    grants: [{ operation: "messages.send", resources: [{ kind: "scene", id: chat.id }, { kind: "take", id: branch.id }], fields: ["message.content"], methods: [], destinations: [], duration: "persistent" as const, budget: EXTENSION_BUDGET_PRESETS.write }],
    themeScopes: [], eventSubscriptions: [], registeredCommands: [], promptFailures: [], suspendedPromptIds: [], hostTrusted: false, enabled: true, recoveryRequired: false, dataVersion: 0, legacyThemeImport: "complete" as const };
  expect(await extensions.compareAndSaveControl(control, -1, lease)).toBe("saved");
  const principal = { storeId: "fixture", packageId, packageDigest: digest, apiMajor: 1, policyFingerprint: fingerprint, grantRevision: 1, runEpoch: 1 };
  const grants = { packageId, packageDigest: digest, policyFingerprint: fingerprint, revision: 1, grants: control.grants };
  const operations = bindExtensionDefinitions(sceneMutationOperations, createExtensionSceneServices(chats));
  const reservations = new Set<string>();
  const invoke = createExtensionBroker(operations, {
    principal: () => principal, grants: () => grants, host: "desktop", operationMetadata: [], signal: new AbortController().signal,
    selectedScope: () => [], confirm: async () => true,
    reserveBudget: async (reservation) => { reservations.add(reservation.id); return true; },
    settleBudget: async (_id, reservationId) => reservations.delete(reservationId), record: async () => undefined, readReceipts: async () => [],
    now: () => now, id: (() => { let n = 0; return () => `receipt-${++n}`; })(),
    commitContext: (current, operation, access) => ({ access, owner: lease.owner, epoch: lease.epoch, packageId: current.packageId, packageDigest: current.packageDigest,
      policyFingerprint: current.policyFingerprint, grantRevision: current.grantRevision, operation, now: () => now }),
  });
  const output = await invoke({ v: 1, type: "request", id: 1, operation: "messages.send", args: { sceneId: chat.id, takeId: branch.id, content: "hello", expectedVersion: branch.version } });
  expect(output).toMatchObject({ role: "user", seq: 1 });
  await expect(invoke({ v: 1, type: "request", id: 2, operation: "messages.send", args: { sceneId: chat.id, takeId: branch.id, content: "stale", expectedVersion: branch.version } })).rejects.toMatchObject({ code: "operation-failed" });
  expect((await chats.readMessages(branch.id, { limit: 10 })).messages.map((message) => message.swipes[0]?.content)).toEqual(["hello"]);
});
