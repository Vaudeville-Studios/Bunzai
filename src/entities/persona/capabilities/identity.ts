/**
 * Semantic capability for a persona's shelf identity and injected first-person text.
 */
import { z } from "zod";
import { defineContentCapability } from "../../_shared/define-content-capability";
import { CONTENT_DRAFT_HOSTS } from "../../capabilities/types";
import type { CanonicalPersona } from "../schema";
import { nonEmptyPatch, previewPersonaPatch, targetSchema } from "./shared";

const patchSchema = nonEmptyPatch({
  name: z.string().min(1).optional(),
  brief: z.string().nullable().optional(),
  content: z.string().optional(),
});
const input = z.strictObject({ target: targetSchema, patch: patchSchema });
const paths: Record<string, string> = {
  name: "name",
  brief: "brief",
  content: "content",
};

const capability = defineContentCapability<z.infer<typeof input>, CanonicalPersona>({
  id: "persona.identity.update",
  kind: "persona",
  area: "identity",
  action: "update",
  summary: "Change a persona's name, shelf-only brief, or injected first-person identity text.",
  aliases: ["rename persona", "persona brief", "user identity text"],
  extensionExposure: {
    operationId: "content.draft.persona.identity.update",
    fields: [{ input: "patch.name", path: "body.name" }, { input: "patch.brief", path: "body.brief" }, { input: "patch.content", path: "body.content" }],
    hosts: CONTENT_DRAFT_HOSTS, budget: "write", confirmation: "effect",
  },
  input,
  preview: (entity, { patch }) => previewPersonaPatch(entity, patch, paths),
});

export default capability;
