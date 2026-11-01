/** Host-mediated native file selection and bounded reads for desktop extensions. */
import { z } from "zod";
import { SHA256_HEX_PATTERN } from "../../../core/sha256";
import { bindExtensionOperation, DESKTOP_TERMINAL_EXTENSION_HOSTS, type ExtensionOperationDefinition, type ExtensionOperationMetadata } from "../../contracts/operation";
import { fileHandleInfoSchema } from "../../contracts/file-actions";
import { decodeJsonValue } from "../../contracts/value";
import type { ExtensionOperationServices } from "../_services";
import { digestFileBytes, encodeFileBytes, MAX_FILE_BYTES } from "./_bytes";

const modes = z.enum(["read", "create", "overwrite"]);
const pickInput = z.strictObject({ mode: modes, suggestedName: z.string().min(1).max(255).optional() });
const pickOutput = fileHandleInfoSchema.nullable();
const readInput = z.strictObject({ handleId: z.string().min(1).max(120), maxBytes: z.number().int().min(0).max(MAX_FILE_BYTES) });
export const fileReadResultSchema = z.strictObject({ bytes: z.number().int().min(0).max(MAX_FILE_BYTES), digest: z.string().regex(SHA256_HEX_PATTERN), base64: z.string().max(Math.ceil(MAX_FILE_BYTES / 3) * 4) }).nullable();
const readOutput = fileReadResultSchema;
type PickInput = z.infer<typeof pickInput>;
type ReadInput = z.infer<typeof readInput>;
const metadata = <I, O>(id: string, title: string, description: string, input: z.ZodType<I>, output: z.ZodType<O>, fields: readonly string[], budget: "read-small" | "read-large"): ExtensionOperationMetadata<I, O> => ({
  id, version: 1, inputVersion: 1, outputVersion: 1, projectionVersion: 1, title, description,
  input, output, effect: "read", sensitivity: "private", hosts: DESKTOP_TERMINAL_EXTENSION_HOSTS,
  policy: { resources: [], fields, methods: [], destinations: [], destinationMode: "none", budget, confirmation: "none" },
  estimateBudget: () => ({ bytes: MAX_FILE_BYTES + 2_000, tokens: 0 }), measureTokens: () => 0,
  resolveAccess: () => ({ resources: [], fields, methods: [], destinations: [] }), project: (value) => decodeJsonValue(value),
});
const pick: ExtensionOperationDefinition<PickInput, z.infer<typeof pickOutput>, ExtensionOperationServices> = {
  metadata: metadata("files.pick", "Choose a file", "Ask the host to select a file or create a new file handle.", pickInput, pickOutput, [], "read-small"),
  execute: async ({ mode, suggestedName }, context, services) => {
    context.signal.throwIfAborted();
    if (context.host !== "desktop" && context.host !== "terminal" || !services.files) throw new Error("Host file selection is unavailable on this host.");
    return await services.files.pick({ packageName: context.principal.packageId, principal: context.principal, mode, suggestedName, signal: context.signal });
  },
};
const read: ExtensionOperationDefinition<ReadInput, z.infer<typeof readOutput>, ExtensionOperationServices> = {
  metadata: metadata("files.read", "Read a chosen file", "Read the entire host-selected file, up to the approved byte limit.", readInput, readOutput, ["file.contents"], "read-large"),
  execute: async ({ handleId, maxBytes }, context, services) => {
    if (!context.access.fields.includes("file.contents")) throw new Error("File contents are outside the approved grant.");
    if (context.host !== "desktop" && context.host !== "terminal" || !services.files) throw new Error("Host file access is unavailable on this host.");
    const bytes = await services.files.read({ packageName: context.principal.packageId, principal: context.principal, handleId, maxBytes, signal: context.signal });
    return bytes === null ? null : { bytes: bytes.byteLength, digest: digestFileBytes(bytes), base64: encodeFileBytes(bytes) };
  },
};
export const filePickReadOperations = [pick, read] as const;
export const createOperations = (services: ExtensionOperationServices) => filePickReadOperations.map((item) => bindExtensionOperation(item as ExtensionOperationDefinition<unknown, unknown, ExtensionOperationServices>, services));
export default filePickReadOperations;
