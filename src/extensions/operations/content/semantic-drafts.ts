/** Generated-style adapters for capabilities that explicitly opt into extension drafts. */
import { z } from "zod";
import { allCapabilities } from "../../../generated/capabilities";
import type { ContentCapability } from "../../../entities/capabilities/types";
import { canonicalEntitySchema, type ParsedCanonicalEntity } from "../../../entities/runtime-schema";
import { bindExtensionOperation, EXTENSION_HOSTS, type ExtensionOperationContext, type ExtensionOperationDefinition, type ExtensionOperationMetadata, type ResourceRef } from "../../contracts/operation";
import { decodeJsonValue, MAX_VALUE_BYTES, type JsonValue } from "../../contracts/value";
import type { ExtensionOperationServices } from "../_services";
import { extensionDraftProjectionSchema, type ExtensionDraftProjection } from "./_draft-services";
import { createDraftApplyOperation } from "./_draft-apply";
import { STUDIO_ENTITY_KINDS } from "../../../studio/path-policy";
import { SHA256_HEX_PATTERN } from "../../../core/sha256";

const draftSchema = extensionDraftProjectionSchema;
const draftOutput = z.strictObject({ draft: draftSchema.nullable() });
const stateInput = z.strictObject({ kind: z.enum(STUDIO_ENTITY_KINDS), id: z.string().min(1).max(120), draftId: z.string().min(1).max(120), fingerprint: z.string().regex(SHA256_HEX_PATTERN).optional() });
const stateOutput = z.strictObject({ status: z.enum(["discarded", "missing", "applied", "stale", "failed"]), kind: z.enum(STUDIO_ENTITY_KINDS), id: z.string().min(1).max(120) });
const stateResult = z.union([draftOutput, stateOutput]);
const createInput = canonicalEntitySchema;
const duplicateInput = z.strictObject({ kind: z.enum(STUDIO_ENTITY_KINDS), id: z.string().min(1).max(120), targetId: z.string().min(1).max(120) });
const atPath = (source: unknown, path: string): unknown => path.split(".").reduce<unknown>((value, key) => typeof value === "object" && value !== null ? (value as Record<string, unknown>)[key] : undefined, source);
const exactResource = (kind: string, id: string): { resources: ResourceRef[]; fields: string[]; methods: []; destinations: [] } => ({ resources: [{ kind, id }], fields: ["draft"], methods: [], destinations: [] });
const draftPrincipal = (context: ExtensionOperationContext) => ({
  storeId: context.principal.storeId, packageId: context.principal.packageId, packageDigest: context.principal.packageDigest,
  policyFingerprint: context.principal.policyFingerprint, apiMajor: context.principal.apiMajor,
  grantRevision: context.principal.grantRevision,
});
function projectDraft(value: ExtensionDraftProjection | null): JsonValue {
  return decodeJsonValue({ draft: value });
}
function createDraftOperation(capability: ContentCapability): ExtensionOperationDefinition<unknown, z.infer<typeof draftOutput>, ExtensionOperationServices> {
  const exposure = capability.extensionExposure!;
  const fields = exposure.fields.map(({ path }) => path);
  const metadata: ExtensionOperationMetadata<unknown, z.infer<typeof draftOutput>> = {
    id: exposure.operationId, version: 1, inputVersion: 1, outputVersion: 1, projectionVersion: 1,
    title: `Preview ${capability.summary}`, description: `Create a reviewed draft using ${capability.id}.`,
    input: capability.input as z.ZodType<unknown>, output: draftOutput, effect: "read", sensitivity: "private", hosts: exposure.hosts,
    policy: { resources: [capability.kind], fields, methods: [], destinationMode: "none", destinations: [], budget: "read-large", confirmation: "none" },
    estimateBudget: () => ({ bytes: fields.some((path) => path.startsWith("body.media.")) ? MAX_VALUE_BYTES : 200_000, tokens: 0 }), measureTokens: () => 0,
    resolveAccess: (args) => {
      const target = atPath(args, "target");
      if (typeof target !== "object" || target === null || typeof (target as { id?: unknown }).id !== "string") return { resources: [], fields: [], methods: [], destinations: [] };
      const requested = exposure.fields.filter(({ input }) => atPath(args, input) !== undefined).map(({ path }) => path);
      return { resources: [{ kind: capability.kind, id: (target as { id: string }).id }], fields: requested, methods: [], destinations: [] };
    },
    project: (value) => projectDraft(draftOutput.parse(value).draft),
  };
  return {
    metadata,
    execute: async (args, context, services) => {
      const target = atPath(args, "target");
      if (typeof target !== "object" || target === null || typeof (target as { id?: unknown }).id !== "string") throw new Error("semantic draft target is invalid");
      const id = (target as { id: string }).id;
      if (!context.access.resources.some((ref) => ref.kind === capability.kind && ref.id === id)) throw new Error("semantic draft target is outside the approved grant");
      const allowed = new Set(context.access.fields);
      if (exposure.fields.some(({ input, path }) => atPath(args, input) !== undefined && !allowed.has(path))) throw new Error("semantic draft fields are outside the approved grant");
      if (!services.drafts) throw new Error("semantic drafts are unavailable on this host");
      return { draft: await services.drafts.preview(draftPrincipal(context), capability, args, context.access.resources) };
    },
  };
}

const draftOperations = allCapabilities.filter((capability) => capability.extensionExposure?.hosts.some((host) => EXTENSION_HOSTS.includes(host))).map(createDraftOperation);
function createStateOperation(action: "inspect" | "discard"): ExtensionOperationDefinition<z.infer<typeof stateInput>, z.infer<typeof stateResult>, ExtensionOperationServices> {
  const inspect = action === "inspect";
  const operation = `content.draft.${action}`;
  const metadata: ExtensionOperationMetadata<z.infer<typeof stateInput>, z.infer<typeof stateResult>> = {
    id: operation, version: 1, inputVersion: 1, outputVersion: 1, projectionVersion: 1,
    title: `${action[0]!.toUpperCase()}${action.slice(1)} content draft`, description: `${action} one draft owned by this package and exact target.`,
    input: stateInput, output: stateResult, effect: "read", sensitivity: "private", hosts: EXTENSION_HOSTS,
    policy: { resources: [...STUDIO_ENTITY_KINDS], fields: ["draft"], methods: [], destinationMode: "none", destinations: [], budget: "read-small", confirmation: "none" },
    estimateBudget: () => ({ bytes: 200_000, tokens: 0 }), measureTokens: () => 0,
    resolveAccess: ({ kind, id }) => exactResource(kind, id),
    project: (value) => decodeJsonValue(value),
  };
  const definition: ExtensionOperationDefinition<z.infer<typeof stateInput>, z.infer<typeof stateResult>, ExtensionOperationServices> = {
    metadata,
    execute: async ({ kind, id, draftId, fingerprint }, context, services) => {
      if (!context.access.resources.some((ref) => ref.kind === kind && ref.id === id) || !context.access.fields.includes("draft")) throw new Error("content draft is outside the approved grant");
      if (!services.drafts) throw new Error("semantic drafts are unavailable on this host");
      if (inspect) {
        const draft = await services.drafts.inspect(draftPrincipal(context), draftId, context.access.resources);
        if (!draft || draft.kind !== kind || draft.targetId !== id || draft.requiredOperations.some((required) => !context.grantedOperations.includes(required))) throw new Error("content draft is unavailable under current grants");
        return stateResult.parse({ draft });
      }
      const status = await services.drafts.discard(draftPrincipal(context), draftId, context.access.resources) ? "discarded" : "missing";
      return stateResult.parse({ status, kind, id });
    },
  };
  return definition;
}

const stateOperations = (["inspect", "discard"] as const).map(createStateOperation);
const createDefinition: ExtensionOperationDefinition<ParsedCanonicalEntity, z.infer<typeof draftOutput>, ExtensionOperationServices> = {
  metadata: { id: "content.create.preview", version: 1, inputVersion: 1, outputVersion: 1, projectionVersion: 1, title: "Preview content creation", description: "Stage one canonical piece for exact-target review before creating it.", input: createInput, output: draftOutput, effect: "read", sensitivity: "private", hosts: EXTENSION_HOSTS,
    policy: { resources: [...STUDIO_ENTITY_KINDS], fields: ["draft"], methods: [], destinations: [], destinationMode: "none", budget: "read-large", confirmation: "none" }, estimateBudget: () => ({ bytes: 200_000, tokens: 0 }), measureTokens: () => 0,
    resolveAccess: ({ kind, id }) => exactResource(kind, id), project: (value) => projectDraft(draftOutput.parse(value).draft) },
    execute: async (entity, context, services) => {
    if (!context.access.resources.some((ref) => ref.kind === entity.kind && ref.id === entity.id) || !context.access.fields.includes("draft")) throw new Error("content create target is outside the approved grant");
    if (!services.drafts) throw new Error("semantic drafts are unavailable on this host");
    return { draft: await services.drafts.create(draftPrincipal(context), entity, context.access.resources) };
  },
};
const duplicateDefinition: ExtensionOperationDefinition<z.infer<typeof duplicateInput>, z.infer<typeof draftOutput>, ExtensionOperationServices> = {
  metadata: { id: "content.duplicate.preview", version: 1, inputVersion: 1, outputVersion: 1, projectionVersion: 1, title: "Preview content duplication", description: "Stage a canonical copy under an exact requested ID before creation.", input: duplicateInput, output: draftOutput, effect: "read", sensitivity: "private", hosts: EXTENSION_HOSTS,
    policy: { resources: [...STUDIO_ENTITY_KINDS], fields: ["draft"], methods: [], destinations: [], destinationMode: "none", budget: "read-large", confirmation: "none" }, estimateBudget: () => ({ bytes: 200_000, tokens: 0 }), measureTokens: () => 0,
    resolveAccess: ({ kind, id, targetId }) => ({ resources: [{ kind, id }, { kind, id: targetId }], fields: ["draft"], methods: [], destinations: [] }), project: (value) => projectDraft(draftOutput.parse(value).draft) },
  execute: async ({ kind, id, targetId }, context, services) => {
    if (!context.access.resources.some((ref) => ref.kind === kind && ref.id === id) || !context.access.resources.some((ref) => ref.kind === kind && ref.id === targetId) || !context.access.fields.includes("draft")) throw new Error("content duplicate resources are outside the approved grant");
    if (!services.drafts) throw new Error("semantic drafts are unavailable on this host");
    return { draft: await services.drafts.duplicate(draftPrincipal(context), kind, id, targetId, context.access.resources) };
  },
};
export const semanticDraftOperations = [...draftOperations, createDefinition, duplicateDefinition, createDraftApplyOperation(), ...stateOperations] as const;
export const createOperations = (services: ExtensionOperationServices) => semanticDraftOperations.map((item) => bindExtensionOperation(item as ExtensionOperationDefinition<unknown, unknown, ExtensionOperationServices>, services));
export default semanticDraftOperations;
