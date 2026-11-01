/** Read-only scene, take and transcript operations over canonical ChatStore projections. */
import { z } from "zod";
import { bindExtensionDefinitions, EXTENSION_HOSTS, type ExtensionOperationDefinition, type ExtensionOperationMetadata, type ResourceRef } from "../../contracts/operation";
import { decodeJsonValue, MAX_VALUE_BYTES } from "../../contracts/value";
import type { ExtensionOperationServices } from "../_services";
import type { ExtensionSceneServices } from "./_services";
import { messageFieldsSchema, messageSchema, sceneDetailFieldSchema, sceneDetailFields, sceneDetailSchema, sceneIdSchema, sceneResourceSchema, sceneScopeSchema, sceneSummarySchema, takeSummarySchema } from "./_schemas";

const empty = { methods: [] as const, destinations: [] as const, destinationMode: "none" as const, budget: "read-small" as const, confirmation: "none" as const };
const readPolicy = (resources: readonly string[], fields: readonly string[] = []) => ({ ...empty, resources, fields });
const metadata = <I, O>(item: Omit<ExtensionOperationMetadata<I, O>, "execute">): ExtensionOperationMetadata<I, O> => item;
const scopeInput = z.strictObject({ scope: sceneScopeSchema, limit: z.number().int().min(1).max(50).default(20) });
const readSceneInput = z.strictObject({ sceneId: sceneIdSchema });
const readSceneDetailsInput = z.strictObject({ sceneId: sceneIdSchema, fields: z.array(sceneDetailFieldSchema).min(1).max(sceneDetailFields.length).refine((fields) => new Set(fields).size === fields.length) });
const takeInput = z.strictObject({ sceneId: sceneIdSchema, takeId: sceneIdSchema });
const messagesInput = z.strictObject({ sceneId: sceneIdSchema, takeId: sceneIdSchema, fromSeq: z.number().int().nonnegative().optional(), limit: z.number().int().min(1).max(50).default(20), fields: messageFieldsSchema });
const messageInput = z.strictObject({ sceneId: sceneIdSchema, takeId: sceneIdSchema, seq: z.number().int().nonnegative(), fields: messageFieldsSchema });
const versionsInput = z.strictObject({ sceneId: sceneIdSchema, takeId: sceneIdSchema, seq: z.number().int().nonnegative(), fromIndex: z.number().int().nonnegative().default(0) });
const listOutput = z.array(sceneSummarySchema).max(50);
const takeListOutput = z.array(takeSummarySchema).max(50);
export const messagePageOutput = z.strictObject({ messages: z.array(messageSchema).max(50), nextSeq: z.number().int().nonnegative().nullable(), branchVersion: z.number().int().nonnegative().nullable() });
export const versionOutput = z.strictObject({ versions: z.array(z.strictObject({ index: z.number().int().nonnegative(), content: z.string().max(3_000), contentTruncated: z.boolean(), createdAt: z.number().int().nonnegative(), pinned: z.boolean() })).max(32), nextIndex: z.number().int().nonnegative().nullable() });
const noAccess = () => ({ resources: [], fields: [], methods: [], destinations: [] });
const requestScope = (scope: z.infer<typeof sceneScopeSchema>): readonly ResourceRef[] => scope.type === "library" ? [{ kind: "library", id: "library" }] : scope.resources;
const uniqueResources = (resources: readonly ResourceRef[]): ResourceRef[] => [...new Map(resources.map((resource) => [`${resource.kind}:${resource.id}`, resource])).values()];
function assertScope(requested: readonly ResourceRef[], approved: readonly ResourceRef[]): void {
  if (requested.some((resource) => !approved.some((item) => item.kind === resource.kind && item.id === resource.id))) throw new Error("scene scope is outside the approved grant");
}
function assertFields(requested: readonly string[], approved: readonly string[]): void {
  if (requested.some((field) => !approved.includes(field))) throw new Error("message fields are outside the approved grant");
}
function parse<T>(schema: z.ZodType<T>, value: unknown): T { return schema.parse(decodeJsonValue(value)); }
const sceneList: ExtensionOperationDefinition<z.infer<typeof scopeInput>, z.infer<typeof listOutput>, ExtensionSceneServices> = {
  metadata: metadata({ id: "scenes.list", version: 1, inputVersion: 1, outputVersion: 1, projectionVersion: 1, title: "List scenes", description: "List bounded scene summaries inside an explicitly approved scene or library scope.",
    input: scopeInput, output: listOutput, effect: "read", sensitivity: "private", hosts: EXTENSION_HOSTS, policy: readPolicy(["library", "scene"]),
    estimateBudget: () => ({ bytes: MAX_VALUE_BYTES, tokens: 0 }), measureTokens: () => 0,
    resolveAccess: ({ scope }) => ({ resources: requestScope(scope), fields: [], methods: [], destinations: [] }),
    project: (rows) => rows.map((row) => parse(sceneSummarySchema, row)) }),
  execute: async ({ scope, limit }, context, services) => { const requested = requestScope(scope); assertScope(requested, context.access.resources); return (await services.list(context.access.resources, limit)).map((row) => parse(sceneSummarySchema, row)); },
};
const sceneRead: ExtensionOperationDefinition<z.infer<typeof readSceneInput>, z.infer<typeof sceneSummarySchema> | null, ExtensionSceneServices> = {
  metadata: metadata({ id: "scenes.summary", version: 1, inputVersion: 1, outputVersion: 1, projectionVersion: 1, title: "Read a scene summary", description: "Read the safe summary of one approved scene without provider credentials or private runtime state.",
    input: readSceneInput, output: sceneSummarySchema.nullable(), effect: "read", sensitivity: "private", hosts: EXTENSION_HOSTS, policy: readPolicy(["scene"]),
    estimateBudget: () => ({ bytes: 8_000, tokens: 0 }), measureTokens: () => 0,
    resolveAccess: ({ sceneId }) => ({ resources: [{ kind: "scene", id: sceneId }], fields: [], methods: [], destinations: [] }),
    project: (value) => value === null ? null : parse(sceneSummarySchema, value) }),
  execute: async ({ sceneId }, context, services) => { assertScope([{ kind: "scene", id: sceneId }], context.access.resources); const value = await services.read(sceneId, context.access.resources); return value === null ? null : parse(sceneSummarySchema, value); },
};
const sceneDetails: ExtensionOperationDefinition<z.infer<typeof readSceneDetailsInput>, z.infer<typeof sceneDetailSchema> | null, ExtensionSceneServices> = {
  metadata: metadata({ id: "scenes.read", version: 1, inputVersion: 1, outputVersion: 1, projectionVersion: 1, title: "Read scene details", description: "Read explicitly selected, non-secret settings for one approved scene.",
    input: readSceneDetailsInput, output: sceneDetailSchema.nullable(), effect: "read", sensitivity: "private", hosts: EXTENSION_HOSTS, policy: readPolicy(["scene"], sceneDetailFields),
    estimateBudget: () => ({ bytes: 8_000, tokens: 0 }), measureTokens: () => 0,
    resolveAccess: ({ sceneId, fields }) => ({ resources: [{ kind: "scene", id: sceneId }], fields, methods: [], destinations: [] }),
    project: (value) => value === null ? null : parse(sceneDetailSchema, value) }),
  execute: async ({ sceneId, fields }, context, services) => {
    assertScope([{ kind: "scene", id: sceneId }], context.access.resources);
    assertFields(fields, context.access.fields);
    const value = await services.readDetails(sceneId, context.access.resources, fields);
    return value === null ? null : parse(sceneDetailSchema, value);
  },
};
const takeList: ExtensionOperationDefinition<z.infer<typeof scopeInput> & { sceneId: string }, z.infer<typeof takeListOutput>, ExtensionSceneServices> = {
  metadata: metadata({ id: "takes.list", version: 1, inputVersion: 1, outputVersion: 1, projectionVersion: 1, title: "List takes", description: "List the bounded take tree for one approved scene.",
    input: scopeInput.extend({ sceneId: sceneIdSchema }), output: takeListOutput, effect: "read", sensitivity: "private", hosts: EXTENSION_HOSTS, policy: readPolicy(["library", "scene", "take"]),
    estimateBudget: () => ({ bytes: MAX_VALUE_BYTES, tokens: 0 }), measureTokens: () => 0,
    resolveAccess: ({ scope, sceneId }) => ({ resources: uniqueResources([...requestScope(scope), { kind: "scene", id: sceneId }]), fields: [], methods: [], destinations: [] }),
    project: (rows) => rows.map((row) => parse(takeSummarySchema, row)) }),
  execute: async ({ scope, sceneId, limit }, context, services) => { const requested = [...requestScope(scope), { kind: "scene", id: sceneId }]; assertScope(requested, context.access.resources); return (await services.listTakes(sceneId, context.access.resources, limit)).map((row) => parse(takeSummarySchema, row)); },
};
const takeRead: ExtensionOperationDefinition<z.infer<typeof takeInput>, z.infer<typeof takeSummarySchema> | null, ExtensionSceneServices> = {
  metadata: metadata({ id: "takes.read", version: 1, inputVersion: 1, outputVersion: 1, projectionVersion: 1, title: "Read a take", description: "Read the safe metadata for one approved take.",
    input: takeInput, output: takeSummarySchema.nullable(), effect: "read", sensitivity: "private", hosts: EXTENSION_HOSTS, policy: readPolicy(["scene", "take"]),
    estimateBudget: () => ({ bytes: 4_000, tokens: 0 }), measureTokens: () => 0,
    resolveAccess: ({ sceneId, takeId }) => ({ resources: [{ kind: "scene", id: sceneId }, { kind: "take", id: takeId }], fields: [], methods: [], destinations: [] }),
    project: (value) => value === null ? null : parse(takeSummarySchema, value) }),
  execute: async ({ sceneId, takeId }, context, services) => { assertScope([{ kind: "scene", id: sceneId }, { kind: "take", id: takeId }], context.access.resources); const value = await services.readTake(sceneId, takeId, context.access.resources); return value === null ? null : parse(takeSummarySchema, value); },
};
const messageList: ExtensionOperationDefinition<z.infer<typeof messagesInput>, z.infer<typeof messagePageOutput>, ExtensionSceneServices> = {
  metadata: metadata({ id: "messages.list", version: 1, inputVersion: 1, outputVersion: 1, projectionVersion: 1, title: "List messages", description: "Read a bounded chronological page from one approved take.",
    input: messagesInput, output: messagePageOutput, effect: "read", sensitivity: "private", hosts: EXTENSION_HOSTS, policy: readPolicy(["scene", "take"], ["message.seq", "message.id", "message.role", "message.createdAt", "message.hidden", "message.content"]),
    estimateBudget: () => ({ bytes: MAX_VALUE_BYTES, tokens: 0 }), measureTokens: () => 0,
    resolveAccess: ({ sceneId, takeId, fields }) => ({ resources: [{ kind: "scene", id: sceneId }, { kind: "take", id: takeId }], fields, methods: [], destinations: [] }),
    project: (value) => parse(messagePageOutput, value) }),
  execute: async ({ sceneId, takeId, fromSeq, limit, fields }, context, services) => { assertScope([{ kind: "scene", id: sceneId }, { kind: "take", id: takeId }], context.access.resources); assertFields(fields, context.access.fields); return parse(messagePageOutput, await services.listMessages(sceneId, takeId, fromSeq, limit, context.access.resources, fields)); },
};
const messageRead: ExtensionOperationDefinition<z.infer<typeof messageInput>, z.infer<typeof messageSchema> | null, ExtensionSceneServices> = {
  metadata: metadata({ id: "messages.read", version: 1, inputVersion: 1, outputVersion: 1, projectionVersion: 1, title: "Read a message", description: "Read one selected message version inside an approved take.",
    input: messageInput, output: messageSchema.nullable(), effect: "read", sensitivity: "private", hosts: EXTENSION_HOSTS, policy: readPolicy(["scene", "take"], ["message.seq", "message.id", "message.role", "message.createdAt", "message.hidden", "message.content"]),
    estimateBudget: () => ({ bytes: 24_000, tokens: 0 }), measureTokens: () => 0,
    resolveAccess: ({ sceneId, takeId, fields }) => ({ resources: [{ kind: "scene", id: sceneId }, { kind: "take", id: takeId }], fields, methods: [], destinations: [] }),
    project: (value) => value === null ? null : parse(messageSchema, value) }),
  execute: async ({ sceneId, takeId, seq, fields }, context, services) => { assertScope([{ kind: "scene", id: sceneId }, { kind: "take", id: takeId }], context.access.resources); assertFields(fields, context.access.fields); const value = await services.readMessage(sceneId, takeId, seq, context.access.resources, fields); return value === null ? null : parse(messageSchema, value); },
};
const versions: ExtensionOperationDefinition<z.infer<typeof versionsInput>, z.infer<typeof versionOutput>, ExtensionSceneServices> = {
  metadata: metadata({ id: "messages.versions.list", version: 1, inputVersion: 1, outputVersion: 1, projectionVersion: 1, title: "List message versions", description: "Read all bounded versions of one message under an explicit history grant.",
    input: versionsInput, output: versionOutput, effect: "read", sensitivity: "private", hosts: EXTENSION_HOSTS, policy: readPolicy(["scene", "take"], ["message.history"]),
    estimateBudget: () => ({ bytes: MAX_VALUE_BYTES, tokens: 0 }), measureTokens: () => 0,
    resolveAccess: ({ sceneId, takeId }) => ({ resources: [{ kind: "scene", id: sceneId }, { kind: "take", id: takeId }], fields: ["message.history"], methods: [], destinations: [] }),
    project: (rows) => parse(versionOutput, rows) }),
  execute: async ({ sceneId, takeId, seq, fromIndex }, context, services) => { assertScope([{ kind: "scene", id: sceneId }, { kind: "take", id: takeId }], context.access.resources); assertFields(["message.history"], context.access.fields); return parse(versionOutput, await services.listMessageVersions(sceneId, takeId, seq, fromIndex, context.access.resources)); },
};

export const sceneOperations = [sceneList, sceneRead, sceneDetails, takeList, takeRead, messageList, messageRead, versions] as const;
export const createOperations = (services: ExtensionOperationServices) => bindExtensionDefinitions(sceneOperations, services.scenes!);
export default sceneOperations;
