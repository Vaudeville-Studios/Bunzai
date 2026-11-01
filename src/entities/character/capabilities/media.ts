/**
 * Semantic capability for character portrait and named media references.
 */
import { z } from "zod";
import { defineContentCapability } from "../../_shared/define-content-capability";
import { CONTENT_DRAFT_HOSTS } from "../../capabilities/types";
import { mediaAssetSchema } from "../../_shared/capability-schemas";
import type { CanonicalCharacter } from "../schema";
import { nonEmptyPatch, previewCharacterPatch, targetSchema } from "./shared";

const patchSchema = nonEmptyPatch({
  portrait: mediaAssetSchema.nullable().optional(),
  assets: z.array(mediaAssetSchema).nullable().optional(),
  visualKind: z.string().nullable().optional(),
  faceLabel: z.string().nullable().optional(),
});
const input = z.strictObject({ target: targetSchema, patch: patchSchema });
const paths: Record<string, string> = {
  portrait: "media.portrait",
  assets: "media.assets",
  visualKind: "media.visualKind",
  faceLabel: "media.faceLabel",
};

const capability = defineContentCapability<z.infer<typeof input>, CanonicalCharacter>({
  id: "character.media.update",
  kind: "character",
  area: "media",
  action: "update",
  summary: "Change the canonical portrait, media asset references, visual mode, or preferred face.",
  aliases: ["character portrait", "sprites", "emotion images", "media pack"],
  extensionExposure: {
    operationId: "content.draft.character.media.update",
    fields: Object.entries(paths).map(([input, path]) => ({ input: `patch.${input}`, path: `body.${path}` })),
    hosts: CONTENT_DRAFT_HOSTS, budget: "write", confirmation: "effect",
  },
  input,
  preview: (entity, { target, patch }) =>
    previewCharacterPatch(entity, patch, paths, target.variantId),
});

export default capability;
