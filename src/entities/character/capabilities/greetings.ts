/**
 * Semantic capability for first, alternate, and group-only character greetings.
 */
import { z } from "zod";
import { defineContentCapability } from "../../_shared/define-content-capability";
import { CONTENT_DRAFT_HOSTS } from "../../capabilities/types";
import type { CanonicalCharacter } from "../schema";
import { nonEmptyPatch, previewCharacterPatch, targetSchema } from "./shared";

const greeting = z.strictObject({
  text: z.string(),
  title: z.string().optional(),
  id: z.string().optional(),
});
const patchSchema = nonEmptyPatch({
  firstMessage: z.string().nullable().optional(),
  alternateGreetings: z.array(greeting).nullable().optional(),
  groupOnlyGreetings: z.array(greeting).nullable().optional(),
});
const input = z.strictObject({ target: targetSchema, patch: patchSchema });
const paths: Record<string, string> = {
  firstMessage: "greetings.firstMessage",
  alternateGreetings: "greetings.alternateGreetings",
  groupOnlyGreetings: "greetings.groupOnlyGreetings",
};

const capability = defineContentCapability<z.infer<typeof input>, CanonicalCharacter>({
  id: "character.greetings.update",
  kind: "character",
  area: "greetings",
  action: "update",
  summary: "Change the first message or replace authored alternate and group-only greeting lists.",
  aliases: ["edit greeting", "alternate greetings", "first message", "group greeting"],
  extensionExposure: {
    operationId: "content.draft.character.greetings.update",
    fields: Object.entries(paths).map(([input, path]) => ({ input: `patch.${input}`, path: `body.${path}` })),
    hosts: CONTENT_DRAFT_HOSTS, budget: "write", confirmation: "effect",
  },
  input,
  preview: (entity, { target, patch }) =>
    previewCharacterPatch(entity, patch, paths, target.variantId),
});

export default capability;
