/** Memory document backend commit-door coverage for extension authority contexts. */
import { expect, test } from "bun:test";
import { character } from "../../contracts/content-store.contract-fixtures";
import { createContentStore } from "../content-store";
import { memoryDocumentBackend } from "./document-backend";
import { memoryExtensionStore } from "./extension-store";

test("memory document writes, trash and restore validate authority at the mutation door", async () => {
  const extensionStore = memoryExtensionStore(() => 1_000);
  const lease = await extensionStore.acquireRuntimeFence("00000000-0000-4000-8000-000000000001", 1_000, 30_000);
  const control = { id: "fixture.extension", revision: 0, packageDigest: "a".repeat(64), policyFingerprint: "b".repeat(64), grantRevision: 1,
    grants: ["content.draft.apply", "content.trash", "content.restore"].map((operation) => ({ operation, resources: [{ kind: "character", id: "Ada" }], fields: ["identity"], methods: [], destinations: [],
      duration: "persistent" as const, budget: { requests: 10, bytes: 100_000, tokens: 0 } })), themeScopes: [], eventSubscriptions: [], registeredCommands: [], promptFailures: [], suspendedPromptIds: [], hostTrusted: false,
    enabled: true, recoveryRequired: false, dataVersion: 0, legacyThemeImport: "complete" as const };
  expect(await extensionStore.compareAndSaveControl(control, -1, lease!)).toBe("saved");
  const content = createContentStore(memoryDocumentBackend({ authorizeExtensionCommit: (context) => extensionStore.assertCommitContext(context) }));
  const initial = await content.save(character("Ada"));
  const context = (operation: string) => ({ ...lease!, packageId: control.id, packageDigest: control.packageDigest, policyFingerprint: control.policyFingerprint,
    grantRevision: control.grantRevision, operation, access: { resources: [{ kind: "character", id: "Ada" }], fields: ["identity"], methods: [], destinations: [] }, now: () => 1_000 });
  const piece = await content.read("character", "Ada");
  if (piece?.entity.kind !== "character") throw new Error("fixture character missing");
  const edited = structuredClone(piece.entity);
  edited.body.identity.name = "Reviewed";
  expect((await content.saveIfUnchanged(edited, initial.revision, context("content.draft.apply"))).status).toBe("saved");
  const current = await content.read("character", "Ada");
  if (!current) throw new Error("edited character missing");
  const receipt = await content.deleteWithReceipt("character", "Ada", current.revision, context("content.trash"));
  expect(receipt?.action).toBe("delete");
  const grave = (await content.graveyard("character"))[0];
  expect(grave).toBeDefined();

  const revoked = { ...control, enabled: false, revision: 1 };
  expect(await extensionStore.compareAndSaveControl(revoked, control.revision, lease!)).toBe("saved");
  await expect(content.deleteWithReceipt("character", "Ada", undefined, context("content.trash"))).rejects.toThrow("authority changed");
  await expect(content.restore(grave!.graveId, context("content.restore"))).rejects.toThrow("authority changed");
  expect(await content.read("character", "Ada")).toBeNull();
  expect((await content.graveyard("character"))).toHaveLength(1);
});
