/** Semantic item lifecycle for a pack's default or named group. */
import { z } from "zod";
import { defineContentCapability } from "../../_shared/define-content-capability";
import { CONTENT_DRAFT_HOSTS } from "../../capabilities/types";
import { nonEmptyPatch } from "../../_shared/capability-schemas";
import type { CanonicalPack } from "../schema";
import { addPackItem, patchPackItem, removePackItem, reorderPack } from "../operations";
import { preview, targetSchema } from "./shared";

const item = z.strictObject({
  id: z.string().min(1),
  label: z.string().min(1),
  ref: z.string().min(1),
  mime: z.string().optional(),
});
const patch = nonEmptyPatch({
  label: z.string().min(1).optional(),
  ref: z.string().min(1).optional(),
  mime: z.string().nullable().optional(),
});
const operation = z.union([
  z.strictObject({ type: z.literal("add"), item }),
  z.strictObject({ type: z.literal("update"), id: z.string().min(1), patch }),
  z.strictObject({ type: z.literal("remove"), id: z.string().min(1) }),
  z.strictObject({ type: z.literal("reorder"), orderedIds: z.array(z.string().min(1)) }),
]);
const input = z.strictObject({ target: targetSchema, operation });

const capability = defineContentCapability<z.infer<typeof input>, CanonicalPack>({
  id: "pack.items.manage",
  kind: "pack",
  area: "items",
  action: "manage",
  summary: "Add, edit, remove, or reorder typed media items in the default or a named pack group.",
  aliases: ["pack face", "expression image", "sprite item", "reorder faces"],
  extensionExposure: { operationId: "content.draft.pack.items.manage", fields: [{ input: "operation", path: "body.pack.items" }, { input: "operation", path: "body.groups" }], hosts: CONTENT_DRAFT_HOSTS, budget: "write", confirmation: "effect" },
  input,
  preview: (entity, { target, operation }) => {
    const body = operation.type === "add"
      ? addPackItem(entity.body, operation.item, target.groupId)
      : operation.type === "remove"
        ? removePackItem(entity.body, operation.id, target.groupId)
        : operation.type === "reorder"
          ? reorderPack(entity.body, operation.orderedIds, target.groupId)
          : patchPackItem(entity.body, operation.id, {
              ...operation.patch,
              mime: operation.patch.mime ?? undefined,
            }, target.groupId);
    return preview(entity, body, [{
      path: target.groupId ? `body.groups.${target.groupId}.items` : "body.pack.items",
      label: `${operation.type} pack item`,
      before: entity.body,
      after: body,
    }]);
  },
});

export default capability;
