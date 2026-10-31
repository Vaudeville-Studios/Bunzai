/** Read/search/list bounded summary projections through the filtered content service port. */
import { z } from "zod";
import { bindExtensionOperation, EXTENSION_HOSTS, PROMPT_SAFE_READ_ORIGINS, type ExtensionOperationDefinition, type ExtensionOperationMetadata, type HostFeature, type ResourceRef } from "../../contracts/operation";
import type { ExtensionContentServices } from "../../contracts/operation";
import type { ContentKind } from "../../../entities/capabilities/types";
import type { ExtensionOperationServices } from "../_services";
import { contentKindSchema, projectSummary, safeSummarySchema, summaryFieldsSchema } from "./_summary";
import { STUDIO_ENTITY_KINDS } from "../../../studio/path-policy";

const selectedResourceSchema = z.array(z.strictObject({ kind: contentKindSchema, id: z.string().min(1).max(120) })).min(1).max(50)
  .refine((resources) => new Set(resources.map(({ kind, id }) => `${kind}:${id}`)).size === resources.length);
const scopeSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("library") }),
  z.strictObject({ type: z.literal("selected"), resources: selectedResourceSchema }),
  z.strictObject({ type: z.literal("invocation") }),
]);
const common = {
  scope: scopeSchema,
  kinds: z.array(contentKindSchema).min(1).max(STUDIO_ENTITY_KINDS.length).optional(),
  fields: summaryFieldsSchema,
  limit: z.number().int().min(1).max(50).optional(),
};
const listInput = z.strictObject(common);
const searchInput = z.strictObject({ ...common, query: z.string().trim().min(1).max(200) });
const readInput = z.strictObject({ kind: contentKindSchema, id: z.string().min(1).max(120), fields: summaryFieldsSchema });
const rowsOutput = z.array(safeSummarySchema).max(50);
const readOutput = safeSummarySchema.nullable();
const fieldPolicy = ["id", "kind", "name", "updatedAt", "tags", "description"] as const;
const policy = (resources: readonly string[]) => ({
  resources,
  fields: fieldPolicy,
  destinations: [],
  methods: [] as const,
  destinationMode: "none" as const,
  budget: "read-small" as const,
  confirmation: "none" as const,
});
const metadata = <I, O>(value: Omit<ExtensionOperationMetadata<I, O>, "execute">): ExtensionOperationMetadata<I, O> => value;
const checkFields = (requested: readonly string[], context: { access: { fields: readonly string[] } }): readonly string[] => {
  if (requested.some((field) => !context.access.fields.includes(field))) {
    throw new Error("requested summary fields are outside the approved grant");
  }
  return requested;
};
const kindFilter = (requested?: readonly ContentKind[]): readonly ContentKind[] => requested ?? STUDIO_ENTITY_KINDS;
const scopeFor = (scope: z.infer<typeof scopeSchema>): readonly ResourceRef[] => scope.type === "library"
  ? [{ kind: "library", id: "library" }]
  : scope.type === "selected" ? scope.resources : [];
const verifyScope = (requested: readonly ResourceRef[], access: readonly ResourceRef[]): void => {
  const libraryRequest = requested.length === 0;
  const valid = libraryRequest
    ? access.every((allowed) => allowed.kind === "library" && allowed.id === "library"
      || STUDIO_ENTITY_KINDS.includes(allowed.kind as typeof STUDIO_ENTITY_KINDS[number]) && allowed.id.length > 0)
    : access.every((allowed) => requested.some((item) => item.kind === allowed.kind && item.id === allowed.id));
  if (!valid) {
    throw new Error("requested content scope is outside the approved grant");
  }
};
const hosts: readonly HostFeature[] = EXTENSION_HOSTS;

const listDefinition: ExtensionOperationDefinition<z.infer<typeof listInput>, z.infer<typeof rowsOutput>, ExtensionContentServices> = {
  metadata: metadata({
    id: "content.list", version: 1, inputVersion: 1, outputVersion: 1, projectionVersion: 1,
    title: "List content summaries", description: "List bounded summaries inside an approved library, explicit pieces, or this invocation's grant-filtered focused pieces.",
    input: listInput, output: rowsOutput, effect: "read", sensitivity: "private", hosts,
    policy: policy(["library", ...STUDIO_ENTITY_KINDS]),
    estimateBudget: ({ limit }) => ({ bytes: Math.min(256_000, (limit ?? 20) * 2_500), tokens: 0 }),
    measureTokens: () => 0,
    resolveAccess: ({ scope, fields }) => ({ resources: scopeFor(scope), fields, methods: [], destinations: [] }),
    project: (rows, _principal, access) => rows.map((row) => projectSummary(row, access.fields as (typeof fieldPolicy[number])[])),
  }),
  execute: async ({ scope, kinds, fields, limit }, context, services) => {
    const resources = scopeFor(scope);
    verifyScope(resources, context.access.resources);
    const selectedFields = checkFields(fields, context);
    const result = await services.listSummaries(context.access.resources, kindFilter(kinds), limit ?? 20, selectedFields);
    return result.map((row) => projectSummary(row, selectedFields as (typeof fieldPolicy[number])[]));
  },
};

const searchDefinition: ExtensionOperationDefinition<z.infer<typeof searchInput>, z.infer<typeof rowsOutput>, ExtensionContentServices> = {
  metadata: metadata({
    id: "content.search", version: 1, inputVersion: 1, outputVersion: 1, projectionVersion: 1,
    title: "Search content summaries", description: "Search approved summaries after enforcing the granted library, explicit-piece, or invocation scope.",
    input: searchInput, output: rowsOutput, effect: "read", sensitivity: "private", hosts,
    policy: policy(["library", ...STUDIO_ENTITY_KINDS]),
    estimateBudget: ({ limit }) => ({ bytes: Math.min(256_000, (limit ?? 20) * 2_500), tokens: 0 }),
    measureTokens: () => 0,
    resolveAccess: ({ scope, fields }) => ({ resources: scopeFor(scope), fields, methods: [], destinations: [] }),
    project: (rows, _principal, access) => rows.map((row) => projectSummary(row, access.fields as (typeof fieldPolicy[number])[])),
  }),
  execute: async ({ scope, kinds, fields, limit, query }, context, services) => {
    const resources = scopeFor(scope);
    verifyScope(resources, context.access.resources);
    const selectedFields = checkFields(fields, context);
    const result = await services.searchSummaries(query, context.access.resources, kindFilter(kinds), limit ?? 20, selectedFields);
    return result.map((row) => projectSummary(row, selectedFields as (typeof fieldPolicy[number])[]));
  },
};

const readDefinition: ExtensionOperationDefinition<z.infer<typeof readInput>, z.infer<typeof readOutput>, ExtensionContentServices> = {
  metadata: metadata({
    id: "content.summary", version: 1, inputVersion: 1, outputVersion: 1, projectionVersion: 1,
    title: "Read a content summary", description: "Read only selected summary fields for one approved piece.",
    input: readInput, output: readOutput, effect: "read", sensitivity: "private", hosts, activationOrigins: PROMPT_SAFE_READ_ORIGINS,
    policy: policy(STUDIO_ENTITY_KINDS),
    estimateBudget: () => ({ bytes: 2_500, tokens: 0 }),
    measureTokens: () => 0,
    resolveAccess: ({ kind, id, fields }) => ({ resources: [{ kind, id }], fields, methods: [], destinations: [] }),
    project: (row, _principal, access) => row ? projectSummary(row, access.fields as (typeof fieldPolicy[number])[]) : null,
  }),
  execute: async ({ kind, id, fields }, context, services) => {
    const resource = { kind, id };
    verifyScope([resource], context.access.resources);
    const selectedFields = checkFields(fields, context);
    const result = await services.readSummary(kind, id, context.access.resources, selectedFields);
    return result ? projectSummary(result, selectedFields as (typeof fieldPolicy[number])[]) : null;
  },
};

export const contentSummaryOperations = [listDefinition, searchDefinition, readDefinition] as const;
export const createOperations = (services: ExtensionOperationServices) =>
  contentSummaryOperations.map((definition) => bindExtensionOperation(
    definition as ExtensionOperationDefinition<unknown, unknown, ExtensionContentServices>, services.content,
  ));
export default contentSummaryOperations;
