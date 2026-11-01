/** Tests exact-target, group-selected content reads without raw entity access. */
import { expect, test } from "bun:test";
import type { ExtensionOperationContext } from "../../contracts/operation";
import type { ExtensionOperationServices } from "../_services";
import { createContentStore } from "../../../stage/store/content-store";
import { memoryDocumentBackend } from "../../../stage/store/memory/document-backend";
import { extensionContentServices } from "../../runtime/content-services";
import { contentReadOperations } from "./read";

const context = (kind: string, id: string, fields: string[]): ExtensionOperationContext => ({
  principal: { storeId: "s", packageId: "p", packageDigest: "d", apiMajor: 1, policyFingerprint: "f", grantRevision: 1, runEpoch: 1 },
  signal: new AbortController().signal, invocation: { resources: [] }, resources: [{ kind, id }], grantedOperations: ["content.read"], host: "desktop", availableOperations: [], availableGrants: [], operationReceipts: [],
  access: { resources: [{ kind, id }], fields, methods: [], destinations: [] }, commit: { owner: "00000000-0000-4000-8000-000000000001", epoch: 1, packageId: "p", packageDigest: "d", policyFingerprint: "f", grantRevision: 1, operation: "content.read", access: { resources: [{ kind, id }], fields, methods: [], destinations: [] }, now: () => 1 }, confirm: async () => true, assertCurrent: async () => {},
});

test("all content kinds expose the explicitly granted canonical body without escrow", async () => {
  let called: unknown[] = [];
  const body = { name: "Archive", tags: [], globalCaseSensitive: false, globalMatchWholeWords: false, globalScanDepth: 4, globalRecursion: true, tokenBudget: 0, budgetMode: "token", entryBudget: 0, entries: [] };
  const services = { content: { readBody: async (...args: unknown[]) => { called = args; return { id: "book", kind: "lorebook", body }; } } } as unknown as ExtensionOperationServices;
  const result = await contentReadOperations[0]!.execute({ kind: "lorebook", id: "book", groups: ["body"] }, context("lorebook", "book", ["body"]), services);
  expect(called).toEqual(["lorebook", "book", [{ kind: "lorebook", id: "book" }], ["body"]]);
  expect(result).toMatchObject({ requested: ["body"], body: { id: "book", kind: "lorebook", body: { name: "Archive" } }, identity: null, links: null });
  expect(JSON.stringify(result)).not.toContain("original");
});

test("ContentStore body adapter validates canonical data and checks scope before reading", async () => {
  const store = createContentStore(memoryDocumentBackend());
  await store.create({ schemaVersion: "1", kind: "character", id: "mira", body: { identity: { name: "Mira" }, persona: {}, prompts: {}, greetings: {}, examples: {}, media: {}, attribution: {}, discovery: {} }, original: { sillytavern: { raw: { payload: "escrow" } } } });
  const content = extensionContentServices(store);
  const body = await content.readBody("character", "mira", [{ kind: "character", id: "mira" }], ["body"]);
  expect(body).toMatchObject({ kind: "character", id: "mira", body: { identity: { name: "Mira" } } });
  expect(JSON.stringify(body)).not.toContain("escrow");
  await expect(content.readBody("character", "mira", [{ kind: "character", id: "other" }], ["body"])).rejects.toThrow();
  await expect(content.readBody("character", "mira", [{ kind: "character", id: "mira" }], ["description"])).rejects.toThrow();
});

test("character details remain separately selected and exact-field checked", async () => {
  const services = { content: { readFields: async () => ({ id: "mira", kind: "character", group: "character.identity", identity: { name: "Mira" } }), readLinks: async () => null } } as unknown as ExtensionOperationServices;
  const fields = ["summary", "name", "nickname", "tagline", "description", "characterVersion", "links"];
  const result = await contentReadOperations[0]!.execute({ kind: "character", id: "mira", groups: ["character.identity"] }, context("character", "mira", fields), services);
  expect(result.identity?.identity.name).toBe("Mira");
  await expect(contentReadOperations[0]!.execute({ kind: "character", id: "other", groups: ["body"] }, context("character", "mira", ["body"]), services)).rejects.toThrow();
});

test("persona identity is a separately granted projection that excludes injected text", async () => {
  const services = { content: { readPersonaIdentity: async () => ({ id: "mira-persona", kind: "persona", group: "persona.identity", identity: { name: "Mira", brief: "The user voice" } }) } } as unknown as ExtensionOperationServices;
  const result = await contentReadOperations[0]!.execute({ kind: "persona", id: "mira-persona", groups: ["persona.identity"] }, context("persona", "mira-persona", ["persona.name", "persona.brief"]), services);
  expect(result.personaIdentity?.identity).toEqual({ name: "Mira", brief: "The user voice" });
  expect(JSON.stringify(result)).not.toContain("injected");
});
