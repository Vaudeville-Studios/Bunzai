/** Public broker regressions for grant checks, confirmations and stale authority. */
import { describe, expect, test } from "bun:test";
import { z } from "zod";
import type { EffectReceipt, ExtensionGrantSet } from "../contracts/grants";
import type { ExtensionBudget, ExtensionBudgetReservation } from "../../stage/contracts/extension-store";
import type { ExtensionOperationDescriptor, OperationPrincipal, ResolvedOperationAccess } from "../contracts/operation";
import { PROMPT_SAFE_READ_ORIGINS } from "../contracts/operation";
import type { JsonValue } from "../contracts/value";
import { createExtensionBroker } from "./invoke";
import { ExtensionServiceError } from "../runtime/service-errors";

const principal: OperationPrincipal = { storeId: "fixture", packageId: "example.test", packageDigest: "a".repeat(64), apiMajor: 1, policyFingerprint: "b".repeat(64), grantRevision: 2, runEpoch: 1 };
const grants: ExtensionGrantSet = { packageId: principal.packageId, packageDigest: principal.packageDigest, policyFingerprint: principal.policyFingerprint, revision: principal.grantRevision, grants: [{ operation: "content.read", resources: [{ kind: "character", id: "char-1" }], fields: ["identity"], methods: [], destinations: [], duration: "persistent", budget: { requests: 10, bytes: 1000, tokens: 0 } }] };
const operation: ExtensionOperationDescriptor<{ id: string }, { name: string }> = {
  id: "content.read", version: 1, inputVersion: 1, outputVersion: 1, projectionVersion: 1, title: "Read content", description: "Read one approved character.",
  input: z.object({ id: z.string() }).strict(), output: z.object({ name: z.string() }).strict(),
  effect: "read", sensitivity: "private", hosts: ["desktop"],
  policy: { resources: ["character"], fields: ["identity"], methods: [], destinationMode: "none", destinations: [], budget: "read-small", confirmation: "none" },
  estimateBudget: () => ({ bytes: 100, tokens: 0 }), measureTokens: () => 0,
  resolveAccess: ({ id }) => ({ resources: [{ kind: "character", id }], fields: ["identity"], methods: [], destinations: [] }), project: ({ name }) => ({ name }),
  execute: async ({ id }) => ({ name: id }),
};

function authority(overrides: Partial<{ current: OperationPrincipal; confirm: (effect: JsonValue) => Promise<boolean>; records: EffectReceipt[]; grants: ExtensionGrantSet; signal: AbortSignal; budgetAllowed: boolean; selectedScope: readonly { kind: string; id: string }[]; activationOrigin: "command" | "event" | "prompt" | "background" | "host"; readReceipts: (packageId: string, limit: number) => Promise<readonly EffectReceipt[]> }> = {}) {
  const records = overrides.records ?? [];
  const reservations: ExtensionBudgetReservation[] = [];
  return { records, reservations, principal: () => overrides.current ?? principal, grants: () => overrides.grants ?? grants, selectedScope: () => overrides.selectedScope ?? [], activationOrigin: overrides.activationOrigin, host: "desktop" as const, operationMetadata: [], signal: overrides.signal ?? new AbortController().signal,
    confirm: overrides.confirm ?? (async () => true), reserveBudget: async (reservation: ExtensionBudgetReservation, _limits: ExtensionBudget) => { reservations.push(reservation); return overrides.budgetAllowed ?? true; },
    settleBudget: async (_packageId: string, id: string, bytes: number) => reservations.some((reservation) => reservation.id === id && bytes <= reservation.bytes),
    record: async (receipt: EffectReceipt) => { records.push(receipt); }, readReceipts: overrides.readReceipts ?? (async () => [...records]), now: () => 123, id: () => `receipt-${records.length}`,
    commitContext: (current: OperationPrincipal, operation: string, access: ResolvedOperationAccess, invocationId: string) => ({ owner: "00000000-0000-4000-8000-000000000001", epoch: 1, invocationId, packageId: current.packageId, packageDigest: current.packageDigest, policyFingerprint: current.policyFingerprint, grantRevision: current.grantRevision, operation, access, now: () => 123 }) };
}

describe("extension operation broker", () => {
  test("prompt activations admit explicitly reviewed data reads and deny separately granted writes or egress", async () => {
    let read = false; let mutation = false; let egress = false;
    const promptRead = { ...operation, activationOrigins: PROMPT_SAFE_READ_ORIGINS, execute: async ({ id }: { id: string }) => { read = true; return { name: id }; } };
    await expect(createExtensionBroker([promptRead], authority({ activationOrigin: "prompt" }))({ v: 1, type: "request", id: 1, operation: operation.id, args: { id: "char-1" } })).resolves.toEqual({ name: "char-1" });
    const write = { ...operation, id: "content.mutate", effect: "write" as const, policy: { ...operation.policy, budget: "write" as const, confirmation: "effect" as const }, review: async () => ({ action: "write" }), execute: async () => { mutation = true; return { name: "written" }; } };
    const external = { ...operation, id: "models.generate", effect: "external" as const, sensitivity: "secret" as const, policy: { ...operation.policy, budget: "external" as const, confirmation: "sensitive-send" as const }, review: async () => ({ action: "send" }), execute: async () => { egress = true; return { name: "sent" }; } };
    const withGrant = (id: string): ExtensionGrantSet => ({ ...grants, grants: [{ ...grants.grants[0]!, operation: id }] });
    await expect(createExtensionBroker([write], authority({ activationOrigin: "prompt", grants: withGrant(write.id) }))({ v: 1, type: "request", id: 2, operation: write.id, args: { id: "char-1" } })).rejects.toMatchObject({ code: "denied" });
    await expect(createExtensionBroker([external], authority({ activationOrigin: "prompt", grants: withGrant(external.id) }))({ v: 1, type: "request", id: 3, operation: external.id, args: { id: "char-1" } })).rejects.toMatchObject({ code: "denied" });
    expect({ read, mutation, egress }).toEqual({ read: true, mutation: false, egress: false });
  });
  test("validates the request, applies exact resource grants, projects output and records a receipt", async () => {
    const auth = authority(); const invoke = createExtensionBroker([operation], auth);
    await expect(invoke({ v: 1, type: "request", id: 1, operation: "content.read", args: { id: "char-1" } })).resolves.toEqual({ name: "char-1" });
    expect(auth.records.map(({ status }) => status)).toEqual(["admitted", "completed"]);
    expect(auth.records[0]!.id).toBe(auth.records[1]!.id);
    await expect(invoke({ v: 1, type: "request", id: 2, operation: "content.read", args: { id: "char-2" } })).rejects.toMatchObject({ code: "denied" });
    await expect(invoke({ v: 1, type: "request", id: 3, operation: "content.read", args: { id: "char-1", fetch: true } })).rejects.toMatchObject({ code: "invalid-request" });
  });
  test("uses the broker receipt identity as the invocation commit identity", async () => {
    let invocationId: string | undefined;
    const inspectCommit = { ...operation, execute: async (_args: { id: string }, context: Parameters<typeof operation.execute>[1]) => {
      invocationId = context.commit.invocationId;
      return { name: "ok" };
    } };
    const auth = authority();
    await createExtensionBroker([inspectCommit], auth)({ v: 1, type: "request", id: 1, operation: operation.id, args: { id: "char-1" } });
    const receiptId = auth.records[0]?.id;
    expect(invocationId).toBe(receiptId);
    if (!receiptId) throw new Error("broker did not record its admitted receipt");
    expect(auth.records.map(({ id }) => id)).toEqual([receiptId, receiptId]);
  });
  test("requires host confirmation for effects and refuses stale access revisions", async () => {
    let confirmed = false; let review: JsonValue | undefined; const records: EffectReceipt[] = [];
    const effect = { ...operation, policy: { ...operation.policy, confirmation: "effect" as const }, effect: "write" as const, review: async () => ({ before: "old", after: "new" }), execute: async () => ({ name: "written" }) };
    const invoke = createExtensionBroker([effect], authority({ records, confirm: async (value) => { confirmed = true; review = value; expect(records.map(({ status }) => status)).toEqual(["admitted"]); return false; } }));
    await expect(invoke({ v: 1, type: "request", id: 1, operation: effect.id, args: { id: "char-1" } })).rejects.toMatchObject({ code: "denied" });
    expect(confirmed).toBe(true);
    expect(records.map(({ status }) => status)).toEqual(["admitted", "denied"]);
    expect(review).toMatchObject({ operation: effect.id, title: effect.title, review: { before: "old", after: "new" } });
    const noReview = { ...effect, review: undefined };
    await expect(createExtensionBroker([noReview], authority())({ v: 1, type: "request", id: 3, operation: effect.id, args: { id: "char-1" } })).rejects.toMatchObject({ code: "denied" });
    const stale = { ...principal, grantRevision: 3 };
    await expect(createExtensionBroker([operation], authority({ current: stale }))({ v: 1, type: "request", id: 2, operation: operation.id, args: { id: "char-1" } })).rejects.toMatchObject({ code: "stale-principal" });
  });
  test("binds the broker to its creation principal and requires the requested fields", async () => {
    let current = principal;
    const auth = { ...authority(), principal: () => current };
    const invoke = createExtensionBroker([operation], auth);
    current = { ...principal, runEpoch: 2 };
    await expect(invoke({ v: 1, type: "request", id: 1, operation: operation.id, args: { id: "char-1" } })).rejects.toMatchObject({ code: "stale-principal" });
    current = principal;
    const emptyFields = { ...grants, grants: [{ ...grants.grants[0]!, fields: [] }] };
    await expect(createExtensionBroker([operation], authority({ grants: emptyFields }))({ v: 1, type: "request", id: 2, operation: operation.id, args: { id: "char-1" } })).rejects.toMatchObject({ code: "denied" });
  });
  test("resolves empty list scope from trusted selection and denies missing or unapproved scope", async () => {
    let seen: readonly { kind: string; id: string }[] = [];
    let invocation: readonly { kind: string; id: string }[] = [];
    const list = { ...operation, id: "content.list", input: z.object({}).strict(), resolveAccess: () => ({ resources: [], fields: ["identity"], methods: [], destinations: [] }), execute: async (_args: {}, context: Parameters<typeof operation.execute>[1]) => { seen = context.access.resources; invocation = context.invocation.resources; return { name: "listed" }; } };
    const listGrants = { ...grants, grants: [{ ...grants.grants[0]!, operation: list.id }] };
    const selected = [{ kind: "character", id: "char-1" }];
    const invoke = createExtensionBroker([list], authority({ grants: listGrants, selectedScope: selected }));
    selected.push({ kind: "character", id: "outside" });
    await invoke({ v: 1, type: "request", id: 1, operation: list.id, args: {} });
    expect(seen).toEqual([{ kind: "character", id: "char-1" }]);
    expect(invocation).toEqual([{ kind: "character", id: "char-1" }]);
    await expect(createExtensionBroker([list], authority({ grants: listGrants }))({ v: 1, type: "request", id: 2, operation: list.id, args: {} })).rejects.toMatchObject({ code: "denied" });
    await expect(createExtensionBroker([list], authority({ grants: listGrants, selectedScope: [{ kind: "character", id: "outside" }] }))({ v: 1, type: "request", id: 3, operation: list.id, args: {} })).rejects.toMatchObject({ code: "denied" });
  });
  test("rechecks authority after receipt admission before starting an effect", async () => {
    let current = principal; let called = false; const records: EffectReceipt[] = [];
    const auth = { ...authority({ records }), principal: () => current, record: async (receipt: EffectReceipt) => { records.push(receipt); if (receipt.status === "admitted") current = { ...principal, runEpoch: 2 }; } };
    const guarded = { ...operation, execute: async () => { called = true; return { name: "no" }; } };
    await expect(createExtensionBroker([guarded], auth)({ v: 1, type: "request", id: 1, operation: operation.id, args: { id: "char-1" } })).rejects.toMatchObject({ code: "stale-principal" });
    expect(called).toBe(false);
    expect(records.map(({ status }) => status)).toEqual(["admitted", "denied"]);
  });
  test("preserves a completed file write when access changes after the host action", async () => {
    let current = principal; const records: EffectReceipt[] = [];
    const effect = { ...operation, policy: { ...operation.policy, confirmation: "effect" as const }, effect: "write" as const,
      review: async () => ({ target: "fixture" }), execute: async () => ({ name: "written" }) };
    const auth = { ...authority({ records, confirm: async () => { current = { ...principal, runEpoch: 2 }; return true; } }), principal: () => current,
      confirmedEffectResult: async () => "written" as const };
    await expect(createExtensionBroker([effect], auth)({ v: 1, type: "request", id: 1, operation: effect.id, args: { id: "char-1" } })).rejects.toMatchObject({ code: "stale-principal" });
    expect(records.map(({ status }) => status)).toEqual(["admitted", "committed"]);
  });
  test("records ambiguous when a file host action reports uncertain completion", async () => {
    const records: EffectReceipt[] = [];
    const effect = { ...operation, policy: { ...operation.policy, confirmation: "effect" as const }, effect: "write" as const,
      review: async () => ({ target: "fixture" }), execute: async () => { throw new Error("uncertain native completion"); } };
    const auth = { ...authority({ records }), confirmedEffectResult: async () => "ambiguous" as const };
    await expect(createExtensionBroker([effect], auth)({ v: 1, type: "request", id: 1, operation: effect.id, args: { id: "char-1" } })).rejects.toMatchObject({ code: "operation-failed" });
    expect(records.map(({ status }) => status)).toEqual(["admitted", "ambiguous"]);
  });
  test("a completed typed host action remains committed if its linked review ticket expires", async () => {
    const records: EffectReceipt[] = [];
    const effect = { ...operation, policy: { ...operation.policy, confirmation: "effect" as const }, effect: "write" as const,
      review: async () => ({ target: "fixture" }), execute: async () => ({ name: "written" }) };
    const auth = { ...authority({ records, confirm: async () => false }), confirmedEffectResult: async () => "written" as const };
    await expect(createExtensionBroker([effect], auth)({ v: 1, type: "request", id: 1, operation: effect.id, args: { id: "char-1" } })).resolves.toEqual({ name: "written" });
    expect(records.map(({ status }) => status)).toEqual(["admitted", "committed"]);
  });
  test("records ambiguous when admitted work aborts during execution", async () => {
    const controller = new AbortController(); const records: EffectReceipt[] = [];
    const auth = authority({ signal: controller.signal, records });
    const work = { ...operation, execute: async () => { controller.abort(); throw new Error("aborted"); } };
    await expect(createExtensionBroker([work], auth)({ v: 1, type: "request", id: 1, operation: operation.id, args: { id: "char-1" } })).rejects.toMatchObject({ code: "cancelled" });
    expect(records.map(({ status }) => status)).toEqual(["admitted", "ambiguous"]);
  });
  test("translates structured unsupported-host errors without rewriting admitted-effect accounting", async () => {
    const records: EffectReceipt[] = [];
    const settlements: { bytes: number; tokens: number }[] = [];
    const unavailable = { ...operation, execute: async (): Promise<{ name: string }> => { throw new ExtensionServiceError("UNSUPPORTED_HOST", "This scene is owned by rp-core."); } };
    const auth = { ...authority({ records }), settleBudget: async (_packageId: string, _id: string, bytes: number, tokens: number) => { settlements.push({ bytes, tokens }); return true; } };
    await expect(createExtensionBroker([unavailable], auth)({ v: 1, type: "request", id: 1, operation: operation.id, args: { id: "char-1" } }))
      .rejects.toMatchObject({ code: "unsupported-host", message: "This scene is owned by rp-core." });
    expect(records.map(({ status }) => status)).toEqual(["admitted", "ambiguous"]);
    expect(settlements).toContainEqual({ bytes: 100, tokens: 0 });
  });
  test("a typed unsupported-host review failure is denied before admission", async () => {
    const records: EffectReceipt[] = [];
    const unavailable = { ...operation, effect: "write" as const, policy: { ...operation.policy, budget: "write" as const, confirmation: "effect" as const },
      review: async () => { throw new ExtensionServiceError("UNSUPPORTED_HOST", "This scene is owned by rp-core."); } };
    const reviewGrants = { ...grants, grants: [{ ...grants.grants[0]!, operation: unavailable.id, budget: { requests: 10, bytes: 1_000, tokens: 0 } }] };
    await expect(createExtensionBroker([unavailable], authority({ records, grants: reviewGrants }))({ v: 1, type: "request", id: 1, operation: operation.id, args: { id: "char-1" } }))
      .rejects.toMatchObject({ code: "unsupported-host" });
    expect(records).toEqual([]);
  });
  test("an arbitrary coded exception cannot claim a trusted unsupported-host refusal", async () => {
    const records: EffectReceipt[] = [];
    const untrusted = { ...operation, execute: async (): Promise<{ name: string }> => { throw Object.assign(new Error("coded failure"), { code: "UNSUPPORTED_HOST" }); } };
    await expect(createExtensionBroker([untrusted], authority({ records }))({ v: 1, type: "request", id: 1, operation: operation.id, args: { id: "char-1" } }))
      .rejects.toMatchObject({ code: "operation-failed" });
    expect(records.map(({ status }) => status)).toEqual(["admitted", "ambiguous"]);
  });
  test("a confirmed host write remains committed when a later structured error is reported", async () => {
    const records: EffectReceipt[] = [];
    const write = { ...operation, effect: "write" as const, policy: { ...operation.policy, budget: "write" as const, confirmation: "effect" as const },
      review: async () => ({ action: "write" }), execute: async (): Promise<{ name: string }> => { throw new ExtensionServiceError("UNSUPPORTED_HOST", "The target changed after the host write."); } };
    const writeGrants = { ...grants, grants: [{ ...grants.grants[0]!, operation: write.id, budget: { requests: 10, bytes: 1_000, tokens: 0 } }] };
    const auth = { ...authority({ records, grants: writeGrants }), confirmedEffectResult: async () => "written" as const };
    await expect(createExtensionBroker([write], auth)({ v: 1, type: "request", id: 1, operation: operation.id, args: { id: "char-1" } }))
      .rejects.toMatchObject({ code: "unsupported-host" });
    expect(records.map(({ status }) => status)).toEqual(["admitted", "committed"]);
  });
  test("records a structured stale mutation as conflicted instead of committed", async () => {
    const mutation: ExtensionOperationDescriptor<{ id: string }, { status: "saved" | "stale" }> = {
      ...operation,
      id: "content.write",
      output: z.discriminatedUnion("status", [z.object({ status: z.literal("saved") }), z.object({ status: z.literal("stale") })]),
      effect: "write", policy: { ...operation.policy, budget: "write", confirmation: "effect" },
      receiptStatus: ({ status }) => status === "saved" ? "committed" : "conflicted",
      measureTokens: () => 0,
      review: async () => ({ action: "apply" }),
      project: (value) => value,
      execute: async () => ({ status: "stale" }),
    };
    const mutationGrants: ExtensionGrantSet = { ...grants, grants: [{ ...grants.grants[0]!, operation: mutation.id }] };
    const records: EffectReceipt[] = [];
    await expect(createExtensionBroker([mutation], authority({ records, grants: mutationGrants }))({ v: 1, type: "request", id: 1, operation: mutation.id, args: { id: "char-1" } }))
      .resolves.toEqual({ status: "stale" });
    expect(records.map(({ status }) => status)).toEqual(["admitted", "conflicted"]);
  });
  test("releases a reserved budget when trusted admission setup fails before the receipt", async () => {
    let settled = 0;
    const auth = { ...authority({ readReceipts: async () => { throw new Error("receipt store unavailable"); } }),
      settleBudget: async () => { settled++; return true; } };
    await expect(createExtensionBroker([operation], auth)({ v: 1, type: "request", id: 1, operation: operation.id, args: { id: "char-1" } }))
      .rejects.toThrow("receipt store unavailable");
    expect(settled).toBe(1);
    expect(auth.records).toEqual([]);
  });
  test("control tickets wait outside commit serialization and cancellation settles the guest call", async () => {
    const controller = new AbortController();
    let entered!: () => void;
    const running = new Promise<void>((resolve) => { entered = resolve; });
    let fenced = false;
    const auth = { ...authority({ signal: controller.signal }), withCommitFence: async <T>(_principal: OperationPrincipal, action: () => Promise<T>): Promise<T> => { fenced = true; return action(); } };
    const dialog = { ...operation, id: "ui.dialog.request", effect: "control" as const, policy: { ...operation.policy, confirmation: "none" as const },
      execute: async (_args: { id: string }, context: Parameters<typeof operation.execute>[1]) => new Promise<{ name: string }>((_resolve, reject) => {
        entered(); context.signal.addEventListener("abort", () => reject(new DOMException("cancelled", "AbortError")), { once: true });
      }) };
    const dialogGrants = { ...grants, grants: [{ ...grants.grants[0]!, operation: dialog.id }] };
    const invoke = createExtensionBroker([dialog], { ...auth, grants: () => dialogGrants });
    const pending = invoke({ v: 1, type: "request", id: 1, operation: dialog.id, args: { id: "char-1" } });
    await running;
    controller.abort();
    await expect(pending).rejects.toMatchObject({ code: "cancelled" });
    expect(fenced).toBe(false);
  });
  test("trusted nested dispatch reuses the exact broker and blocks recursive cycles", async () => {
    const toolsInvoke: ExtensionOperationDescriptor<{ id: string; args: JsonValue }, { name: string }> = {
      id: "tools.invoke", version: 1, inputVersion: 1, outputVersion: 1, projectionVersion: 1, title: "Invoke tool", description: "Nested dispatch.",
      input: z.object({ id: z.string(), args: z.json() }).strict(), output: z.object({ name: z.string() }).strict(), effect: "control", sensitivity: "private", hosts: ["desktop"],
      policy: { resources: [], fields: ["tools.invoke"], methods: [], destinationMode: "none", destinations: [], budget: "metadata", confirmation: "none" },
      estimateBudget: () => ({ bytes: 100, tokens: 0 }), measureTokens: () => 0,
      resolveAccess: () => ({ resources: [], fields: ["tools.invoke"], methods: [], destinations: [] }), project: (value) => value,
      execute: async ({ id, args }, context) => {
        if (!context.invoke) throw new Error("nested dispatcher is unavailable");
        return z.object({ name: z.string() }).strict().parse(await context.invoke(id, args));
      },
    };
    const nestedGrants = { ...grants, grants: [...grants.grants, { operation: toolsInvoke.id, resources: [], fields: ["tools.invoke"], methods: [], destinations: [], duration: "persistent" as const, budget: { requests: 10, bytes: 1_000, tokens: 0 } }] };
    const auth = authority({ grants: nestedGrants });
    await expect(createExtensionBroker([operation, toolsInvoke], auth)({ v: 1, type: "request", id: 1, operation: toolsInvoke.id, args: { id: operation.id, args: { id: "char-1" } } })).resolves.toEqual({ name: "char-1" });
    const recursive = { ...toolsInvoke, execute: async (_args: { id: string; args: JsonValue }, context: Parameters<typeof operation.execute>[1]) => z.object({ name: z.string() }).strict().parse(await context.invoke!(toolsInvoke.id, { id: toolsInvoke.id, args: {} })) };
    await expect(createExtensionBroker([recursive], authority({ grants: nestedGrants }))({ v: 1, type: "request", id: 2, operation: toolsInvoke.id, args: { id: toolsInvoke.id, args: {} } })).rejects.toMatchObject({ code: "denied" });
  });
});
