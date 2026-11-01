/** Revision-checked settings updates validated against the installed package schema. */
import { z } from "zod";
import { bindExtensionOperation, EXTENSION_HOSTS, type ExtensionOperationDefinition } from "../../contracts/operation";
import { decodeJsonValue, digestJson, jsonValueSchemaBounded } from "../../contracts/value";
import { validateExtensionSettings } from "../../contracts/package-validation";
import type { ExtensionOperationServices } from "../_services";
import { isRecord } from "../../../core/guards";

const revision = z.number().int().min(-1).max(Number.MAX_SAFE_INTEGER);
const input = z.strictObject({ value: jsonValueSchemaBounded, expectedRevision: revision });
const output = z.strictObject({ status: z.enum(["saved", "stale"]), revision: z.number().int().nonnegative().optional() });
type Input = z.infer<typeof input>;
const definition: ExtensionOperationDefinition<Input, z.infer<typeof output>, ExtensionOperationServices> = {
  metadata: {
    id: "settings.update", version: 1, inputVersion: 1, outputVersion: 1, projectionVersion: 1,
    title: "Update extension settings", description: "Validate and save this package's settings at an expected revision.",
    input, output, effect: "write", sensitivity: "private", hosts: EXTENSION_HOSTS,
    policy: { resources: [], fields: ["settings"], methods: [], destinations: [], destinationMode: "none", budget: "write", confirmation: "effect" },
    receiptStatus: (value) => value.status === "saved" ? "committed" : "conflicted",
    estimateBudget: ({ value }) => ({ bytes: new TextEncoder().encode(JSON.stringify(value)).byteLength + 2_000, tokens: 0 }), measureTokens: () => 0,
    resolveAccess: () => ({ resources: [], fields: ["settings"], methods: [], destinations: [] }),
    project: (value) => decodeJsonValue(value),
  },
  review: async ({ value, expectedRevision }, context, services) => {
    if (!services.settings) throw new Error("extension settings are unavailable on this host");
    const current = await services.settings.read(context.principal.packageId, context.principal.packageDigest);
    const validated = validateExtensionSettings(current.schema, value);
    const keys = (candidate: unknown) => isRecord(candidate) ? Object.keys(candidate).sort().slice(0, 64) : [];
    return decodeJsonValue({ operation: "settings.update", packageId: context.principal.packageId, expectedRevision, currentRevision: current.revision,
      beforeDigest: current.value === null ? null : await digestJson(current.value), afterDigest: await digestJson(validated), propertyNames: keys(validated) });
  },
  execute: async ({ value, expectedRevision }, context, services) => {
    /* clone-ok: this is a separately confirmed revision-checked mutation, unlike settings.read. */
    if (!context.access.fields.includes("settings")) throw new Error("extension settings write is not granted");
    if (!services.settings) throw new Error("extension settings are unavailable on this host");
    return output.parse(await services.settings.write(context.principal.packageId, context.principal.packageDigest, value, expectedRevision, context.commit));
  },
};
export const settingsWriteOperations = [definition] as const;
export const createOperations = (services: ExtensionOperationServices) => settingsWriteOperations.map((item) => bindExtensionOperation(item, services));
export default settingsWriteOperations;
