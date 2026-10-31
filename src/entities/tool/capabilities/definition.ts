/** Edits one tool definition as data; executing the action still requires a separate operation grant. */
import { z } from "zod";
import { defineContentCapability } from "../../_shared/define-content-capability";
import { CONTENT_DRAFT_HOSTS } from "../../capabilities/types";
import { toolBodySchema } from "../runtime-schema";
import type { CanonicalTool } from "../schema";

const input = z.strictObject({ target: z.strictObject({ id: z.string().min(1).max(120) }), body: toolBodySchema });

const capability = defineContentCapability<z.infer<typeof input>, CanonicalTool>({
  id: "tool.definition.update",
  kind: "tool",
  area: "definition",
  action: "update",
  summary: "Replace one validated tool definition as inert data.",
  aliases: ["edit tool", "change tool fields"],
  extensionExposure: {
    operationId: "content.draft.tool.definition.update",
    fields: [{ input: "body", path: "body" }],
    hosts: CONTENT_DRAFT_HOSTS, budget: "write", confirmation: "effect",
  },
  input,
  preview(entity, { body }) {
    return {
      entity: { ...entity, body },
      changes: [{ path: "body", label: "tool definition", before: entity.body, after: body }],
      warnings: [],
      platformImpact: [],
    };
  },
});

export default capability;
