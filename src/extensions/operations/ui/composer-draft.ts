/** Replaces one mounted scene composer through an explicit, host-rendered Apply/Decline ticket. */
import { z } from "zod";
import { MAX_EXTENSION_COMPOSER_DRAFT_BYTES } from "../../contracts/limits";
import { BROWSER_EXTENSION_HOSTS, bindExtensionOperation, defineExtensionOperationMetadata, type ExtensionOperationDefinition } from "../../contracts/operation";
import type { ExtensionRunPrincipal } from "../../contracts/host-actions";
import type { ExtensionOperationServices } from "../_services";

const input = z.strictObject({ sceneId: z.string().min(1).max(120), text: z.string().max(MAX_EXTENSION_COMPOSER_DRAFT_BYTES) }).superRefine((value, ctx) => {
  if (new TextEncoder().encode(value.text).byteLength > MAX_EXTENSION_COMPOSER_DRAFT_BYTES) ctx.addIssue({ code: "custom", path: ["text"], message: "composer draft exceeds its byte limit" });
});
const output = z.strictObject({ status: z.enum(["applied", "declined", "stale"]) });
type Input = z.infer<typeof input>;
type Output = z.infer<typeof output>;
const principal = (value: { storeId: string; packageId: string; packageDigest: string; grantRevision: number; runEpoch: number }): ExtensionRunPrincipal => ({
  storeId: value.storeId, packageId: value.packageId, packageDigest: value.packageDigest, grantRevision: value.grantRevision, runEpoch: value.runEpoch,
});

const definition: ExtensionOperationDefinition<Input, Output, ExtensionOperationServices> = {
  metadata: defineExtensionOperationMetadata({
    id: "composer.draft.set", title: "Replace a scene draft", description: "Offer a bounded replacement for one scene's unsent draft; the host asks before applying it.", input, output,
    effect: "control", sensitivity: "private", hosts: BROWSER_EXTENSION_HOSTS,
    policy: { resources: ["scene"], fields: ["scene.draft"], methods: [], destinationMode: "none", destinations: [], budget: "metadata", confirmation: "none" },
    estimateBudget: ({ text }) => ({ bytes: new TextEncoder().encode(text).byteLength + 2_048, tokens: 0 }), measureTokens: () => 0,
    resolveAccess: ({ sceneId }) => ({ resources: [{ kind: "scene", id: sceneId }], fields: ["scene.draft"], methods: [], destinations: [] }),
    project: (value) => output.parse(value),
    receiptStatus: ({ status }) => status === "stale" ? "conflicted" : "completed",
  }),
  execute: async ({ sceneId, text }, context, services) => {
    if (context.host === "terminal" || !context.access.resources.some((item) => item.kind === "scene" && item.id === sceneId)
      || !context.access.fields.includes("scene.draft") || !services.hostActions) throw new Error("PERMISSION_DENIED: this scene draft is outside the approved host scope");
    const answer = await services.hostActions.request({ action: "composer.draft.set", operation: "composer.draft.set", packageId: context.principal.packageId, principal: principal(context.principal), sceneId, text }, context.signal);
    if (answer?.status === "ambiguous") throw new Error("OPERATION_FAILED: The host could not confirm whether the draft changed.");
    const status = answer?.status === "composer-draft-result" ? answer.result : "stale";
    return output.parse({ status });
  },
};

export const createOperations = (services: ExtensionOperationServices) => [bindExtensionOperation(definition, services)];
export default [definition];
