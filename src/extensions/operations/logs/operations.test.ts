/** Proves log operations stay package-scoped, bounded and separate from effect receipts. */
import { expect, test } from "bun:test";
import type { EffectReceipt, ExtensionGrantSet } from "../../contracts/grants";
import type { ExtensionBudget, ExtensionBudgetReservation, ExtensionCommitContext } from "../../../stage/contracts/extension-store";
import type { ExtensionContentServices, OperationPrincipal } from "../../contracts/operation";
import { createExtensionBroker } from "../../broker/invoke";
import { bindExtensionDefinitions } from "../../contracts/operation";
import { createOperationCatalog } from "../../catalog/operations";
import type { ExtensionOperationServices } from "../_services";
import { logOperations } from "./operations";
import type { ExtensionLogServices } from "./_services";

const principal: OperationPrincipal = { storeId: "fixture", packageId: "pkg.logs", packageDigest: "a".repeat(64), apiMajor: 1, policyFingerprint: "b".repeat(64), grantRevision: 1, runEpoch: 1 };
const content: ExtensionContentServices = { listSummaries: async () => [], searchSummaries: async () => [], readSummary: async () => null, readBody: async () => null, readSelectedFields: async () => null, readFields: async () => null, readPersonaIdentity: async () => null, readLinks: async () => null, listHistory: async () => [], readHistory: async () => null, trash: async () => false, readGrave: async () => null, restore: async () => null };
const commit: ExtensionCommitContext = { owner: "00000000-0000-4000-8000-000000000001", epoch: 1, packageId: principal.packageId, packageDigest: principal.packageDigest, policyFingerprint: principal.policyFingerprint, grantRevision: principal.grantRevision, operation: "logs.write", access: { resources: [], fields: ["logs"], methods: [], destinations: [] }, now: () => 1 };

function broker(services: ExtensionOperationServices, operations: readonly string[]) {
  const receipts: EffectReceipt[] = [];
  const grants: ExtensionGrantSet = { packageId: principal.packageId, packageDigest: principal.packageDigest, policyFingerprint: principal.policyFingerprint, revision: principal.grantRevision,
    grants: operations.map((operation) => ({ operation, resources: [], fields: [operation === "diagnostics.runtime" ? "runtime" : "logs"], methods: [], destinations: [], duration: "session", budget: { requests: 10, bytes: 300_000, tokens: 0 } })) };
  const descriptors = bindExtensionDefinitions(logOperations, services).filter((item) => operations.includes(item.id));
  const invoke = createExtensionBroker(descriptors, {
    principal: () => principal, grants: () => grants, host: "desktop", operationMetadata: [], signal: new AbortController().signal,
    confirm: async () => false, reserveBudget: async (_item: ExtensionBudgetReservation, _limits: ExtensionBudget) => true,
    settleBudget: async () => true, record: async (receipt) => { receipts.push(receipt); }, readReceipts: async () => [],
    now: () => 1, id: () => "log-test", commitContext: () => commit,
  });
  return { invoke, receipts };
}

test("write and read-own pass only the trusted package ID and fenced append context", async () => {
  const appended: unknown[][] = [];
  const logs: ExtensionLogServices = {
    append: async (...args) => { appended.push(args); return { id: "l-1", createdAt: 100 }; },
    readOwn: async (packageId, cursor, limit) => ({ records: [{ id: "l-1", createdAt: 100, level: "info", message: `${packageId}:${cursor ?? "start"}:${limit}` }], nextCursor: null }),
  };
  const service = broker({ content, logs }, ["logs.write", "logs.readOwn"]);
  await expect(service.invoke({ v: 1, type: "request", id: 1, operation: "logs.write", args: { level: "info", message: "ready" } })).resolves.toEqual({ id: "l-1", createdAt: 100 });
  expect(appended).toEqual([[principal.packageId, { level: "info", message: "ready" }, commit]]);
  await expect(service.invoke({ v: 1, type: "request", id: 2, operation: "logs.readOwn", args: { cursor: "l-0", limit: 5 } })).resolves.toEqual({ records: [{ id: "l-1", createdAt: 100, level: "info", message: "pkg.logs:l-0:5" }], nextCursor: null });
});

test("logs reject oversize UTF-8 input and malformed persisted output before returning it", async () => {
  let writes = 0;
  const logs: ExtensionLogServices = { append: async () => { writes++; return { id: "x", createdAt: 1 }; }, readOwn: async () => ({ records: [], nextCursor: null }) };
  const service = broker({ content, logs }, ["logs.write", "logs.readOwn"]);
  await expect(service.invoke({ v: 1, type: "request", id: 1, operation: "logs.write", args: { level: "info", message: "\u{1F642}".repeat(257) } })).rejects.toThrow();
  expect(writes).toBe(0);
  await expect(service.invoke({ v: 1, type: "request", id: 2, operation: "logs.readOwn", args: {} })).resolves.toEqual({ records: [], nextCursor: null });
  const readOwn = logOperations.find((item) => item.metadata.id === "logs.readOwn");
  if (!readOwn) throw new Error("logs.readOwn definition is missing");
  expect(() => readOwn.metadata.output.parse({ records: [{ id: "x", createdAt: 1, level: "info", message: "x", stack: "secret" }], nextCursor: null })).toThrow();
});

test("catalog accepts the exact mixed-case plan ID without relaxing other policy rules", () => {
  const operations = bindExtensionDefinitions(logOperations, { content });
  expect(createOperationCatalog(operations).get("logs.readOwn")?.id).toBe("logs.readOwn");
  expect(operations.find((item) => item.id === "logs.readOwn")?.hosts).toEqual(["desktop", "browser", "terminal"]);
  const readOwn = operations.find((item) => item.id === "logs.readOwn");
  if (!readOwn) throw new Error("logs.readOwn operation is missing");
  expect(() => createOperationCatalog([readOwn, { ...readOwn, id: "Logs.readOwn" }])).toThrow();
});
