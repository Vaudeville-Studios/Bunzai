/** Replace only this package's host-visible subset of manifest-declared commands. */
import { z } from "zod";
import { bindExtensionOperation, EXTENSION_COMMAND_HOSTS, type ExtensionOperationDefinition, type ExtensionOperationMetadata } from "../../contracts/operation";
import { contributionIdSchema } from "../../contracts/contribution-id";
import { decodeJsonValue } from "../../contracts/value";
import type { ExtensionOperationServices } from "../_services";

const input = z.strictObject({ commandIds: z.array(contributionIdSchema).max(64).refine((ids) => new Set(ids).size === ids.length) });
const output = z.strictObject({ status: z.enum(["saved", "stale"]), registered: z.array(contributionIdSchema).max(64), revision: z.number().int().nonnegative() });
const metadata: ExtensionOperationMetadata<z.infer<typeof input>, z.infer<typeof output>> = {
  id: "commands.register", version: 1, inputVersion: 1, outputVersion: 1, projectionVersion: 1,
  title: "Choose available commands", description: "Replace which of this package's declared commands appear in the host.", input, output,
  effect: "write", sensitivity: "private", hosts: EXTENSION_COMMAND_HOSTS,
  policy: { resources: [], fields: ["commands"], methods: [], destinationMode: "none", destinations: [], budget: "write", confirmation: "effect" },
  receiptStatus: (value) => value.status === "saved" ? "committed" : "conflicted",
  estimateBudget: ({ commandIds }) => ({ bytes: 2_000 + commandIds.join("").length, tokens: 0 }), measureTokens: () => 0,
  resolveAccess: () => ({ resources: [], fields: ["commands"], methods: [], destinations: [] }),
  project: (value) => decodeJsonValue(value),
};
const definition: ExtensionOperationDefinition<z.infer<typeof input>, z.infer<typeof output>, ExtensionOperationServices> = {
  metadata,
  review: async ({ commandIds }, context, services) => {
    if (!context.declaredCommands || commandIds.some((id) => !context.declaredCommands!.includes(id))) throw new Error("command registration must use declared package command IDs");
    if (!services.commands) throw new Error("command registration is unavailable on this host");
    return decodeJsonValue({ operation: metadata.id, packageId: context.principal.packageId, current: await services.commands.registered(context.principal.packageId), requested: commandIds });
  },
  execute: async ({ commandIds }, context, services) => {
    if (!context.access.fields.includes("commands") || !context.declaredCommands || commandIds.some((id) => !context.declaredCommands!.includes(id))) {
      throw new Error("command registration exceeds the package manifest or approved field scope");
    }
    if (!services.commands) throw new Error("command registration is unavailable on this host");
    return output.parse(await services.commands.replaceRegistered(context.principal.packageId, commandIds, context.commit));
  },
};

export const commandOperations = [definition] as const;
export const createOperations = (services: ExtensionOperationServices) => commandOperations.map((operation) => bindExtensionOperation(operation, services));
export default commandOperations;
