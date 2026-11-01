/** Read the calling package's validated settings and immutable schema. */
import { z } from "zod";
import { bindExtensionOperation, EXTENSION_HOSTS, PROMPT_SAFE_READ_ORIGINS, type ExtensionOperationDefinition } from "../../contracts/operation";
import { jsonValueSchemaBounded, decodeJsonValue } from "../../contracts/value";
import type { ExtensionOperationServices } from "../_services";

const input = z.strictObject({});
const output = z.strictObject({ schema: jsonValueSchemaBounded, value: jsonValueSchemaBounded.nullable(), revision: z.number().int().min(-1) });
const definition: ExtensionOperationDefinition<Record<string, never>, z.infer<typeof output>, ExtensionOperationServices> = {
  metadata: {
    id: "settings.read", version: 1, inputVersion: 1, outputVersion: 1, projectionVersion: 1,
    title: "Read extension settings", description: "Read this package's validated settings and declared schema.",
    input, output, effect: "read", sensitivity: "private", hosts: EXTENSION_HOSTS, activationOrigins: PROMPT_SAFE_READ_ORIGINS,
    policy: { resources: [], fields: ["settings"], methods: [], destinations: [], destinationMode: "none", budget: "read-small", confirmation: "none" },
    estimateBudget: () => ({ bytes: 70_000, tokens: 0 }), measureTokens: () => 0,
    resolveAccess: () => ({ resources: [], fields: ["settings"], methods: [], destinations: [] }),
    project: (value) => decodeJsonValue(value),
  },
  execute: async (_args, context, services) => {
    /* clone-ok: this is a read-only lookup; settings.update uses a separately confirmed CAS write door. */
    if (!context.access.fields.includes("settings")) throw new Error("extension settings read is not granted");
    if (!services.settings) throw new Error("extension settings are unavailable on this host");
    return output.parse(await services.settings.read(context.principal.packageId, context.principal.packageDigest));
  },
};
export const settingsReadOperations = [definition] as const;
export const createOperations = (services: ExtensionOperationServices) => settingsReadOperations.map((item) => bindExtensionOperation(item, services));
export default settingsReadOperations;
