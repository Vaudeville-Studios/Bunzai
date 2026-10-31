/** Broker-bound scene creation freezes only the explicitly granted character version. */
import { expect, test } from "bun:test";
import { createContentStore } from "../../../stage/store/content-store";
import { artDataUri, characterWithArt } from "../../../stage/contracts/content-store.contract-fixtures";
import { memoryDocumentBackend } from "../../../stage/store/memory/document-backend";
import { memoryChatStore } from "../../../stage/store/chat-store";
import { memoryExtensionStore } from "../../../stage/store/memory/extension-store";
import { createExtensionBroker } from "../../broker/invoke";
import { EXTENSION_BUDGET_PRESETS, bindExtensionDefinitions } from "../../contracts/operation";
import { sceneCreateOperations } from "./create";
import { createExtensionSceneServices } from "../../runtime/scene-services";

test("scene creation reviews and freezes the exact approved character source at the native commit door", async () => {
  const now = 50, packageId = "fixture.extension", owner = "00000000-0000-4000-8000-000000000050";
  const extensions = memoryExtensionStore(() => now), lease = await extensions.acquireRuntimeFence(owner, now, 30_000);
  if (!lease) throw new Error("runtime lease unavailable");
  const content = createContentStore(memoryDocumentBackend());
  const sourceCard = characterWithArt("ada", artDataUri(7)); sourceCard.body.identity.name = "Ada";
  await content.create(sourceCard);
  const source = await content.readHeld("character", "ada");
  if (!source) throw new Error("character fixture did not persist");
  const control = { id: packageId, revision: 0, packageDigest: "a".repeat(64), policyFingerprint: "b".repeat(64), grantRevision: 1,
    grants: [{ operation: "scenes.create", resources: [{ kind: "character", id: "ada" }], fields: ["scene.create"], methods: [], destinations: [], duration: "persistent" as const, budget: EXTENSION_BUDGET_PRESETS.write }],
    themeScopes: [], eventSubscriptions: [], registeredCommands: [], promptFailures: [], suspendedPromptIds: [], hostTrusted: false, enabled: true, recoveryRequired: false, dataVersion: 0, legacyThemeImport: "complete" as const };
  expect(await extensions.compareAndSaveControl(control, -1, lease)).toBe("saved");
  const chats = memoryChatStore(() => now, () => crypto.randomUUID(), { authorizeExtensionCommit: (context) => extensions.assertCommitContext(context) });
  const principal = { storeId: "fixture", packageId, packageDigest: control.packageDigest, apiMajor: 1, policyFingerprint: control.policyFingerprint, grantRevision: 1, runEpoch: 1 };
  const grants = { packageId, packageDigest: control.packageDigest, policyFingerprint: control.policyFingerprint, revision: 1, grants: control.grants };
  let reviewed: unknown, changeSourceOnReview = false;
  const invoke = createExtensionBroker(bindExtensionDefinitions(sceneCreateOperations, createExtensionSceneServices(chats, content)), {
    principal: () => principal, grants: () => grants, host: "desktop", operationMetadata: [], signal: new AbortController().signal,
    selectedScope: () => [], confirm: async (effect) => {
      reviewed = effect;
      if (changeSourceOnReview) {
        const current = await content.readHeld("character", "ada");
        if (current?.entity.kind !== "character") throw new Error("character fixture disappeared");
        const changed = structuredClone(current.entity); changed.body.identity.name = "Ada after review";
        await content.saveIfUnchanged(changed, current.revision);
      }
      return true;
    }, reserveBudget: async () => true,
    settleBudget: async () => true, record: async () => undefined, readReceipts: async () => [], now: () => now, id: () => "scene-create-receipt",
    commitContext: (current, operation, access) => ({ access, owner: lease.owner, epoch: lease.epoch, packageId: current.packageId, packageDigest: current.packageDigest,
      policyFingerprint: current.policyFingerprint, grantRevision: current.grantRevision, operation, now: () => now }),
  });
  const created = await invoke({ v: 1, type: "request", id: 1, operation: "scenes.create", args: { characterId: "ada", characterVersion: source.version, title: "A new scene" } });
  expect(reviewed).toMatchObject({ review: { action: "create scene", title: "A new scene", character: { id: "ada", name: "Ada", version: source.version } } });
  expect(created).toMatchObject({ title: "A new scene", characterId: "ada", personaId: null });
  const scene = await chats.getChat((created as { id: string }).id);
  expect(scene?.cast.character.version).toBe(source.version);
  expect((await chats.castSnapshot(scene!.id))?.character).toMatchObject({ body: { identity: { name: "Ada" } } });
  const portrait = await chats.castPortraitRef(scene!.id);
  expect(portrait?.ref).toMatchObject({ mime: "image/png" });
  const sourceArt = await content.readPortraitContent("character", "ada");
  expect(portrait?.ref).toEqual(sourceArt ? { sha: sourceArt.sha, mime: sourceArt.mime } : null);
  expect((await chats.castSnapshot(scene!.id))?.persona).toBeUndefined();
  changeSourceOnReview = true;
  await expect(invoke({ v: 1, type: "request", id: 2, operation: "scenes.create", args: { characterId: "ada", characterVersion: source.version, title: "Stale source" } })).rejects.toMatchObject({ code: "operation-failed" });
  expect((await chats.listChats()).chats).toHaveLength(1);
  const updated = await content.readHeld("character", "ada");
  if (!updated) throw new Error("updated character fixture disappeared");
  expect(await content.delete("character", "ada", updated.revision)).toBe(true);
  expect((await chats.castSnapshot(scene!.id))?.character).toMatchObject({ body: { identity: { name: "Ada" } } });
  expect((await chats.castPortraitRef(scene!.id))?.ref).toEqual(portrait?.ref);
  await extensions.releaseRuntimeFence(lease);
});
