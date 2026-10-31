/**
 * Semantic capability for portable character identity and casting-card facts.
 */
import { z } from "zod";
import { defineContentCapability } from "../../_shared/define-content-capability";
import { CONTENT_DRAFT_HOSTS } from "../../capabilities/types";
import type { CanonicalCharacter } from "../schema";
import { nonEmptyPatch, nullableOptionalText, previewCharacterPatch, targetSchema } from "./shared";

const patchSchema = nonEmptyPatch({
  name: z.string().min(1).optional(),
  nickname: nullableOptionalText,
  tagline: nullableOptionalText,
  fullName: nullableOptionalText,
  title: nullableOptionalText,
  age: nullableOptionalText,
  pronouns: nullableOptionalText,
  culture: nullableOptionalText,
  characterVersion: nullableOptionalText,
});
const input = z.strictObject({ target: targetSchema, patch: patchSchema });

const paths: Record<string, string> = {
  name: "identity.name",
  nickname: "identity.nickname",
  tagline: "identity.tagline",
  fullName: "identity.fullName",
  title: "identity.title",
  age: "identity.age",
  pronouns: "identity.pronouns",
  culture: "identity.culture",
  characterVersion: "identity.characterVersion",
};

const capability = defineContentCapability<z.infer<typeof input>, CanonicalCharacter>({
  id: "character.identity.update",
  kind: "character",
  area: "identity",
  action: "update",
  summary: "Change a character's portable name, nickname, tagline, or casting-card identity facts.",
  aliases: ["rename character", "edit identity", "change pronouns", "casting card"],
  extensionExposure: {
    operationId: "content.draft.character.identity.update",
    fields: Object.entries(paths).map(([input, path]) => ({ input: `patch.${input}`, path: `body.${path}` })),
    hosts: CONTENT_DRAFT_HOSTS, budget: "write", confirmation: "effect",
  },
  input,
  preview: (entity, { target, patch }) =>
    previewCharacterPatch(entity, patch, paths, target.variantId),
});

export default capability;
