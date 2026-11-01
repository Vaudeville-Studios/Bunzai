/** SQLite commit-door regressions for revoked and stale extension content mutations. */
import { afterEach, expect, test } from "bun:test";
import { character } from "../contracts/content-store.contract-fixtures";
import type { StoredExtensionControl } from "../contracts/extension-store";
import { createContentStore } from "./content-store";
import { sqliteDocumentBackend } from "./sqlite/document-backend";
import { sqliteExtensionStore } from "./sqlite/extension-store";
import type { StageDatabase } from "./sqlite/database";
import { freshDatabase, testCipher } from "./sqlite/test-support";

const open: StageDatabase[] = [];
afterEach(() => { for (const database of open.splice(0)) database.close(); });
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

test("content transaction rejects a stale runtime lease and a revoked package authority", async () => {
  let now = Date.now();
  const database = freshDatabase(open);
  const cipher = testCipher();
  const extensionStore = sqliteExtensionStore(database, cipher, () => now);
  const lease = await extensionStore.acquireRuntimeFence(uuid(1), now, 30_000);
  expect(lease).not.toBeNull();
  const bytes = new TextEncoder().encode("fixture sealed package");
  const packageDigest = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), (byte) => byte.toString(16).padStart(2, "0")).join("");
  await extensionStore.savePackage({ digest: packageDigest, bytes }, lease!);
  const control: StoredExtensionControl = { id: "fixture.extension", revision: 0, packageDigest, policyFingerprint: "b".repeat(64), grantRevision: 2,
    grants: [{ operation: "content.draft.apply", resources: [{ kind: "character", id: "Ada" }], fields: ["identity"], methods: [], destinations: [], duration: "persistent", budget: { requests: 10, bytes: 10_000, tokens: 0 } }],
    themeScopes: [], eventSubscriptions: [], registeredCommands: [], promptFailures: [], suspendedPromptIds: [], hostTrusted: false, enabled: true, recoveryRequired: false, dataVersion: 0, legacyThemeImport: "complete" };
  expect(await extensionStore.compareAndSaveControl(control, -1, lease!)).toBe("saved");
  const content = createContentStore(sqliteDocumentBackend(database, cipher));
  const initial = await content.save(character("Ada"));
  const stored = await content.read("character", "Ada");
  if (stored?.entity.kind !== "character") throw new Error("fixture character did not persist");
  const context = { owner: lease!.owner, epoch: lease!.epoch, packageId: control.id, packageDigest, policyFingerprint: control.policyFingerprint,
    grantRevision: control.grantRevision, operation: "content.draft.apply", access: { resources: [{ kind: "character", id: "Ada" }], fields: ["identity"], methods: [], destinations: [] }, now: () => now };
  const next = structuredClone(stored.entity);
  next.body.identity.name = "Edited";

  now += 30_001;
  const takeover = await extensionStore.acquireRuntimeFence(uuid(2), now, 30_000);
  expect(takeover?.epoch).toBe(lease!.epoch + 1);
  await expect(content.saveIfUnchanged(next, initial.revision, context)).rejects.toThrow("fence is stale");
  const persisted = await content.read("character", "Ada");
  expect(persisted?.entity.kind === "character" ? persisted.entity.body.identity.name : null).toBe("Ada");
  const updatedControl = { ...control, enabled: false, revision: control.revision + 1 };
  expect(await extensionStore.compareAndSaveControl(updatedControl, control.revision, takeover!)).toBe("saved");
  const revokedContext = { ...context, owner: takeover!.owner, epoch: takeover!.epoch };
  await expect(content.saveIfUnchanged(next, initial.revision, revokedContext)).rejects.toThrow("authority changed");
  await expect(content.patchWithCommit("character", "Ada", initial.revision, { head: next }, [], "manual", revokedContext))
    .rejects.toThrow("authority changed");
  const afterRevocation = await content.read("character", "Ada");
  expect(afterRevocation?.entity.kind === "character" ? afterRevocation.entity.body.identity.name : null).toBe("Ada");
});
