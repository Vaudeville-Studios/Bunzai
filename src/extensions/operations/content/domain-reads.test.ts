/** Verifies content links and history projections obey exact resource and field grants. */
import { expect, test } from "bun:test";
import type { ExtensionOperationContext, ExtensionContentServices } from "../../contracts/operation";
import { CANONICAL_SCHEMA_VERSION } from "../../../core/canonical";
import type { ExtensionOperationServices } from "../_services";
import { CHARACTER_LINKS_GROUP, projectCharacterLinks } from "./_links-projection";
import links from "./links-operations";
import history from "./history-operations";
import lifecycle from "./lifecycle-operations";

const entity = () => ({ schemaVersion: CANONICAL_SCHEMA_VERSION, kind: "character", id: "ada", body: {
  identity: { name: "Ada" }, persona: {}, prompts: {}, greetings: {}, examples: {}, media: {}, attribution: {}, discovery: {},
  worldName: "World", knowledgeRefs: ["book-a"], behaviorRefs: ["rules-a"],
} });
const context = (fields: readonly string[]): ExtensionOperationContext => ({
  principal: { storeId: "s", packageId: "p", packageDigest: "d", apiMajor: 1, policyFingerprint: "f", grantRevision: 1, runEpoch: 1 },
  signal: new AbortController().signal, invocation: { resources: [] }, resources: [{ kind: "character", id: "ada" }], grantedOperations: [], host: "desktop", availableOperations: [], availableGrants: [], operationReceipts: [],
  access: { resources: [{ kind: "character", id: "ada" }], fields, methods: [], destinations: [] }, commit: { owner: "00000000-0000-4000-8000-000000000001", epoch: 1, packageId: "p", packageDigest: "d", policyFingerprint: "f", grantRevision: 1, operation: "fixture", access: { resources: [{ kind: "character", id: "ada" }], fields, methods: [], destinations: [] }, now: () => 1 }, confirm: async () => true, assertCurrent: async () => {},
});
const base: ExtensionContentServices = { readSummary: async () => null, readBody: async () => null, readSelectedFields: async () => null, listSummaries: async () => [], searchSummaries: async () => [], readFields: async () => null, readPersonaIdentity: async () => null,
  readLinks: async () => projectCharacterLinks(entity()), listHistory: async () => [{ version: 1, revision: "r1", savedAt: 1, reason: "create" }],
  readHistory: async () => [{ path: "body.identity.name", value: "Ada" }], trash: async () => false,
  readGrave: async () => ({ graveId: "g1", kind: "character", id: "ada", name: "Ada", deletedAt: 2 }),
  restore: async () => ({ id: "ada", kind: "character", name: "Ada", revision: "r2", version: 2, writeId: 2, updatedAt: 3, tokens: 1 }),
};
const services: ExtensionOperationServices = { content: base };

test("link reads return only the bounded link group", async () => {
  expect(projectCharacterLinks(entity())).toEqual({ id: "ada", kind: "character", group: CHARACTER_LINKS_GROUP, links: { worldName: "World", knowledgeRefs: ["book-a"], behaviorRefs: ["rules-a"] } });
  await expect(links[0]!.execute({ kind: "character", id: "ada", group: CHARACTER_LINKS_GROUP }, context(["links"]), services)).resolves.toMatchObject({ links: { worldName: "World" } });
  await expect(links[0]!.execute({ kind: "character", id: "ada", group: CHARACTER_LINKS_GROUP }, context([]), services)).rejects.toThrow();
});

test("history list and read require exact granted target and fields", async () => {
  await expect(history[0]!.execute({ kind: "character", id: "ada" }, context(["history"]), services)).resolves.toEqual({ versions: [{ version: 1, revision: "r1", savedAt: 1, reason: "create" }], truncated: false });
  await expect(history[1]!.execute({ kind: "character", id: "ada", version: 1, fields: ["body.identity.name"] }, context(["history", "body.identity.name"]), services)).resolves.toEqual({ version: 1, fields: [{ path: "body.identity.name", value: "Ada" }] });
  await expect(history[1]!.execute({ kind: "character", id: "ada", version: 1, fields: ["body.identity.name"] }, context(["history"]), services)).rejects.toThrow();
});

test("restore review names one grave and exposes only a safe summary", async () => {
  const definition = lifecycle[1]!;
  const args = { kind: "character" as const, id: "ada", graveId: "g1" };
  await expect(definition.review!(args, context(["lifecycle"]), services)).resolves.toMatchObject({ target: { kind: "character", id: "ada" }, graveId: "g1", name: "Ada", action: "restore-retired-id", available: true });
  await expect(definition.execute(args, context(["lifecycle"]), services)).resolves.toEqual({ status: "restored", piece: { id: "ada", kind: "character", name: "Ada" } });
});
/** Verifies content links/history projections obey exact resource and field grants. */
