/** Public inventory of canonical content kinds supported by the Studio content boundary. */
import { z } from "zod";
import { STUDIO_ENTITY_KINDS } from "../../../studio/path-policy";
import { bindExtensionOperation, EXTENSION_HOSTS, PROMPT_SAFE_READ_ORIGINS, type ExtensionOperationDefinition, type ExtensionOperationMetadata } from "../../contracts/operation";
import { decodeJsonValue } from "../../contracts/value";
import type { ExtensionOperationServices } from "../_services";

const input = z.strictObject({});
const output = z.strictObject({ kinds: z.array(z.enum(STUDIO_ENTITY_KINDS)).min(1).max(STUDIO_ENTITY_KINDS.length) });
type Output = z.infer<typeof output>;
const metadata: ExtensionOperationMetadata<z.infer<typeof input>, Output> = {
  id: "content.kinds", version: 1, inputVersion: 1, outputVersion: 1, projectionVersion: 1,
  title: "List content kinds", description: "List canonical content kinds supported by this Studio content runtime.",
  input, output, effect: "read", sensitivity: "public", hosts: EXTENSION_HOSTS, activationOrigins: PROMPT_SAFE_READ_ORIGINS,
  policy: { resources: [], fields: [], methods: [], destinations: [], destinationMode: "none", budget: "metadata", confirmation: "none" },
  estimateBudget: () => ({ bytes: 4_096, tokens: 0 }), measureTokens: () => 0,
  resolveAccess: () => ({ resources: [], fields: [], methods: [], destinations: [] }),
  project: (value) => decodeJsonValue(output.parse(value)),
};
const operation: ExtensionOperationDefinition<z.infer<typeof input>, Output, ExtensionOperationServices> = {
  metadata,
  execute: async () => output.parse({ kinds: STUDIO_ENTITY_KINDS }),
};
export const contentKindOperations = [operation] as const;
export const createOperations = (services: ExtensionOperationServices) => contentKindOperations.map((item) => bindExtensionOperation(item, services));
export default contentKindOperations;
