/** Shared bounded shape for own-namespace extension data operations. */
import { z } from "zod";
import { EXTENSION_SETTINGS_DATA_KEY } from "../settings/_services";

export const keySchema = z.string().regex(/^[a-z0-9][a-z0-9._-]{0,127}$/).refine((key) => key !== EXTENSION_SETTINGS_DATA_KEY, "reserved extension data key");
export const valueSchema = z.json().superRefine((value, context) => {
  if (new TextEncoder().encode(JSON.stringify(value)).byteLength > 64_000) context.addIssue({ code: "custom", message: "value exceeds the 64 KB extension data limit" });
});
export const safeKeyListSchema = z.strictObject({ keys: z.array(keySchema).max(200), truncated: z.boolean() });
export const dataResultSchema = z.strictObject({ key: keySchema, value: valueSchema.nullable(), revision: z.number().int().nonnegative().nullable() });
export const writeResultSchema = z.strictObject({ status: z.enum(["saved", "stale"]), revision: z.number().int().nonnegative().optional() });
export const deleteResultSchema = z.strictObject({ status: z.enum(["deleted", "stale"]) });
