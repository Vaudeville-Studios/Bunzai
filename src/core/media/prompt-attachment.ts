/** Public, value-only identity for a file shown in a prompt request. It carries no bytes or storage reference. */
import { z } from "zod";
import { PROMPT_ATTACHMENT_REQUEST_COUNT } from "./limits";

export const promptAttachmentNameSchema = z.string().min(1).max(255).refine((name) => !/[\\/\u0000-\u001f\u007f]/u.test(name), "filename must be a name, not a path");
export const promptAttachmentInfoSchema = z.strictObject({
  message: z.number().int().nonnegative(),
  name: promptAttachmentNameSchema,
  kind: z.enum(["image", "pdf", "text"]),
  owner: z.string().max(255).optional(),
});
export type PromptAttachmentInfo = z.infer<typeof promptAttachmentInfoSchema>;
export const promptAttachmentInfoListSchema = z.array(promptAttachmentInfoSchema).max(PROMPT_ATTACHMENT_REQUEST_COUNT);

/** Bounds display-only provenance without changing the authored block name. */
export function promptAttachmentOwnerLabel(name: string): string {
  const safe = name.replace(/[\u0000-\u001f\u007f]/gu, " ");
  return safe.length <= 255 ? safe : `${safe.slice(0, 252)}...`;
}

export const hasUnpricedPromptMedia = (files: readonly PromptAttachmentInfo[]): boolean => files.some((file) => file.kind !== "text");
