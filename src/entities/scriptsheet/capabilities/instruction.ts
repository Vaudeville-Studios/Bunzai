/** Safe semantic edit for the Script Sheet instruction; it never evaluates the text. */
import { z } from "zod";
import { defineContentCapability } from "../../_shared/define-content-capability";
import { CONTENT_DRAFT_HOSTS } from "../../capabilities/types";
import type { CanonicalScriptSheet } from "../schema";

const input = z.strictObject({ target: z.strictObject({ id: z.string().min(1).max(120) }), content: z.string().max(100_000) });

const capability = defineContentCapability<z.infer<typeof input>, CanonicalScriptSheet>({
  id: "scriptsheet.instruction.update",
  kind: "scriptsheet",
  area: "instruction",
  action: "update",
  summary: "Replace one Script Sheet instruction as inert authored text.",
  aliases: ["edit script sheet", "change writing instruction"],
  extensionExposure: {
    operationId: "content.draft.scriptsheet.instruction.update",
    fields: [{ input: "content", path: "body.content" }],
    hosts: CONTENT_DRAFT_HOSTS, budget: "write", confirmation: "effect",
  },
  input,
  preview(entity, { content }) {
    return {
      entity: { ...entity, body: { ...entity.body, content } },
      changes: [{ path: "body.content", label: "Script Sheet instruction", before: entity.body.content, after: content }],
      warnings: [],
      platformImpact: [],
    };
  },
});

export default capability;
