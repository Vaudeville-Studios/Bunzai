/** One selected native file is parsed, scoped and staged through the real nested broker path. */
import { expect, test } from "bun:test";
import type { EffectReceipt, ExtensionGrantSet } from "../../contracts/grants";
import type { ExtensionBudget, ExtensionBudgetReservation } from "../../../stage/contracts/extension-store";
import type { OperationPrincipal } from "../../contracts/operation";
import { createContentStore } from "../../../stage/store/content-store";
import { memoryDocumentBackend } from "../../../stage/store/memory/document-backend";
import { createExtensionBroker } from "../../broker/invoke";
import { createExtensionOperations } from "../../../generated/extension-operations";
import { allCapabilities } from "../../../generated/capabilities";
import { extensionContentServices } from "../../runtime/content-services";
import { createExtensionDraftServices } from "../../runtime/draft-services";
import { extensionFormatServices } from "./_services";
import vaudJson from "../../../formats/vaud-json";
import type { ExtensionFileServices } from "../files/_services";

const entity = {
  schemaVersion: "1", kind: "character", id: "mira", body: {
    identity: { name: "Mira" }, persona: { personality: "Patient" }, prompts: { systemPrompt: "Keep this sealed as data." },
    greetings: { firstMessage: "Welcome." }, examples: {}, media: {}, attribution: {}, discovery: {},
  }, original: { "vaud-json": { raw: { preserve: true }, unmapped: {} } },
};
const principal: OperationPrincipal = { storeId: "fixture", packageId: "fixture.importer", packageDigest: "a".repeat(64), apiMajor: 1, policyFingerprint: "b".repeat(64), grantRevision: 1, runEpoch: 1 };
const resource = { kind: "character", id: "mira" };
const grants: ExtensionGrantSet = {
  packageId: principal.packageId, packageDigest: principal.packageDigest, policyFingerprint: principal.policyFingerprint, revision: 1,
  grants: [
    { operation: "import.preview", resources: [resource], fields: ["file.contents", "draft"], methods: [], destinations: [], duration: "session", budget: { requests: 8, bytes: 1_000_000, tokens: 0 } },
    { operation: "files.read", resources: [], fields: ["file.contents"], methods: [], destinations: [], duration: "session", budget: { requests: 8, bytes: 1_000_000, tokens: 0 } },
    { operation: "content.create.preview", resources: [resource], fields: ["draft"], methods: [], destinations: [], duration: "session", budget: { requests: 8, bytes: 1_000_000, tokens: 0 } },
  ],
};

test("import preview uses selected handle and nested grants, preserving canonical escrow without executing text", async () => {
  const bytes = new TextEncoder().encode(JSON.stringify(entity));
  const files: ExtensionFileServices = {
    pick: async () => null, read: async ({ packageName, handleId, maxBytes }) => packageName === principal.packageId && handleId === "picked-1" && bytes.length <= maxBytes ? bytes : null,
    previewWrite: async () => null, reviewWrite: () => { throw new Error("not a write action"); },
    stageWrite: () => { throw new Error("not a write action"); }, write: async () => "cancelled",
  };
  const store = createContentStore(memoryDocumentBackend());
  const services = createExtensionOperations({ content: extensionContentServices(store), drafts: createExtensionDraftServices(store, allCapabilities), files, formats: extensionFormatServices([vaudJson]) });
  const receipts: EffectReceipt[] = [];
  const reservations: ExtensionBudgetReservation[] = [];
  const broker = createExtensionBroker(services.all(), {
    principal: () => principal, grants: () => grants, host: "desktop", operationMetadata: [], signal: new AbortController().signal,
    confirm: async () => true, reserveBudget: async (item: ExtensionBudgetReservation, _budget: ExtensionBudget) => { reservations.push(item); return true; },
    settleBudget: async (_packageId, id, used) => reservations.some((item) => item.id === id && used <= item.bytes),
    record: async (receipt: EffectReceipt) => { receipts.push(receipt); }, readReceipts: async () => [], now: () => 1, id: () => `receipt-${receipts.length}`,
    commitContext: (current, operation, access) => ({ access, owner: "00000000-0000-4000-8000-000000000001", epoch: current.runEpoch, packageId: current.packageId, packageDigest: current.packageDigest, policyFingerprint: current.policyFingerprint, grantRevision: current.grantRevision, operation, now: () => 1 }),
  });
  const result = await broker({ v: 1, type: "request", id: 1, operation: "import.preview", args: { handleId: "picked-1", kind: "character", id: "mira" } }) as { source: { formatId: string }; draft: { id: string; status: string; requiredOperations: string[] } | null };
  expect(result.source.formatId).toBe("vaud-json");
  expect(result.draft).toMatchObject({ kind: "character", targetId: "mira", status: "draft", requiredOperations: ["content.create.preview"] });
  expect((await store.read("character", "mira"))).toBeNull();
  expect(receipts.filter((receipt) => receipt.status === "completed").map((receipt) => receipt.operation)).toEqual(["files.read", "content.create.preview", "import.preview"]);
  expect(reservations.map((item) => item.operation)).toEqual(["import.preview", "files.read", "content.create.preview"]);
  await expect(broker({ v: 1, type: "request", id: 2, operation: "import.preview", args: { handleId: "picked-1", kind: "character", id: "other" } })).rejects.toMatchObject({ code: "denied" });
});
