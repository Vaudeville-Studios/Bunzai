/** Describe operations the current package can request on this host. */
import { z } from "zod";
import type { JsonValue } from "../../contracts/value";
import { MAX_VALUE_BYTES } from "../../contracts/value";
import { bindExtensionOperation, EXTENSION_HOSTS, PROMPT_SAFE_READ_ORIGINS, type ExtensionOperationDefinition } from "../../contracts/operation";
import { pageAvailableOperations, projectAvailableOperations, operationPageSchema } from "../../contracts/operation-metadata";
import type { ExtensionOperationServices } from "../_services";

const input = z.strictObject({ ids: z.array(z.string().min(1).max(160)).max(200).optional(), offset: z.number().int().min(0).max(2000).default(0), limit: z.number().int().min(1).max(20).default(10) });
export const operationMetadataOutputSchema = operationPageSchema;
const output = operationMetadataOutputSchema;

const apiDescribe: ExtensionOperationDefinition<z.infer<typeof input>, z.infer<typeof output>, void> = {
  metadata: {
    id: "api.describe",
    version: 1,
    inputVersion: 1,
    outputVersion: 1,
    projectionVersion: 1,
    title: "Describe available operations",
    description: "Return public operation schemas available on this host, with this package's grant status.",
    input,
    output,
    effect: "read",
    sensitivity: "public",
    hosts: EXTENSION_HOSTS,
    activationOrigins: PROMPT_SAFE_READ_ORIGINS,
    estimateBudget: () => ({ bytes: MAX_VALUE_BYTES, tokens: 0 }),
    measureTokens: () => 0,
    policy: {
      resources: [], fields: [], destinations: [], methods: [], destinationMode: "none", budget: "metadata", confirmation: "none",
    },
    resolveAccess: () => ({ resources: [], fields: [], methods: [], destinations: [] }),
    project: (value, _principal, _access) => value as JsonValue,
  },
  execute: async ({ ids, offset, limit }, context) => {
    const requested = ids ? new Set(ids) : undefined;
    const rows = projectAvailableOperations(context.availableOperations, context.host, context.grantedOperations)
      .filter((entry) => !requested || requested.has(entry.id));
    return output.parse(pageAvailableOperations(rows, offset, limit));
  },
};

export const createOperations = (_services: ExtensionOperationServices) => [bindExtensionOperation(apiDescribe, undefined)];
export default apiDescribe;
