/** Bounded file preview and host-confirmed apply; guest code never chooses native paths. */
import { z } from "zod";
import { SHA256_HEX_PATTERN } from "../../../core/sha256";
import { bindExtensionOperation, DESKTOP_TERMINAL_EXTENSION_HOSTS, type ExtensionOperationDefinition, type ExtensionOperationMetadata } from "../../contracts/operation";
import { fileWriteEffectReviewSchema } from "../../contracts/file-actions";
import { decodeJsonValue } from "../../contracts/value";
import type { ExtensionOperationServices } from "../_services";
import { decodeFileBytes, MAX_FILE_BYTES } from "./_bytes";

const previewInput = z.strictObject({ handleId: z.string().min(1).max(120), base64: z.string().max(Math.ceil(MAX_FILE_BYTES / 3) * 4) });
export const fileWritePreviewResultSchema = z.strictObject({ previewId: z.string().min(1).max(120), proposedBytes: z.number().int().nonnegative().max(MAX_FILE_BYTES), proposedDigest: z.string().regex(SHA256_HEX_PATTERN) }).nullable();
const previewOutput = fileWritePreviewResultSchema;
const applyInput = z.strictObject({ previewId: z.string().min(1).max(120) });
const applyOutput = z.strictObject({ written: z.boolean() });
type PreviewInput = z.infer<typeof previewInput>;
type ApplyInput = z.infer<typeof applyInput>;
const metadata = <I, O>(id: string, title: string, description: string, input: z.ZodType<I>, output: z.ZodType<O>, effect: "read" | "write", confirmation: "none" | "effect", budget: "read-large" | "write"): ExtensionOperationMetadata<I, O> => ({
  id, version: 1, inputVersion: 1, outputVersion: 1, projectionVersion: 1, title, description,
  input, output, effect, sensitivity: "private", hosts: DESKTOP_TERMINAL_EXTENSION_HOSTS,
  policy: { resources: [], fields: ["file.contents"], methods: [], destinations: [], destinationMode: "none", budget, confirmation },
  estimateBudget: () => ({ bytes: MAX_FILE_BYTES + 2_000, tokens: 0 }), measureTokens: () => 0,
  resolveAccess: () => ({ resources: [], fields: ["file.contents"], methods: [], destinations: [] }), project: (value) => decodeJsonValue(value),
});
const preview: ExtensionOperationDefinition<PreviewInput, z.infer<typeof previewOutput>, ExtensionOperationServices> = {
  metadata: metadata("files.write.preview", "Preview file contents", "Stage up to 180 KB of replacement bytes and inspect the selected file's current snapshot.", previewInput, previewOutput, "read", "none", "read-large"),
  execute: async ({ handleId, base64 }, context, services) => {
    if (!context.access.fields.includes("file.contents")) throw new Error("File contents are outside the approved grant.");
    if (context.host !== "desktop" && context.host !== "terminal" || !services.files) throw new Error("Host file access is unavailable on this host.");
    return await services.files.previewWrite({ packageName: context.principal.packageId, principal: context.principal, handleId, bytes: decodeFileBytes(base64), signal: context.signal });
  },
};
const apply: ExtensionOperationDefinition<ApplyInput, z.infer<typeof applyOutput>, ExtensionOperationServices> = {
  metadata: metadata("files.write.apply", "Write a chosen file", "Review the exact file snapshot and bytes, then wait for the host's explicit write action.", applyInput, applyOutput, "write", "effect", "write"),
  review: async ({ previewId }, context, services) => {
    if (context.host !== "desktop" && context.host !== "terminal" || !services.files) throw new Error("Host file access is unavailable on this host.");
    const detail = services.files.reviewWrite(previewId, context.principal);
    const ticket = services.files.stageWrite({ packageName: context.principal.packageId, principal: context.principal, previewId, signal: context.signal });
    if (ticket.action !== "write") throw new Error("The file write could not be staged.");
    return fileWriteEffectReviewSchema.extend({ hostAction: z.strictObject({ kind: z.literal("bunzai.file.write"), ticketId: z.string().min(1).max(120) }) }).parse({ kind: "bunzai.file.write", ticketId: ticket.id, ...detail, hostAction: { kind: "bunzai.file.write", ticketId: ticket.id } });
  },
  execute: async ({ previewId }, context, services) => {
    if (!context.access.fields.includes("file.contents")) throw new Error("File contents are outside the approved grant.");
    if (context.host !== "desktop" && context.host !== "terminal" || !services.files) throw new Error("Host file access is unavailable on this host.");
    const result = await services.files.write({ packageName: context.principal.packageId, principal: context.principal, previewId, signal: context.signal });
    if (result === "ambiguous") throw new Error("The file write outcome is uncertain. Check the selected file before retrying.");
    if (result !== "written") throw new Error("The file write was cancelled before it completed.");
    return { written: true };
  },
};
export const fileWriteOperations = [preview, apply] as const;
export const createOperations = (services: ExtensionOperationServices) => fileWriteOperations.map((item) => bindExtensionOperation(item as ExtensionOperationDefinition<unknown, unknown, ExtensionOperationServices>, services));
export default fileWriteOperations;
