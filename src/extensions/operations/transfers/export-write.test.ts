/** Verify export.write delegates to the independently granted, reviewed file-write operation. */
import { expect, test } from "bun:test";
import type { EffectReceipt, ExtensionGrantSet } from "../../contracts/grants";
import type { ExtensionBudget, ExtensionBudgetReservation } from "../../../stage/contracts/extension-store";
import type { OperationPrincipal } from "../../contracts/operation";
import { createExtensionBroker } from "../../broker/invoke";
import { createExtensionOperations } from "../../../generated/extension-operations";
import { extensionContentServices } from "../../runtime/content-services";
import { createContentStore } from "../../../stage/store/content-store";
import { memoryDocumentBackend } from "../../../stage/store/memory/document-backend";
import type { ExtensionFileServices } from "../files/_services";
import { digestFileBytes } from "../files/_bytes";

const principal: OperationPrincipal = { storeId: "fixture", packageId: "fixture.exporter", packageDigest: "a".repeat(64), apiMajor: 1, policyFingerprint: "b".repeat(64), grantRevision: 1, runEpoch: 1 };
const grant = (operation: string) => ({ operation, resources: [], fields: ["file.contents"], methods: [], destinations: [], duration: "session" as const, budget: { requests: 8, bytes: 100_000, tokens: 0 } });

test("export.write invokes only the separately granted files.write.apply broker child", async () => {
  const bytes = new TextEncoder().encode("export bytes");
  const files: ExtensionFileServices = {
    pick: async () => null, read: async () => null, previewWrite: async () => null,
    reviewWrite: () => ({ fileName: "export.json", mode: "create", current: { size: 0, lastModified: 0, digest: "0".repeat(64) }, proposedBytes: bytes.byteLength, proposedDigest: digestFileBytes(bytes) }),
    stageWrite: () => ({ id: "action-1", packageId: principal.packageId, packageName: "Exporter", principal: { storeId: principal.storeId, packageId: principal.packageId, packageDigest: principal.packageDigest, grantRevision: principal.grantRevision, runEpoch: principal.runEpoch }, expiresAt: 100, operation: "files.write.apply", action: "write", handleId: "handle-1", fileName: "export.json", mode: "create", current: { size: 0, lastModified: 0, digest: "0".repeat(64) }, proposedDigest: digestFileBytes(bytes), proposedBytes: bytes.byteLength }),
    write: async () => "written",
  };
  const catalog = createExtensionOperations({ content: extensionContentServices(createContentStore(memoryDocumentBackend())), files });
  const operations = catalog.all().filter(({ id }) => id === "export.write" || id === "files.write.apply");
  const grants: ExtensionGrantSet = { packageId: principal.packageId, packageDigest: principal.packageDigest, policyFingerprint: principal.policyFingerprint, revision: 1, grants: [grant("export.write"), grant("files.write.apply")] };
  const records: EffectReceipt[] = [];
  const reservations: ExtensionBudgetReservation[] = [];
  let approved = 0;
  const invoke = createExtensionBroker(operations, {
    principal: () => principal, grants: () => grants, host: "desktop", operationMetadata: [], signal: new AbortController().signal,
    confirm: async (review) => { approved++; expect(review).toMatchObject({ operation: "files.write.apply", review: { fileName: "export.json", proposedDigest: digestFileBytes(bytes) } }); return true; },
    reserveBudget: async (reservation: ExtensionBudgetReservation, _budget: ExtensionBudget) => { reservations.push(reservation); return true; },
    settleBudget: async (_packageId, id, used) => reservations.some((item) => item.id === id && used <= item.bytes),
    record: async (receipt) => { records.push(receipt); }, readReceipts: async () => records, now: () => 1, id: () => `receipt-${records.length}`,
    commitContext: (current, operation, access) => ({ access, owner: "00000000-0000-4000-8000-000000000001", epoch: current.runEpoch, packageId: current.packageId, packageDigest: current.packageDigest, policyFingerprint: current.policyFingerprint, grantRevision: current.grantRevision, operation, now: () => 1 }),
  });
  await expect(invoke({ v: 1, type: "request", id: 1, operation: "export.write", args: { previewId: "preview-1" } })).resolves.toEqual({ written: true });
  expect(approved).toBe(1);
  expect(records.map(({ operation, status }) => `${operation}:${status}`)).toEqual(["export.write:admitted", "files.write.apply:admitted", "files.write.apply:committed", "export.write:committed"]);
});
