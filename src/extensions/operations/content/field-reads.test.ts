/** Proves capability-derived field grants return only selected authored paths through the broker. */
import { expect, test } from "bun:test";
import type { EffectReceipt, ExtensionGrantSet } from "../../contracts/grants";
import type { ExtensionBudget, ExtensionBudgetReservation } from "../../../stage/contracts/extension-store";
import { bytesToBase64 } from "../../../core/base64";
import { createContentStore } from "../../../stage/store/content-store";
import { memoryDocumentBackend } from "../../../stage/store/memory/document-backend";
import { createExtensionBroker } from "../../broker/invoke";
import { bindExtensionOperation } from "../../contracts/operation";
import { extensionContentServices } from "../../runtime/content-services";
import { contentReadOperations } from "./read";
import { contentFieldReadOperations } from "./field-reads";

test("field reads are capability-derived, exact-granted, and never include escrow", async () => {
  const store = createContentStore(memoryDocumentBackend());
  const assetBytes = new Uint8Array(300_000);
  const assetData = `data:image/png;base64,${bytesToBase64(assetBytes)}`;
  await store.create({ schemaVersion: "1", kind: "character", id: "mira", body: {
    identity: { name: "Mira", fullName: "Mira Rowan" }, persona: {}, prompts: {}, greetings: {}, examples: {}, media: { portrait: { role: "portrait", ref: assetData, mime: "image/png" } }, attribution: {}, discovery: {},
  }, original: { fixture: { raw: { secret: "escrow-only" } } } });
  const content = extensionContentServices(store);
  const selectedScope = [{ kind: "character", id: "mira" }];
  expect(await content.readSelectedFields("character", "mira", [{ kind: "character", id: "mira" }], ["body.identity.name"])).toEqual([{ path: "body.identity.name", value: "Mira" }]);
  expect(await content.readFields("character", "mira", "character.identity", selectedScope, ["name"])).toMatchObject({ identity: { name: "Mira" } });
  expect(await content.readLinks("character", "mira", selectedScope, ["links"])).toMatchObject({ id: "mira", kind: "character" });
  const principal = { storeId: "fixture", packageId: "reader.extension", packageDigest: "a".repeat(64), apiMajor: 1, policyFingerprint: "b".repeat(64), grantRevision: 1, runEpoch: 1 };
  const grant: ExtensionGrantSet = { packageId: principal.packageId, packageDigest: principal.packageDigest, policyFingerprint: principal.policyFingerprint, revision: 1,
    grants: [
      { operation: "content.fields.read", resources: [{ kind: "character", id: "mira" }], fields: ["body.identity.name", "body.media.portrait"], methods: [], destinations: [], duration: "session", budget: { requests: 5, bytes: 240_000, tokens: 0 } },
      { operation: "content.read", resources: [{ kind: "character", id: "mira" }], fields: ["body"], methods: [], destinations: [], duration: "session", budget: { requests: 5, bytes: 240_000, tokens: 0 } },
    ] };
  const operation = bindExtensionOperation(contentFieldReadOperations[0]!, { content });
  const bodyRead = bindExtensionOperation(contentReadOperations[0]!, { content });
  const receipts: EffectReceipt[] = [];
  const invoke = createExtensionBroker([operation, bodyRead], {
    principal: () => principal, grants: () => grant, activationOrigin: "command", host: "desktop", operationMetadata: [], signal: new AbortController().signal,
    confirm: async () => true, reserveBudget: async (_item: ExtensionBudgetReservation, _limits: ExtensionBudget) => true, settleBudget: async () => true,
    record: async (receipt) => { receipts.push(receipt); }, readReceipts: async () => [], now: () => 1, id: () => "fields-1",
    commitContext: (_current, operationId, access) => ({ access, owner: "00000000-0000-4000-8000-000000000001", epoch: 1, packageId: principal.packageId, packageDigest: principal.packageDigest, policyFingerprint: principal.policyFingerprint, grantRevision: 1, operation: operationId, now: () => 1 }),
  });
  const request = (fields: string[], id = "mira") => invoke({ v: 1, type: "request", id: 1, operation: "content.fields.read", args: { kind: "character", id, fields } });
  const result = await request(["body.identity.name"]).then((value) => ({ value }), (error: unknown) => ({ error: String(error) }));
  expect(result).toEqual({ value: { kind: "character", id: "mira", fields: [{ path: "body.identity.name", value: "Mira" }] } });
  const body = await invoke({ v: 1, type: "request", id: 2, operation: "content.read", args: { kind: "character", id: "mira", groups: ["body"] } });
  expect(JSON.stringify(body).length).toBeLessThan(10_000);
  expect(JSON.stringify(body)).not.toContain(bytesToBase64(assetBytes));
  const media = await request(["body.media.portrait"]);
  expect(JSON.stringify(media)).not.toContain(bytesToBase64(assetBytes));
  await expect(request(["body.identity.fullName"])).rejects.toMatchObject({ code: "denied" });
  await expect(request(["body.original"])).rejects.toMatchObject({ code: "invalid-request" });
  await expect(request(["body.identity.name"], "other")).rejects.toMatchObject({ code: "denied" });
  expect(JSON.stringify(receipts)).not.toContain("escrow-only");
});
