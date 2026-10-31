/** Memory ChatStore settings use the same opaque CAS as first-party scene setters. */
import { expect, test } from "bun:test";
import { CAST, SNAP } from "../../contracts/chat-store.contract-rig";
import type { StoredExtensionControl } from "../../contracts/extension-store";
import { memoryChatStore } from "../chat-store";
import { memoryExtensionStore } from "./extension-store";

test("first-party setting changes make reviewed extension settings stale", async () => {
  const now = 500, extensions = memoryExtensionStore(() => now);
  const lease = await extensions.acquireRuntimeFence("00000000-0000-4000-8000-000000000500", now, 30_000);
  if (!lease) throw new Error("runtime lease unavailable");
  const control: StoredExtensionControl = { id: "fixture.extension", revision: 0, packageDigest: "a".repeat(64), policyFingerprint: "b".repeat(64), grantRevision: 1,
    grants: [{ operation: "scenes.settings.apply", resources: [{ kind: "scene", id: "scene-1" }], fields: ["scene.settings.connection"], methods: [], destinations: [], duration: "persistent", budget: { requests: 4, bytes: 20_000, tokens: 0 } }],
    themeScopes: [], eventSubscriptions: [], registeredCommands: [], promptFailures: [], suspendedPromptIds: [], hostTrusted: false, enabled: true, recoveryRequired: false, dataVersion: 0, legacyThemeImport: "complete" };
  expect(await extensions.compareAndSaveControl(control, -1, lease)).toBe("saved");
  const chats = memoryChatStore(() => now, () => "scene-1", { authorizeExtensionCommit: (context) => extensions.assertCommitContext(context) });
  const chat = await chats.createChat({ title: "Settings", cast: CAST, snapshot: SNAP });
  const selector = { group: "connection" } as const;
  const change = { group: "connection" as const, value: { id: "reviewed", model: "model-a" } };
  const review = await chats.previewSceneSetting(chat.id, selector, change);
  if (!review) throw new Error("scene setting preview unavailable");
  await chats.setConnection(chat.id, { id: "first-party", model: "model-b" });
  const commit = { owner: lease.owner, epoch: lease.epoch, packageId: control.id, packageDigest: control.packageDigest,
    policyFingerprint: control.policyFingerprint, grantRevision: control.grantRevision, operation: "scenes.settings.apply", access: { resources: [{ kind: "scene", id: chat.id }], fields: ["scene.settings.connection"], methods: [], destinations: [] }, now: () => now };
  expect(await chats.applySceneSetting(chat.id, selector, change, review.revision, commit)).toEqual({ status: "stale" });
  expect(await chats.readSceneSetting(chat.id, selector)).toMatchObject({ value: { id: "first-party", model: "model-b" } });
  const current = await chats.readSceneSetting(chat.id, selector);
  if (!current) throw new Error("scene setting disappeared");
  expect(await chats.applySceneSetting(chat.id, selector, change, current.revision, commit)).toMatchObject({ status: "saved" });
  expect(await chats.readSceneSetting(chat.id, selector)).toMatchObject({ value: { id: "reviewed", model: "model-a" } });
  await extensions.releaseRuntimeFence(lease);
});
