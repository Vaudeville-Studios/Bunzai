/** Revision-checked writes to the calling package's own namespace. */
import { z } from "zod";
import { bindExtensionOperation, EXTENSION_HOSTS, type ExtensionOperationDefinition, type ExtensionOperationMetadata } from "../../contracts/operation";
import { decodeJsonValue, digestJson } from "../../contracts/value";
import type { ExtensionOperationServices } from "../_services";
import { deleteResultSchema, keySchema, valueSchema, writeResultSchema } from "./_schemas";

const revision = z.number().int().min(-1).max(Number.MAX_SAFE_INTEGER);
const setInput = z.strictObject({ key: keySchema, value: valueSchema, expectedRevision: revision });
const deleteInput = z.strictObject({ key: keySchema, expectedRevision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER) });
const metadata = <I, O extends { status: string }>(id: string, title: string, description: string, input: z.ZodType<I>, output: z.ZodType<O>, field: string, estimate: (args: I) => number): ExtensionOperationMetadata<I, O> => ({
  id, version: 1, inputVersion: 1, outputVersion: 1, projectionVersion: 1, title, description,
  input, output, effect: "write", sensitivity: "private", hosts: EXTENSION_HOSTS,
  policy: { resources: [], fields: [field], destinationMode: "none", destinations: [], methods: [], budget: "write", confirmation: "effect" },
  receiptStatus: (value) => value.status === "saved" || value.status === "deleted" ? "committed" : "conflicted",
  estimateBudget: (args) => ({ bytes: estimate(args), tokens: 0 }), measureTokens: () => 0,
  resolveAccess: () => ({ resources: [], fields: [field], methods: [], destinations: [] }), project: (value) => decodeJsonValue(value),
});
const setDefinition: ExtensionOperationDefinition<z.infer<typeof setInput>, z.infer<typeof writeResultSchema>, ExtensionOperationServices> = {
  metadata: metadata("storage.set", "Store a value", "Write one value to this package's own namespace at an expected revision.", setInput, writeResultSchema, "data", ({ value }) => new TextEncoder().encode(JSON.stringify(value)).byteLength + 1_000),
  review: async ({ key, value, expectedRevision }, context) => ({ operation: "storage.set", packageId: context.principal.packageId, key, expectedRevision, valueBytes: new TextEncoder().encode(JSON.stringify(value)).byteLength, valueDigest: await digestJson(value) }),
  execute: async ({ key, value, expectedRevision }, context, services) => {
    if (!context.access.fields.includes("data")) throw new Error("extension data write is not granted");
    if (!services.storage) throw new Error("extension data storage is unavailable on this host");
    return services.storage.write(context.principal.packageId, key, value, expectedRevision, context.commit);
  },
};
const deleteDefinition: ExtensionOperationDefinition<z.infer<typeof deleteInput>, z.infer<typeof deleteResultSchema>, ExtensionOperationServices> = {
  metadata: metadata("storage.delete", "Delete stored data", "Delete one key from this package's own namespace at an expected revision.", deleteInput, deleteResultSchema, "data", () => 1_000),
  review: async ({ key, expectedRevision }, context, services) => {
    if (!services.storage) throw new Error("extension data storage is unavailable on this host");
    const current = await services.storage.read(context.principal.packageId, key);
    return { operation: "storage.delete", packageId: context.principal.packageId, key, expectedRevision, currentRevision: current?.revision ?? null, valueDigest: current ? await digestJson(current.value) : null };
  },
  execute: async ({ key, expectedRevision }, context, services) => {
    if (!context.access.fields.includes("data")) throw new Error("extension data delete is not granted");
    if (!services.storage) throw new Error("extension data storage is unavailable on this host");
    return services.storage.delete(context.principal.packageId, key, expectedRevision, context.commit);
  },
};
export const storageWriteOperations = [setDefinition, deleteDefinition] as const;
export const createOperations = (services: ExtensionOperationServices) => storageWriteOperations.map((item) => bindExtensionOperation(item as ExtensionOperationDefinition<unknown, unknown, ExtensionOperationServices>, services));
export default storageWriteOperations;
