/** Purpose: expose only the reviewed read-only Kit docs and semantic capability tools. */
import { z } from "zod";
import { decodeJsonValue, jsonValueSchemaBounded, type JsonValue } from "../../contracts/value";
import { bindExtensionOperation, type ExtensionOperationDefinition, type ExtensionOperationMetadata } from "../../contracts/operation";
import type { ExtensionOperationServices } from "../_services";

const metadataSchema = z.strictObject({ id: z.string().min(1).max(80), description: z.string().max(2_000), inputSchema: z.string().max(32_000) });
const listInput = z.strictObject({ offset: z.number().int().min(0).max(63).default(0), limit: z.number().int().min(1).max(25).default(25) });
const pageOutput = z.strictObject({ tools: z.array(metadataSchema).max(25), total: z.number().int().nonnegative().max(64), nextOffset: z.number().int().min(0).nullable() });
const describeInput = z.strictObject({ id: z.string().min(1).max(80) });
const describeOutput = metadataSchema.nullable();
const invokeInput = z.strictObject({ id: z.string().min(1).max(80), args: jsonValueSchemaBounded });
const invokeOutput = z.strictObject({ summary: z.string().max(500), output: z.string().max(32_000) });
type ListInput = z.infer<typeof listInput>;
type PageOutput = z.infer<typeof pageOutput>;
type DescribeInput = z.infer<typeof describeInput>;
type DescribeOutput = z.infer<typeof describeOutput>;
type InvokeInput = z.infer<typeof invokeInput>;
type InvokeOutput = z.infer<typeof invokeOutput>;

const hosts = ["desktop", "terminal"] as const;
const metadata = <I, O extends JsonValue>(id: string, title: string, description: string, input: z.ZodType<I>, output: z.ZodType<O>, field: string): ExtensionOperationMetadata<I, O> => ({
  id, version: 1, inputVersion: 1, outputVersion: 1, projectionVersion: 1, title, description, input, output,
  effect: "read", sensitivity: "public", hosts,
  policy: { resources: field === "tools.invoke" ? ["kit-tool"] : [], fields: [field], methods: [], destinationMode: "none", destinations: [], budget: "read-large", confirmation: "none" },
  estimateBudget: () => ({ bytes: 100_000, tokens: 0 }),
  measureTokens: () => 0,
  resolveAccess: (args) => ({ resources: field === "tools.invoke" ? [{ kind: "kit-tool", id: (args as InvokeInput).id }] : [], fields: [field], methods: [], destinations: [] }),
  project: (value) => decodeJsonValue(output.parse(value)),
});

const list: ExtensionOperationDefinition<ListInput, PageOutput, ExtensionOperationServices> = {
  metadata: metadata("tools.list", "List reviewed Kit tools", "List the read-only Kit documentation and semantic capability discovery tools available to Terminal extensions.", listInput, pageOutput, "tools.catalog"),
  execute: async (_args, context, services) => {
    if ((context.host !== "terminal" && context.host !== "desktop") || !services.tools) throw new Error("UNSUPPORTED_HOST: Kit tools are unavailable.");
    const items = services.tools.list(), offset = _args.offset, tools = items.slice(offset, offset + _args.limit);
    return { tools, total: items.length, nextOffset: offset + tools.length < items.length ? offset + tools.length : null };
  },
};
const describe: ExtensionOperationDefinition<DescribeInput, DescribeOutput, ExtensionOperationServices> = {
  metadata: metadata("tools.describe", "Describe a reviewed Kit tool", "Read the exact schema and description for one reviewed read-only Kit tool.", describeInput, describeOutput, "tools.catalog"),
  execute: async ({ id }, context, services) => {
    if ((context.host !== "terminal" && context.host !== "desktop") || !services.tools) throw new Error("UNSUPPORTED_HOST: Kit tools are unavailable.");
    return services.tools.describe(id);
  },
};
const invoke: ExtensionOperationDefinition<InvokeInput, InvokeOutput, ExtensionOperationServices> = {
  metadata: metadata("tools.invoke", "Invoke a reviewed Kit tool", "Invoke one exact read-only Kit discovery tool under this operation's resource and byte budgets.", invokeInput, invokeOutput, "tools.invoke"),
  execute: async ({ id, args }, context, services) => {
    if ((context.host !== "terminal" && context.host !== "desktop") || !services.tools) throw new Error("UNSUPPORTED_HOST: Kit tools are unavailable.");
    if (!context.access.resources.some((resource) => resource.kind === "kit-tool" && resource.id === id)) throw new Error("PERMISSION_DENIED: this Kit tool is outside the approved resource grant.");
    return services.tools.invoke(id, args, context.signal, context.assertCurrent);
  },
};

export const toolOperations = [list, describe, invoke] as const;
export const createOperations = (services: ExtensionOperationServices) => toolOperations.map((item) => bindExtensionOperation(item as ExtensionOperationDefinition<unknown, unknown, ExtensionOperationServices>, services));
export default toolOperations;
