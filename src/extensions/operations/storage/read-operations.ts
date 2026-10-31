/** Read only the active package's bounded key/value namespace. */
import { z } from "zod";
import { bindExtensionOperation, EXTENSION_HOSTS, PROMPT_SAFE_READ_ORIGINS, type ExtensionOperationDefinition, type ExtensionOperationMetadata } from "../../contracts/operation";
import { decodeJsonValue } from "../../contracts/value";
import type { ExtensionOperationServices } from "../_services";
import { dataResultSchema, keySchema, safeKeyListSchema } from "./_schemas";

const getInput = z.strictObject({ key: keySchema });
const listInput = z.strictObject({});
const readMeta = <I, O>(id: string, title: string, input: z.ZodType<I>, output: z.ZodType<O>, field: string): ExtensionOperationMetadata<I, O> => ({
  id, version: 1, inputVersion: 1, outputVersion: 1, projectionVersion: 1, title, description: `Read this package's own ${field} data.`,
  input, output, effect: "read", sensitivity: "private", hosts: EXTENSION_HOSTS, activationOrigins: PROMPT_SAFE_READ_ORIGINS,
  policy: { resources: [], fields: [field], destinationMode: "none", destinations: [], methods: [], budget: "read-small", confirmation: "none" },
  estimateBudget: () => ({ bytes: 70_000, tokens: 0 }), measureTokens: () => 0,
  resolveAccess: () => ({ resources: [], fields: [field], methods: [], destinations: [] }), project: (value) => decodeJsonValue(value),
});
const getDefinition: ExtensionOperationDefinition<z.infer<typeof getInput>, z.infer<typeof dataResultSchema>, ExtensionOperationServices> = {
  metadata: readMeta("storage.get", "Read stored data", getInput, dataResultSchema, "data"),
  execute: async ({ key }, context, services) => {
    if (!context.access.fields.includes("data")) throw new Error("extension data read is not granted");
    if (!services.storage) throw new Error("extension data storage is unavailable on this host");
    const result = await services.storage.read(context.principal.packageId, key);
    return { key, value: result?.value ?? null, revision: result?.revision ?? null };
  },
};
const listDefinition: ExtensionOperationDefinition<z.infer<typeof listInput>, z.infer<typeof safeKeyListSchema>, ExtensionOperationServices> = {
  metadata: readMeta("storage.list", "List stored data keys", listInput, safeKeyListSchema, "keys"),
  execute: async (_args, context, services) => {
    if (!context.access.fields.includes("keys")) throw new Error("extension data listing is not granted");
    if (!services.storage) throw new Error("extension data storage is unavailable on this host");
    const keys = [...new Set(await services.storage.list(context.principal.packageId, 200))].sort();
    return { keys: keys.slice(0, 200), truncated: keys.length >= 200 };
  },
};
export const storageReadOperations = [getDefinition, listDefinition] as const;
export const createOperations = (services: ExtensionOperationServices) => storageReadOperations.map((item) => bindExtensionOperation(item as ExtensionOperationDefinition<unknown, unknown, ExtensionOperationServices>, services));
export default storageReadOperations;
