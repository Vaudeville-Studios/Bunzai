/** Covers package-isolated storage access, reserved settings keys and fenced mutations. */
import { expect, test } from "bun:test";
import type { EffectReceipt, ExtensionGrantSet } from "../../contracts/grants";
import type { ExtensionBudget, ExtensionBudgetReservation } from "../../../stage/contracts/extension-store";
import type { ExtensionCommitContext } from "../../../stage/contracts/extension-store";
import type { ExtensionContentServices, OperationPrincipal } from "../../contracts/operation";
import { createExtensionBroker } from "../../broker/invoke";
import { createExtensionOperations } from "../../../generated/extension-operations";
import type { ExtensionStorageServices } from "./_services";

const principal: OperationPrincipal = { storeId: "store", packageId: "pkg.owned", packageDigest: "a".repeat(64), apiMajor: 1, policyFingerprint: "b".repeat(64), grantRevision: 2, runEpoch: 3 };
const noopContent: ExtensionContentServices = { readSummary: async () => null, readBody: async () => null, readSelectedFields: async () => null, listSummaries: async () => [], searchSummaries: async () => [], readFields: async () => null, readPersonaIdentity: async () => null, readLinks: async () => null, listHistory: async () => [], readHistory: async () => null, trash: async () => false, readGrave: async () => null, restore: async () => null };

test("storage calls use the trusted package namespace and review exact writes", async () => {
  const writes: unknown[][] = [];
  const commit: ExtensionCommitContext = { owner: "00000000-0000-4000-8000-000000000001", epoch: 1, packageId: principal.packageId, packageDigest: principal.packageDigest, policyFingerprint: principal.policyFingerprint, grantRevision: 1, operation: "storage.set", access: { resources: [], fields: ["storage.own"], methods: [], destinations: [] }, now: () => 1 };
  const storage: ExtensionStorageServices = {
    read: async () => null, list: async () => [],
    write: async (...args) => { writes.push(args); return { status: "saved", revision: 4 }; },
    delete: async () => ({ status: "deleted" }),
  };
  const operation = createExtensionOperations({ content: noopContent, storage }).get("storage.set")!;
  const grant = { operation: "storage.set", resources: [], fields: ["data"], methods: [], destinations: [], duration: "session" as const, budget: { requests: 10, bytes: 100_000, tokens: 0 } };
  const grants: ExtensionGrantSet = { packageId: principal.packageId, packageDigest: principal.packageDigest, policyFingerprint: principal.policyFingerprint, revision: principal.grantRevision, grants: [grant] };
  let review: unknown;
  const receipts: EffectReceipt[] = [];
  const reservations: ExtensionBudgetReservation[] = [];
  const invoke = createExtensionBroker([operation], {
    principal: () => principal, grants: () => grants, host: "desktop", operationMetadata: [], signal: new AbortController().signal,
    confirm: async (effect) => { review = effect; return true; }, reserveBudget: async (item: ExtensionBudgetReservation, _limits: ExtensionBudget) => { reservations.push(item); return true; },
    settleBudget: async (_packageId: string, id: string, bytes: number) => reservations.some((item) => item.id === id && bytes <= item.bytes),
    record: async (receipt: EffectReceipt) => { receipts.push(receipt); }, readReceipts: async () => [], now: () => 1, id: () => "receipt-1",
    commitContext: () => commit,
  });
  await expect(invoke({ v: 1, type: "request", id: 1, operation: "storage.set", args: { key: "theme.choice", value: { id: "dark" }, expectedRevision: -1 } })).resolves.toEqual({ status: "saved", revision: 4 });
  expect(writes).toEqual([[principal.packageId, "theme.choice", { id: "dark" }, -1, commit]]);
  expect(JSON.stringify(review)).toContain("theme.choice");
  expect(JSON.stringify(review)).not.toContain('"id":"dark"');
  expect(receipts.map(({ status }) => status)).toEqual(["admitted", "committed"]);
});
/** Covers package-isolated storage access, reserved settings keys and fenced mutations. */
