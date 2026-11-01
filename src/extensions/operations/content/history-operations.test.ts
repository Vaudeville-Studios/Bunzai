/** Prove all-kind history reads require history plus source-reviewed fields and stay held. */
import { expect, test } from "bun:test";
import type { EffectReceipt, ExtensionGrantSet } from "../../contracts/grants";
import type { ExtensionBudget, ExtensionBudgetReservation } from "../../../stage/contracts/extension-store";
import type { OperationPrincipal } from "../../contracts/operation";
import type { JsonValue } from "../../contracts/value";
import { bytesToBase64 } from "../../../core/base64";
import { createContentStore } from "../../../stage/store/content-store";
import { memoryDocumentBackend } from "../../../stage/store/memory/document-backend";
import { createExtensionBroker } from "../../broker/invoke";
import { createExtensionOperations } from "../../../generated/extension-operations";
import { extensionContentServices } from "../../runtime/content-services";

const principal: OperationPrincipal = { storeId: "fixture", packageId: "fixture.history", packageDigest: "a".repeat(64), apiMajor: 1, policyFingerprint: "b".repeat(64), grantRevision: 1, runEpoch: 1 };
const character = (name: string, media: string) => ({ schemaVersion: "1", kind: "character", id: "mira", body: { identity: { name }, persona: {}, prompts: {}, greetings: {}, examples: {}, media: { portrait: { role: "portrait", ref: media } }, attribution: {}, discovery: {} } });

test("history reads held versions across kinds using separate history and exact field grants", async () => {
  const store = createContentStore(memoryDocumentBackend());
  const bytes = Uint8Array.from({ length: 180_000 }, (_, index) => index % 251);
  const dataUri = `data:image/png;base64,${bytesToBase64(bytes)}`;
  await store.create(character("Mira", dataUri));
  await store.create({ schemaVersion: "1", kind: "scriptsheet", id: "sheet", body: { name: "Sheet", content: "Old instruction" } });
  const current = await store.read("character", "mira");
  const currentSheet = await store.read("scriptsheet", "sheet");
  if (!current || current.entity.kind !== "character") throw new Error("fixture character was not saved");
  if (!currentSheet || currentSheet.entity.kind !== "scriptsheet") throw new Error("fixture script sheet was not saved");
  await store.saveIfUnchanged({ ...current.entity, body: { ...current.entity.body, identity: { ...current.entity.body.identity, name: "Mira Vale" } } }, current.revision);
  await store.saveIfUnchanged({ ...currentSheet.entity, body: { ...currentSheet.entity.body, content: "New instruction" } }, currentSheet.revision);
  const versions = await store.versions("character", "mira");
  expect(versions.versions.length).toBe(2);
  const held = await store.readVersionHeld("character", "mira", 1);
  expect(JSON.stringify(held?.kind === "character" ? held.body.media : null)).not.toContain(bytesToBase64(bytes));

  const operations = createExtensionOperations({ content: extensionContentServices(store) });
  const resources = [{ kind: "character", id: "mira" }, { kind: "scriptsheet", id: "sheet" }];
  const readGrant = { operation: "content.history.read", resources, fields: ["history", "body.identity.name", "body.content"], methods: [], destinations: [], duration: "session" as const, budget: { requests: 4, bytes: 500_000, tokens: 0 } };
  const listGrant = { operation: "content.history.list", resources, fields: ["history"], methods: [], destinations: [], duration: "session" as const, budget: { requests: 4, bytes: 100_000, tokens: 0 } };
  const grants: ExtensionGrantSet = { packageId: principal.packageId, packageDigest: principal.packageDigest, policyFingerprint: principal.policyFingerprint, revision: 1, grants: [readGrant, listGrant] };
  const receipts: EffectReceipt[] = [];
  const reservations: ExtensionBudgetReservation[] = [];
  const invoke = createExtensionBroker(operations.all(), {
    principal: () => principal, grants: () => grants, activationOrigin: "command", host: "desktop", operationMetadata: JSON.parse(JSON.stringify(operations.metadata())) as JsonValue[], signal: new AbortController().signal,
    confirm: async () => true, reserveBudget: async (reservation: ExtensionBudgetReservation, _budget: ExtensionBudget) => { reservations.push(reservation); return true; },
    settleBudget: async (_packageId, id, used) => reservations.some((item) => item.id === id && used <= item.bytes),
    record: async (receipt) => { receipts.push(receipt); }, readReceipts: async () => receipts, now: () => 1, id: () => `receipt-${receipts.length}`,
    commitContext: (currentPrincipal, operation, access) => ({ access, owner: "00000000-0000-4000-8000-000000000001", epoch: currentPrincipal.runEpoch, packageId: currentPrincipal.packageId, packageDigest: currentPrincipal.packageDigest, policyFingerprint: currentPrincipal.policyFingerprint, grantRevision: currentPrincipal.grantRevision, operation, now: () => 1 }),
  });
  const page = await invoke({ v: 1, type: "request", id: 1, operation: "content.history.list", args: { kind: "character", id: "mira" } }) as { versions: { version: number }[] };
  expect(page.versions.map(({ version }) => version)).toEqual([1, 2]);
  const result = await invoke({ v: 1, type: "request", id: 2, operation: "content.history.read", args: { kind: "character", id: "mira", version: 1, fields: ["body.identity.name"] } }) as { fields: { path: string; value: unknown }[] };
  expect(result.fields).toEqual([{ path: "body.identity.name", value: "Mira" }]);
  expect(JSON.stringify(result)).not.toContain("base64");
  const sheetResult = await invoke({ v: 1, type: "request", id: 3, operation: "content.history.read", args: { kind: "scriptsheet", id: "sheet", version: 1, fields: ["body.content"] } }) as { fields: { path: string; value: unknown }[] };
  expect(sheetResult.fields).toEqual([{ path: "body.content", value: "Old instruction" }]);
  grants.grants = [readGrant, listGrant].map((grant) => grant.operation === "content.history.read" ? { ...grant, fields: ["body.identity.name", "body.content"] } : grant);
  await expect(invoke({ v: 1, type: "request", id: 4, operation: "content.history.read", args: { kind: "character", id: "mira", version: 1, fields: ["body.identity.name"] } })).rejects.toMatchObject({ code: "denied" });
});
