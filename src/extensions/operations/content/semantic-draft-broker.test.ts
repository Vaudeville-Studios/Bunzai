/** Runs semantic draft preview and commit through the broker against an isolated ContentStore. */
import { expect, test } from "bun:test";
import type { ExtensionGrantSet, EffectReceipt } from "../../contracts/grants";
import type { ExtensionBudget, ExtensionBudgetReservation } from "../../../stage/contracts/extension-store";
import type { OperationPrincipal } from "../../contracts/operation";
import { createContentStore } from "../../../stage/store/content-store";
import { memoryDocumentBackend } from "../../../stage/store/memory/document-backend";
import { createExtensionBroker } from "../../broker/invoke";
import { createExtensionOperations } from "../../../generated/extension-operations";
import { allCapabilities } from "../../../generated/capabilities";
import { extensionContentServices } from "../../runtime/content-services";
import { createExtensionDraftServices } from "../../runtime/draft-services";
import type { JsonValue } from "../../contracts/value";
import { projectContentStoreChange } from "../../contracts/events";

const entity = { schemaVersion: "1", kind: "character", id: "mira", body: { identity: { name: "Mira", tagline: "Keeper" }, persona: { personality: "Patient", scenario: "At the archive" }, prompts: { systemPrompt: "Stay in character." }, greetings: { firstMessage: "Welcome.", alternateGreetings: [{ text: "Back again?", title: "Return" }] }, examples: { exampleMessages: "Mira: Hush." }, media: {}, attribution: { creator: "Chi" }, discovery: { tags: ["archivist"] } }, original: { sillytavern: { raw: { untouched: true }, unmapped: { foreign: { value: 7 } } } } };

test("identity draft is scoped, reviewed, and applied once with a commit-context CAS", async () => {
  const store = createContentStore(memoryDocumentBackend({ authorizeExtensionCommit: (context) => {
    if (context.packageId !== "fixture.extension" || context.operation !== "content.draft.apply") throw new Error("unexpected extension fixture commit");
  } }));
  await store.create(entity);
  await store.create({ schemaVersion: "1", kind: "scriptsheet", id: "sheet", body: { name: "Sheet", content: "Old instruction" } });
  await store.create({ schemaVersion: "1", kind: "tool", id: "tool", body: { name: "Check", description: "Record", fields: [], action: { kind: "record" } }, original: { rolecall: { raw: { keep: true } } } });
  const contentEvents: JsonValue[] = [];
  store.subscribeChanges((change) => { contentEvents.push(projectContentStoreChange(change)); });
  const services = createExtensionOperations({ content: extensionContentServices(store), drafts: createExtensionDraftServices(store, allCapabilities) });
  const principal: OperationPrincipal = { storeId: "fixture", packageId: "fixture.extension", packageDigest: "a".repeat(64), apiMajor: 1, policyFingerprint: "b".repeat(64), grantRevision: 1, runEpoch: 1 };
  const previewGrant = { operation: "content.draft.character.identity.update", resources: [{ kind: "character", id: "mira" }], fields: ["body.identity.name"], methods: [], destinations: [], duration: "session" as const, budget: { requests: 10, bytes: 300_000, tokens: 0 } };
  const variantGrant = { operation: "content.draft.character.variants.manage", resources: [{ kind: "character", id: "mira" }], fields: ["body.variants"], methods: [], destinations: [], duration: "session" as const, budget: { requests: 10, bytes: 300_000, tokens: 0 } };
  const scriptGrant = { operation: "content.draft.scriptsheet.instruction.update", resources: [{ kind: "scriptsheet", id: "sheet" }], fields: ["body.content"], methods: [], destinations: [], duration: "session" as const, budget: { requests: 10, bytes: 300_000, tokens: 0 } };
  const promptGrant = { operation: "content.draft.character.prompts.update", resources: [{ kind: "character", id: "mira" }], fields: ["body.prompts.systemPrompt"], methods: [], destinations: [], duration: "session" as const, budget: { requests: 10, bytes: 300_000, tokens: 0 } };
  const toolGrant = { operation: "content.draft.tool.definition.update", resources: [{ kind: "tool", id: "tool" }], fields: ["body"], methods: [], destinations: [], duration: "session" as const, budget: { requests: 10, bytes: 300_000, tokens: 0 } };
  const createGrant = { operation: "content.create.preview", resources: [{ kind: "character", id: "new-mira" }], fields: ["draft"], methods: [], destinations: [], duration: "session" as const, budget: { requests: 10, bytes: 300_000, tokens: 0 } };
  const applyGrant = { operation: "content.draft.apply", resources: [{ kind: "character", id: "mira" }, { kind: "character", id: "new-mira" }, { kind: "scriptsheet", id: "sheet" }, { kind: "tool", id: "tool" }], fields: ["draft"], methods: [], destinations: [], duration: "session" as const, budget: { requests: 10, bytes: 300_000, tokens: 0 } };
  const grants: ExtensionGrantSet = { packageId: principal.packageId, packageDigest: principal.packageDigest, policyFingerprint: principal.policyFingerprint, revision: 1, grants: [previewGrant, promptGrant, variantGrant, scriptGrant, toolGrant, createGrant, applyGrant] };
  const receipts: EffectReceipt[] = [];
  const reservations: ExtensionBudgetReservation[] = [];
  let next = 0;
  const invoke = createExtensionBroker(services.all(), {
    principal: () => principal, grants: () => grants, host: "desktop", operationMetadata: JSON.parse(JSON.stringify(services.metadata())) as JsonValue[], signal: new AbortController().signal,
    confirm: async () => true, reserveBudget: async (reservation: ExtensionBudgetReservation, _budget: ExtensionBudget) => { reservations.push(reservation); return true; },
    settleBudget: async (_packageId, id, bytes) => reservations.some((item) => item.id === id && bytes <= item.bytes),
    record: async (receipt) => { receipts.push(receipt); }, readReceipts: async () => [], now: () => 1, id: () => `receipt-${++next}`,
    commitContext: (current, operation, access) => ({ access, owner: "00000000-0000-4000-8000-000000000001", epoch: current.runEpoch, packageId: current.packageId, packageDigest: current.packageDigest, policyFingerprint: current.policyFingerprint, grantRevision: current.grantRevision, operation, now: () => 1 }),
  });
  const preview = await invoke({ v: 1, type: "request", id: 1, operation: "content.draft.character.identity.update", args: { target: { id: "mira" }, patch: { name: "Mira Vale" } } }) as { draft: { id: string; fingerprint: string } };
  const nextRunPrincipal = { ...principal, runEpoch: 2 };
  const review: unknown[] = [];
  const applyBroker = createExtensionBroker(services.all(), {
    principal: () => nextRunPrincipal, grants: () => grants, host: "desktop", operationMetadata: JSON.parse(JSON.stringify(services.metadata())) as JsonValue[], signal: new AbortController().signal,
    confirm: async (effect) => { review.push(effect); return true; }, reserveBudget: async (reservation: ExtensionBudgetReservation, _budget: ExtensionBudget) => { reservations.push(reservation); return true; },
    settleBudget: async (_packageId, id, bytes) => reservations.some((item) => item.id === id && bytes <= item.bytes),
    record: async (receipt) => { receipts.push(receipt); }, readReceipts: async () => [], now: () => 1, id: () => `receipt-${++next}`,
    commitContext: (current, operation, access) => ({ access, owner: "00000000-0000-4000-8000-000000000001", epoch: current.runEpoch, packageId: current.packageId, packageDigest: current.packageDigest, policyFingerprint: current.policyFingerprint, grantRevision: current.grantRevision, operation, now: () => 1 }),
  });
  const applied = await applyBroker({ v: 1, type: "request", id: 2, operation: "content.draft.apply", args: { kind: "character", id: "mira", draftId: preview.draft.id, fingerprint: preview.draft.fingerprint } }).then((value) => ({ value }), (error: unknown) => ({ error }));
  expect(applied).toMatchObject({ value: { status: "applied" } });
  expect(JSON.stringify(review)).toContain("Mira Vale");
  expect((await store.read("character", "mira"))?.entity.kind).toBe("character");
  const saved = await store.read("character", "mira");
  expect(saved?.entity.kind === "character" ? saved.entity.body.identity.name : null).toBe("Mira Vale");
  expect(saved?.entity.original).toEqual(entity.original);
  expect(receipts.filter(({ operation, status }) => operation === "content.draft.apply" && status === "committed")).toHaveLength(1);
  expect(contentEvents[0]).toMatchObject({ type: "content.changed", kind: "character", id: "mira", revision: saved?.revision, invalidations: ["body"] });
  expect(JSON.stringify(contentEvents)).not.toContain("Mira Vale");

  const instructionDraft = await invoke({ v: 1, type: "request", id: 5, operation: "content.draft.scriptsheet.instruction.update", args: { target: { id: "sheet" }, content: "Write with measured care." } }) as { draft: { id: string; fingerprint: string; changes: { path: string; before: JsonValue; after: JsonValue }[] } };
  expect(instructionDraft.draft.changes).toEqual([{ path: "body.content", before: "Old instruction", after: "Write with measured care." }]);
  const instructionApply = await applyBroker({ v: 1, type: "request", id: 6, operation: "content.draft.apply", args: { kind: "scriptsheet", id: "sheet", draftId: instructionDraft.draft.id, fingerprint: instructionDraft.draft.fingerprint } });
  expect(instructionApply).toMatchObject({ status: "applied" });
  const savedSheet = await store.read("scriptsheet", "sheet");
  expect(savedSheet?.entity.kind === "scriptsheet" ? savedSheet.entity.body.content : null).toBe("Write with measured care.");

  const toolDraft = await invoke({ v: 1, type: "request", id: 9, operation: "content.draft.tool.definition.update", args: { target: { id: "tool" }, body: { name: "Check", description: "Read one value", fields: [{ name: "value", description: "Value to record", type: "text", required: true }], action: { kind: "record" } } } }) as { draft: { id: string; fingerprint: string; changes: { path: string; before: JsonValue; after: JsonValue }[] } };
  expect(toolDraft.draft.changes).toMatchObject([{ path: "body", after: { name: "Check", description: "Read one value" } }]);
  expect(await applyBroker({ v: 1, type: "request", id: 10, operation: "content.draft.apply", args: { kind: "tool", id: "tool", draftId: toolDraft.draft.id, fingerprint: toolDraft.draft.fingerprint } })).toMatchObject({ status: "applied" });
  const savedTool = await store.read("tool", "tool");
  expect(savedTool?.entity.kind === "tool" ? savedTool.entity.original : null).toEqual({ rolecall: { raw: { keep: true } } });

  const variantDraft = await invoke({ v: 1, type: "request", id: 7, operation: "content.draft.character.variants.manage", args: { target: { id: "mira" }, operation: { type: "add", id: "alternate", label: "Alternate" } } }) as { draft: { id: string; fingerprint: string; changes: { path: string; after: JsonValue }[] } };
  expect(variantDraft.draft.changes).toMatchObject([{ path: "body.variants[id=alternate]", before: null, after: { id: "alternate", label: "Alternate", overrides: {} } }]);
  expect(await applyBroker({ v: 1, type: "request", id: 8, operation: "content.draft.apply", args: { kind: "character", id: "mira", draftId: variantDraft.draft.id, fingerprint: variantDraft.draft.fingerprint } })).toMatchObject({ status: "applied" });

  const created = await invoke({ v: 1, type: "request", id: 3, operation: "content.create.preview", args: { ...entity, id: "new-mira", body: { ...entity.body, identity: { name: "New Mira" } } } }) as { draft: { id: string; fingerprint: string } };
  const createReview: unknown[] = [];
  const createBroker = createExtensionBroker(services.all(), {
    principal: () => principal, grants: () => grants, host: "desktop", operationMetadata: JSON.parse(JSON.stringify(services.metadata())) as JsonValue[], signal: new AbortController().signal,
    confirm: async (effect) => { createReview.push(effect); return true; }, reserveBudget: async () => true,
    settleBudget: async () => true, record: async () => {}, readReceipts: async () => [], now: () => 1, id: () => "create-receipt",
    commitContext: (current, operation, access) => ({ access, owner: "00000000-0000-4000-8000-000000000001", epoch: current.runEpoch, packageId: current.packageId, packageDigest: current.packageDigest, policyFingerprint: current.policyFingerprint, grantRevision: current.grantRevision, operation, now: () => 1 }),
  });
  await createBroker({ v: 1, type: "request", id: 4, operation: "content.draft.apply", args: { kind: "character", id: "new-mira", draftId: created.draft.id, fingerprint: created.draft.fingerprint } });
  expect(JSON.stringify(createReview)).toContain('"createdBody"');
  expect(JSON.stringify(createReview)).toContain("New Mira");
  expect(JSON.stringify(createReview)).not.toContain("untouched");

  await invoke({ v: 1, type: "request", id: 14, operation: "content.draft.character.identity.update", args: { target: { id: "mira" }, patch: { name: "Composed Mira" } } });
  const composed = await invoke({ v: 1, type: "request", id: 15, operation: "content.draft.character.prompts.update", args: { target: { id: "mira" }, patch: { systemPrompt: "Composed prompt" } } }) as { draft: { id: string; fingerprint: string; changes: { path: string }[] } };
  expect(composed.draft.changes.map(({ path }) => path)).toEqual(["body.identity.name", "body.prompts.systemPrompt"]);
  await applyBroker({ v: 1, type: "request", id: 16, operation: "content.draft.apply", args: { kind: "character", id: "mira", draftId: composed.draft.id, fingerprint: composed.draft.fingerprint } });
  expect(JSON.stringify(review.at(-1))).toContain("Composed Mira");
  expect(JSON.stringify(review.at(-1))).toContain("Composed prompt");

  const firstVersion = await invoke({ v: 1, type: "request", id: 11, operation: "content.draft.character.identity.update", args: { target: { id: "mira" }, patch: { name: "Reviewed Name" } } }) as { draft: { id: string; fingerprint: string } };
  let reviewed!: () => void;
  let approve!: (value: boolean) => void;
  const reviewReady = new Promise<void>((resolve) => { reviewed = resolve; });
  const approved = new Promise<boolean>((resolve) => { approve = resolve; });
  const raceBroker = createExtensionBroker(services.all(), {
    principal: () => nextRunPrincipal, grants: () => grants, host: "desktop", operationMetadata: [], signal: new AbortController().signal,
    confirm: async () => { reviewed(); return approved; }, reserveBudget: async () => true, settleBudget: async () => true,
    record: async (receipt) => { receipts.push(receipt); }, readReceipts: async () => [], now: () => 1, id: () => `race-${receipts.length}`,
    commitContext: (current, operation, access) => ({ access, owner: "00000000-0000-4000-8000-000000000001", epoch: current.runEpoch, packageId: current.packageId, packageDigest: current.packageDigest, policyFingerprint: current.policyFingerprint, grantRevision: current.grantRevision, operation, now: () => 1 }),
  });
  const pending = raceBroker({ v: 1, type: "request", id: 12, operation: "content.draft.apply", args: { kind: "character", id: "mira", draftId: firstVersion.draft.id, fingerprint: firstVersion.draft.fingerprint } }).then((value) => ({ value }), (error: unknown) => ({ error }));
  await reviewReady;
  const amended = await invoke({ v: 1, type: "request", id: 13, operation: "content.draft.character.identity.update", args: { target: { id: "mira" }, patch: { name: "Amended after review" } } }) as { draft: { fingerprint: string } };
  expect(amended.draft.fingerprint).not.toBe(firstVersion.draft.fingerprint);
  approve(true);
  expect(await pending).toHaveProperty("error");
  const unchanged = await store.read("character", "mira");
  expect(unchanged?.entity.kind === "character" ? unchanged.entity.body.identity.name : null).toBe("Composed Mira");
});
