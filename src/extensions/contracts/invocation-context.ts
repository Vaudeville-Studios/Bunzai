/** Purpose: validate the bounded host-selected resource snapshot passed separately from guest input. */
import { z } from "zod";
import type { ResourceRef } from "./operation";

export const MAX_EXTENSION_INVOCATION_RESOURCES = 16;
const resource = z.strictObject({ kind: z.string().min(1).max(80), id: z.string().min(1).max(160) });

export const extensionInvocationContextSchema = z.strictObject({
  resources: z.array(resource).max(MAX_EXTENSION_INVOCATION_RESOURCES),
}).superRefine(({ resources }, context) => {
  if (new Set(resources.map(({ kind, id }) => `${kind}:${id}`)).size !== resources.length) {
    context.addIssue({ code: "custom", message: "invocation resources must be unique" });
  }
});

export type ExtensionInvocationContext = z.infer<typeof extensionInvocationContextSchema>;

export function snapshotInvocationResources(resources: readonly ResourceRef[]): readonly ResourceRef[] {
  const parsed = extensionInvocationContextSchema.parse({ resources });
  return Object.freeze(parsed.resources.map((item) => Object.freeze({ ...item })));
}
