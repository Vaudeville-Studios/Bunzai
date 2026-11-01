/** Exact-ID body and reviewed detail projections; summary access has its own operation. */
import { z } from "zod";
import { bindExtensionOperation, EXTENSION_HOSTS, PROMPT_SAFE_READ_ORIGINS, type ExtensionOperationDefinition, type ExtensionOperationMetadata } from "../../contracts/operation";
import { decodeJsonValue } from "../../contracts/value";
import type { ContentKind } from "../../../entities/capabilities/types";
import { STUDIO_ENTITY_KINDS } from "../../../studio/path-policy";
import type { ExtensionOperationServices } from "../_services";
import { CHARACTER_IDENTITY_FIELDS, CHARACTER_IDENTITY_GROUP, characterIdentityGroupSchema } from "./_identity-projection";
import { CHARACTER_LINKS_GROUP, characterLinksSchema } from "./_links-projection";
import { PERSONA_IDENTITY_FIELDS, PERSONA_IDENTITY_GROUP, personaIdentitySchema } from "./_persona-projection";
import { canonicalEntityBodySchema } from "../../../entities/runtime-schema";

const groups = z.enum(["body", CHARACTER_IDENTITY_GROUP, CHARACTER_LINKS_GROUP, PERSONA_IDENTITY_GROUP]);
const input = z.strictObject({ kind: z.enum(STUDIO_ENTITY_KINDS), id: z.string().min(1).max(120), groups: z.array(groups).min(1).max(4) }).superRefine(({ groups: selected }, context) => {
  if (new Set(selected).size !== selected.length) context.addIssue({ code: "custom", path: ["groups"], message: "duplicate content projection" });
});
export const contentReadResultSchema = z.strictObject({ requested: z.array(groups), body: canonicalEntityBodySchema.nullable(), identity: characterIdentityGroupSchema.nullable(), links: characterLinksSchema.nullable(), personaIdentity: personaIdentitySchema.nullable() });
const output = contentReadResultSchema;
type Input = z.infer<typeof input>;
type Output = z.infer<typeof output>;
function access(args: Input) {
  const fields = args.groups.flatMap((group) => group === "body" ? ["body"] : group === CHARACTER_IDENTITY_GROUP ? [...CHARACTER_IDENTITY_FIELDS] : group === CHARACTER_LINKS_GROUP ? ["links"] : [...PERSONA_IDENTITY_FIELDS]);
  return { resources: [{ kind: args.kind, id: args.id }], fields, methods: [] as [], destinations: [] as [] };
}
const metadata: ExtensionOperationMetadata<Input, Output> = {
  id: "content.read", version: 1, inputVersion: 1, outputVersion: 1, projectionVersion: 1,
  title: "Read canonical piece body", description: "Read one approved canonical body, including authored prompts and sealed script data, without escrow, notes, profiles or execution.",
  input, output, effect: "read", sensitivity: "private", hosts: EXTENSION_HOSTS, activationOrigins: PROMPT_SAFE_READ_ORIGINS,
  policy: { resources: [...STUDIO_ENTITY_KINDS], fields: ["body", ...CHARACTER_IDENTITY_FIELDS, "links", ...PERSONA_IDENTITY_FIELDS], methods: [], destinations: [], destinationMode: "none", budget: "read-large", confirmation: "none" },
  estimateBudget: () => ({ bytes: 256_000, tokens: 0 }), measureTokens: () => 0,
  resolveAccess: access, project: (value) => decodeJsonValue(value),
};
const definition: ExtensionOperationDefinition<Input, Output, ExtensionOperationServices> = {
  metadata,
  execute: async ({ kind, id, groups: requested }, context, { content }) => {
    if (!context.access.resources.some((ref) => ref.kind === kind && ref.id === id)) throw new Error("content target is outside the approved grant");
    const result: Output = { requested, body: null, identity: null, links: null, personaIdentity: null };
    if (requested.includes("body")) {
      if (!context.access.fields.includes("body")) throw new Error("content body is outside the approved grant");
      const value = await content.readBody(kind as ContentKind, id, context.access.resources, ["body"]);
      result.body = value === null ? null : canonicalEntityBodySchema.parse(value);
    }
    if (requested.includes(CHARACTER_IDENTITY_GROUP)) {
      if (kind !== "character" || CHARACTER_IDENTITY_FIELDS.some((field) => !context.access.fields.includes(field))) throw new Error("content identity is outside the approved grant");
      const value = await content.readFields("character", id, CHARACTER_IDENTITY_GROUP, context.access.resources, CHARACTER_IDENTITY_FIELDS);
      result.identity = value === null ? null : characterIdentityGroupSchema.parse(value);
    }
    if (requested.includes(CHARACTER_LINKS_GROUP)) {
      if (kind !== "character" || !context.access.fields.includes("links")) throw new Error("content links are outside the approved grant");
      const value = await content.readLinks("character", id, context.access.resources, ["links"]);
      result.links = value === null ? null : characterLinksSchema.parse(value);
    }
    if (requested.includes(PERSONA_IDENTITY_GROUP)) {
      if (kind !== "persona" || PERSONA_IDENTITY_FIELDS.some((field) => !context.access.fields.includes(field))) throw new Error("persona identity is outside the approved grant");
      const value = await content.readPersonaIdentity("persona", id, PERSONA_IDENTITY_GROUP, context.access.resources, PERSONA_IDENTITY_FIELDS);
      result.personaIdentity = value === null ? null : personaIdentitySchema.parse(value);
    }
    return result;
  },
};
export const contentReadOperations = [definition] as const;
export const createOperations = (services: ExtensionOperationServices) => contentReadOperations.map((item) => bindExtensionOperation(item, services));
export default contentReadOperations;
