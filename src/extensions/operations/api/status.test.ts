/** Verifies discovery/status APIs consume only the broker's principal-scoped projections. */
import { expect, test } from "bun:test";
import type { ExtensionOperationContext } from "../../contracts/operation";
import type { ExtensionOperationDefinition } from "../../contracts/operation";
import type { ExtensionOperationServices } from "../_services";
import { apiStatusOperations } from "./status";
import describe, { createOperations as bindDescribe } from "./describe";
import { createExtensionBroker } from "../../broker/invoke";
import { extensionOperationMetadata } from "../../../generated/extension-operation-metadata";
import type { EffectReceipt, ExtensionGrantSet } from "../../contracts/grants";
import type { ExtensionBudget, ExtensionBudgetReservation } from "../../../stage/contracts/extension-store";
import type { OperationPrincipal } from "../../contracts/operation";
import type { JsonValue } from "../../contracts/value";
import { MAX_OPERATION_PAGE_BYTES } from "../../contracts/operation-metadata";

const operation = (id: string, title: string) => ({ id, version: 1, inputVersion: 1, outputVersion: 1, projectionVersion: 1, title, description: `${title} operation`, effect: "read", sensitivity: "private", hosts: ["desktop"], policy: { resources: [], fields: [], methods: [], destinations: [], destinationMode: "none", budget: "read-small", confirmation: "none" }, input: {}, output: {} });

const context: ExtensionOperationContext = {
  principal: { storeId: "s", packageId: "fixture.extension", packageDigest: "d", apiMajor: 1, policyFingerprint: "p", grantRevision: 1, runEpoch: 1 },
  signal: new AbortController().signal, invocation: { resources: [] }, resources: [], grantedOperations: ["content.search", "api.describe"], host: "desktop",
  availableOperations: [operation("content.search", "Search"), operation("content.read", "Read content"), operation("api.describe", "Describe operations")],
  availableGrants: [{ operation: "content.search", resources: [{ kind: "character", id: "mira" }], fields: ["name"], methods: [], destinations: [], duration: "session", budget: { requests: 2, bytes: 1000, tokens: 0 } }],
  operationReceipts: [{ id: "receipt-1", packageId: "fixture.extension", operation: "content.search", effect: "read", status: "completed", createdAt: 7, resourceCount: 1 }],
  access: { resources: [], fields: [], methods: [], destinations: [] },
  commit: { owner: "00000000-0000-4000-8000-000000000001", epoch: 1, packageId: "fixture.extension", packageDigest: "d", policyFingerprint: "p", grantRevision: 1, operation: "fixture", access: { resources: [], fields: [], methods: [], destinations: [] }, now: () => 1 },
  confirm: async () => true, assertCurrent: async () => {},
};
const invoke = async (id: string, args: unknown) => {
  const definition = apiStatusOperations.find((item) => item.metadata.id === id)! as ExtensionOperationDefinition<unknown, unknown, ExtensionOperationServices>;
  const services = { content: {} } as unknown as ExtensionOperationServices;
  return definition.execute(definition.metadata.input.parse(args), context, services);
};

test("catalog search and host availability expose public metadata with grant flags", async () => {
  expect(await invoke("api.search", { query: "search" })).toMatchObject({ operations: [{ id: "content.search", granted: true }], total: 1, nextOffset: null });
  expect(await invoke("host.features", {})).toMatchObject({ host: "desktop", operations: [{ id: "content.search", granted: true }, { id: "content.read", granted: false }, { id: "api.describe", granted: true }], total: 3, nextOffset: null });
  expect(await describe.execute({ offset: 0, limit: 10 }, context, undefined)).toMatchObject({ operations: [{ id: "content.search", granted: true }, { id: "content.read", granted: false }, { id: "api.describe", granted: true }], total: 3, nextOffset: null });
  expect(await invoke("operations.status", {})).toEqual({ host: "desktop", operations: [{ id: "content.search", status: "available", granted: true }, { id: "content.read", status: "available", granted: false }, { id: "api.describe", status: "available", granted: true }] });
});

test("permission and receipt status remain bound to the current package", async () => {
  expect(await invoke("permissions.status", {})).toMatchObject({ packageId: "fixture.extension", grants: [{ operation: "content.search", resources: [{ id: "mira" }] }] });
  expect(await invoke("operations.receipts.list", { limit: 5 })).toMatchObject({ receipts: [{ packageId: "fixture.extension", operation: "content.search" }], truncated: false });
});

test("brokered api.describe exposes public host metadata while only marking its own grant", async () => {
  const principal: OperationPrincipal = { storeId: "s", packageId: "fixture.extension", packageDigest: "d", apiMajor: 1, policyFingerprint: "p", grantRevision: 1, runEpoch: 1 };
  const grant = { operation: "api.describe", resources: [], fields: [], methods: [], destinations: [], duration: "session" as const, budget: { requests: 100, bytes: 25_000_000, tokens: 0 } };
  const grants: ExtensionGrantSet = { packageId: principal.packageId, packageDigest: principal.packageDigest, policyFingerprint: principal.policyFingerprint, revision: 1, grants: [grant] };
  const receipts: EffectReceipt[] = [];
  let next = 0;
  const metadata = extensionOperationMetadata as unknown as readonly JsonValue[];
  const invoke = createExtensionBroker(bindDescribe({ content: {} } as unknown as ExtensionOperationServices), {
    principal: () => principal, grants: () => grants, activationOrigin: "command", host: "desktop", operationMetadata: metadata, signal: new AbortController().signal,
    confirm: async () => false, reserveBudget: async (_reservation: ExtensionBudgetReservation, _budget: ExtensionBudget) => true,
    settleBudget: async () => true, record: async (receipt) => { receipts.push(receipt); }, readReceipts: async () => [], now: () => 1, id: () => `receipt-${++next}`,
    commitContext: (current, operation, access) => ({ access, owner: "00000000-0000-4000-8000-000000000001", epoch: current.runEpoch, packageId: current.packageId, packageDigest: current.packageDigest, policyFingerprint: current.policyFingerprint, grantRevision: current.grantRevision, operation, now: () => 1 }),
  });
  const described = new Map<string, string>();
  let offset = 0;
  let nextId = 1;
  let total = 0;
  do {
    const page = await invoke({ v: 1, type: "request", id: nextId++, operation: "api.describe", args: { offset, limit: 20 } }) as { operations: { id: string; granted: boolean; inputSchema: string; outputSchema: string }[]; total: number; nextOffset: number | null };
    total = page.total;
    expect(new TextEncoder().encode(JSON.stringify(page)).byteLength).toBeLessThanOrEqual(MAX_OPERATION_PAGE_BYTES);
    for (const row of page.operations) described.set(row.id, row.inputSchema);
    offset = page.nextOffset ?? -1;
  } while (offset >= 0);
  const expected = extensionOperationMetadata.filter(({ hosts }) => hosts.some((host) => host === "desktop"));
  expect(total).toBe(expected.length);
  expect([...described.keys()]).toEqual(expected.map(({ id }) => id));
  for (const row of expected) {
    const page = await invoke({ v: 1, type: "request", id: nextId++, operation: "api.describe", args: { ids: [row.id], limit: 1 } }) as { operations: { id: string; granted: boolean; inputSchema: string; outputSchema: string }[]; total: number; nextOffset: number | null };
    expect(page.total).toBe(1);
    expect(page.operations[0]?.id).toBe(row.id);
    expect(JSON.parse(page.operations[0]!.inputSchema)).toEqual(row.input);
    expect(JSON.parse(page.operations[0]!.outputSchema)).toEqual(row.output);
  }
  expect(described.get("content.read")).toBeDefined();
  expect(receipts).toHaveLength((nextId - 1) * 2);
  expect(receipts.filter(({ status }) => status === "completed")).toHaveLength(nextId - 1);
});
