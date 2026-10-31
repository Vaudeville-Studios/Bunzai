/** Tests filtered summary operation ports and field/resource rechecks. */
import { expect, test } from "bun:test";
import type { ExtensionOperationContext, ExtensionOperationDefinition, ExtensionContentServices, OperationPrincipal, ResourceRef } from "../../contracts/operation";
import type { PieceSummary } from "../../../stage/contracts/content-store-summary";
import { contentSummaryOperations } from "./summary-operations";
import { projectSummary } from "./_summary";

const principal: OperationPrincipal = {
  storeId: "store", packageId: "pkg", packageDigest: "a".repeat(64), apiMajor: 1,
  policyFingerprint: "b".repeat(64), grantRevision: 1, runEpoch: 1,
};
const summary = (id: string): PieceSummary => ({
  id, kind: "character", name: id, updatedAt: 1, revision: "rev", version: 1, writeId: 1, tokens: 0,
});
const operation = (id: string): ExtensionOperationDefinition =>
  contentSummaryOperations.find((definition) => definition.metadata.id === id)! as ExtensionOperationDefinition;
function context(resources: readonly ResourceRef[], fields: readonly string[]): ExtensionOperationContext {
  return {
    principal, signal: new AbortController().signal, invocation: { resources: [] }, resources, grantedOperations: [], host: "desktop",
    availableOperations: [], availableGrants: [], operationReceipts: [], access: { resources, fields, methods: [], destinations: [] }, commit: { owner: "00000000-0000-4000-8000-000000000001", epoch: 1, packageId: "pkg", packageDigest: principal.packageDigest, policyFingerprint: principal.policyFingerprint, grantRevision: 1, operation: "fixture", access: { resources, fields, methods: [], destinations: [] }, now: () => 1 }, confirm: async () => false, assertCurrent: async () => {},
  };
}

test("list passes the broker-narrowed scope and fields to the service before results are returned", async () => {
  let seen: { scope: readonly ResourceRef[]; fields: readonly string[] } | undefined;
  const services: ExtensionContentServices = {
    readFields: async () => null,
    readPersonaIdentity: async () => null,
    readLinks: async () => null, listHistory: async () => [], readHistory: async () => null, trash: async () => false, readGrave: async () => null, restore: async () => null,
    readSummary: async () => null,
    readBody: async () => null,
    readSelectedFields: async () => null,
    listSummaries: async (scope, _kinds, _limit, fields) => {
      seen = { scope, fields };
      return [summary("one")];
    },
    searchSummaries: async () => [],
  };
  const definition = operation("content.list");
  const input = definition.metadata.input.parse({
    scope: { type: "library" }, fields: ["id", "kind", "name"], limit: 10,
  });
  const grantedScope = [{ kind: "library", id: "library" }];
  const result = await definition.execute(input, context(grantedScope, ["id", "kind", "name"]), services);
  expect(seen).toEqual({ scope: grantedScope, fields: ["id", "kind", "name"] });
  expect(result).toEqual([{ id: "one", kind: "character", name: "one" }]);
});

test("invocation scope passes only the host snapshot narrowed by the broker", async () => {
  let seen: readonly ResourceRef[] = [];
  const services: ExtensionContentServices = {
    readFields: async () => null,
    readPersonaIdentity: async () => null,
    readLinks: async () => null, listHistory: async () => [], readHistory: async () => null, trash: async () => false, readGrave: async () => null, restore: async () => null,
    readSummary: async () => null, readBody: async () => null, readSelectedFields: async () => null,
    listSummaries: async (scope) => { seen = scope; return scope.map(({ id }) => summary(id)); },
    searchSummaries: async () => [],
  };
  const definition = operation("content.list");
  const input = definition.metadata.input.parse({ scope: { type: "invocation" }, fields: ["id", "kind", "name"] });
  const narrowed = [{ kind: "character", id: "allowed" }];
  const result = await definition.execute(input, context(narrowed, ["id", "kind", "name"]), services);
  expect(seen).toEqual(narrowed);
  expect(result).toEqual([{ id: "allowed", kind: "character", name: "allowed" }]);
});

test("a selected ID request cannot broaden to an unapproved piece", async () => {
  let calls = 0;
  const services: ExtensionContentServices = {
    readFields: async () => null,
    readPersonaIdentity: async () => null,
    readLinks: async () => null, listHistory: async () => [], readHistory: async () => null, trash: async () => false, readGrave: async () => null, restore: async () => null,
    readSummary: async () => null,
    readBody: async () => null,
    readSelectedFields: async () => null,
    listSummaries: async () => { calls += 1; return []; },
    searchSummaries: async () => [],
  };
  const definition = operation("content.list");
  const input = definition.metadata.input.parse({
    scope: { type: "selected", resources: [{ kind: "character", id: "one" }] },
    fields: ["id", "kind", "name"],
  });
  const invocation = definition.execute(input, context([{ kind: "character", id: "two" }], ["id", "kind", "name"]), services);
  const error = await invocation.then(() => null, (value) => value);
  expect(error).toBeInstanceOf(Error);
  expect(calls).toBe(0);
});

test("requested fields outside the approved grant are rejected before service access", async () => {
  let calls = 0;
  const services: ExtensionContentServices = {
    readFields: async () => null,
    readPersonaIdentity: async () => null,
    readLinks: async () => null, listHistory: async () => [], readHistory: async () => null, trash: async () => false, readGrave: async () => null, restore: async () => null,
    readSummary: async () => { calls += 1; return summary("one"); },
    readBody: async () => null,
    readSelectedFields: async () => null,
    listSummaries: async () => [],
    searchSummaries: async () => [],
  };
  const definition = operation("content.summary");
  const input = definition.metadata.input.parse({ kind: "character", id: "one", fields: ["id", "kind", "name", "description"] });
  const invocation = definition.execute(input, context([{ kind: "character", id: "one" }], ["id", "kind", "name"]), services);
  const error = await invocation.then(() => null, (value) => value);
  expect(error).toBeInstanceOf(Error);
  expect(calls).toBe(0);
});

test("bounded summary tags remain valid and report truncation", () => {
  const projected = projectSummary({ id: "one", kind: "character", name: "one", tags: [...Array(21)].map((_, index) => `tag-${index}`) }, ["id", "kind", "name", "tags"]);
  expect(projected.tags).toHaveLength(20);
  expect(projected.tagsTruncated).toBe(true);
  expect(projectSummary(projected, ["id", "kind", "name", "tags"]).tagsTruncated).toBe(true);
});
