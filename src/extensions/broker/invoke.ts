/** Single trusted admission path for every guest operation request. */
import { extensionWireRequestSchema } from "../contracts/wire";
import { decodeJsonValue } from "../contracts/value";
import type { EffectReceipt, ExtensionGrantSet } from "../contracts/grants";
import type { ExtensionBudget, ExtensionBudgetReservation } from "../../stage/contracts/extension-store";
import type { ExtensionCommitContext } from "../../stage/contracts/extension-store";
import type { ExtensionOperationContext, ExtensionOperationDescriptor, ExtensionPromptInvocation, ExtensionActivationOrigin, HostFeature, OperationPrincipal, ResolvedOperationAccess } from "../contracts/operation";
import type { JsonValue } from "../contracts/value";
import type { ExtensionWireRequest } from "../contracts/wire";
import { resolveGrantedAccess } from "../permissions/matching";
import { estimateOperationBudget } from "../catalog/operations";
import { deepEq, isRecord } from "../../core/guards";
import { snapshotInvocationResources } from "../contracts/invocation-context";
import { ExtensionOperationError } from "../contracts/errors";

export type BrokerErrorCode = "invalid-request" | "unknown-operation" | "unsupported-host" | "stale-principal" | "denied" | "cancelled" | "operation-failed";
export class ExtensionBrokerError extends Error {
  constructor(readonly code: BrokerErrorCode, message: string) { super(message); this.name = "ExtensionBrokerError"; }
}

export interface BrokerAuthority {
  refresh?(): Promise<void>;
  principal(): OperationPrincipal;
  declarations?: { commands: readonly string[]; panels: readonly string[]; assets: readonly string[] };
  activationOrigin?: ExtensionActivationOrigin;
  grants(): ExtensionGrantSet;
  host: HostFeature;
  operationMetadata: readonly JsonValue[];
  selectedScope?(): readonly { kind: string; id: string }[];
  signal: AbortSignal;
  confirm(effect: JsonValue): Promise<boolean>;
  confirmedEffectResult?(effect: JsonValue): Promise<"none" | "written" | "ambiguous">;
  reserveBudget(reservation: ExtensionBudgetReservation, limits: ExtensionBudget): Promise<boolean>;
  settleBudget(packageId: string, reservationId: string, bytes: number, tokens: number): Promise<boolean>;
  record(receipt: EffectReceipt): Promise<void>;
  readReceipts(packageId: string, limit: number): Promise<readonly EffectReceipt[]>;
  now(): number;
  id(): string;
  commitContext(principal: OperationPrincipal, operation: string, access: ResolvedOperationAccess, invocationId: string): ExtensionCommitContext;
  promptInvocation?(): ExtensionPromptInvocation | undefined;
}

const fail = (code: BrokerErrorCode, message: string): never => { throw new ExtensionBrokerError(code, message); };
const unsupportedHostFailure = (error: unknown): error is ExtensionOperationError =>
  error instanceof ExtensionOperationError && error.code === "UNSUPPORTED_HOST";

/** Creates an invocation function bound to one host-created package principal. */
export function createExtensionBroker(operations: readonly ExtensionOperationDescriptor[], authority: BrokerAuthority) {
  const catalog = new Map(operations.map((operation) => [operation.id, operation]));
  if (catalog.size !== operations.length) throw new Error("duplicate extension operation id");
  for (const operation of operations) {
    if (operation.effect === "write" && operation.policy.confirmation === "none" && !operation.delegates?.length) throw new Error("unreviewed writes must declare their delegated child operations");
    if (operation.delegates && (operation.effect !== "write" || operation.policy.confirmation !== "none" || new Set(operation.delegates).size !== operation.delegates.length
      || operation.delegates.some((id) => id === operation.id || !catalog.has(id)))) throw new Error("invalid delegated operation contract");
  }
  const bound = Object.freeze({ ...authority.principal() });
  const invocationResources = snapshotInvocationResources(authority.selectedScope?.() ?? []);
  const samePrincipal = (current: OperationPrincipal): boolean => current.storeId === bound.storeId
    && current.packageId === bound.packageId && current.packageDigest === bound.packageDigest
    && current.apiMajor === bound.apiMajor && current.policyFingerprint === bound.policyFingerprint
    && current.grantRevision === bound.grantRevision && current.runEpoch === bound.runEpoch;

  let nestedRequestId = 0;
  return async function invoke(raw: unknown, depth = 0, path: readonly string[] = []): Promise<unknown> {
    if (depth > 4) fail("denied", "Nested tool invocation exceeded its depth limit.");
    await authority.refresh?.();
    const request = extensionWireRequestSchema.safeParse(raw);
    if (!request.success) fail("invalid-request", "The extension request is invalid.");
    const data = request.data as ExtensionWireRequest;
    const principal = bound;
    if (!samePrincipal(authority.principal())) fail("stale-principal", "The extension's access changed. Restart it to continue.");
    const grants = authority.grants();
    if (grants.packageId !== principal.packageId || grants.packageDigest !== principal.packageDigest
      || grants.policyFingerprint !== principal.policyFingerprint || grants.revision !== principal.grantRevision) {
      fail("stale-principal", "The extension's approved access changed. Restart it to continue.");
    }
    const operation = catalog.get(data.operation);
    if (!operation) throw new ExtensionBrokerError("unknown-operation", "This operation is not available.");
    if (path.includes(operation.id)) fail("denied", "Nested tool invocation cannot recurse through the same operation.");
    if (!operation.hosts.includes(authority.host)) fail("unsupported-host", "This operation is not supported on this host.");
    if (authority.activationOrigin === "prompt" && !operation.activationOrigins?.includes("prompt")) fail("denied", "Prompt hooks may call only prompt-scoped operations.");
    if (operation.activationOrigins && (!authority.activationOrigin || !operation.activationOrigins.includes(authority.activationOrigin))) fail("denied", "This operation is unavailable from the current activation context.");
    const args = operation.input.safeParse(data.args);
    if (!args.success) fail("invalid-request", "The operation arguments are invalid.");
    const requestedAccess: ResolvedOperationAccess = operation.resolveAccess(args.data);
    const grant = grants.grants.find((item) => item.operation === operation.id);
    if (!grant) throw new ExtensionBrokerError("denied", "This extension has not been granted access to that operation and resource.");
    const access = resolveGrantedAccess(grant, operation, requestedAccess, invocationResources);
    if (!access || !grant.resources.length && operation.policy.resources.length) throw new ExtensionBrokerError("denied", "This extension has not been granted access to that operation and resource.");
    if (authority.signal.aborted) fail("cancelled", "The extension operation was cancelled.");

    let estimate: { bytes: number; tokens: number };
    try { estimate = estimateOperationBudget(operation, args.data); }
    catch { throw new ExtensionBrokerError("operation-failed", "The operation has invalid budget metadata."); }
    const receiptId = authority.id();
    const reservation: ExtensionBudgetReservation = { packageId: principal.packageId, operation: operation.id, grantRevision: principal.grantRevision, id: receiptId, ...estimate };
    const receiptCreatedAt = authority.now();
    if (!await authority.reserveBudget(reservation, grant.budget)) throw new ExtensionBrokerError("denied", "The extension has reached this operation's approved usage limit.");
    const receipt = (status: EffectReceipt["status"]): EffectReceipt => ({ id: receiptId, packageId: principal.packageId, operation: operation.id, effect: operation.effect, status, createdAt: receiptCreatedAt, resourceCount: access.resources.length });

    const prepared = await (async () => {
    const grantedOperations = grants.grants.map((item) => item.operation);
    const availableOperations = authority.operationMetadata.filter((metadata) => {
      if (!isRecord(metadata)) return false;
      const entry = metadata as Record<string, JsonValue>;
      return Array.isArray(entry.hosts) && entry.hosts.includes(authority.host);
    });
    const operationReceipts = (await authority.readReceipts(principal.packageId, 20)).map((receipt) => decodeJsonValue(receipt));
    const availableGrants = grants.grants.map((grant) => decodeJsonValue(grant));
    const promptInvocation = authority.promptInvocation ? authority.promptInvocation() : undefined;
    const assertCurrent = async (): Promise<void> => {
      if (authority.signal.aborted) fail("cancelled", "The extension operation was cancelled.");
      await authority.refresh?.();
      if (!samePrincipal(authority.principal())) fail("stale-principal", "The extension's access changed before its effect could start.");
      const liveGrants = authority.grants();
      const liveGrant = liveGrants.grants.find((item) => item.operation === operation.id);
      const liveAccess = liveGrant && resolveGrantedAccess(liveGrant, operation, requestedAccess, invocationResources);
      if (liveGrants.packageId !== principal.packageId || liveGrants.packageDigest !== principal.packageDigest
        || liveGrants.policyFingerprint !== principal.policyFingerprint || liveGrants.revision !== principal.grantRevision
        || !liveAccess || !deepEq(liveAccess, access)) {
        fail("stale-principal", "The extension's approved resource access changed before its effect could start.");
      }
    };
    const invocation = { resources: invocationResources.filter((resource) => grant.resources.some((allowed) => allowed.kind === resource.kind && allowed.id === resource.id)) };
    const context: ExtensionOperationContext = { principal, declaredCommands: authority.declarations?.commands ?? [], declaredPanels: authority.declarations?.panels ?? [], declaredAssets: authority.declarations?.assets ?? [], activationOrigin: authority.activationOrigin, invocation,
      signal: authority.signal, resources: access.resources, access, commit: authority.commitContext(principal, operation.id, access, receiptId), grantedOperations,
      availableGrants, operationReceipts, host: authority.host, availableOperations, assertCurrent, confirm: authority.confirm,
      ...(promptInvocation ? { promptInvocation } : {}),
      invoke: async (nestedOperation: string, nestedArgs: JsonValue): Promise<JsonValue> => {
        if (operation.delegates && !operation.delegates.includes(nestedOperation)) fail("denied", "The wrapper may dispatch only its declared child operation.");
        return decodeJsonValue(await invoke({ v: 1, type: "request", id: ++nestedRequestId, operation: nestedOperation, args: nestedArgs }, depth + 1, [...path, operation.id]));
      } };
    let review: JsonValue | undefined;
    if (operation.policy.confirmation !== "none") {
      const reviewHandler = operation.review;
      if (!reviewHandler) {
        await authority.settleBudget(principal.packageId, receiptId, 0, 0);
        return fail("denied", "This consequential operation has no host review projection.");
      }
      try {
        const detail = decodeJsonValue(await reviewHandler(args.data, context));
        context.hostReview = detail;
        review = decodeJsonValue({ operation: operation.id, title: operation.title, resources: access.resources, fields: access.fields, methods: access.methods, destinations: access.destinations, effect: operation.effect, review: detail });
      } catch (error) {
        await authority.settleBudget(principal.packageId, receiptId, 0, 0).catch(() => false);
      if (unsupportedHostFailure(error)) fail("unsupported-host", error.message);
        throw error;
      }
    }

    try { await authority.refresh?.(); }
    catch (error) { await authority.settleBudget(principal.packageId, receiptId, 0, 0).catch(() => false); throw error; }
    if (!samePrincipal(authority.principal()) || authority.signal.aborted) {
      await authority.settleBudget(principal.packageId, receiptId, 0, 0);
      fail("stale-principal", "The extension's access changed before the operation could start.");
    }
    await authority.record(receipt("admitted"));
    return { context, review };
    })().catch(async (error: unknown) => {
      // Reservation setup and durable admission can fail before the normal execution settlement path exists.
      await authority.settleBudget(principal.packageId, receiptId, 0, 0).catch(() => false);
      throw error;
    });
    const { context, review } = prepared;
    try { await authority.refresh?.(); }
    catch (error) {
      await authority.settleBudget(principal.packageId, receiptId, 0, 0).catch(() => false);
      await authority.record(receipt("cancelled")).catch(() => undefined);
      throw error;
    }
    if (!samePrincipal(authority.principal()) || authority.signal.aborted) {
      await authority.settleBudget(principal.packageId, receiptId, 0, 0);
      await authority.record(receipt("denied"));
      fail(authority.signal.aborted ? "cancelled" : "stale-principal", "The extension's access changed before the operation could start.");
    }
    let confirmedEffectResult: "none" | "written" | "ambiguous" = "none";
    let executionStarted = false;
    let settled = false;
    let recorded = false;
    const finish = async (status: EffectReceipt["status"], bytes: number, tokens: number): Promise<void> => {
      if (!settled) {
        if (!await authority.settleBudget(principal.packageId, receiptId, bytes, tokens)) fail("operation-failed", "The operation exceeded its approved usage budget.");
        settled = true;
      }
      if (!recorded) { await authority.record(receipt(status)); recorded = true; }
    };
    try {
      if (review) {
        const accepted = await authority.confirm(review);
        if (!accepted) confirmedEffectResult = await authority.confirmedEffectResult?.(review) ?? "none";
        if (!accepted && confirmedEffectResult === "none") {
          await finish("denied", 0, 0);
          fail("denied", "The operation was not approved.");
        }
        if (accepted) confirmedEffectResult = await authority.confirmedEffectResult?.(review) ?? "none";
      }
      try { await context.assertCurrent(); }
      catch (error) {
        const hostWriteDone = operation.effect === "write" && confirmedEffectResult !== "none";
        await finish(hostWriteDone && confirmedEffectResult === "written" ? "committed" : hostWriteDone ? "ambiguous" : authority.signal.aborted ? "cancelled" : "denied",
          hostWriteDone ? estimate.bytes : 0, hostWriteDone ? estimate.tokens : 0);
        throw error;
      }
      const execute = async () => {
        if (authority.signal.aborted) fail("cancelled", "The extension operation was cancelled before commit.");
        await context.assertCurrent();
        executionStarted = true;
        return operation.execute(args.data, context);
      };
      const result = await execute();
      const output = operation.output.parse(result);
      const projected = decodeJsonValue(operation.project(output, principal, access));
      await authority.refresh?.();
      if (!samePrincipal(authority.principal())) fail("stale-principal", "The extension's access changed while the operation was running.");
      const bytes = new TextEncoder().encode(JSON.stringify(projected)).byteLength;
      const tokens = operation.measureTokens(output);
      if (!Number.isSafeInteger(tokens) || tokens < 0) fail("operation-failed", "The operation exceeded its approved usage budget.");
      const status = operation.receiptStatus?.(output) ?? (operation.effect === "read" ? "completed" : "committed");
      await finish(status, bytes, tokens);
      return projected;
    } catch (error) {
      if (!recorded) {
        if (review && confirmedEffectResult === "none" && authority.confirmedEffectResult) {
          try { confirmedEffectResult = await authority.confirmedEffectResult(review); } catch { confirmedEffectResult = "none"; }
        }
        const hostWriteDone = operation.effect === "write" && confirmedEffectResult !== "none";
        const uncertainEffect = executionStarted;
        const charged = hostWriteDone || uncertainEffect;
        await finish(hostWriteDone && confirmedEffectResult === "written" ? "committed" : charged ? "ambiguous" : authority.signal.aborted ? "cancelled" : "denied",
          charged ? estimate.bytes : 0, charged ? estimate.tokens : 0);
      }
      if (error instanceof ExtensionBrokerError) throw error;
      if (unsupportedHostFailure(error)) fail("unsupported-host", error.message);
      if (authority.signal.aborted) fail("cancelled", "The extension operation was cancelled while waiting for host action.");
      if (error instanceof Error && "code" in error && error.code === "STALE_PRINCIPAL") fail("stale-principal", "Extension access changed before the write could commit.");
      fail("operation-failed", "The extension operation failed. Its effect may need review.");
    }
  };
}
