/** Serialize one exactly granted canonical piece and preview it against a host-selected file handle. */
import { z } from "zod";
import { SHA256_HEX_PATTERN } from "../../../core/sha256";
import { STUDIO_ENTITY_KINDS } from "../../../studio/path-policy";
import { bindExtensionOperation, DESKTOP_TERMINAL_EXTENSION_HOSTS, type ExtensionOperationDefinition, type ExtensionOperationMetadata } from "../../contracts/operation";
import { decodeJsonValue } from "../../contracts/value";
import type { ExtensionOperationServices } from "../_services";
import { contentReadResultSchema } from "../content/read";
import { MAX_FILE_BYTES, encodeFileBytes } from "../files/_bytes";
import { fileWritePreviewResultSchema } from "../files/write-operations";
import { transferReportSchema } from "./_report";

const input = z.strictObject({ handleId: z.string().min(1).max(120), formatId: z.string().min(1).max(80), kind: z.enum(STUDIO_ENTITY_KINDS), id: z.string().min(1).max(120) });
const output = z.strictObject({ format: z.strictObject({ id: z.string().min(1).max(80), label: z.string().min(1).max(120) }), preview: z.strictObject({ previewId: z.string().min(1).max(120), proposedBytes: z.number().int().min(0).max(MAX_FILE_BYTES), proposedDigest: z.string().regex(SHA256_HEX_PATTERN) }), report: transferReportSchema });
type Input = z.infer<typeof input>;
type Output = z.infer<typeof output>;
const metadata: ExtensionOperationMetadata<Input, Output> = {
  id: "export.preview", version: 1, inputVersion: 1, outputVersion: 1, projectionVersion: 1,
  title: "Preview one content export", description: "Serialize one approved canonical piece with its fidelity report and preview the bytes for a host-selected file.",
  input, output, effect: "read", sensitivity: "private", hosts: DESKTOP_TERMINAL_EXTENSION_HOSTS,
  policy: { resources: [...STUDIO_ENTITY_KINDS], fields: ["body", "file.contents"], methods: [], destinations: [], destinationMode: "none", budget: "read-large", confirmation: "none" },
  estimateBudget: () => ({ bytes: 20_000, tokens: 0 }), measureTokens: () => 0,
  resolveAccess: ({ kind, id }) => ({ resources: [{ kind, id }], fields: ["body", "file.contents"], methods: [], destinations: [] }),
  project: (value) => decodeJsonValue(output.parse(value)),
};

const definition: ExtensionOperationDefinition<Input, Output, ExtensionOperationServices> = {
  metadata,
  execute: async ({ handleId, formatId, kind, id }, context, services) => {
    if (!context.access.resources.some((resource) => resource.kind === kind && resource.id === id)
      || !context.access.fields.includes("body") || !context.access.fields.includes("file.contents")) throw new Error("Export access is outside the approved grant.");
    if (!context.invoke || !services.formats || !services.transfers) throw new Error("Canonical export is unavailable on this host.");
    const read = contentReadResultSchema.parse(await context.invoke("content.read", { kind, id, groups: ["body"] }));
    if (!read.body) throw new Error("The selected content is unavailable.");
    const entity = await services.transfers.readCanonical(kind, id, context.access.resources);
    if (!entity || entity.kind !== kind || entity.id !== id) throw new Error("The selected content is unavailable.");
    const serialized = services.formats.serialize(formatId, entity);
    if (!serialized || serialized.bytes.byteLength > MAX_FILE_BYTES) throw new Error("The selected format cannot serialize this piece within the file size limit.");
    const preview = fileWritePreviewResultSchema.parse(await context.invoke("files.write.preview", { handleId, base64: encodeFileBytes(serialized.bytes) }));
    if (!preview) throw new Error("The selected file handle is unavailable.");
    return output.parse({ format: { id: serialized.adapterId, label: serialized.label }, preview, report: serialized.report });
  },
};

export const transferExportOperations = [definition] as const;
export const createOperations = (services: ExtensionOperationServices) => transferExportOperations.map((item) => bindExtensionOperation(item, services));
export default transferExportOperations;
