/** Bounded, exact-field historical reads over held canonical versions. */
import { z } from "zod";
import { STUDIO_ENTITY_KINDS } from "../../../studio/path-policy";
import type { ContentKind } from "../../../entities/capabilities/types";
import { bindExtensionDefinitions, EXTENSION_HOSTS, PROMPT_SAFE_READ_ORIGINS, type ExtensionOperationDefinition, type ExtensionOperationMetadata } from "../../contracts/operation";
import { decodeJsonValue, MAX_VALUE_BYTES } from "../../contracts/value";
import type { ExtensionOperationServices } from "../_services";
import { areReviewedBodyFields, REVIEWED_CONTENT_FIELD_PATHS } from "./_reviewed-fields";

const kindSchema = z.enum(STUDIO_ENTITY_KINDS);
const idSchema = z.string().min(1).max(120);
const listInput = z.strictObject({ kind: kindSchema, id: idSchema });
const listOutput = z.strictObject({ versions: z.array(z.strictObject({ version: z.number().int().positive(), revision: z.string().min(1).max(200), savedAt: z.number().finite(), reason: z.enum(["create", "save", "autosave", "restore"]) })).max(100), truncated: z.boolean() });
const readInput = z.strictObject({ kind: kindSchema, id: idSchema, version: z.number().int().positive().max(Number.MAX_SAFE_INTEGER), fields: z.array(z.string().min(1).max(180)).min(1).max(16) })
  .refine(({ kind, fields }) => areReviewedBodyFields(kind as ContentKind, fields), "historical field paths must be unique and capability-reviewed");
const readOutput = z.strictObject({ version: z.number().int().positive(), fields: z.array(z.strictObject({ path: z.string().min(1).max(180), value: z.json() })).max(16) }).nullable();
type ListInput = z.infer<typeof listInput>;
type ReadInput = z.infer<typeof readInput>;
type ListOutput = z.infer<typeof listOutput>;
type ReadOutput = z.infer<typeof readOutput>;

function metadata<I, O>(id: string, title: string, description: string, input: z.ZodType<I>, output: z.ZodType<O>, fields: readonly string[], budget: number, resolve: (args: I) => { kind: string; id: string }, resolveFields?: (args: I) => string[]): ExtensionOperationMetadata<I, O> {
  return {
    id, version: 1, inputVersion: 1, outputVersion: 1, projectionVersion: 1, title, description,
    input, output, effect: "read", sensitivity: "private", hosts: EXTENSION_HOSTS, activationOrigins: PROMPT_SAFE_READ_ORIGINS,
    policy: { resources: [...STUDIO_ENTITY_KINDS], fields: [...fields], destinations: [], methods: [], destinationMode: "none", budget: "read-small", confirmation: "none" },
    estimateBudget: () => ({ bytes: budget, tokens: 0 }), measureTokens: () => 0,
    resolveAccess: (args) => ({ resources: [resolve(args)], fields: resolveFields?.(args) ?? [...fields], methods: [], destinations: [] }),
    project: (value) => decodeJsonValue(output.parse(value)),
  };
}
const listMetadata = metadata("content.history.list", "List content history", "List bounded version summaries for one exactly granted canonical piece.", listInput, listOutput, ["history"], 24_000, ({ kind, id }) => ({ kind, id }));
const listDefinition: ExtensionOperationDefinition<ListInput, ListOutput, ExtensionOperationServices> = {
  metadata: listMetadata,
  execute: async ({ kind, id }, context, { content }) => {
    if (!context.access.resources.some((ref) => ref.kind === kind && ref.id === id) || !context.access.fields.includes("history")) throw new Error("requested history is outside the approved grant");
    const versions = await content.listHistory(kind as ContentKind, id, context.access.resources, context.access.fields);
    return listOutput.parse({ versions: versions.slice(-100), truncated: versions.length > 100 });
  },
};
const readMetadata = metadata("content.history.read", "Read historical fields", "Read up to 16 capability-reviewed fields from one held historical version. Requires separate history and exact field grants.", readInput, readOutput, ["history", ...REVIEWED_CONTENT_FIELD_PATHS], MAX_VALUE_BYTES - 1_000, ({ kind, id }) => ({ kind, id }), ({ fields }) => ["history", ...fields]);
const readDefinition: ExtensionOperationDefinition<ReadInput, ReadOutput, ExtensionOperationServices> = {
  metadata: readMetadata,
  execute: async ({ kind, id, version, fields }, context, { content }) => {
    if (!context.access.resources.some((ref) => ref.kind === kind && ref.id === id)
      || !context.access.fields.includes("history") || fields.some((field) => !context.access.fields.includes(field))) throw new Error("requested historical fields are outside the approved grant");
    const result = await content.readHistory(kind as ContentKind, id, version, context.access.resources, ["history", ...fields]);
    if (result === null) return null;
    const output = readOutput.parse({ version, fields: result });
    if (new TextEncoder().encode(JSON.stringify(output)).byteLength > MAX_VALUE_BYTES) throw new Error("historical projection exceeds the shared guest JSON limit");
    return output;
  },
};
export const contentHistoryOperations = [listDefinition, readDefinition] as const;
export const createOperations = (services: ExtensionOperationServices) => bindExtensionDefinitions(contentHistoryOperations, services);
export default contentHistoryOperations;
