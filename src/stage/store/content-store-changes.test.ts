/** Purpose: prove one value-free invalidation per successful ContentStore commit, including extension commits. */
import { expect, test } from "bun:test";
import type { ExtensionCommitContext } from "../contracts/extension-store";
import { character } from "../contracts/content-store.contract-fixtures";
import { createContentStore } from "./content-store";
import { memoryDocumentBackend } from "./memory/document-backend";

const commit: ExtensionCommitContext = {
  owner: "00000000-0000-4000-8000-000000000001", epoch: 1, packageId: "fixture.extension",
  packageDigest: "a".repeat(64), policyFingerprint: "b".repeat(64), grantRevision: 1,
  operation: "content.draft.apply", access: { resources: [{ kind: "character", id: "event" }], fields: ["body"], methods: [], destinations: [] }, now: () => 10,
};

test("successful canonical writes publish bounded invalidations once; refused writes publish none", async () => {
  const store = createContentStore(memoryDocumentBackend({ authorizeExtensionCommit: (context) => {
    if (context.packageId !== commit.packageId || context.operation !== commit.operation) throw new Error("wrong commit context");
  } }));
  const events: unknown[] = [];
  const unsubscribe = store.subscribeChanges((event) => { events.push(event); });
  const created = await store.create(character("event"));
  expect(created.status).toBe("saved");
  if (created.status !== "saved") throw new Error("fixture create failed");
  expect(events).toEqual([{ kind: "character", id: "event", revision: created.summary.revision, action: "upsert", invalidations: ["body"] }]);

  const current = await store.read("character", "event");
  if (current?.entity.kind !== "character") throw new Error("fixture character missing");
  const edited = structuredClone(current.entity);
  edited.body.identity.name = "Committed by extension";
  const saved = await store.saveIfUnchanged(edited, current.revision, commit);
  expect(saved.status).toBe("saved");
  expect(events).toHaveLength(2);
  expect(events[1]).toMatchObject({ kind: "character", id: "event", action: "upsert", invalidations: ["body"], originPackageId: "fixture.extension" });
  expect(JSON.stringify(events)).not.toContain("Committed by extension");

  expect((await store.saveIfUnchanged(edited, current.revision, commit)).status).toBe("stale");
  expect(events).toHaveLength(2);
  const latest = await store.read("character", "event");
  expect(await store.deleteWithReceipt("character", "event", latest?.revision)).toMatchObject({ action: "delete" });
  expect(events[2]).toMatchObject({ action: "delete", invalidations: ["*"] });
  unsubscribe();
  await store.create(character("after-unsubscribe"));
  expect(events).toHaveLength(3);
});

test("observer failures cannot change the committed write result", async () => {
  const store = createContentStore(memoryDocumentBackend());
  store.subscribeChanges(() => { throw new Error("fixture observer failure"); });
  expect((await store.create(character("observer"))).status).toBe("saved");
});
