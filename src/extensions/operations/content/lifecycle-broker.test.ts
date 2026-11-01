/** Broker admission, reviewed effect and ContentStore revision guard for Trash. */
import { expect, test } from "bun:test";
import type { EffectReceipt, ExtensionGrantSet } from "../../contracts/grants";
import type { ExtensionBudget, ExtensionBudgetReservation } from "../../../stage/contracts/extension-store";
import type { ContentStore } from "../../../stage/contracts/content-store";
import type { OperationPrincipal } from "../../contracts/operation";
import { createExtensionBroker } from "../../broker/invoke";
import { createExtensionOperations } from "../../../generated/extension-operations";
import { extensionContentServices } from "../../runtime/content-services";

test("Trash requires exact resource approval, reviewed revision and commit-bound store CAS", async () => {
  const calls: unknown[][] = [];
  const store = {
    deleteWithReceipt: async (...args: unknown[]) => { calls.push(args); return args[2] === "rev-1" ? { kind: "character", id: "ada", action: "delete" } : null; },
  } as unknown as ContentStore;
  const operation = createExtensionOperations({ content: extensionContentServices(store) }).get("content.trash")!;
  const principal: OperationPrincipal = { storeId: "s", packageId: "p", packageDigest: "a".repeat(64), apiMajor: 1, policyFingerprint: "b".repeat(64), grantRevision: 1, runEpoch: 1 };
  const grant = { operation: "content.trash", resources: [{ kind: "character", id: "ada" }], fields: ["lifecycle"], methods: [], destinations: [], duration: "session" as const, budget: { requests: 10, bytes: 20_000, tokens: 0 } };
  const grants: ExtensionGrantSet = { packageId: "p", packageDigest: principal.packageDigest, policyFingerprint: principal.policyFingerprint, revision: 1, grants: [grant] };
  const reservations: ExtensionBudgetReservation[] = [];
  const reviews: unknown[] = [];
  const invoke = createExtensionBroker([operation], {
    principal: () => principal, grants: () => grants, host: "desktop", operationMetadata: [], signal: new AbortController().signal,
    confirm: async (review) => { reviews.push(review); return true; }, reserveBudget: async (item: ExtensionBudgetReservation, _limits: ExtensionBudget) => { reservations.push(item); return true; },
    settleBudget: async (_packageId: string, id: string, bytes: number) => reservations.some((item) => item.id === id && bytes <= item.bytes),
    record: async (_receipt: EffectReceipt) => {}, readReceipts: async () => [], now: () => 1, id: () => "receipt-1",
    commitContext: (current: OperationPrincipal, operationId: string, access) => ({ owner: "00000000-0000-4000-8000-000000000001", epoch: 1, packageId: current.packageId, packageDigest: current.packageDigest, policyFingerprint: current.policyFingerprint, grantRevision: current.grantRevision, operation: operationId, access, now: () => 1 }),
  });
  await expect(invoke({ v: 1, type: "request", id: 1, operation: "content.trash", args: { kind: "character", id: "ada", expectedRevision: "rev-1" } })).resolves.toEqual({ status: "trashed", kind: "character", id: "ada" });
  await expect(invoke({ v: 1, type: "request", id: 2, operation: "content.trash", args: { kind: "character", id: "ada", expectedRevision: "stale" } })).resolves.toEqual({ status: "stale", kind: "character", id: "ada" });
  expect(calls.map(([kind, id, revision]) => [kind, id, revision])).toEqual([["character", "ada", "rev-1"], ["character", "ada", "stale"]]);
  expect((calls[0]?.[3] as { operation: string }).operation).toBe("content.trash");
  expect(reviews.every((review) => JSON.stringify(review).includes("move-to-trash"))).toBe(true);
  await expect(invoke({ v: 1, type: "request", id: 3, operation: "content.trash", args: { kind: "character", id: "other", expectedRevision: "rev-1" } })).rejects.toMatchObject({ code: "denied" });
  expect(calls).toHaveLength(2);
});
