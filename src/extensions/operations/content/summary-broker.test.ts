/** Exercises the real broker, operation, and ContentStore adapter with isolated rows. */
import { expect, test } from "bun:test";
import type { EffectReceipt, ExtensionGrantSet } from "../../contracts/grants";
import type { ExtensionBudget, ExtensionBudgetReservation } from "../../../stage/contracts/extension-store";
import type { ContentStore } from "../../../stage/contracts/content-store";
import type { PieceSummary } from "../../../stage/contracts/content-store-summary";
import { createExtensionBroker } from "../../broker/invoke";
import { createExtensionOperations } from "../../../generated/extension-operations";
import { extensionContentServices } from "../../runtime/content-services";

const rows: PieceSummary[] = [
  { id: "allowed", kind: "character", name: "needle permitted", revision: "a", version: 1, writeId: 1, updatedAt: 1, tokens: 0 },
  { id: "blocked", kind: "character", name: "needle secret", revision: "b", version: 1, writeId: 2, updatedAt: 2, tokens: 0 },
];

test("broker and ContentStore adapter constrain search before ranking and limiting", async () => {
  const readIds: string[] = [];
  const store = {
    summary: async (kind: string, id: string) => { readIds.push(`${kind}:${id}`); return rows.find((row) => row.kind === kind && row.id === id) ?? null; },
  } as unknown as ContentStore;
  const operation = createExtensionOperations({ content: extensionContentServices(store) }).all().find((item) => item.id === "content.search")!;
  const principal = { storeId: "fixture", packageId: "example.search", packageDigest: "a".repeat(64), apiMajor: 1, policyFingerprint: "b".repeat(64), grantRevision: 1, runEpoch: 1 };
  const grant = { operation: "content.search", resources: [{ kind: "character", id: "allowed" }], fields: ["id", "kind", "name"], methods: [], destinations: [], duration: "persistent" as const, budget: { requests: 10, bytes: 30_000, tokens: 0 } };
  const grants: ExtensionGrantSet = { packageId: principal.packageId, packageDigest: principal.packageDigest, policyFingerprint: principal.policyFingerprint, revision: 1, grants: [grant] };
  const receipts: EffectReceipt[] = [];
  const reservations: ExtensionBudgetReservation[] = [];
  let sequence = 0;
  const invoke = createExtensionBroker([operation], {
    principal: () => principal, grants: () => grants, host: "desktop", operationMetadata: [], signal: new AbortController().signal,
    confirm: async () => true, reserveBudget: async (item: ExtensionBudgetReservation, _limits: ExtensionBudget) => { reservations.push(item); return true; },
    settleBudget: async (_pkg: string, id: string, bytes: number) => reservations.some((item) => item.id === id && bytes <= item.bytes),
    record: async (receipt: EffectReceipt) => { receipts.push(receipt); }, readReceipts: async () => [], now: () => 1, id: () => `receipt-${++sequence}`,
    commitContext: (current, operationName, access) => ({ access, owner: "00000000-0000-4000-8000-000000000001", epoch: 1, packageId: current.packageId, packageDigest: current.packageDigest, policyFingerprint: current.policyFingerprint, grantRevision: current.grantRevision, operation: operationName, now: () => 1 }),
  });
  const request = (id: string) => invoke({ v: 1, type: "request", id: 1, operation: "content.search", args: {
    query: "needle", scope: { type: "selected", resources: [{ kind: "character", id }] }, fields: ["id", "kind", "name"], limit: 1,
  } });
  await expect(request("allowed")).resolves.toEqual([{ id: "allowed", kind: "character", name: "needle permitted" }]);
  expect(readIds).toEqual(["character:allowed"]);
  await expect(request("blocked")).rejects.toMatchObject({ code: "denied" });
  expect(readIds).toEqual(["character:allowed"]);
  expect(receipts.filter(({ status }) => status === "completed")).toHaveLength(1);
});
