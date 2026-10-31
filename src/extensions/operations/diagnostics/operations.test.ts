/** Exercises the public diagnostic handlers against bounded canonical and sample inputs. */
import { expect, test } from "bun:test";
import type { ExtensionOperationContext, ExtensionOperationDefinition } from "../../contracts/operation";
import type { ExtensionOperationServices } from "../_services";
import { diagnosticOperations } from "./operations";

const context: ExtensionOperationContext = {
  principal: { storeId: "fixture", packageId: "fixture.diagnostics", packageDigest: "a".repeat(64), apiMajor: 1, policyFingerprint: "b".repeat(64), grantRevision: 1, runEpoch: 1 },
  signal: new AbortController().signal, invocation: { resources: [] }, resources: [], grantedOperations: [], host: "desktop", availableOperations: [], availableGrants: [], operationReceipts: [],
  access: { resources: [], fields: [], methods: [], destinations: [] },
  commit: { owner: "00000000-0000-4000-8000-000000000001", epoch: 1, packageId: "fixture.diagnostics", packageDigest: "a".repeat(64), policyFingerprint: "b".repeat(64), grantRevision: 1, operation: "fixture", access: { resources: [], fields: ["runtime"], methods: [], destinations: [] }, now: () => 1 },
  confirm: async () => true, assertCurrent: async () => {},
};
const services = { content: {} } as ExtensionOperationServices;
const operations = diagnosticOperations as readonly ExtensionOperationDefinition<unknown, unknown, ExtensionOperationServices>[];
const invoke = async (id: string, args: unknown) => {
  const operation = operations.find((item) => item.metadata.id === id)!;
  return operation.execute(operation.metadata.input.parse(args), context, services);
};

test("canonical validation and token estimates are strict and honest", async () => {
  expect(await invoke("content.validate", { entity: { kind: "character", id: "bad" } })).toMatchObject({ valid: false, kind: null, id: null });
  expect(await invoke("content.tokens.estimate", { text: "abcde" })).toEqual({ characters: 5, tokens: 2, method: "rough-four-characters" });
  await expect(invoke("content.tokens.estimate", { text: "ok", extra: true })).rejects.toThrow();
});

test("macro metadata is paged and regex execution is not exposed on the host thread", async () => {
  const macros = await invoke("macros.describe", { offset: 0, limit: 2 }) as { macros: { name: string }[]; total: number; nextOffset: number | null };
  expect(macros.macros).toHaveLength(2);
  expect(macros.nextOffset).toBe(2);
  expect(macros.total).toBeGreaterThan(2);
  expect(diagnosticOperations.some((item) => item.metadata.id === "regex.preview")).toBe(false);
});
