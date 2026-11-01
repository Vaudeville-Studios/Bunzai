/** Replaces one Promptbook phase's canonical preset content as an inert draft. */
import { z } from "zod";
import { defineContentCapability } from "../../_shared/define-content-capability";
import { CONTENT_DRAFT_HOSTS } from "../../capabilities/types";
import type { CanonicalPromptbook } from "../schema";

const input = z.strictObject({
  target: z.strictObject({ id: z.string().min(1).max(120) }),
  phaseId: z.string().min(1).max(120),
  blockId: z.string().min(1).max(120),
  content: z.string().max(100_000),
});

const capability = defineContentCapability<z.infer<typeof input>, CanonicalPromptbook>({
  id: "promptbook.phase-preset.update",
  kind: "promptbook",
  area: "phase-preset",
  action: "update",
  summary: "Replace one Promptbook phase block's authored text without running it.",
  aliases: ["edit promptbook phase prompts", "change phase instruction"],
  extensionExposure: {
    operationId: "content.draft.promptbook.phase-preset.update",
    fields: [{ input: "content", path: "body.phases.prompt-content" }],
    hosts: CONTENT_DRAFT_HOSTS, budget: "write", confirmation: "effect",
  },
  input,
  preview(entity, { phaseId, blockId, content }) {
    const phase = entity.body.phases.find((candidate) => candidate.id === phaseId);
    if (!phase) throw new Error("Promptbook phase is missing");
    const block = phase.preset.prompts.find((candidate) => candidate.id === blockId);
    if (!block) throw new Error("Promptbook phase block is missing");
    const phases = entity.body.phases.map((candidate) => candidate.id === phaseId
      ? { ...candidate, preset: { ...candidate.preset, prompts: candidate.preset.prompts.map((row) => row.id === blockId ? { ...row, content } : row) } }
      : candidate);
    return {
      entity: { ...entity, body: { ...entity.body, phases } },
      changes: [{ path: "body.phases.prompt-content", label: `${phase.name} phase instruction`, before: block.content, after: content }],
      warnings: [],
      platformImpact: [],
    };
  },
});

export default capability;
