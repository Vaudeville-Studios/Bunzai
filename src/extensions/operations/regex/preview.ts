/** Purpose: request bounded regex previews through the existing isolated UI worker action. */
import { z } from "zod";
import { decodeJsonValue } from "../../contracts/value";
import { extensionRegexPreviewInputSchema } from "../../contracts/host-actions";
import { MAX_EXTENSION_REGEX_PREVIEW_BYTES } from "../../contracts/limits";
import { EXTENSION_HOSTS, bindExtensionOperation, type ExtensionOperationDefinition, type ExtensionOperationMetadata } from "../../contracts/operation";
import type { ExtensionOperationServices } from "../_services";

const output = z.strictObject({ ok: z.boolean(), text: z.string().max(MAX_EXTENSION_REGEX_PREVIEW_BYTES), error: z.string().max(500).nullable() });
type Input = z.infer<typeof extensionRegexPreviewInputSchema>;
type Output = z.infer<typeof output>;
const definition: ExtensionOperationDefinition<Input, Output, ExtensionOperationServices> = {
  metadata: {
    id: "regex.preview", version: 1, inputVersion: 1, outputVersion: 1, projectionVersion: 1,
    title: "Preview regex rules", description: "Run a bounded regex preview in the isolated host worker.",
    input: extensionRegexPreviewInputSchema, output, effect: "read", sensitivity: "private", hosts: EXTENSION_HOSTS,
    policy: { resources: [], fields: ["regex.preview"], methods: [], destinationMode: "none", destinations: [], budget: "read-small", confirmation: "none" },
    estimateBudget: ({ text, rules }) => ({ bytes: new TextEncoder().encode(JSON.stringify({ text, rules })).byteLength + 2_000, tokens: 0 }),
    measureTokens: () => 0,
    resolveAccess: () => ({ resources: [], fields: ["regex.preview"], methods: [], destinations: [] }),
    project: (value) => decodeJsonValue(output.parse(value)),
  },
  async execute(args, context, services) {
    if (!context.access.fields.includes("regex.preview")) throw new Error("PERMISSION_DENIED: regex preview is outside the approved grant.");
    if (context.host === "terminal") {
      if (!services.regex) throw new Error("UNSUPPORTED_HOST: isolated regex preview is unavailable.");
      return output.parse(await services.regex.run(args, context.signal));
    }
    if (!services.hostActions) throw new Error("UNSUPPORTED_HOST: host regex preview action is unavailable.");
    const answer = await services.hostActions.request({ action: "regex.preview", operation: "regex.preview", packageId: context.principal.packageId, principal: {
      storeId: context.principal.storeId, packageId: context.principal.packageId, packageDigest: context.principal.packageDigest, grantRevision: context.principal.grantRevision, runEpoch: context.principal.runEpoch,
    }, ...args }, context.signal);
    if (answer?.status !== "regex-result") throw new Error("CANCELLED: regex preview did not complete.");
    return output.parse({ ok: answer.ok, text: answer.text, error: answer.error });
  },
};

export const regexPreviewOperations = [definition] as const;
export const createOperations = (services: ExtensionOperationServices) => regexPreviewOperations.map((item) => bindExtensionOperation(item as ExtensionOperationDefinition<unknown, unknown, ExtensionOperationServices>, services));
export default regexPreviewOperations;
