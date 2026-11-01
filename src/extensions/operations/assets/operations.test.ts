/** Verify the asset bridge's largest response stays within the shared guest JSON ceiling. */
import { expect, test } from "bun:test";
import type { EffectReceipt, ExtensionGrantSet } from "../../contracts/grants";
import type { ExtensionBudget, ExtensionBudgetReservation } from "../../../stage/contracts/extension-store";
import type { OperationPrincipal } from "../../contracts/operation";
import { bytesToBase64 } from "../../../core/base64";
import { sha256HexBytes } from "../../../core/sha256";
import { MAX_VALUE_BYTES } from "../../contracts/limits";
import { createExtensionBroker } from "../../broker/invoke";
import { createContentStore } from "../../../stage/store/content-store";
import { memoryDocumentBackend } from "../../../stage/store/memory/document-backend";
import { createExtensionAssetServices } from "../../runtime/asset-services";
import { extensionContentServices } from "../../runtime/content-services";
import { createExtensionOperations } from "../../../generated/extension-operations";
import { MAX_EXTENSION_ASSET_READ_BYTES } from "./operations";

const principal: OperationPrincipal = { storeId: "fixture", packageId: "fixture.assets", packageDigest: "a".repeat(64), apiMajor: 1, policyFingerprint: "b".repeat(64), grantRevision: 1, runEpoch: 1 };

test("assets.read returns its exact maximum payload under the shared wire limit and rejects one byte more", async () => {
  const bytes = Uint8Array.from({ length: MAX_EXTENSION_ASSET_READ_BYTES }, (_, index) => index % 251);
  const base64 = bytesToBase64(bytes);
  const store = createContentStore(memoryDocumentBackend());
  await store.create({ schemaVersion: "1", kind: "character", id: "mira", body: {
    identity: { name: "Mira" }, persona: {}, prompts: {}, greetings: {}, examples: {},
    media: { portrait: { role: "portrait", ref: `data:image/png;base64,${base64}` } }, attribution: {}, discovery: {},
  } });
  const catalog = createExtensionOperations({ content: extensionContentServices(store), assets: createExtensionAssetServices(store) });
  const grants: ExtensionGrantSet = { packageId: principal.packageId, packageDigest: principal.packageDigest, policyFingerprint: principal.policyFingerprint, revision: 1, grants: [{ operation: "assets.read", resources: [{ kind: "character", id: "mira" }], fields: ["media"], methods: [], destinations: [], duration: "session", budget: { requests: 4, bytes: MAX_VALUE_BYTES * 2, tokens: 0 } }] };
  const records: EffectReceipt[] = [];
  const reservations: ExtensionBudgetReservation[] = [];
  const invoke = createExtensionBroker(catalog.all(), {
    principal: () => principal, grants: () => grants, host: "desktop", operationMetadata: [], signal: new AbortController().signal,
    confirm: async () => true, reserveBudget: async (reservation: ExtensionBudgetReservation, _budget: ExtensionBudget) => { reservations.push(reservation); return true; },
    settleBudget: async (_packageId, id, used) => reservations.some((item) => item.id === id && used <= item.bytes),
    record: async (receipt) => { records.push(receipt); }, readReceipts: async () => records, now: () => 1, id: () => `receipt-${records.length}`,
    commitContext: (current, operation, access) => ({ access, owner: "00000000-0000-4000-8000-000000000001", epoch: current.runEpoch, packageId: current.packageId, packageDigest: current.packageDigest, policyFingerprint: current.policyFingerprint, grantRevision: current.grantRevision, operation, now: () => 1 }),
  });
  const result = await invoke({ v: 1, type: "request", id: 1, operation: "assets.read", args: { kind: "character", id: "mira", sha: sha256HexBytes(bytes), maxBytes: MAX_EXTENSION_ASSET_READ_BYTES } }) as { status: string; bytes: number; base64: string };
  expect(result.status).toBe("ok");
  expect(result.bytes).toBe(MAX_EXTENSION_ASSET_READ_BYTES);
  expect(new TextEncoder().encode(JSON.stringify(result)).byteLength).toBeLessThanOrEqual(MAX_VALUE_BYTES);
  expect(result.base64).toBe(base64);
  await expect(invoke({ v: 1, type: "request", id: 2, operation: "assets.read", args: { kind: "character", id: "mira", sha: sha256HexBytes(bytes), maxBytes: MAX_EXTENSION_ASSET_READ_BYTES + 1 } })).rejects.toMatchObject({ code: "invalid-request" });
});
