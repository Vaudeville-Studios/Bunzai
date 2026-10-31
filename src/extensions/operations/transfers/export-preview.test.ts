/** Export preview keeps source escrow in trusted host code and writes only through selected-file preview. */
import { expect, test } from "bun:test";
import type { EffectReceipt, ExtensionGrantSet } from "../../contracts/grants";
import type { ExtensionBudget, ExtensionBudgetReservation } from "../../../stage/contracts/extension-store";
import type { OperationPrincipal } from "../../contracts/operation";
import { createContentStore } from "../../../stage/store/content-store";
import { memoryDocumentBackend } from "../../../stage/store/memory/document-backend";
import { createExtensionBroker } from "../../broker/invoke";
import { createExtensionOperations } from "../../../generated/extension-operations";
import { extensionContentServices } from "../../runtime/content-services";
import { createExtensionTransferServices } from "../../runtime/transfer-services";
import { extensionFormatServices } from "./_services";
import vaudJson from "../../../formats/vaud-json";
import type { ExtensionFileServices } from "../files/_services";
import { digestFileBytes } from "../files/_bytes";

const entity = { schemaVersion: "1", kind: "character", id: "mira", body: { identity: { name: "Mira" }, persona: { personality: "Patient" }, prompts: { systemPrompt: "Private prompt content." }, greetings: { firstMessage: "Welcome." }, examples: {}, media: {}, attribution: {}, discovery: {} }, original: { "vaud-json": { raw: { untouched: true }, unmapped: {} } } };
const principal: OperationPrincipal = { storeId: "fixture", packageId: "fixture.exporter", packageDigest: "a".repeat(64), apiMajor: 1, policyFingerprint: "b".repeat(64), grantRevision: 1, runEpoch: 1 };
const resource = { kind: "character", id: "mira" };
const grants: ExtensionGrantSet = { packageId: principal.packageId, packageDigest: principal.packageDigest, policyFingerprint: principal.policyFingerprint, revision: 1, grants: [
  { operation: "export.preview", resources: [resource], fields: ["body", "file.contents"], methods: [], destinations: [], duration: "session", budget: { requests: 8, bytes: 1_000_000, tokens: 0 } },
  { operation: "content.read", resources: [resource], fields: ["body"], methods: [], destinations: [], duration: "session", budget: { requests: 8, bytes: 1_000_000, tokens: 0 } },
  { operation: "files.write.preview", resources: [], fields: ["file.contents"], methods: [], destinations: [], duration: "session", budget: { requests: 8, bytes: 1_000_000, tokens: 0 } },
] };

test("export preview serializes through the canonical adapter and stages selected-file bytes only", async () => {
  const store = createContentStore(memoryDocumentBackend());
  await store.create(entity);
  let staged: Uint8Array<ArrayBufferLike> = new Uint8Array();
  const files: ExtensionFileServices = {
    pick: async () => null, read: async () => null,
    previewWrite: async ({ bytes }) => { staged = bytes; return { previewId: "preview-1", proposedBytes: bytes.byteLength, proposedDigest: digestFileBytes(bytes) }; },
    reviewWrite: () => { throw new Error("not a write action"); }, stageWrite: () => { throw new Error("not a write action"); }, write: async () => "cancelled",
  };
  const operations = createExtensionOperations({ content: extensionContentServices(store), transfers: createExtensionTransferServices(store), formats: extensionFormatServices([vaudJson]), files });
  const receipts: EffectReceipt[] = [];
  const reservations: ExtensionBudgetReservation[] = [];
  const invoke = createExtensionBroker(operations.all(), {
    principal: () => principal, grants: () => grants, activationOrigin: "command", host: "desktop", operationMetadata: [], signal: new AbortController().signal,
    confirm: async () => true, reserveBudget: async (item: ExtensionBudgetReservation, _budget: ExtensionBudget) => { reservations.push(item); return true; },
    settleBudget: async (_packageId, id, used) => reservations.some((item) => item.id === id && used <= item.bytes),
    record: async (receipt: EffectReceipt) => { receipts.push(receipt); }, readReceipts: async () => [], now: () => 1, id: () => `receipt-${receipts.length}`,
    commitContext: (current, operation, access) => ({ access, owner: "00000000-0000-4000-8000-000000000001", epoch: current.runEpoch, packageId: current.packageId, packageDigest: current.packageDigest, policyFingerprint: current.policyFingerprint, grantRevision: current.grantRevision, operation, now: () => 1 }),
  });
  const result = await invoke({ v: 1, type: "request", id: 1, operation: "export.preview", args: { handleId: "picked-output", formatId: "vaud-json", kind: "character", id: "mira" } }) as { format: { id: string }; preview: { proposedDigest: string }; report: { coverage: string } };
  expect(result).toMatchObject({ format: { id: "vaud-json" }, report: { coverage: "native" } });
  expect(result.preview.proposedDigest).toBe(digestFileBytes(staged));
  expect(new TextDecoder().decode(staged)).toContain('"untouched": true');
  expect(JSON.stringify(result)).not.toContain("Private prompt content.");
  expect(receipts.filter(({ status }) => status === "completed").map(({ operation }) => operation)).toEqual(["content.read", "files.write.preview", "export.preview"]);
});
