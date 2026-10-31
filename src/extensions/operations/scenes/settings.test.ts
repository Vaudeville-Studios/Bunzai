/** Broker review and ChatStore CAS keep a scene setting from drifting between host approval and commit. */
import { expect, test } from "bun:test";
import { memoryChatStore } from "../../../stage/store/chat-store";
import { memoryExtensionStore } from "../../../stage/store/memory/extension-store";
import { createExtensionBroker } from "../../broker/invoke";
import { EXTENSION_BUDGET_PRESETS, bindExtensionDefinitions } from "../../contracts/operation";
import { createExtensionSceneServices } from "../../runtime/scene-services";
import { sceneSettingOperations } from "./settings";

test("scene setting applies only the exact reviewed revision and refuses a first-party setter race", async () => {
  const now = 2_000, owner = "00000000-0000-4000-8000-000000000002", packageId = "fixture.extension";
  const extensions = memoryExtensionStore(() => now), lease = await extensions.acquireRuntimeFence(owner, now, 30_000);
  if (!lease) throw new Error("fixture runtime lease unavailable");
  const chats = memoryChatStore(() => now, () => crypto.randomUUID(), { authorizeExtensionCommit: (context) => extensions.assertCommitContext(context) });
  const chat = await chats.createChat({ title: "Fixture", cast: { character: { id: "ada", version: 1 } }, snapshot: { character: {} } });
  const digest = "a".repeat(64), fingerprint = "b".repeat(64), field = "scene.settings.prompting";
  const grants = ["scenes.settings.preview", "scenes.settings.apply"].map((operation) => ({ operation, resources: [{ kind: "scene", id: chat.id }], fields: [field], methods: [], destinations: [], duration: "persistent" as const, budget: EXTENSION_BUDGET_PRESETS[operation.endsWith("apply") ? "write" : "read-small"] }));
  const control = { id: packageId, revision: 0, packageDigest: digest, policyFingerprint: fingerprint, grantRevision: 1, grants,
    themeScopes: [], eventSubscriptions: [], registeredCommands: [], promptFailures: [], suspendedPromptIds: [], hostTrusted: false, enabled: true, recoveryRequired: false, dataVersion: 0, legacyThemeImport: "complete" as const };
  expect(await extensions.compareAndSaveControl(control, -1, lease)).toBe("saved");
  const principal = { storeId: "fixture", packageId, packageDigest: digest, apiMajor: 1, policyFingerprint: fingerprint, grantRevision: 1, runEpoch: 1 };
  const invoke = createExtensionBroker(bindExtensionDefinitions(sceneSettingOperations, createExtensionSceneServices(chats, undefined, null)), {
    principal: () => principal, grants: () => ({ packageId, packageDigest: digest, policyFingerprint: fingerprint, revision: 1, grants }), host: "desktop", operationMetadata: [], signal: new AbortController().signal,
    selectedScope: () => [], confirm: async (effect) => { reviewed.push(effect); if (race) await chats.setPrompting(chat.id, { note: { text: "person changed it", position: "in_chat", depth: 0, frequency: 1 } }); return true; },
    reserveBudget: async () => true, settleBudget: async () => true, record: async () => undefined, readReceipts: async () => [], now: () => now, id: () => "receipt",
    commitContext: (current, operation, access) => ({ access, owner: lease.owner, epoch: lease.epoch, packageId: current.packageId, packageDigest: current.packageDigest, policyFingerprint: current.policyFingerprint, grantRevision: current.grantRevision, operation, now: () => now }),
  });
  const reviewed: unknown[] = []; let race = false;
  const selector = { group: "prompting" } as const;
  const change = { group: "prompting" as const, patch: { note: { text: "extension", position: "in_chat" as const, depth: 1, frequency: 1 } } };
  const preview = await invoke({ v: 1, type: "request", id: 1, operation: "scenes.settings.preview", args: { sceneId: chat.id, selector, change } }) as { revision: string; before: unknown; after: unknown };
  expect(preview.before).toBeNull();
  expect(preview.after).toMatchObject({ note: { text: "extension" } });
  const saved = await invoke({ v: 1, type: "request", id: 2, operation: "scenes.settings.apply", args: { sceneId: chat.id, selector, change, expectedRevision: preview.revision } });
  expect(saved).toMatchObject({ status: "saved" });
  expect(reviewed[0]).toMatchObject({ review: { before: null, after: { note: { text: "extension" } }, expectedRevision: preview.revision } });

  const second = await invoke({ v: 1, type: "request", id: 3, operation: "scenes.settings.preview", args: { sceneId: chat.id, selector, change } }) as { revision: string };
  race = true;
  const stale = await invoke({ v: 1, type: "request", id: 4, operation: "scenes.settings.apply", args: { sceneId: chat.id, selector, change, expectedRevision: second.revision } });
  expect(stale).toEqual({ status: "stale" });
  expect((await chats.getChat(chat.id))?.prompting?.note?.text).toBe("person changed it");
  await extensions.releaseRuntimeFence(lease);
});
