/** Prove media import stages a sanitized semantic draft through the real broker. */
import { expect, test } from "bun:test";
import type { EffectReceipt, ExtensionGrantSet } from "../../contracts/grants";
import type { ExtensionBudget, ExtensionBudgetReservation } from "../../../stage/contracts/extension-store";
import type { OperationPrincipal } from "../../contracts/operation";
import type { JsonValue } from "../../contracts/value";
import { bytesToBase64 } from "../../../core/base64";
import { sha256HexBytes } from "../../../core/sha256";
import { createExtensionBroker } from "../../broker/invoke";
import { createContentStore } from "../../../stage/store/content-store";
import { memoryDocumentBackend } from "../../../stage/store/memory/document-backend";
import { createExtensionAssetServices } from "../../runtime/asset-services";
import { extensionContentServices } from "../../runtime/content-services";
import { createExtensionDraftServices } from "../../runtime/draft-services";
import { createExtensionOperations } from "../../../generated/extension-operations";
import { allCapabilities } from "../../../generated/capabilities";
import { MAX_EXTENSION_ASSET_READ_BYTES } from "./operations";

const principal: OperationPrincipal = { storeId: "fixture", packageId: "fixture.assets", packageDigest: "a".repeat(64), apiMajor: 1, policyFingerprint: "b".repeat(64), grantRevision: 1, runEpoch: 1 };
const character = { schemaVersion: "1", kind: "character", id: "mira", body: { identity: { name: "Mira" }, persona: {}, prompts: {}, greetings: {}, examples: {}, media: {}, attribution: {}, discovery: {} } };

test("asset import stages reviewed portrait bytes and keeps the preview projection free of data", async () => {
  const store = createContentStore(memoryDocumentBackend({ authorizeExtensionCommit: (commit) => {
    if (commit.packageId !== principal.packageId || commit.operation !== "content.draft.apply") throw new Error("unexpected media draft commit");
  } }));
  await store.create(character);
  const sourceBytes = Uint8Array.from({ length: MAX_EXTENSION_ASSET_READ_BYTES }, (_, index) => index < 8 ? [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a][index]! : index % 251);
  const sourceCreated = await store.create({ ...character, id: "source", body: { ...character.body, media: { portrait: { role: "portrait", ref: `data:image/png;base64,${bytesToBase64(sourceBytes)}` } } } });
  expect(sourceCreated.status).toBe("saved");
  const operations = createExtensionOperations({ content: extensionContentServices(store), drafts: createExtensionDraftServices(store, allCapabilities), assets: createExtensionAssetServices(store) });
  const grants: ExtensionGrantSet = {
    packageId: principal.packageId, packageDigest: principal.packageDigest, policyFingerprint: principal.policyFingerprint, revision: 1,
    grants: [
      { operation: "assets.import.preview", resources: [{ kind: "character", id: "mira" }], fields: ["media", "draft"], methods: [], destinations: [], duration: "session", budget: { requests: 4, bytes: 500_000, tokens: 0 } },
      { operation: "assets.import.apply", resources: [{ kind: "character", id: "mira" }], fields: ["draft"], methods: [], destinations: [], duration: "session", budget: { requests: 4, bytes: 500_000, tokens: 0 } },
      { operation: "assets.attach.preview", resources: [{ kind: "character", id: "source" }, { kind: "character", id: "mira" }], fields: ["media", "draft"], methods: [], destinations: [], duration: "session", budget: { requests: 4, bytes: 500_000, tokens: 0 } },
      { operation: "assets.attach.apply", resources: [{ kind: "character", id: "mira" }], fields: ["draft"], methods: [], destinations: [], duration: "session", budget: { requests: 4, bytes: 500_000, tokens: 0 } },
      { operation: "assets.list", resources: [{ kind: "character", id: "source" }], fields: ["media"], methods: [], destinations: [], duration: "session", budget: { requests: 4, bytes: 500_000, tokens: 0 } },
      { operation: "content.draft.character.media.update", resources: [{ kind: "character", id: "mira" }], fields: ["body.media.portrait"], methods: [], destinations: [], duration: "session", budget: { requests: 4, bytes: 500_000, tokens: 0 } },
      { operation: "content.draft.apply", resources: [{ kind: "character", id: "mira" }], fields: ["draft"], methods: [], destinations: [], duration: "session", budget: { requests: 4, bytes: 500_000, tokens: 0 } },
    ],
  };
  const receipts: EffectReceipt[] = [];
  const reservations: ExtensionBudgetReservation[] = [];
  const invoke = createExtensionBroker(operations.all(), {
    principal: () => principal, grants: () => grants, host: "desktop", operationMetadata: JSON.parse(JSON.stringify(operations.metadata())) as JsonValue[], signal: new AbortController().signal,
    confirm: async () => true,
    reserveBudget: async (reservation: ExtensionBudgetReservation, _budget: ExtensionBudget) => { reservations.push(reservation); return true; },
    settleBudget: async (_packageId, id, used) => reservations.some((item) => item.id === id && used <= item.bytes),
    record: async (receipt) => { receipts.push(receipt); }, readReceipts: async () => receipts,
    now: () => 1, id: () => `receipt-${receipts.length}`,
    commitContext: (current, operation, access) => ({ access, owner: "00000000-0000-4000-8000-000000000001", epoch: current.runEpoch, packageId: current.packageId, packageDigest: current.packageDigest, policyFingerprint: current.policyFingerprint, grantRevision: current.grantRevision, operation, now: () => 1 }),
  });
  const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const result = await invoke({ v: 1, type: "request", id: 1, operation: "assets.import.preview", args: { id: "mira", base64: bytesToBase64(png) } }) as { asset: { mime: string; bytes: number }; draft: { id: string; fingerprint: string; changes: { path: string; after: unknown }[] } };
  expect(result.asset).toMatchObject({ mime: "image/png", bytes: png.byteLength });
  expect(result.draft.changes).toMatchObject([{ path: "body.media.portrait", after: { role: "portrait", mime: "image/png", bytes: png.byteLength } }]);
  expect(JSON.stringify(result)).not.toContain("base64");
  expect(JSON.stringify(result)).not.toContain(bytesToBase64(png));
  expect(await invoke({ v: 1, type: "request", id: 4, operation: "assets.import.apply", args: { id: "mira", draftId: result.draft.id, fingerprint: result.draft.fingerprint } })).toMatchObject({ status: "applied" });
  expect((await store.read("character", "mira"))?.entity.kind).toBe("character");
  const sourceAssets = await invoke({ v: 1, type: "request", id: 5, operation: "assets.list", args: { kind: "character", id: "source" } }) as { assets: { sha: string }[] };
  expect(sourceAssets.assets.map(({ sha }) => sha)).toContain(sha256HexBytes(sourceBytes));
  const attached = await invoke({ v: 1, type: "request", id: 6, operation: "assets.attach.preview", args: { sourceKind: "character", sourceId: "source", sha: sha256HexBytes(sourceBytes), id: "mira" } }) as { asset: { sha: string }; draft: { id: string; fingerprint: string } };
  expect(sourceAssets.assets.map(({ sha }) => sha)).toContain(attached.asset.sha);
  expect(JSON.stringify(attached)).not.toContain(bytesToBase64(sourceBytes));
  expect(await invoke({ v: 1, type: "request", id: 7, operation: "assets.attach.apply", args: { id: "mira", draftId: attached.draft.id, fingerprint: attached.draft.fingerprint } })).toMatchObject({ status: "applied" });
  await expect(invoke({ v: 1, type: "request", id: 2, operation: "assets.import.preview", args: { id: "mira", base64: "<svg/>" } })).rejects.toBeDefined();
  await expect(invoke({ v: 1, type: "request", id: 3, operation: "assets.import.preview", args: { id: "other", base64: bytesToBase64(png) } })).rejects.toBeDefined();
  expect(MAX_EXTENSION_ASSET_READ_BYTES).toBeLessThanOrEqual(256_000);
});
