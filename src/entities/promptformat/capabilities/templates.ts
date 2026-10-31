/** Safe semantic edits for inert text-completion templates; no runtime consumes these templates yet. */
import { z } from "zod";
import { defineContentCapability } from "../../_shared/define-content-capability";
import { CONTENT_DRAFT_HOSTS } from "../../capabilities/types";
import { nonEmptyPatch } from "../../_shared/capability-schemas";
import type { CanonicalPromptFormat } from "../schema";

const scalar = z.union([z.string().max(200_000), z.number().finite(), z.boolean()]);
const part = z.record(z.string().max(100), scalar);
const patch = nonEmptyPatch({ name: z.string().min(1).max(200).optional(), instruct: part.optional(), context: part.optional(), notes: z.string().optional() });
const input = z.strictObject({ target: z.strictObject({ id: z.string().min(1).max(120) }), patch });
const fields = [
  { key: "name", input: "patch.name", path: "body.name", label: "Prompt-format name" },
  { key: "instruct", input: "patch.instruct", path: "body.instruct", label: "Instruct template" },
  { key: "context", input: "patch.context", path: "body.context", label: "Context template" },
  { key: "notes", input: "patch.notes", path: "body.notes", label: "Author notes" },
] as const;
const capability = defineContentCapability<z.infer<typeof input>, CanonicalPromptFormat>({
  id: "promptformat.templates.update", kind: "promptformat", area: "templates", action: "update",
  summary: "Edit stored text-completion template fields as inert canonical data.", aliases: ["edit prompt format", "change text-completion template"],
  extensionExposure: { operationId: "content.draft.promptformat.templates.update", fields, hosts: CONTENT_DRAFT_HOSTS, budget: "write", confirmation: "effect" },
  input,
  preview(entity, { patch: changes }) {
    const body = { ...entity.body, ...changes };
    return { entity: { ...entity, body }, changes: fields.flatMap(({ key, path, label }) => changes[key] === undefined ? [] : [{ path, label, before: entity.body[key] ?? null, after: changes[key] }]), warnings: [], platformImpact: [] };
  },
});
export default capability;
