/** Exercises collection operation scope, review and revision guards through the broker and real state adapter. */
import { expect, test } from "bun:test";
import type { EffectReceipt, ExtensionGrantSet } from "../../contracts/grants";
import type { ExtensionBudget, ExtensionBudgetReservation } from "../../../stage/contracts/extension-store";
import type { ExtensionOperationDefinition, OperationPrincipal } from "../../contracts/operation";
import { createExtensionBroker } from "../../broker/invoke";
import { bindExtensionOperation } from "../../contracts/operation";
import type { ExtensionOperationServices } from "../_services";
import { collectionReadWriteOperations } from "./read-write";
import { extensionCollectionStateServices } from "../../runtime/collection-services";
import { memoryStateStore } from "../../../stage/store/memory/state-store";

const principal: OperationPrincipal = { storeId: "fixture", packageId: "fixture.collections", packageDigest: "a".repeat(64), apiMajor: 1, policyFingerprint: "b".repeat(64), grantRevision: 1, runEpoch: 1 };
const budget = { requests: 10, bytes: 100_000, tokens: 0 };
const grants: ExtensionGrantSet = {
  packageId: principal.packageId, packageDigest: principal.packageDigest, policyFingerprint: principal.policyFingerprint, revision: 1,
  grants: [
    { operation: "collections.create", resources: [{ kind: "library", id: "library" }], fields: ["collection.create"], methods: [], destinations: [], duration: "session", budget },
    { operation: "collections.read", resources: [{ kind: "collection", id: "cast" }], fields: ["collection.name", "collection.members"], methods: [], destinations: [], duration: "session", budget },
    ...["collections.membership.preview", "collections.membership.apply"].map((operation) => ({ operation, resources: [{ kind: "collection", id: "cast" }, { kind: "character", id: "ada" }], fields: ["collection.members"], methods: [], destinations: [], duration: "session" as const, budget })),
  ],
};

test("create/read/membership operations share the canonical revisioned collection owner", async () => {
  const state = memoryStateStore({ authorizeExtensionCommit: () => undefined });
  const services = { content: {} as never, collections: extensionCollectionStateServices(state) };
  const operations = collectionReadWriteOperations.map((item) => bindExtensionOperation(item as ExtensionOperationDefinition<unknown, unknown, ExtensionOperationServices>, services));
  const receipts: EffectReceipt[] = [];
  const reservations: ExtensionBudgetReservation[] = [];
  let sequence = 0;
  const invoke = createExtensionBroker(operations, {
    principal: () => principal, grants: () => grants, host: "desktop", operationMetadata: [], signal: new AbortController().signal,
    confirm: async () => true, reserveBudget: async (item: ExtensionBudgetReservation, _limits: ExtensionBudget) => { reservations.push(item); return true; },
    settleBudget: async (_packageId, id, bytes) => reservations.some((item) => item.id === id && bytes <= item.bytes),
    record: async (receipt) => { receipts.push(receipt); }, readReceipts: async () => [], now: () => 1, id: () => `receipt-${++sequence}`,
    commitContext: (current, operation, access) => ({ access, owner: "00000000-0000-4000-8000-000000000001", epoch: current.runEpoch, packageId: current.packageId, packageDigest: current.packageDigest, policyFingerprint: current.policyFingerprint, grantRevision: current.grantRevision, operation, now: () => 1 }),
  });
  const call = async (operation: string, args: unknown) => invoke({ v: 1, type: "request", id: ++sequence, operation, args });
  const created = await call("collections.create", { name: "Cast", note: "Main cast", expectedRevision: -1 });
  expect(created).toMatchObject({ status: "created", id: "cast", revision: 0 });
  const preview = await call("collections.membership.preview", { id: "cast", action: "add", kind: "character", refId: "ada", expectedRevision: 0 });
  expect(preview).toMatchObject({ status: "ready", member: true, revision: 0 });
  expect(await call("collections.membership.apply", { id: "cast", action: "add", kind: "character", refId: "ada", expectedRevision: 0 })).toMatchObject({ status: "ready", member: true, revision: 1 });
  expect(await call("collections.read", { id: "cast", fields: ["collection.name", "collection.members"] })).toMatchObject({ collection: { name: "Cast", members: [{ kind: "character", id: "ada" }] }, revision: 1 });
  await expect(call("collections.membership.apply", { id: "cast", action: "add", kind: "character", refId: "unauthorized", expectedRevision: 1 })).rejects.toMatchObject({ code: "denied" });
  expect(receipts.filter(({ status }) => status === "committed").map(({ operation }) => operation)).toEqual(["collections.create", "collections.membership.apply"]);
  expect(receipts.filter(({ status }) => status === "completed").map(({ operation }) => operation)).toEqual(["collections.membership.preview", "collections.read"]);
});
