/** Semantic capability for preset category lifecycle and safe membership cleanup. */
import { z } from "zod";
import { deepEq } from "../../../core/guards";
import { defineContentCapability } from "../../_shared/define-content-capability";
import { CONTENT_DRAFT_HOSTS } from "../../capabilities/types";
import type { CapabilityChange } from "../../capabilities";
import { nonEmptyPatch, nullsToUndefined } from "../../_shared/capability-schemas";
import type { CanonicalPreset } from "../schema";
import { addPresetGroup, patchPresetGroup, removePresetGroup } from "../operations";
import { presetPreview, targetSchema } from "./shared";

const group = z.strictObject({
  id: z.string().min(1),
  name: z.string(),
  content: z.string().optional(),
  parentGroupId: z.string().optional(),
  order: z.number().optional(),
  enabled: z.boolean().optional(),
  extras: z.record(z.string(), z.unknown()).optional(),
});
const patch = nonEmptyPatch({
  name: z.string().optional(),
  content: z.string().nullable().optional(),
  parentGroupId: z.string().nullable().optional(),
  order: z.number().nullable().optional(),
  enabled: z.boolean().nullable().optional(),
});
const operation = z.union([
  z.strictObject({ type: z.literal("add"), group }),
  z.strictObject({ type: z.literal("update"), id: z.string().min(1), patch }),
  z.strictObject({ type: z.literal("remove"), id: z.string().min(1) }),
]);
const input = z.strictObject({ target: targetSchema, operation });

const capability = defineContentCapability<z.infer<typeof input>, CanonicalPreset>({
  id: "preset.groups.manage",
  kind: "preset",
  area: "groups",
  action: "manage",
  summary: "Add, edit, or remove preset categories while cleaning block and child references.",
  aliases: ["preset category", "prompt group", "remove category"],
  extensionExposure: { operationId: "content.draft.preset.groups.manage", fields: [{ input: "operation", path: "body.groups" }, { input: "operation", path: "body.prompts" }], hosts: CONTENT_DRAFT_HOSTS, budget: "write", confirmation: "effect" },
  input,
  preview: (entity, { operation: action }) => {
    const body = action.type === "add"
      ? addPresetGroup(entity.body, action.group)
      : action.type === "remove"
        ? removePresetGroup(entity.body, action.id)
        : patchPresetGroup(entity.body, action.id, nullsToUndefined(action.patch));
    const changes: CapabilityChange[] = [{
      path: "body.groups",
      label: `${action.type} preset group`,
      before: entity.body.groups,
      after: body.groups,
    }];
    if (!deepEq(entity.body.prompts, body.prompts)) {
      changes.push({
        path: "body.prompts",
        label: "clear removed group membership",
        before: entity.body.prompts,
        after: body.prompts,
      });
    }
    return presetPreview(entity, body, changes);
  },
});

export default capability;
