/** Read one host-selected file through canonical adapters and stage a bounded create draft. */
import { z } from "zod";
import { STUDIO_ENTITY_KINDS } from "../../../studio/path-policy";
import { bindExtensionOperation, DESKTOP_TERMINAL_EXTENSION_HOSTS, type ExtensionOperationDefinition, type ExtensionOperationMetadata } from "../../contracts/operation";
import { decodeJsonValue } from "../../contracts/value";
import type { ExtensionOperationServices } from "../_services";
import { extensionDraftProjectionSchema } from "../content/_draft-services";
import { fileReadResultSchema } from "../files/pick-read";
import { decodeFileBytes, digestFileBytes, MAX_FILE_BYTES } from "../files/_bytes";

const input = z.strictObject({ handleId: z.string().min(1).max(120), kind: z.enum(STUDIO_ENTITY_KINDS), id: z.string().min(1).max(120) });
const output = z.strictObject({ source: z.strictObject({ formatId: z.string().min(1).max(80), label: z.string().min(1).max(120) }), draft: extensionDraftProjectionSchema.nullable() });
type Input = z.infer<typeof input>;
type Output = z.infer<typeof output>;
const metadata: ExtensionOperationMetadata<Input, Output> = {
  id: "import.preview", version: 1, inputVersion: 1, outputVersion: 1, projectionVersion: 1,
  title: "Preview one content import", description: "Read one host-selected file, parse one canonical piece, and stage it for reviewed creation. Imported scripts remain data.",
  input, output, effect: "read", sensitivity: "private", hosts: DESKTOP_TERMINAL_EXTENSION_HOSTS,
  policy: { resources: [...STUDIO_ENTITY_KINDS], fields: ["file.contents", "draft"], methods: [], destinations: [], destinationMode: "none", budget: "read-large", confirmation: "none" },
  estimateBudget: () => ({ bytes: 220_000, tokens: 0 }), measureTokens: () => 0,
  resolveAccess: ({ kind, id }) => ({ resources: [{ kind, id }], fields: ["file.contents", "draft"], methods: [], destinations: [] }),
  project: (value) => decodeJsonValue(output.parse(value)),
};

const definition: ExtensionOperationDefinition<Input, Output, ExtensionOperationServices> = {
  metadata,
  execute: async ({ handleId, kind, id }, context, services) => {
    if (!context.access.resources.some((resource) => resource.kind === kind && resource.id === id)
      || !context.access.fields.includes("file.contents") || !context.access.fields.includes("draft")) {
      throw new Error("Import access is outside the approved grant.");
    }
    if (!context.invoke || !services.formats) throw new Error("Canonical import is unavailable on this host.");
    const file = fileReadResultSchema.parse(await context.invoke("files.read", { handleId, maxBytes: MAX_FILE_BYTES }));
    if (!file) throw new Error("The selected file is unavailable.");
    const bytes = decodeFileBytes(file.base64);
    if (bytes.byteLength !== file.bytes || digestFileBytes(bytes) !== file.digest) throw new Error("The selected file changed during import.");
    let text: string | undefined;
    try { text = new TextDecoder("utf-8", { fatal: true }).decode(bytes); } catch { /* Binary adapters receive bytes only. */ }
    const parsed = services.formats.parse({ bytes, ...(text === undefined ? {} : { text }) });
    if (!parsed || parsed.entity.kind !== kind || parsed.entity.id !== id) throw new Error("The selected file does not contain the requested canonical piece.");
    const draftResult = await context.invoke("content.create.preview", decodeJsonValue(parsed.entity));
    const draft = z.strictObject({ draft: extensionDraftProjectionSchema.nullable() }).parse(draftResult).draft;
    return output.parse({ source: { formatId: parsed.adapterId, label: parsed.label }, draft });
  },
};

export const transferImportOperations = [definition] as const;
export const createOperations = (services: ExtensionOperationServices) => transferImportOperations.map((item) => bindExtensionOperation(item, services));
export default transferImportOperations;
