/**
 * Semantic capability for structured persona sections, traits, order, and casting facts.
 */
import { z } from "zod";
import { defineContentCapability } from "../../_shared/define-content-capability";
import { CONTENT_DRAFT_HOSTS } from "../../capabilities/types";
import type { CanonicalPersona } from "../schema";
import { nonEmptyPatch, nullableOptionalText, previewPersonaPatch, targetSchema } from "./shared";

const pronounSet = z.strictObject({
  subjective: z.string(),
  objective: z.string(),
  possessive: z.string(),
});
const patchSchema = nonEmptyPatch({
  appearance: nullableOptionalText,
  body: nullableOptionalText,
  personality: nullableOptionalText,
  quirks: nullableOptionalText,
  history: nullableOptionalText,
  sectionOrder: z.array(z.string()).nullable().optional(),
  traits: z.array(z.string()).nullable().optional(),
  tagline: nullableOptionalText,
  age: nullableOptionalText,
  height: nullableOptionalText,
  pronouns: nullableOptionalText,
  pronounSet: pronounSet.nullable().optional(),
});
const input = z.strictObject({ target: targetSchema, patch: patchSchema });
const paths: Record<string, string> = {
  appearance: "sections.appearance",
  body: "sections.body",
  personality: "sections.personality",
  quirks: "sections.quirks",
  history: "sections.history",
  sectionOrder: "sectionOrder",
  traits: "traits",
  tagline: "identity.tagline",
  age: "identity.age",
  height: "identity.height",
  pronouns: "identity.pronouns",
  pronounSet: "identity.pronounSet",
};

const capability = defineContentCapability<z.infer<typeof input>, CanonicalPersona>({
  id: "persona.profile.update",
  kind: "persona",
  area: "profile",
  action: "update",
  summary: "Change structured persona sections, traits, ordering, pronouns, or casting facts.",
  aliases: ["persona sections", "persona traits", "persona pronouns", "persona appearance"],
  extensionExposure: {
    operationId: "content.draft.persona.profile.update",
    fields: Object.entries(paths).map(([input, path]) => ({ input: `patch.${input}`, path: `body.${path}` })),
    hosts: CONTENT_DRAFT_HOSTS, budget: "write", confirmation: "effect",
  },
  input,
  preview: (entity, { patch }) => previewPersonaPatch(entity, patch, paths),
});

export default capability;
