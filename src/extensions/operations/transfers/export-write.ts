/** Write an already reviewed export through the package's independently granted file-write operation. */
import { z } from "zod";
import { bindExtensionOperation, DESKTOP_TERMINAL_EXTENSION_HOSTS, type ExtensionOperationDefinition, type ExtensionOperationMetadata } from "../../contracts/operation";
import type { ExtensionOperationServices } from "../_services";

const input = z.strictObject({ previewId: z.string().min(1).max(120) });
const output = z.strictObject({ written: z.boolean() });
type Input = z.infer<typeof input>;
type Output = z.infer<typeof output>;
const metadata: ExtensionOperationMetadata<Input, Output> = {
  id: "export.write", version: 1, inputVersion: 1, outputVersion: 1, projectionVersion: 1,
  title: "Write a reviewed export", description: "Write a staged export through the separately granted files.write.apply operation, which owns the exact host file review.",
  input, output, effect: "write", sensitivity: "private", hosts: DESKTOP_TERMINAL_EXTENSION_HOSTS,
  delegates: ["files.write.apply"],
  policy: { resources: [], fields: ["file.contents"], methods: [], destinations: [], destinationMode: "none", budget: "write", confirmation: "none" },
  receiptStatus: (value) => value.written ? "committed" : "conflicted",
  estimateBudget: () => ({ bytes: 4_096, tokens: 0 }), measureTokens: () => 0,
  resolveAccess: () => ({ resources: [], fields: ["file.contents"], methods: [], destinations: [] }),
  project: (value) => output.parse(value),
};
const operation: ExtensionOperationDefinition<Input, Output, ExtensionOperationServices> = {
  metadata,
  execute: async ({ previewId }, context) => {
    if (!context.access.fields.includes("file.contents") || !context.invoke) throw new Error("The reviewed file write is unavailable under this grant.");
    return output.parse(await context.invoke("files.write.apply", { previewId }));
  },
};
export const transferExportWriteOperations = [operation] as const;
export const createOperations = (services: ExtensionOperationServices) => transferExportWriteOperations.map((item) => bindExtensionOperation(item, services));
export default transferExportWriteOperations;
