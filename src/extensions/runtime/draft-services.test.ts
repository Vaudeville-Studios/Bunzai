/** Exercises the extension draft port against an isolated canonical ContentStore. */
import { expect, test } from "bun:test";
import { allCapabilities } from "../../generated/capabilities";
import { createContentStore } from "../../stage/store/content-store";
import { memoryDocumentBackend } from "../../stage/store/memory/document-backend";
import type { ExtensionCommitContext } from "../../stage/contracts/extension-store";
import type { ResourceRef } from "../contracts/operation";
import { createExtensionDraftServices } from "./draft-services";
import { parseCanonicalEntity, type ParsedCanonicalEntity } from "../../entities/runtime-schema";

const entity = (name = "Mira", id = "mira"): ParsedCanonicalEntity => parseCanonicalEntity({ schemaVersion: "1", kind: "character", id, body: { identity: { name, tagline: "Keeper" }, persona: { personality: "Patient", scenario: "At the archive" }, prompts: { systemPrompt: "Stay in character." }, greetings: { firstMessage: "Welcome.", alternateGreetings: [{ text: "Back again?", title: "Return" }] }, examples: { exampleMessages: "Mira: Hush." }, media: {}, attribution: { creator: "Chi" }, discovery: { tags: ["archivist"] } }, original: { sillytavern: { raw: { untouched: true }, unmapped: { foreign: { value: 7 } } } } });
const commit: ExtensionCommitContext = { owner: "00000000-0000-4000-8000-000000000001", epoch: 1, packageId: "fixture.extension", packageDigest: "d", policyFingerprint: "p", grantRevision: 1, operation: "content.draft.apply", access: { resources: [{ kind: "character", id: "mira" }], fields: ["body.identity.name"], methods: [], destinations: [] }, now: () => 10 };
const principal = { storeId: "fixture", packageId: "fixture.extension", packageDigest: "d", policyFingerprint: "p", apiMajor: 1, grantRevision: 1, runEpoch: 1 };
const fixtureStore = () => createContentStore(memoryDocumentBackend({ authorizeExtensionCommit: (context) => {
  if (context.packageId !== principal.packageId || context.operation !== "content.draft.apply") throw new Error("unexpected extension fixture commit");
} }));
const scope: ResourceRef[] = [{ kind: "character", id: "mira" }];

test("semantic identity preview is package-owned, exact-target and field-projected", async () => {
  const store = fixtureStore();
  await store.create(entity());
  const services = createExtensionDraftServices(store, allCapabilities);
  const capability = allCapabilities.find((item) => item.id === "character.identity.update")!;
  const draft = await services.preview(principal, capability, { target: { id: "mira" }, patch: { name: "Mira Vale" } }, scope);
  expect(draft).toMatchObject({ kind: "character", targetId: "mira", status: "draft", changes: [{ path: "body.identity.name", before: "Mira", after: "Mira Vale" }] });
  expect(await services.inspect({ ...principal, packageId: "another.extension" }, draft!.id, scope)).toBeNull();
  expect(await services.inspect(principal, draft!.id, [{ kind: "character", id: "other" }])).toBeNull();
  expect(await services.preview(principal, capability, { target: { id: "mira", variantId: "v1" }, patch: { name: "Unsafe variant" } }, scope)).toBeNull();
});

test("reviewed greeting capability stages authored text as data", async () => {
  const store = fixtureStore();
  await store.create(entity());
  const services = createExtensionDraftServices(store, allCapabilities);
  const capability = allCapabilities.find((item) => item.id === "character.greetings.update")!;
  expect(capability.extensionExposure?.operationId).toBe("content.draft.character.greetings.update");
  const draft = await services.preview(principal, capability, {
    target: { id: "mira" }, patch: { firstMessage: "A new greeting." },
  }, scope);
  expect(draft?.changes).toEqual([{ path: "body.greetings.firstMessage", before: "Welcome.", after: "A new greeting." }]);
  expect((await store.read("character", "mira"))?.entity.kind).toBe("character");
});

test("reviewed prompt capability stages authored instructions without executing them", async () => {
  const store = fixtureStore();
  await store.create(entity());
  const services = createExtensionDraftServices(store, allCapabilities);
  const capability = allCapabilities.find((item) => item.id === "character.prompts.update")!;
  const instruction = "Do not run anything; preserve this text exactly.";
  const draft = await services.preview(principal, capability, {
    target: { id: "mira" }, patch: { systemPrompt: instruction },
  }, scope);
  expect(draft?.changes).toEqual([{ path: "body.prompts.systemPrompt", before: "Stay in character.", after: instruction }]);
  expect((await store.read("character", "mira"))?.entity.kind).toBe("character");
});

test("principal generation changes invalidate package drafts", async () => {
  const store = fixtureStore();
  await store.create(entity());
  const services = createExtensionDraftServices(store, allCapabilities);
  const capability = allCapabilities.find((item) => item.id === "character.identity.update")!;
  const draft = await services.preview(principal, capability, { target: { id: "mira" }, patch: { name: "Mira Vale" } }, scope);
  expect(await services.inspect(principal, draft!.id, scope)).toMatchObject({ id: draft!.id });
  expect(await services.inspect({ ...principal, grantRevision: 2 }, draft!.id, scope)).toBeNull();
  expect(await services.inspect(principal, draft!.id, scope)).toBeNull();
});

test("apply uses canonical expected-revision CAS and verifies saved escrow", async () => {
  const store = fixtureStore();
  await store.create(entity());
  const services = createExtensionDraftServices(store, allCapabilities);
  const capability = allCapabilities.find((item) => item.id === "character.identity.update")!;
  const draft = await services.preview(principal, capability, { target: { id: "mira" }, patch: { name: "Mira Vale" } }, scope);
  expect(await services.apply(principal, draft!.id, draft!.fingerprint, scope, commit)).toBe("applied");
  const saved = await store.read("character", "mira");
  expect(saved?.entity.kind === "character" ? saved.entity.body.identity.name : null).toBe("Mira Vale");
  expect(saved?.entity.original).toEqual({ sillytavern: { raw: { untouched: true }, unmapped: { foreign: { value: 7 } } } });
  expect((await services.inspect(principal, draft!.id, scope))?.status).toBe("applied");
});

test("create and duplicate previews stage exact IDs, then apply through guarded create", async () => {
  const store = fixtureStore();
  await store.create(entity());
  const services = createExtensionDraftServices(store, allCapabilities);
  const created = await services.create(principal, entity("New Mira", "new-mira"), [{ kind: "character", id: "new-mira" }]);
  expect(created).toMatchObject({ mode: "create", kind: "character", targetId: "new-mira", status: "draft" });
  const review = await services.review(principal, created!.id, [{ kind: "character", id: "new-mira" }]);
  expect(review?.createdBody).toMatchObject({ kind: "character", id: "new-mira", body: { identity: { name: "New Mira" } } });
  expect(JSON.stringify(review)).not.toContain("untouched");
  expect(await services.apply(principal, created!.id, created!.fingerprint, [{ kind: "character", id: "new-mira" }], commit)).toBe("applied");
  const copied = await services.duplicate(principal, "character", "mira", "copy-mira", [
    { kind: "character", id: "mira" }, { kind: "character", id: "copy-mira" },
  ]);
  expect(copied).toMatchObject({ mode: "create", targetId: "copy-mira", status: "draft" });
  expect(await services.apply(principal, copied!.id, copied!.fingerprint, [{ kind: "character", id: "copy-mira" }], commit)).toBe("applied");
  const saved = await store.read("character", "copy-mira");
  expect(saved?.entity.original).toEqual((await store.read("character", "mira"))?.entity.original);
  expect(await services.create(principal, entity(), [{ kind: "character", id: "new-mira" }])).toBeNull();
});
