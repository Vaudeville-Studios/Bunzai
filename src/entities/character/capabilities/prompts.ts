/**
 * Semantic capability for character persona, prompt, and example-text slots.
 */
import { z } from "zod";
import { defineContentCapability } from "../../_shared/define-content-capability";
import { CONTENT_DRAFT_HOSTS } from "../../capabilities/types";
import type { CanonicalCharacter } from "../schema";
import { nonEmptyPatch, previewCharacterPatch, targetSchema } from "./shared";

const text = z.string().nullable().optional();
const patchSchema = nonEmptyPatch({
  description: text,
  personality: text,
  scenario: text,
  appearance: text,
  systemPrompt: text,
  postHistoryInstructions: text,
  prefill: text,
  additionalText: text,
  exampleMessages: text,
});
const input = z.strictObject({ target: targetSchema, patch: patchSchema });

const paths: Record<string, string> = {
  description: "identity.description",
  personality: "persona.personality",
  scenario: "persona.scenario",
  appearance: "persona.appearance",
  systemPrompt: "prompts.systemPrompt",
  postHistoryInstructions: "prompts.postHistoryInstructions",
  prefill: "prompts.prefill",
  additionalText: "prompts.additionalText",
  exampleMessages: "examples.exampleMessages",
};

const capability = defineContentCapability<z.infer<typeof input>, CanonicalCharacter>({
  id: "character.prompts.update",
  kind: "character",
  area: "prompts",
  action: "update",
  summary: "Change portable character description, persona, scenario, system instructions, or examples.",
  aliases: ["edit character prompt", "change personality", "update scenario", "system prompt"],
  extensionExposure: {
    operationId: "content.draft.character.prompts.update",
    fields: Object.entries(paths).map(([input, path]) => ({ input: `patch.${input}`, path: `body.${path}` })),
    hosts: CONTENT_DRAFT_HOSTS, budget: "write", confirmation: "effect",
  },
  input,
  preview: (entity, { target, patch }) =>
    previewCharacterPatch(entity, patch, paths, target.variantId),
});

export default capability;
