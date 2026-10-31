/** Bounded access to host-selected model connections through Kit's provider owner. */
import { z } from "zod";
import type { JsonValue } from "../../contracts/value";
import { decodeJsonValue } from "../../contracts/value";
import { bindExtensionOperation, DESKTOP_TERMINAL_EXTENSION_HOSTS, type ExtensionOperationDefinition, type ExtensionOperationMetadata } from "../../contracts/operation";
import type { ExtensionOperationServices } from "../_services";
import { extensionTokenReportSchema, type ExtensionModelServices } from "./_services";

const connectionId = z.string().regex(/^[A-Za-z0-9._:-]{1,120}$/);
const jobId = z.string().regex(/^[A-Za-z0-9_-]{8,80}$/);
const destination = (id: string) => `connection:${id}`;
const connectionAccess = (id: string, fields: string[]) => ({ resources: [{ kind: "host-connection", id }], fields, methods: [], destinations: [destination(id)] });
const metadata = <I, O>(value: Omit<ExtensionOperationMetadata<I, O>, "execute" | "resolveAccess" | "project">): Omit<ExtensionOperationMetadata<I, O>, "execute" | "resolveAccess" | "project"> => value;
const connectionOutput = z.strictObject({ id: connectionId, name: z.string().max(120), provider: z.string().max(80), model: z.string().max(200), hasKey: z.boolean() });
const modelOutput = z.strictObject({ id: z.string().min(1).max(200), label: z.string().max(200).optional(), context: z.number().int().positive().optional() });
const hosts = DESKTOP_TERMINAL_EXTENSION_HOSTS;
const base = <I, O>(id: string, title: string, description: string, input: z.ZodType<I>, output: z.ZodType<O>, config: { effect: "read" | "external" | "control"; sensitivity: "public" | "private" | "secret"; resources: string[]; fields: string[]; destinationMode: "none" | "host-selected-connection"; budget: "read-small" | "external" | "metadata"; confirmation: "none" | "sensitive-send" }) => metadata({
  id, version: 1, inputVersion: 1, outputVersion: 1, projectionVersion: 1, title, description, input, output,
  effect: config.effect, sensitivity: config.sensitivity, hosts,
  policy: { resources: config.resources, fields: config.fields, methods: [], destinationMode: config.destinationMode, destinations: [], budget: config.budget, confirmation: config.confirmation },
  estimateBudget: () => ({ bytes: 250_000, tokens: 0 }), measureTokens: () => 0,
});
const listInput = z.strictObject({ connectionId });
const listOutput = z.strictObject({ connection: connectionOutput.nullable(), models: z.array(modelOutput).max(100).nullable() });
const list: ExtensionOperationDefinition<z.infer<typeof listInput>, z.infer<typeof listOutput>, ExtensionModelServices | undefined> = {
  metadata: { ...base("models.list", "List models", "List models through one approved host connection; this sends no prompt content.", listInput, listOutput, { effect: "read", sensitivity: "private", resources: ["host-connection"], fields: ["models"], destinationMode: "host-selected-connection", budget: "read-small", confirmation: "none" }), resolveAccess: ({ connectionId: id }) => connectionAccess(id, ["models"]), project: (value) => decodeJsonValue(value) },
  execute: async ({ connectionId: id }, context, services) => {
    if (!services) throw new Error("model access is unavailable on this host");
    if (!context.access.destinations.includes(destination(id))) throw new Error("model connection is outside the approved grant");
    await context.assertCurrent();
    const [connection, models] = await Promise.all([services.describe(id), services.list(id, context.signal, context.assertCurrent)]);
    return { connection, models: models?.slice(0, 100) ?? null };
  },
};
const describeInput = z.strictObject({ connectionId });
const describe: ExtensionOperationDefinition<z.infer<typeof describeInput>, z.infer<typeof connectionOutput> | null, ExtensionModelServices | undefined> = {
  metadata: { ...base("models.describe", "Describe a model connection", "Read the safe description of one approved saved connection without exposing credentials or endpoint headers.", describeInput, connectionOutput.nullable(), { effect: "read", sensitivity: "private", resources: ["host-connection"], fields: ["models"], destinationMode: "host-selected-connection", budget: "read-small", confirmation: "none" }), resolveAccess: ({ connectionId: id }) => connectionAccess(id, ["models"]), project: (value) => decodeJsonValue(value) },
  execute: async ({ connectionId: id }, context, services) => {
    if (!services || !context.access.destinations.includes(destination(id))) throw new Error("model connection is outside the approved grant");
    return services.describe(id);
  },
};

const generateInput = z.strictObject({ connectionId, jobId, prompt: z.string().min(1).max(16_000), maxOutputTokens: z.number().int().min(1).max(2_048) });
const generateOutput = z.strictObject({ jobId, model: z.string().max(200), text: z.string().max(65_536), usage: extensionTokenReportSchema.nullable(), promptTokens: z.number().int().nonnegative().nullable(), outputTokens: z.number().int().nonnegative().nullable(), accountingUnits: z.number().int().nonnegative() });
const generate: ExtensionOperationDefinition<z.infer<typeof generateInput>, z.infer<typeof generateOutput>, ExtensionModelServices | undefined> = {
  metadata: {
    ...base("models.generate", "Generate with a saved model", "Send this bounded prompt through an explicitly approved saved connection and return its bounded reply.", generateInput, generateOutput, { effect: "external", sensitivity: "secret", resources: ["host-connection"], fields: ["model.prompt"], destinationMode: "host-selected-connection", budget: "external", confirmation: "sensitive-send" }),
    estimateBudget: ({ prompt, maxOutputTokens }) => ({ bytes: new TextEncoder().encode(prompt).byteLength + 8_000, tokens: new TextEncoder().encode(prompt).byteLength + maxOutputTokens * 4 }),
    measureTokens: ({ accountingUnits }) => accountingUnits,
    resolveAccess: ({ connectionId: id }) => connectionAccess(id, ["model.prompt"]),
    project: (value) => decodeJsonValue(value),
  },
  review: async ({ connectionId: id, jobId: job, prompt, maxOutputTokens }, context, services) => {
    const connection = await services?.prepareGeneration(context.principal.packageId, id, job, prompt, maxOutputTokens, context.principal);
    if (!connection || !context.access.destinations.includes(destination(id))) throw new Error("model connection is outside the approved grant");
    return decodeJsonValue({ connection: { name: connection.name, provider: connection.provider, model: connection.model }, jobId: job, prompt, maxOutputTokens,
      cost: { ceilingUsd: null, notice: "Provider pricing is unavailable, so no dollar cap is enforced. Review each call before it is sent." } });
  },
  execute: async ({ connectionId: id, jobId: job, prompt, maxOutputTokens }, context, services) => {
    if (!services || !context.access.destinations.includes(destination(id))) throw new Error("model connection is outside the approved grant");
    const result = await services.generate(context.principal.packageId, id, job, prompt, maxOutputTokens, context.principal, context.signal, context.assertCurrent);
    return { jobId: job, model: result.model, text: result.text, usage: result.usage, promptTokens: result.promptTokens, outputTokens: result.outputTokens, accountingUnits: result.accountingUnits };
  },
};

const cancelInput = z.strictObject({ connectionId, jobId });
const cancelOutput = z.strictObject({ cancelled: z.boolean() });
const cancel: ExtensionOperationDefinition<z.infer<typeof cancelInput>, z.infer<typeof cancelOutput>, ExtensionModelServices | undefined> = {
  metadata: { ...base("models.cancel", "Cancel model generation", "Cancel one in-flight generation started by this extension and connection.", cancelInput, cancelOutput, { effect: "control", sensitivity: "private", resources: ["host-connection"], fields: ["model.jobs"], destinationMode: "host-selected-connection", budget: "metadata", confirmation: "none" }), resolveAccess: ({ connectionId: id }) => connectionAccess(id, ["model.jobs"]), project: (value) => value as JsonValue },
  execute: async ({ connectionId: id, jobId: job }, context, services) => {
    if (!services || !context.access.destinations.includes(destination(id))) throw new Error("model connection is outside the approved grant");
    return { cancelled: await services.cancel(context.principal.packageId, id, job) };
  },
};

const usageInput = z.strictObject({});
const usageOutput = z.strictObject({ calls: z.number().int().nonnegative(), promptTokens: z.number().int().nonnegative(), outputTokens: z.number().int().nonnegative(), accountingUnits: z.number().int().nonnegative(), tokenUsageComplete: z.boolean(), costUsd: z.number().nonnegative().optional() });
const usage: ExtensionOperationDefinition<z.infer<typeof usageInput>, z.infer<typeof usageOutput>, ExtensionModelServices | undefined> = {
  metadata: { ...base("models.usage", "Read model usage", "Read this extension's bounded in-memory model usage totals.", usageInput, usageOutput, { effect: "read", sensitivity: "private", resources: [], fields: ["model.usage"], destinationMode: "none", budget: "metadata", confirmation: "none" }), resolveAccess: () => ({ resources: [], fields: ["model.usage"], methods: [], destinations: [] }), project: (value) => decodeJsonValue(value) },
  execute: async (_args, context, services) => {
    if (!services) throw new Error("model access is unavailable on this host");
    return services.usage(context.principal.packageId);
  },
};

export const modelOperations = [list, describe, generate, cancel, usage] as const;
export const createOperations = (services: ExtensionOperationServices) => modelOperations.map((item) => bindExtensionOperation(item as ExtensionOperationDefinition<unknown, unknown, ExtensionModelServices | undefined>, services.models));
export default modelOperations;
