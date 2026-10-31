/** Read only the reviewed character links projection. */
import { z } from "zod";
import { bindExtensionOperation, EXTENSION_HOSTS, PROMPT_SAFE_READ_ORIGINS, type ExtensionOperationDefinition, type ExtensionOperationMetadata } from "../../contracts/operation";
import type { ExtensionOperationServices } from "../_services";
import { CHARACTER_LINKS_GROUP, characterLinksSchema } from "./_links-projection";

const input = z.strictObject({ kind: z.literal("character"), id: z.string().min(1).max(120), group: z.literal(CHARACTER_LINKS_GROUP) });
const output = characterLinksSchema.nullable();
const metadata: ExtensionOperationMetadata<z.infer<typeof input>, z.infer<typeof output>> = {
  id: "content.links.read", version: 1, inputVersion: 1, outputVersion: 1, projectionVersion: 1,
  title: "Read character links", description: "Read bounded canonical links for one granted character.",
  input, output, effect: "read", sensitivity: "private", hosts: EXTENSION_HOSTS, activationOrigins: PROMPT_SAFE_READ_ORIGINS,
  policy: { resources: ["character"], fields: ["links"], destinations: [], methods: [], destinationMode: "none", budget: "read-small", confirmation: "none" },
  estimateBudget: () => ({ bytes: 45_000, tokens: 0 }), measureTokens: () => 0,
  resolveAccess: ({ kind, id }) => ({ resources: [{ kind, id }], fields: ["links"], methods: [], destinations: [] }),
  project: (value) => value,
};
const definition: ExtensionOperationDefinition<z.infer<typeof input>, z.infer<typeof output>, ExtensionOperationServices> = {
  metadata,
  execute: async ({ kind, id }, context, { content }) => {
    if (!context.access.resources.some((ref) => ref.kind === kind && ref.id === id) || !context.access.fields.includes("links")) {
      throw new Error("requested character links are outside the approved grant");
    }
    const value = await content.readLinks(kind, id, context.access.resources, context.access.fields);
    return value === null ? null : characterLinksSchema.parse(value);
  },
};
export const characterLinksOperations = [definition] as const;
export const createOperations = (services: ExtensionOperationServices) => characterLinksOperations.map((item) => bindExtensionOperation(item, services));
export default characterLinksOperations;
