/** Exact-scope collection reads and revision-fenced create/membership writes. */
import { z } from "zod";
import { STUDIO_ENTITY_KINDS, type StudioEntityKind } from "../../../studio/path-policy";
import type { CollectionEdit } from "../../../studio/collections-shape";
import { bindExtensionDefinitions, EXTENSION_HOSTS, type ExtensionOperationContext, type ExtensionOperationDefinition, type ExtensionOperationMetadata, type ResourceRef } from "../../contracts/operation";
import { decodeJsonValue } from "../../contracts/value";
import type { ExtensionOperationServices } from "../_services";
import { COLLECTION_READ_FIELDS, type CollectionReadField } from "./_services";

const collection = z.strictObject({
  id: z.string().min(1).max(120), name: z.string().max(200).optional(), nameTruncated: z.boolean().optional(),
  note: z.string().max(1_000).optional(), noteTruncated: z.boolean().optional(),
  members: z.array(z.strictObject({ kind: z.enum(STUDIO_ENTITY_KINDS), id: z.string().min(1).max(120) })).max(8).optional(),
  memberCount: z.number().int().nonnegative().optional(), membersTruncated: z.boolean().optional(),
});
const emptyAccess = () => ({ resources: [], fields: [], methods: [], destinations: [] });
const fieldScope = (fields: readonly string[]): CollectionReadField[] => {
  const selected = fields.filter((field): field is CollectionReadField => COLLECTION_READ_FIELDS.some((allowed) => allowed === field));
  if (selected.length !== fields.length || !selected.length) throw new Error("collection fields are outside the approved grant");
  return selected;
};
const hasResource = (scope: readonly ResourceRef[], expected: ResourceRef): boolean => scope.some((ref) => ref.kind === expected.kind && ref.id === expected.id);
const contentRef = (kind: StudioEntityKind, id: string): ResourceRef => ({ kind, id });
const policy = (resources: string[], fields: string[], effect: "read" | "write", confirmation: "none" | "effect") => ({
  resources, fields, methods: [], destinations: [], destinationMode: "none" as const,
  budget: effect === "write" ? "write" as const : "read-small" as const, confirmation,
});

const readInput = z.strictObject({ id: z.string().min(1).max(120), fields: z.array(z.enum(COLLECTION_READ_FIELDS)).min(1).max(COLLECTION_READ_FIELDS.length) });
const readOutput = z.strictObject({ collection: collection.nullable(), revision: z.number().int().nonnegative() });
type ReadInput = z.infer<typeof readInput>;
type ReadOutput = z.infer<typeof readOutput>;
const readMetadata: ExtensionOperationMetadata<ReadInput, ReadOutput> = {
  id: "collections.read", version: 1, inputVersion: 1, outputVersion: 1, projectionVersion: 1,
  title: "Read one collection", description: "Read selected collection fields under an exact collection grant.",
  input: readInput, output: readOutput, effect: "read", sensitivity: "private", hosts: EXTENSION_HOSTS,
  policy: policy(["collection"], [...COLLECTION_READ_FIELDS], "read", "none"), estimateBudget: () => ({ bytes: 16_000, tokens: 0 }), measureTokens: () => 0,
  resolveAccess: ({ id, fields }) => ({ resources: [{ kind: "collection", id }], fields, methods: [], destinations: [] }),
  project: (value) => decodeJsonValue(readOutput.parse(value)),
};
const readDefinition: ExtensionOperationDefinition<ReadInput, ReadOutput, ExtensionOperationServices> = {
  metadata: readMetadata,
  execute: async ({ id, fields }, context, services) => {
    if (!services.collections || !hasResource(context.access.resources, { kind: "collection", id })) throw new Error("collection access is outside the approved grant");
    return readOutput.parse(await services.collections.readOne(context.access.resources, id, fieldScope(context.access.fields)));
  },
};

const createInput = z.strictObject({ name: z.string().min(1).max(200), note: z.string().max(1_000).optional(), expectedRevision: z.number().int().min(-1) });
const createOutput = z.strictObject({ status: z.enum(["created", "stale"]), id: z.string().min(1).max(120).nullable(), revision: z.number().int().nonnegative().nullable() });
const createReview = z.strictObject({ action: z.literal("create-collection"), name: z.string().max(200), note: z.string().max(1_000).nullable(), id: z.string().max(120).nullable(), expectedRevision: z.number().int().min(-1), available: z.boolean() });
type CreateInput = z.infer<typeof createInput>;
type CreateOutput = z.infer<typeof createOutput>;
const createMetadata: ExtensionOperationMetadata<CreateInput, CreateOutput> = {
  id: "collections.create", version: 1, inputVersion: 1, outputVersion: 1, projectionVersion: 1,
  title: "Create a collection", description: "Create one collection only if the collections revision remains unchanged.",
  input: createInput, output: createOutput, effect: "write", sensitivity: "private", hosts: EXTENSION_HOSTS,
  policy: policy(["library"], ["collection.create"], "write", "effect"), estimateBudget: () => ({ bytes: 3_000, tokens: 0 }), measureTokens: () => 0,
  receiptStatus: (value) => value.status === "created" ? "committed" : "conflicted",
  resolveAccess: () => ({ resources: [{ kind: "library", id: "library" }], fields: ["collection.create"], methods: [], destinations: [] }),
  project: (value) => decodeJsonValue(createOutput.parse(value)),
};
const createDefinition: ExtensionOperationDefinition<CreateInput, CreateOutput, ExtensionOperationServices> = {
  metadata: createMetadata,
  review: async ({ name, note, expectedRevision }, context, services) => {
    if (!hasResource(context.access.resources, { kind: "library", id: "library" }) || !context.access.fields.includes("collection.create") || !services.collections) throw new Error("collection creation is outside the approved grant");
    const result = await services.collections.previewCreate(name, note, expectedRevision);
    return createReview.parse({ action: "create-collection", name, note: note ?? null, id: result.id, expectedRevision, available: result.id !== null });
  },
  execute: async ({ name, note, expectedRevision }, context, services) => {
    if (!hasResource(context.access.resources, { kind: "library", id: "library" }) || !context.access.fields.includes("collection.create") || !services.collections) throw new Error("collection creation is outside the approved grant");
    const result = await services.collections.create(name, note, expectedRevision, context.commit);
    return createOutput.parse({ status: result.status === "saved" ? "created" : "stale", id: result.status === "saved" ? result.id ?? null : null, revision: result.status === "saved" ? result.revision : null });
  },
};

const membershipInput = z.strictObject({ id: z.string().min(1).max(120), action: z.enum(["add", "remove"]), kind: z.enum(STUDIO_ENTITY_KINDS), refId: z.string().min(1).max(120), expectedRevision: z.number().int().min(-1) });
const membershipOutput = z.strictObject({ status: z.enum(["ready", "stale", "missing"]), id: z.string().min(1).max(120), action: z.enum(["add", "remove"]), ref: z.strictObject({ kind: z.enum(STUDIO_ENTITY_KINDS), id: z.string().min(1).max(120) }), member: z.boolean().nullable(), revision: z.number().int().nonnegative() });
type MembershipInput = z.infer<typeof membershipInput>;
type MembershipOutput = z.infer<typeof membershipOutput>;
const edit = (args: MembershipInput): Extract<CollectionEdit, { action: "add" | "remove" }> => ({ action: args.action, id: args.id, ref: { kind: args.kind, id: args.refId } });
const resolveMembership = ({ id, kind, refId }: MembershipInput) => ({ resources: [{ kind: "collection", id }, contentRef(kind, refId)], fields: ["collection.members"], methods: [], destinations: [] });
const memberProjection = (action: MembershipInput["action"], id: string, kind: MembershipInput["kind"], refId: string, expectedRevision: number, result: { collection: { id: string } | null; revision: number; member: boolean | null }): MembershipOutput => membershipOutput.parse({ status: result.revision !== expectedRevision ? "stale" : result.collection ? "ready" : "missing", id, action, ref: { kind, id: refId }, member: result.member, revision: result.revision });
function membershipOperation(id: "collections.membership.preview" | "collections.membership.apply", effect: "read" | "write"): ExtensionOperationDefinition<MembershipInput, MembershipOutput, ExtensionOperationServices> {
  const output = membershipOutput;
  const operationPolicy = policy(["collection", ...STUDIO_ENTITY_KINDS], ["collection.members"], effect, effect === "write" ? "effect" : "none");
  const metadata: ExtensionOperationMetadata<MembershipInput, MembershipOutput> = {
    id, version: 1, inputVersion: 1, outputVersion: 1, projectionVersion: 1,
    title: effect === "read" ? "Preview collection membership" : "Apply collection membership",
    description: "Preview or apply one exact collection and piece membership change at a revisioned commit fence.",
    input: membershipInput, output, effect, sensitivity: "private", hosts: EXTENSION_HOSTS,
    policy: operationPolicy, estimateBudget: () => ({ bytes: 8_000, tokens: 0 }), measureTokens: () => 0,
    ...(effect === "write" ? { receiptStatus: (value: MembershipOutput) => value.status === "stale" || value.status === "missing" ? "conflicted" as const : "committed" as const } : {}),
    resolveAccess: resolveMembership, project: (value) => decodeJsonValue(output.parse(value)),
  };
  const checkAccess = (args: MembershipInput, context: ExtensionOperationContext, services: ExtensionOperationServices) => {
    const resources = resolveMembership(args).resources;
    if (!services.collections || !context.access.fields.includes("collection.members") || resources.some((ref) => !hasResource(context.access.resources, ref))) throw new Error("collection membership is outside the approved grant");
    return edit(args);
  };
  return {
    metadata,
    ...(effect === "write" ? { review: async (args, context, services) => {
      const editValue = checkAccess(args, context, services);
      return memberProjection(args.action, args.id, args.kind, args.refId, args.expectedRevision, await services.collections!.previewMembership(editValue, args.expectedRevision));
    } } : {}),
    execute: async (args, context, services) => {
      const editValue = checkAccess(args, context, services);
      if (effect === "read") return memberProjection(args.action, args.id, args.kind, args.refId, args.expectedRevision, await services.collections!.previewMembership(editValue, args.expectedRevision));
      const result = await services.collections!.membership(editValue, args.expectedRevision, context.commit);
      return output.parse({ status: result.status === "saved" ? "ready" : "stale", id: args.id, action: args.action, ref: { kind: args.kind, id: args.refId }, member: result.status === "saved" ? result.member ?? null : null, revision: result.status === "saved" ? result.revision : args.expectedRevision });
    },
  };
}

export const collectionReadWriteOperations = [readDefinition, createDefinition, membershipOperation("collections.membership.preview", "read"), membershipOperation("collections.membership.apply", "write")] as const;
export const createOperations = (services: ExtensionOperationServices) => bindExtensionDefinitions(collectionReadWriteOperations, services);
export default collectionReadWriteOperations;
