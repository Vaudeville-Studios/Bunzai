/** Explicitly scoped, read-only collections catalog. */
import { z } from "zod";
import { STUDIO_ENTITY_KINDS } from "../../../studio/path-policy";
import { bindExtensionOperation, EXTENSION_HOSTS, type ExtensionOperationDefinition } from "../../contracts/operation";
import { decodeJsonValue } from "../../contracts/value";
import { COLLECTION_READ_FIELDS, type CollectionReadField, type ExtensionCollectionServices } from "./_services";
import type { ExtensionOperationServices } from "../_services";

const input = z.strictObject({ scope: z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("library") }),
  z.strictObject({ kind: z.literal("collections"), ids: z.array(z.string().min(1).max(120)).min(1).max(100) }),
]), fields: z.array(z.enum(COLLECTION_READ_FIELDS)).min(1).max(COLLECTION_READ_FIELDS.length), offset: z.number().int().min(0).max(1_000).default(0), limit: z.number().int().min(1).max(10).default(10) });
const row = z.strictObject({ id: z.string().min(1).max(120), name: z.string().max(200).optional(), nameTruncated: z.boolean().optional(), note: z.string().max(1_000).optional(), noteTruncated: z.boolean().optional(), members: z.array(z.strictObject({ kind: z.enum(STUDIO_ENTITY_KINDS), id: z.string().min(1).max(120) })).max(8).optional(), memberCount: z.number().int().nonnegative().optional(), membersTruncated: z.boolean().optional() });
const output = z.strictObject({ collections: z.array(row).max(10), total: z.number().int().nonnegative(), nextOffset: z.number().int().nonnegative().nullable() });
const operation: ExtensionOperationDefinition<z.infer<typeof input>, z.infer<typeof output>, ExtensionCollectionServices | undefined> = {
  metadata: {
    id: "collections.list", version: 1, inputVersion: 1, outputVersion: 1, projectionVersion: 1,
    title: "Read collections", description: "Page collection metadata and members from explicitly approved collection or library scope.", input, output,
    effect: "read", sensitivity: "private", hosts: EXTENSION_HOSTS,
    policy: { resources: ["library", "collection"], fields: [...COLLECTION_READ_FIELDS], methods: [], destinations: [], destinationMode: "none", budget: "read-large", confirmation: "none" },
    estimateBudget: () => ({ bytes: 220_000, tokens: 0 }), measureTokens: () => 0,
    resolveAccess: ({ scope, fields }) => ({ resources: scope.kind === "library" ? [{ kind: "library", id: "library" }] : scope.ids.map((id) => ({ kind: "collection", id })), fields, methods: [], destinations: [] }),
    project: (value) => decodeJsonValue(output.parse(value)),
  },
  execute: async ({ offset, limit }, context, services) => {
    if (!services) throw new Error("collections are unavailable on this host");
    const fields = context.access.fields.filter((field): field is CollectionReadField => COLLECTION_READ_FIELDS.some((allowed) => allowed === field));
    if (!fields.length || fields.length !== context.access.fields.length) throw new Error("collection fields are outside the approved grant");
    return output.parse(await services.list(context.access.resources, fields, offset, limit));
  },
};

export const createOperations = (services: ExtensionOperationServices) => [bindExtensionOperation(operation, services.collections)];
export default operation;
