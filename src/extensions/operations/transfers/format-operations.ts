/** Public, bounded inventory of the canonical formats installed on this host. */
import { z } from "zod";
import { bindExtensionDefinitions, type ExtensionOperationDefinition, type ExtensionOperationMetadata, type HostFeature } from "../../contracts/operation";
import { decodeJsonValue } from "../../contracts/value";
import type { ExtensionOperationServices } from "../_services";
import { STUDIO_ENTITY_KINDS } from "../../../studio/path-policy";

const row = z.strictObject({
  id: z.string().min(1).max(80), label: z.string().min(1).max(120),
  kinds: z.array(z.enum(STUDIO_ENTITY_KINDS)).min(1).max(STUDIO_ENTITY_KINDS.length),
  extensions: z.array(z.string().min(1).max(16)).max(32), native: z.boolean(),
});
const emptyInput = z.strictObject({});
const listOutput = z.strictObject({ formats: z.array(row).max(256) });
const describeInput = z.strictObject({ formatId: z.string().min(1).max(80) });
const describeOutput = z.strictObject({ format: row.nullable() });
const FORMAT_HOSTS = ["desktop", "terminal"] as const satisfies readonly HostFeature[];
type ListOutput = z.infer<typeof listOutput>;
type DescribeInput = z.infer<typeof describeInput>;
type DescribeOutput = z.infer<typeof describeOutput>;
const readPolicy = { resources: [], fields: [], methods: [], destinations: [], destinationMode: "none" as const, budget: "metadata" as const, confirmation: "none" as const };

const listMetadata: ExtensionOperationMetadata<Record<string, never>, ListOutput> = {
  id: "formats.list", version: 1, inputVersion: 1, outputVersion: 1, projectionVersion: 1,
  title: "List available formats", description: "List canonical import and export formats registered on this host.",
  input: emptyInput, output: listOutput, effect: "read", sensitivity: "public", hosts: FORMAT_HOSTS,
  policy: readPolicy, estimateBudget: () => ({ bytes: 24_000, tokens: 0 }), measureTokens: () => 0,
  resolveAccess: () => ({ resources: [], fields: [], methods: [], destinations: [] }),
  project: (value) => decodeJsonValue(listOutput.parse(value)),
};
const listDefinition: ExtensionOperationDefinition<Record<string, never>, ListOutput, ExtensionOperationServices> = {
  metadata: listMetadata,
  execute: async (_args, _context, services) => {
    if (!services.formats) throw new Error("Format inventory is unavailable on this host.");
    return listOutput.parse({ formats: services.formats.list() });
  },
};

const describeMetadata: ExtensionOperationMetadata<DescribeInput, DescribeOutput> = {
  id: "formats.describe", version: 1, inputVersion: 1, outputVersion: 1, projectionVersion: 1,
  title: "Describe a format", description: "Return supported kinds and output extensions for one registered format.",
  input: describeInput, output: describeOutput, effect: "read", sensitivity: "public", hosts: FORMAT_HOSTS,
  policy: readPolicy, estimateBudget: () => ({ bytes: 2_000, tokens: 0 }), measureTokens: () => 0,
  resolveAccess: () => ({ resources: [], fields: [], methods: [], destinations: [] }),
  project: (value) => decodeJsonValue(describeOutput.parse(value)),
};
const describeDefinition: ExtensionOperationDefinition<DescribeInput, DescribeOutput, ExtensionOperationServices> = {
  metadata: describeMetadata,
  execute: async ({ formatId }, _context, services) => {
    if (!services.formats) throw new Error("Format inventory is unavailable on this host.");
    return describeOutput.parse({ format: services.formats.describe(formatId) });
  },
};

export const formatOperations = [listDefinition, describeDefinition] as const;
export const createOperations = (services: ExtensionOperationServices) => bindExtensionDefinitions(formatOperations, services);
export default formatOperations;
