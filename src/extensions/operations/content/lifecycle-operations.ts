/** Revision-checked content trash and grave restoration operations. */
import { z } from "zod";
import { bindExtensionOperation, EXTENSION_HOSTS, type ExtensionOperationDefinition, type ExtensionOperationMetadata, type ResourceRef } from "../../contracts/operation";
import type { ContentKind } from "../../../entities/capabilities/types";
import { STUDIO_ENTITY_KINDS } from "../../../studio/path-policy";
import type { ExtensionOperationServices } from "../_services";
import { contentKindSchema, projectSummary, safeSummarySchema } from "./_summary";

const input = z.strictObject({ kind: contentKindSchema, id: z.string().min(1).max(120), expectedRevision: z.string().min(1).max(200) });
const output = z.strictObject({ status: z.enum(["trashed", "stale"]), kind: contentKindSchema, id: z.string().min(1).max(120) });
const restoreInput = z.strictObject({ kind: contentKindSchema, id: z.string().min(1).max(120), graveId: z.string().min(1).max(160) });
const restoreOutput = z.strictObject({ status: z.enum(["restored", "missing"]), piece: safeSummarySchema.nullable() });
const metadata: ExtensionOperationMetadata<z.infer<typeof input>, z.infer<typeof output>> = {
  id: "content.trash", version: 1, inputVersion: 1, outputVersion: 1, projectionVersion: 1,
  title: "Move content to Trash", description: "Move one exactly granted piece to Trash if its revision still matches.",
  input, output, effect: "write", sensitivity: "private", hosts: EXTENSION_HOSTS,
  policy: { resources: [...STUDIO_ENTITY_KINDS], fields: ["lifecycle"], destinationMode: "none", destinations: [], methods: [], budget: "write", confirmation: "effect" },
  estimateBudget: () => ({ bytes: 2_000, tokens: 0 }), measureTokens: () => 0,
  receiptStatus: (value) => value.status === "trashed" ? "committed" : "conflicted",
  resolveAccess: ({ kind, id }) => ({ resources: [{ kind, id }], fields: ["lifecycle"], methods: [], destinations: [] }), project: (value) => value,
};
const definition: ExtensionOperationDefinition<z.infer<typeof input>, z.infer<typeof output>, ExtensionOperationServices> = {
  metadata,
  review: async ({ kind, id, expectedRevision }, context) => ({ target: { kind, id }, expectedRevision, action: "move-to-trash", onlyIfRevisionMatches: true, approved: context.access.resources.some((ref) => ref.kind === kind && ref.id === id) }),
  execute: async ({ kind, id, expectedRevision }, context, { content }) => {
    const target: ResourceRef = { kind, id };
    if (!context.access.resources.some((ref) => ref.kind === target.kind && ref.id === target.id) || !context.access.fields.includes("lifecycle")) throw new Error("content lifecycle access is outside the approved grant");
    return { status: await content.trash(kind as ContentKind, id, expectedRevision, context.access.resources, context.commit) ? "trashed" : "stale", kind, id };
  },
};
const restoreMetadata: ExtensionOperationMetadata<z.infer<typeof restoreInput>, z.infer<typeof restoreOutput>> = {
  id: "content.restore", version: 1, inputVersion: 1, outputVersion: 1, projectionVersion: 1,
  title: "Restore content from Trash", description: "Restore one selected grave under its retired ID.",
  input: restoreInput, output: restoreOutput, effect: "write", sensitivity: "private", hosts: EXTENSION_HOSTS,
  policy: metadata.policy, measureTokens: () => 0,
  receiptStatus: (value) => value.status === "restored" ? "committed" : "conflicted",
  estimateBudget: () => ({ bytes: 3_000, tokens: 0 }),
  resolveAccess: ({ kind, id }) => ({ resources: [{ kind, id }], fields: ["lifecycle"], methods: [], destinations: [] }),
  project: ({ status, piece }) => ({ status, piece: piece ? projectSummary(piece, ["id", "kind", "name"]) : null }),
};
const restoreDefinition: ExtensionOperationDefinition<z.infer<typeof restoreInput>, z.infer<typeof restoreOutput>, ExtensionOperationServices> = {
  metadata: restoreMetadata,
  review: async ({ kind, id, graveId }, context, { content }) => {
    const authorized = context.access.resources.some((ref) => ref.kind === kind && ref.id === id);
    const grave = authorized ? await content.readGrave(kind as ContentKind, id, graveId, context.access.resources) : null;
    return { target: { kind, id }, graveId, name: grave?.name ?? null, deletedAt: grave?.deletedAt ?? null, action: "restore-retired-id", available: grave !== null };
  },
  execute: async ({ kind, id, graveId }, context, { content }) => {
    const authorized = context.access.resources.some((ref) => ref.kind === kind && ref.id === id) && context.access.fields.includes("lifecycle");
    if (!authorized) throw new Error("content restore is outside the approved grant");
    const restored = await content.restore(kind as ContentKind, id, graveId, context.access.resources, context.commit);
    return { status: restored ? "restored" : "missing", piece: restored ? projectSummary(restored, ["id", "kind", "name"]) : null };
  },
};
export const contentLifecycleOperations = [definition, restoreDefinition] as const;
export const createOperations = (services: ExtensionOperationServices) => contentLifecycleOperations.map((item) => bindExtensionOperation(
  item as ExtensionOperationDefinition<unknown, unknown, ExtensionOperationServices>, services,
));
export default contentLifecycleOperations;
