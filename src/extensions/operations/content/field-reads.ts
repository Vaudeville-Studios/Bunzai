/** Exact-path content reads derived only from explicitly exposed semantic capability fields. */
import { z } from "zod";
import { STUDIO_ENTITY_KINDS } from "../../../studio/path-policy";
import { bindExtensionOperation, EXTENSION_HOSTS, PROMPT_SAFE_READ_ORIGINS, type ExtensionOperationDefinition, type ExtensionOperationMetadata } from "../../contracts/operation";
import { decodeJsonValue, jsonValueSchemaBounded } from "../../contracts/value";
import type { ExtensionOperationServices } from "../_services";
import { areReviewedBodyFields, REVIEWED_CONTENT_FIELD_PATHS } from "./_reviewed-fields";

const kind = z.enum(STUDIO_ENTITY_KINDS);
const field = z.enum(REVIEWED_CONTENT_FIELD_PATHS as [string, ...string[]]);
const input = z.strictObject({ kind, id: z.string().min(1).max(120), fields: z.array(field).min(1).max(64) })
  .refine(({ kind: selectedKind, fields }) => areReviewedBodyFields(selectedKind, fields), "field paths must be unique and exposed for this content kind");
const output = z.strictObject({ kind, id: z.string().min(1).max(120), fields: z.array(z.strictObject({ path: field, value: jsonValueSchemaBounded })).max(64) });
type Input = z.infer<typeof input>;
type Output = z.infer<typeof output>;
const metadata: ExtensionOperationMetadata<Input, Output> = {
  id: "content.fields.read", version: 1, inputVersion: 1, outputVersion: 1, projectionVersion: 1,
  title: "Read reviewed content fields", description: "Read exact authored body paths declared by reviewed capability owners; escrow is never included.",
  input, output, effect: "read", sensitivity: "private", hosts: EXTENSION_HOSTS, activationOrigins: PROMPT_SAFE_READ_ORIGINS,
  policy: { resources: [...STUDIO_ENTITY_KINDS], fields: REVIEWED_CONTENT_FIELD_PATHS, methods: [], destinations: [], destinationMode: "none", budget: "read-large", confirmation: "none" },
  estimateBudget: () => ({ bytes: 220_000, tokens: 0 }), measureTokens: () => 0,
  resolveAccess: ({ kind: selectedKind, id, fields }) => ({ resources: [{ kind: selectedKind, id }], fields, methods: [], destinations: [] }),
  project: (value) => decodeJsonValue(output.parse(value)),
};
const definition: ExtensionOperationDefinition<Input, Output, ExtensionOperationServices> = {
  metadata,
  execute: async ({ kind: selectedKind, id, fields }, context, { content }) => {
    if (!context.access.resources.some((resource) => resource.kind === selectedKind && resource.id === id)
      || fields.some((path) => !context.access.fields.includes(path))) throw new Error("content fields are outside the approved grant");
    const result = await content.readSelectedFields(selectedKind, id, context.access.resources, fields);
    return output.parse({ kind: selectedKind, id, fields: result });
  },
};
export const contentFieldReadOperations = [definition] as const;
export const createOperations = (services: ExtensionOperationServices) => contentFieldReadOperations.map((item) => bindExtensionOperation(item, services));
export default contentFieldReadOperations;
