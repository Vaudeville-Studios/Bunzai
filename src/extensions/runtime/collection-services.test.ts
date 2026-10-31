/** Verifies the extension collection adapter uses StateStore revisions and the fenced commit door. */
import { expect, test } from "bun:test";
import { memoryStateStore } from "../../stage/store/memory/state-store";
import type { ExtensionCommitContext } from "../../stage/contracts/extension-store";
import { extensionCollectionStateServices } from "./collection-services";

const commit = (operation: string): ExtensionCommitContext => ({
  owner: "00000000-0000-4000-8000-000000000001", epoch: 1, packageId: "fixture.collections", packageDigest: "a".repeat(64),
  policyFingerprint: "b".repeat(64), grantRevision: 1, operation, access: { resources: [{ kind: "library", id: "library" }, { kind: "collection", id: "cast" }], fields: ["collections"], methods: [], destinations: [] }, now: () => 1,
});

test("collection create and membership writes are revision checked and projected", async () => {
  const state = memoryStateStore({ authorizeExtensionCommit: () => undefined });
  const services = extensionCollectionStateServices(state);
  const createdPreview = await services.previewCreate("Cast", "Main cast", -1);
  expect(createdPreview).toMatchObject({ revision: -1, id: "cast", collection: { name: "Cast" } });
  const created = await services.create("Cast", "Main cast", -1, commit("collections.create"));
  expect(created).toEqual({ status: "saved", revision: 0, id: "cast" });
  expect(await services.create("Stale", undefined, -1, commit("collections.create"))).toEqual({ status: "stale" });

  const edit = { action: "add" as const, id: "cast", ref: { kind: "character", id: "ada" } };
  expect(await services.previewMembership(edit, 0)).toMatchObject({ collection: { members: [{ kind: "character", id: "ada" }] }, member: true, revision: 0 });
  expect(await services.membership(edit, 0, commit("collections.membership.apply"))).toEqual({ status: "saved", revision: 1, id: "cast", member: true });
  expect(await services.readOne([{ kind: "collection", id: "cast" }], "cast", ["collection.name", "collection.members"])).toMatchObject({ revision: 1, collection: { id: "cast", name: "Cast", members: [{ kind: "character", id: "ada" }] } });
  expect(await services.membership(edit, 0, commit("collections.membership.apply"))).toEqual({ status: "stale" });
});
