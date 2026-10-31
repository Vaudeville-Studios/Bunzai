/** Convert one user-selected file into another registered canonical format without persistence. */
import { z } from "zod";
import { SHA256_HEX_PATTERN } from "../../../core/sha256";
import { STUDIO_ENTITY_KINDS } from "../../../studio/path-policy";
import { bindExtensionOperation, DESKTOP_TERMINAL_EXTENSION_HOSTS, type ExtensionOperationDefinition, type ExtensionOperationMetadata } from "../../contracts/operation";
import { decodeJsonValue } from "../../contracts/value";
import type { ExtensionOperationServices } from "../_services";
import { fileReadResultSchema } from "../files/pick-read";
import { decodeFileBytes, digestFileBytes, encodeFileBytes, MAX_FILE_BYTES } from "../files/_bytes";
import { fileWritePreviewResultSchema } from "../files/write-operations";
import { transferReportSchema } from "./_report";

const input = z.strictObject({ sourceHandleId: z.string().min(1).max(120), targetHandleId: z.string().min(1).max(120), targetFormatId: z.string().min(1).max(80) });
const output = z.strictObject({ source: z.strictObject({ id: z.string().min(1).max(80), label: z.string().min(1).max(120), kind: z.enum(STUDIO_ENTITY_KINDS) }), target: z.strictObject({ id: z.string().min(1).max(80), label: z.string().min(1).max(120) }), preview: z.strictObject({ previewId: z.string().min(1).max(120), proposedBytes: z.number().int().min(0).max(MAX_FILE_BYTES), proposedDigest: z.string().regex(SHA256_HEX_PATTERN) }), report: transferReportSchema });
type Input = z.infer<typeof input>;
type Output = z.infer<typeof output>;
const metadata: ExtensionOperationMetadata<Input, Output> = {
  id: "transfer.preview", version: 1, inputVersion: 1, outputVersion: 1, projectionVersion: 1,
  title: "Preview a format transfer", description: "Parse one selected source file and stage its canonical conversion into another selected file; no content is stored.",
  input, output, effect: "read", sensitivity: "private", hosts: DESKTOP_TERMINAL_EXTENSION_HOSTS,
  policy: { resources: [], fields: ["file.contents"], methods: [], destinations: [], destinationMode: "none", budget: "read-large", confirmation: "none" },
  estimateBudget: () => ({ bytes: MAX_FILE_BYTES + 20_000, tokens: 0 }), measureTokens: () => 0,
  resolveAccess: () => ({ resources: [], fields: ["file.contents"], methods: [], destinations: [] }),
  project: (value) => decodeJsonValue(output.parse(value)),
};
const definition: ExtensionOperationDefinition<Input, Output, ExtensionOperationServices> = {
  metadata,
  execute: async ({ sourceHandleId, targetHandleId, targetFormatId }, context, services) => {
    if (!context.invoke || !services.formats || !context.access.fields.includes("file.contents")) throw new Error("Format transfer is unavailable on this host.");
    const selected = fileReadResultSchema.parse(await context.invoke("files.read", { handleId: sourceHandleId, maxBytes: MAX_FILE_BYTES }));
    if (!selected) throw new Error("The selected source file is unavailable.");
    const bytes = decodeFileBytes(selected.base64);
    if (bytes.byteLength !== selected.bytes || digestFileBytes(bytes) !== selected.digest) throw new Error("The selected source file changed during transfer.");
    let text: string | undefined;
    try { text = new TextDecoder("utf-8", { fatal: true }).decode(bytes); } catch { /* binary adapters use bytes only */ }
    const source = services.formats.parse({ bytes, ...(text === undefined ? {} : { text }) });
    if (!source) throw new Error("The source file is not a supported canonical format.");
    const target = services.formats.serialize(targetFormatId, source.entity);
    if (!target || target.bytes.byteLength > MAX_FILE_BYTES) throw new Error("The target format cannot represent this piece within the selected-file limit.");
    const preview = fileWritePreviewResultSchema.parse(await context.invoke("files.write.preview", { handleId: targetHandleId, base64: encodeFileBytes(target.bytes) }));
    if (!preview) throw new Error("The selected target file handle is unavailable.");
    return output.parse({ source: { id: source.adapterId, label: source.label, kind: source.entity.kind }, target: { id: target.adapterId, label: target.label }, preview, report: target.report });
  },
};

export const transferPreviewOperations = [definition] as const;
export const createOperations = (services: ExtensionOperationServices) => transferPreviewOperations.map((item) => bindExtensionOperation(item, services));
export default transferPreviewOperations;
