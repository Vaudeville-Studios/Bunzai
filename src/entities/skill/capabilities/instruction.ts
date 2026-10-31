/** Safe semantic edits for authored Skill text and descriptive fields; preview never evaluates content. */
import { z } from "zod";
import { defineContentCapability } from "../../_shared/define-content-capability";
import { CONTENT_DRAFT_HOSTS } from "../../capabilities/types";
import { nonEmptyPatch } from "../../_shared/capability-schemas";
import { SANITY_TEXT } from "../../_shared/sanity";
import type { CanonicalSkill } from "../schema";

const input = z.strictObject({
  target: z.strictObject({ id: z.string().min(1).max(120) }),
  patch: nonEmptyPatch({ name: z.string().min(1).max(500).optional(), description: z.string().max(SANITY_TEXT).optional(), text: z.string().max(SANITY_TEXT).optional() }),
});
const fields = [
  { key: "name", input: "patch.name", path: "body.name", label: "Skill name" },
  { key: "description", input: "patch.description", path: "body.description", label: "Skill description" },
  { key: "text", input: "patch.text", path: "body.text", label: "Skill instructions" },
] as const;
const capability = defineContentCapability<z.infer<typeof input>, CanonicalSkill>({
  id: "skill.instruction.update", kind: "skill", area: "instruction", action: "update",
  summary: "Edit a Skill's name, description, or inert authored instructions.", aliases: ["edit skill", "change skill instructions"],
  extensionExposure: { operationId: "content.draft.skill.instruction.update", fields, hosts: CONTENT_DRAFT_HOSTS, budget: "write", confirmation: "effect" },
  input,
  preview(entity, { patch }) {
    return { entity: { ...entity, body: { ...entity.body, ...patch } }, changes: fields.flatMap(({ key, path, label }) => patch[key] === undefined ? [] : [{ path, label, before: entity.body[key], after: patch[key] }]), warnings: [], platformImpact: [] };
  },
});
export default capability;
