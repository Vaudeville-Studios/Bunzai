/** ADR-015 broker and bounded read-only preview regressions. */
import { expect, test } from "bun:test";
import type { EffectReceipt, ExtensionGrantSet } from "../../contracts/grants";
import type { ExtensionBudget, ExtensionBudgetReservation } from "../../../stage/contracts/extension-store";
import type { ExtensionOperationContext, OperationPrincipal } from "../../contracts/operation";
import type { JsonValue } from "../../contracts/value";
import { createExtensionBroker } from "../../broker/invoke";
import { bindExtensionOperation } from "../../contracts/operation";
import { createOperationCatalog } from "../../catalog/operations";
import { macrosPreviewOperation } from "./macros-preview";

const context = (activationOrigin?: ExtensionOperationContext["activationOrigin"]): ExtensionOperationContext => {
  const principal: OperationPrincipal = { storeId: "fixture", packageId: "fixture.preview", packageDigest: "a".repeat(64), apiMajor: 1, policyFingerprint: "b".repeat(64), grantRevision: 1, runEpoch: 1 };
  return {
    principal, activationOrigin, signal: new AbortController().signal, invocation: { resources: [] }, resources: [], grantedOperations: ["macros.preview"], availableGrants: [], operationReceipts: [],
    host: "desktop", availableOperations: [], access: { resources: [], fields: [], methods: [], destinations: [] },
    commit: { owner: "00000000-0000-4000-8000-000000000001", epoch: 1, packageId: principal.packageId, packageDigest: principal.packageDigest, policyFingerprint: principal.policyFingerprint, grantRevision: principal.grantRevision, operation: "macros.preview", access: { resources: [], fields: [], methods: [], destinations: [] }, now: () => 1 },
    confirm: async () => true, assertCurrent: async () => {},
  };
};
const args = { sample: "{{char}} / {{user}} {{setvar::private::changed}}", environment: { characterName: "Ada", userName: "Sam", localVariables: { private: "original" }, now: 0, randomSeed: 7 } };

test("preview runs deterministically on an explicit command and returns sanitized output", async () => {
  const first = await macrosPreviewOperation.execute(args, context("command"), undefined);
  const second = await macrosPreviewOperation.execute(args, context("command"), undefined);
  expect(first).toEqual(second);
  expect(first.text).toBe("Ada / Sam ");
  expect(first.diagnostics).toMatchObject({ errors: 0, sideEffects: 0, cacheable: true });
  expect(args.environment.localVariables.private).toBe("original");
  const review = await macrosPreviewOperation.review!(args, context("command"), undefined);
  expect(review).toEqual({ sample: args.sample, environment: args.environment });
});

test("preview denies every non-command activation and missing origin", async () => {
  for (const origin of [undefined, "event", "prompt", "background", "host"] as const) {
    await expect(macrosPreviewOperation.execute(args, context(origin), undefined)).rejects.toThrow("explicitly invoked command");
    await expect(macrosPreviewOperation.review!(args, context(origin), undefined)).rejects.toThrow("explicitly invoked command");
  }
});

test("proposal input and rendered output remain bounded and strict", async () => {
  expect(() => macrosPreviewOperation.metadata.input.parse({ ...args, unreviewed: true })).toThrow();
  expect(() => macrosPreviewOperation.metadata.input.parse({ sample: "x".repeat(8_001), environment: {} })).toThrow();
  await expect(macrosPreviewOperation.execute({ sample: "{{char}}".repeat(5_000), environment: { characterName: "A".repeat(120) } }, context("command"), undefined)).rejects.toThrow();
});

test("preview forces author regex off even for a benign pattern", async () => {
  const value = await macrosPreviewOperation.execute({ sample: "{{regex::abc::b::X}}", environment: {} }, context("command"), undefined);
  expect(value.diagnostics.errors).toBe(1);
  expect(value.text).toContain("{{regex::abc::b::X}}");
});

test("preview metadata passes the same catalog policy and closed-schema validation as executable operations", () => {
  const descriptor = bindExtensionOperation(macrosPreviewOperation, undefined);
  expect(createOperationCatalog([descriptor]).get("macros.preview")?.policy.confirmation).toBe("effect");
});

test("broker confirmation precedes the sole evaluator call and activation origin is trusted", async () => {
  const principal: OperationPrincipal = { storeId: "fixture", packageId: "fixture.preview", packageDigest: "a".repeat(64), apiMajor: 1, policyFingerprint: "b".repeat(64), grantRevision: 1, runEpoch: 1 };
  const grant = { operation: "macros.preview", resources: [], fields: [], methods: [], destinations: [], duration: "session" as const, budget: { requests: 5, bytes: 1_000_000, tokens: 0 } };
  const grants: ExtensionGrantSet = { packageId: principal.packageId, packageDigest: principal.packageDigest, policyFingerprint: principal.policyFingerprint, revision: principal.grantRevision, grants: [grant] };
  const records: EffectReceipt[] = [];
  let evaluatorCalls = 0;
  let accepted = false;
  let confirmationCalls = 0;
  let sequence = 0;
  const operation = bindExtensionOperation({
    ...macrosPreviewOperation,
    execute: async (value, ctx, injected) => { evaluatorCalls++; return macrosPreviewOperation.execute(value, ctx, injected); },
  }, undefined);
  const invoke = (origin: ExtensionOperationContext["activationOrigin"]) => createExtensionBroker([operation], {
    principal: () => principal, activationOrigin: origin, grants: () => grants, host: "desktop", operationMetadata: [], signal: new AbortController().signal,
    confirm: async (_effect: JsonValue) => { confirmationCalls++; return accepted; }, reserveBudget: async (_item: ExtensionBudgetReservation, _limits: ExtensionBudget) => true,
    settleBudget: async () => true, record: async (receipt) => { records.push(receipt); }, readReceipts: async () => [], now: () => 1, id: () => `preview-${++sequence}`,
    commitContext: (current, operationId, access) => ({ access, owner: "00000000-0000-4000-8000-000000000001", epoch: current.runEpoch, packageId: current.packageId, packageDigest: current.packageDigest, policyFingerprint: current.policyFingerprint, grantRevision: current.grantRevision, operation: operationId, now: () => 1 }),
  })({ v: 1, type: "request", id: 1, operation: "macros.preview", args });

  await expect(invoke("event")).rejects.toThrow("explicitly invoked command");
  expect(evaluatorCalls).toBe(0);
  expect(confirmationCalls).toBe(0);
  await expect(invoke("command")).rejects.toMatchObject({ code: "denied" });
  expect(evaluatorCalls).toBe(0);
  accepted = true;
  await expect(invoke("command")).resolves.toMatchObject({ text: "Ada / Sam ", diagnostics: { sideEffects: 0 } });
  expect(evaluatorCalls).toBe(1);
  expect(records.filter(({ status }) => status === "completed")).toHaveLength(1);
});
