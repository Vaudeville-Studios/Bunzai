/** Canonical ChangeSession adapter; guest handlers never receive entities or draft objects. */
import { decodeJsonValue, type JsonValue } from "../contracts/value";
import type { ExtensionDraftPrincipal, ExtensionDraftProjection, ExtensionDraftServices } from "../operations/content/_draft-services";
import type { ContentCapability, ContentKind } from "../../entities/capabilities/types";
import type { ContentStore } from "../../stage/contracts/content-store";
import type { ResourceRef } from "../contracts/operation";
import type { ExtensionCommitContext } from "../../stage/contracts/extension-store";
import { createChangeSession } from "../../kit/changes/session";
import type { ChangeDraft } from "../../kit/changes/types";
import { verifySavedEntity } from "../../kit/changes/verify";
import { parseCanonicalEntity, type ParsedCanonicalEntity } from "../../entities/runtime-schema";
import { summaryContentOf } from "../../stage/store/summary-content";
import { canonicalEntityBodySchema } from "../../entities/runtime-schema";
import { canonicalJson } from "../contracts/value";
import { sha256Hex } from "../../core/sha256";

const targetOf = (capability: ContentCapability, input: unknown): { kind: ContentKind; id: string } | null => {
  if (typeof input !== "object" || input === null) return null;
  const target = (input as { target?: unknown }).target;
  if (typeof target !== "object" || target === null || typeof (target as { id?: unknown }).id !== "string") return null;
  return { kind: capability.kind, id: (target as { id: string }).id };
};
const inScope = (scope: readonly ResourceRef[], kind: string, id: string): boolean => scope.some((ref) => ref.kind === kind && ref.id === id);
const fingerprintOf = (draft: ChangeDraft): string => sha256Hex(canonicalJson({
  mode: draft.mode, target: draft.target, baseline: draft.baseline, proposed: draft.proposed,
  operationIds: draft.operations.map(({ capabilityId }) => capabilityId), warnings: draft.warnings,
}));
function project(draft: ChangeDraft, capabilities: readonly ContentCapability[]): ExtensionDraftProjection {
  const byPath = new Map<string, { before: unknown; after: unknown }>();
  for (const operation of draft.operations) {
    const capability = capabilities.find((item) => item.id === operation.capabilityId);
    const allowed = capability?.extensionExposure?.fields.map(({ path }) => path) ?? [];
    for (const change of operation.changes) {
      if (!allowed.some((field) => change.path === field || change.path.startsWith(`${field}.`) || change.path.startsWith(`${field}[`))) continue;
      const prior = byPath.get(change.path);
      byPath.set(change.path, { before: prior ? prior.before : change.before, after: change.after });
    }
  }
  const changes = [...byPath]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([path, change]) => ({ path, before: decodeJsonValue(change.before ?? null), after: decodeJsonValue(change.after ?? null) }));
  const requiredOperations = [...new Set(draft.operations.map(({ capabilityId }) => {
    const operationId = capabilities.find((item) => item.id === capabilityId)?.extensionExposure?.operationId
      ?? (capabilityId === "content.create" ? "content.create.preview" : capabilityId === "content.duplicate" ? "content.duplicate.preview" : null);
    if (!operationId) throw new Error(`Draft capability is no longer exposed: ${capabilityId}`);
    return operationId;
  }))];
  return { id: draft.id, kind: draft.target.kind, targetId: draft.target.id, name: summaryContentOf(draft.proposed).name, revision: draft.target.revision, mode: draft.mode, status: draft.status, fingerprint: fingerprintOf(draft), requiredOperations, changes, warnings: draft.warnings.slice(0, 20).map((warning) => warning.slice(0, 300)) };
}

/** One runtime-local session per trusted package principal, backed by canonical read/CAS doors. */
export function createExtensionDraftServices(
  store: ContentStore,
  capabilities: readonly ContentCapability[],
): ExtensionDraftServices {
  const maxDraftsPerPackage = 256;
  const byId = new Map<string, ContentCapability>(capabilities.filter((item) => item.extensionExposure).map((item) => [item.id, item]));
  const sessions = new Map<string, ReturnType<typeof createChangeSession>>();
  const currentKeyByPackage = new Map<string, string>();
const principalKey = (principal: ExtensionDraftPrincipal) => [principal.storeId, principal.packageId, principal.packageDigest, principal.policyFingerprint, principal.apiMajor, principal.grantRevision].join("\0");
  const sessionFor = (principal: ExtensionDraftPrincipal, create = true) => {
    const key = principalKey(principal);
    const prior = currentKeyByPackage.get(principal.packageId);
    if (prior !== undefined && prior !== key) sessions.delete(prior);
    currentKeyByPackage.set(principal.packageId, key);
    let session = sessions.get(key);
    if (!session && create) {
      if (sessions.size >= 128) throw new Error("extension draft session limit reached");
      session = createChangeSession(); sessions.set(key, session);
    }
    return session ?? null;
  };
  const hasRoom = (session: ReturnType<typeof createChangeSession>) => session.list().length < maxDraftsPerPackage;
  const owner = (principal: ExtensionDraftPrincipal, id: string, scope: readonly ResourceRef[]) => {
    const draft = sessionFor(principal, false)?.get(id);
    return draft && inScope(scope, draft.target.kind, draft.target.id) ? draft : null;
  };
  return {
    async create(principal, entity, scope) {
      const parsed = parseCanonicalEntity(entity);
      if (!inScope(scope, parsed.kind, parsed.id) || await store.freeId(parsed.kind, parsed.id) !== parsed.id) return null;
      const session = sessionFor(principal);
      if (!session) return null;
      if (!hasRoom(session)) throw new Error("extension draft limit reached");
      const operation = { capabilityId: "content.create", input: { kind: parsed.kind, id: parsed.id }, changes: [], warnings: [], platformImpact: [] };
      try { return project(session.create(parsed, operation), capabilities); }
      catch { return null; }
    },
    async duplicate(principal, kind, id, targetId, scope) {
      if (!inScope(scope, kind, id) || !inScope(scope, kind, targetId) || await store.freeId(kind, targetId) !== targetId) return null;
      const stored = await store.read(kind, id);
      if (!stored) return null;
      const session = sessionFor(principal);
      if (!session) return null;
      if (!hasRoom(session)) throw new Error("extension draft limit reached");
      const copied = parseCanonicalEntity({ ...stored.entity, id: targetId });
      const operation = { capabilityId: "content.duplicate", input: { kind, id }, changes: [], warnings: [], platformImpact: [] };
      try { return project(session.create(copied, operation), capabilities); }
      catch { return null; }
    },
    async preview(principal, capability, input, scope) {
      const target = targetOf(capability, input);
      if (!target || !inScope(scope, target.kind, target.id) || byId.get(capability.id) !== capability) return null;
      if (typeof input === "object" && input !== null && typeof (input as { target?: unknown }).target === "object"
        && (input as { target: { variantId?: unknown } }).target.variantId !== undefined) return null;
      const stored = await store.read(target.kind, target.id);
      if (!stored) return null;
      const session = sessionFor(principal);
      if (!session) return null;
      if (!session.forTarget(target.kind, target.id) && !hasRoom(session)) throw new Error("extension draft limit reached");
      const draft = session.draft(capability, input, stored.entity);
      return draft ? project(draft, capabilities) : null;
    },
    async inspect(principal, id, scope) {
      const draft = owner(principal, id, scope);
      if (!draft) return null;
      return project(draft, capabilities);
    },
    async review(principal, id, scope) {
      const draft = owner(principal, id, scope);
      if (!draft) return null;
      const projection = project(draft, capabilities);
      if (draft.mode !== "create") return { draft: projection };
      const parsed = canonicalEntityBodySchema.parse({ kind: draft.proposed.kind, id: draft.proposed.id, body: draft.proposed.body });
      const body = decodeJsonValue(parsed.body);
      if (new TextEncoder().encode(JSON.stringify(body)).byteLength > 200_000) throw new Error("content draft review exceeds size limit");
      return { draft: projection, createdBody: { kind: parsed.kind, id: parsed.id, body } };
    },
    async discard(principal, id, scope) {
      const draft = owner(principal, id, scope);
      const session = sessionFor(principal, false);
      return draft && session ? session.discard(id) !== null : false;
    },
    async apply(principal, id, expectedFingerprint, scope, commit: ExtensionCommitContext) {
      const session = sessionFor(principal, false);
      const pending = owner(principal, id, scope);
      if (!session || !pending || commit.packageId !== principal.packageId || commit.operation !== "content.draft.apply") return "missing";
      if (fingerprintOf(pending) !== expectedFingerprint) return "stale";
      const draft = session.startApply(id);
      if (!draft) return "missing";
      if (draft.mode === "create") {
        const result = await store.create(draft.proposed, commit);
        if (result.status !== "saved") { session.finishApply(id, "stale"); return "stale"; }
        const saved = await store.read(draft.target.kind, draft.target.id);
        const status = saved && verifySavedEntity(draft.proposed, saved.entity) ? "applied" : "failed";
        session.finishApply(id, status);
        return status;
      }
      const result = await store.saveIfUnchanged(draft.proposed, draft.target.revision, commit);
      if (result.status !== "saved") { session.finishApply(id, result.status === "stale" ? "stale" : "failed"); return result.status; }
      const saved = await store.read(draft.target.kind, draft.target.id);
      const status = saved && verifySavedEntity(draft.proposed, saved.entity) ? "applied" : "failed";
      session.finishApply(id, status);
      return status;
    },
  };
}
