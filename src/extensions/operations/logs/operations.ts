/** Package-scoped bounded operational logs and redacted runtime diagnostics. */
import { z } from "zod";
import { bindExtensionDefinitions, EXTENSION_HOSTS, type ExtensionOperationDefinition, type ExtensionOperationMetadata, type HostFeature } from "../../contracts/operation";
import { decodeJsonValue, MAX_VALUE_BYTES } from "../../contracts/value";
import type { ExtensionOperationServices } from "../_services";
import { MAX_EXTENSION_LOG_MESSAGE_BYTES, MAX_EXTENSION_LOG_PAGE_SIZE } from "./_services";

const level = z.enum(["debug", "info", "warn", "error"]);
const utf8Message = z.string().min(1).max(MAX_EXTENSION_LOG_MESSAGE_BYTES).refine((value) => new TextEncoder().encode(value).byteLength <= MAX_EXTENSION_LOG_MESSAGE_BYTES, "message exceeds 1,024 UTF-8 bytes");
const record = z.strictObject({ id: z.string().min(1).max(128), createdAt: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER), level, message: utf8Message });
const empty = z.strictObject({});
const writeInput = z.strictObject({ level, message: utf8Message });
const writeOutput = z.strictObject({ id: z.string().min(1).max(128), createdAt: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER) });
const readInput = z.strictObject({ cursor: z.string().min(1).max(128).nullable().optional(), limit: z.number().int().min(1).max(MAX_EXTENSION_LOG_PAGE_SIZE).default(MAX_EXTENSION_LOG_PAGE_SIZE) });
const readOutput = z.strictObject({ records: z.array(record).max(MAX_EXTENSION_LOG_PAGE_SIZE), nextCursor: z.string().min(1).max(128).nullable() });
const runtimeOutput = z.strictObject({ host: z.enum(["desktop", "browser", "terminal"]), availableOperationCount: z.number().int().nonnegative().max(1000), grantedOperationCount: z.number().int().nonnegative().max(1000) });

function metadata<I, O>(id: string, title: string, description: string, input: z.ZodType<I>, output: z.ZodType<O>, effect: "read" | "control", field: string, hosts: readonly HostFeature[] = EXTENSION_HOSTS): ExtensionOperationMetadata<I, O> {
  return { id, version: 1, inputVersion: 1, outputVersion: 1, projectionVersion: 1, title, description, input, output, effect, sensitivity: "private", hosts,
    policy: { resources: [], fields: [field], methods: [], destinations: [], destinationMode: "none", budget: "metadata", confirmation: "none" },
    estimateBudget: () => ({ bytes: MAX_VALUE_BYTES, tokens: 0 }), measureTokens: () => 0,
    resolveAccess: () => ({ resources: [], fields: [field], methods: [], destinations: [] }), project: (value) => decodeJsonValue(output.parse(value)) };
}

type WriteInput = z.infer<typeof writeInput>;
type WriteOutput = z.infer<typeof writeOutput>;
const writeDefinition: ExtensionOperationDefinition<WriteInput, WriteOutput, ExtensionOperationServices> = {
  metadata: metadata("logs.write", "Write an operational log", "Append one bounded message to this package's own operational log.", writeInput, writeOutput, "control", "logs"),
  execute: async (args, context, services) => {
    if (!context.access.fields.includes("logs") || !services.logs) throw new Error("package logs are unavailable");
    return writeOutput.parse(await services.logs.append(context.principal.packageId, { level: args.level, message: args.message }, context.commit));
  },
};
type ReadInput = z.infer<typeof readInput>;
type ReadOutput = z.infer<typeof readOutput>;
const readDefinition: ExtensionOperationDefinition<ReadInput, ReadOutput, ExtensionOperationServices> = {
  metadata: metadata("logs.readOwn", "Read own operational logs", "Read a bounded page of this package's own operational log records.", readInput, readOutput, "read", "logs"),
  execute: async ({ cursor, limit }, context, services) => {
    if (!context.access.fields.includes("logs") || !services.logs) throw new Error("package logs are unavailable");
    const page = await services.logs.readOwn(context.principal.packageId, cursor ?? null, limit);
    return readOutput.parse({ records: page.records, nextCursor: page.nextCursor });
  },
};
const runtimeDefinition: ExtensionOperationDefinition<z.infer<typeof empty>, z.infer<typeof runtimeOutput>, ExtensionOperationServices> = {
  metadata: metadata("diagnostics.runtime", "Runtime status", "Return bounded public runtime availability counts without host paths or secrets.", empty, runtimeOutput, "read", "runtime", EXTENSION_HOSTS),
  execute: async (_args, context) => runtimeOutput.parse({ host: context.host, availableOperationCount: context.availableOperations.length, grantedOperationCount: context.grantedOperations.length }),
};

export const logOperations = [writeDefinition, readDefinition, runtimeDefinition] as const;
export const createOperations = (services: ExtensionOperationServices) => bindExtensionDefinitions(logOperations, services);
export default logOperations;
