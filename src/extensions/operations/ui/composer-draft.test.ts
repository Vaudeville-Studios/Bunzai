/** Purpose: prove composer draft access is one exact scene scope and one typed host ticket. */
import { expect, test } from "bun:test";
import { EXTENSION_BUDGET_PRESETS, bindExtensionOperation, type ExtensionOperationContext } from "../../contracts/operation";
import type { EffectReceipt, ExtensionGrantSet } from "../../contracts/grants";
import type { ExtensionBudget } from "../../../stage/contracts/extension-store";
import type { ExtensionOperationServices } from "../_services";
import { createExtensionBroker, type BrokerAuthority } from "../../broker/invoke";
import { MAX_EXTENSION_COMPOSER_DRAFT_BYTES } from "../../contracts/limits";
import { createHostActionPort } from "../../runtime/host-action-port";
import definitions from "./composer-draft";
const definition = definitions[0]!;

const principal = { storeId: "store", packageId: "demo.draft", packageDigest: "a".repeat(64), apiMajor: 1, policyFingerprint: "b".repeat(64), grantRevision: 2, runEpoch: 3 };
const context = (resources: readonly { kind: string; id: string }[], fields: readonly string[]): ExtensionOperationContext => ({
  principal, signal: new AbortController().signal, resources, grantedOperations: [], availableGrants: [], operationReceipts: [],
  host: "desktop", availableOperations: [], access: { resources, fields, methods: [], destinations: [] }, commit: {}, confirm: async () => true,
} as unknown as ExtensionOperationContext);

test("composer draft metadata is a control operation scoped to the exact scene and field", () => {
  expect(definition.metadata.effect).toBe("control");
  expect(definition.metadata.sensitivity).toBe("private");
  expect(definition.metadata.policy).toMatchObject({ resources: ["scene"], fields: ["scene.draft"], confirmation: "none", budget: "metadata" });
  expect(definition.metadata.resolveAccess({ sceneId: "scene-1", text: "new draft" })).toEqual({ resources: [{ kind: "scene", id: "scene-1" }], fields: ["scene.draft"], methods: [], destinations: [] });
});

test("composer draft request is bounded and waits for the host's Apply or Decline answer", async () => {
  const port = createHostActionPort({ now: () => 10, id: () => "draft-action" });
  const services = { hostActions: port } as unknown as ExtensionOperationServices;
  const run = definition.execute({ sceneId: "scene-1", text: "replace this unsent draft" }, context([{ kind: "scene", id: "scene-1" }], ["scene.draft"]), services);
  expect(port.actions()[0]).toMatchObject({ action: "composer.draft.set", sceneId: "scene-1", text: "replace this unsent draft" });
  expect(port.answer("draft-action", { status: "composer-draft-result", result: "applied" })).toBe(true);
  await expect(run).resolves.toEqual({ status: "applied" });
  expect(() => definition.metadata.input.parse({ sceneId: "scene-1", text: "x".repeat(MAX_EXTENSION_COMPOSER_DRAFT_BYTES + 1) })).toThrow();
  expect(() => definition.metadata.input.parse({ sceneId: "scene-1", text: "é".repeat(MAX_EXTENSION_COMPOSER_DRAFT_BYTES / 2 + 1) })).toThrow();
});

test("composer draft never submits an unscoped target and fails closed on ambiguous host result", async () => {
  const port = createHostActionPort({ now: () => 10, id: () => "draft-action" });
  const services = { hostActions: port } as unknown as ExtensionOperationServices;
  await expect(definition.execute({ sceneId: "scene-2", text: "no" }, context([{ kind: "scene", id: "scene-1" }], ["scene.draft"]), services)).rejects.toThrow(/outside the approved/);
  const run = definition.execute({ sceneId: "scene-1", text: "maybe" }, context([{ kind: "scene", id: "scene-1" }], ["scene.draft"]), services);
  const ticket = port.actions()[0]!;
  expect(port.answer(ticket.id, { status: "ambiguous" })).toBe(true);
  await expect(run).rejects.toThrow(/could not confirm/);
});

test("broker receipts distinguish declined and stale composer requests from committed drafts", async () => {
  for (const result of ["declined", "stale"] as const) {
    const port = createHostActionPort({ now: () => 10, id: () => "draft-action" });
    const grants: ExtensionGrantSet = { packageId: principal.packageId, packageDigest: principal.packageDigest, policyFingerprint: principal.policyFingerprint, revision: principal.grantRevision,
      grants: [{ operation: "composer.draft.set", resources: [{ kind: "scene", id: "scene-1" }], fields: ["scene.draft"], methods: [], destinations: [], duration: "persistent", budget: EXTENSION_BUDGET_PRESETS.metadata }] };
    const records: EffectReceipt[] = [];
    const authority: BrokerAuthority = { principal: () => principal, grants: () => grants, host: "desktop", operationMetadata: [], signal: new AbortController().signal, activationOrigin: "command",
      confirm: async () => true, reserveBudget: async (_reservation, _limits: ExtensionBudget) => true, settleBudget: async () => true,
      record: async (receipt) => { records.push(receipt); }, readReceipts: async () => records, now: () => 10, id: () => `receipt-${records.length}`,
      commitContext: () => ({}) as never };
    const invoke = createExtensionBroker([bindExtensionOperation(definition, { hostActions: port } as unknown as ExtensionOperationServices)], authority);
    const run = invoke({ v: 1, type: "request", id: 1, operation: "composer.draft.set", args: { sceneId: "scene-1", text: "reviewed" } });
    for (let attempt = 0; attempt < 100 && port.actions().length === 0; attempt++) await new Promise((resolve) => setTimeout(resolve, 1));
    const ticket = port.actions()[0]!;
    expect(port.answer(ticket.id, { status: "composer-draft-result", result })).toBe(true);
    await expect(run).resolves.toEqual({ status: result });
    expect(records.map(({ status }) => status)).toEqual(["admitted", result === "stale" ? "conflicted" : "completed"]);
  }
});
