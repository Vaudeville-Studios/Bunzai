/** Single revision-checked handler for applying reviewed semantic drafts under a broker commit. */
import { z } from "zod";
import { STUDIO_ENTITY_KINDS } from "../../../studio/path-policy";
import { EXTENSION_HOSTS, type ExtensionOperationContext, type ExtensionOperationDefinition, type ExtensionOperationMetadata, type HostFeature, type ResourceRef } from "../../contracts/operation";
import { SHA256_HEX_PATTERN } from "../../../core/sha256";
import { decodeJsonValue } from "../../contracts/value";
import type { ExtensionOperationServices } from "../_services";
import type { ExtensionDraftPrincipal } from "./_draft-services";

export const draftApplyInput = z.strictObject({ kind: z.enum(STUDIO_ENTITY_KINDS), id: z.string().min(1).max(120), draftId: z.string().min(1).max(120), fingerprint: z.string().regex(SHA256_HEX_PATTERN) });
export const draftApplyOutput = z.strictObject({ status: z.enum(["applied", "stale", "missing", "failed"]), kind: z.enum(STUDIO_ENTITY_KINDS), id: z.string().min(1).max(120) });
const principal = (context: ExtensionOperationContext): ExtensionDraftPrincipal => ({
  storeId: context.principal.storeId, packageId: context.principal.packageId, packageDigest: context.principal.packageDigest,
  policyFingerprint: context.principal.policyFingerprint, apiMajor: context.principal.apiMajor, grantRevision: context.principal.grantRevision,
});
const exactTarget = (scope: readonly ResourceRef[], kind: string, id: string): boolean => scope.some((ref) => ref.kind === kind && ref.id === id);
export function createDraftApplyOperation(options: { id?: string; title?: string; description?: string; hosts?: readonly HostFeature[] } = {}): ExtensionOperationDefinition<z.infer<typeof draftApplyInput>, z.infer<typeof draftApplyOutput>, ExtensionOperationServices> {
  const input = draftApplyInput;
  const output = draftApplyOutput;
  const hosts = options.hosts ?? EXTENSION_HOSTS;
  const metadata: ExtensionOperationMetadata<z.infer<typeof input>, z.infer<typeof output>> = {
    id: options.id ?? "content.draft.apply", version: 1, inputVersion: 1, outputVersion: 1, projectionVersion: 1,
    title: options.title ?? "Apply a content draft", description: options.description ?? "Review and atomically apply one unchanged, package-owned semantic draft.",
    input, output, effect: "write", sensitivity: "private", hosts,
    policy: { resources: [...STUDIO_ENTITY_KINDS], fields: ["draft"], methods: [], destinations: [], destinationMode: "none", budget: "write", confirmation: "effect" },
    receiptStatus: (value) => value.status === "applied" ? "committed" : value.status === "failed" ? "ambiguous" : "conflicted",
    estimateBudget: () => ({ bytes: 200_000, tokens: 0 }), measureTokens: () => 0,
    resolveAccess: ({ kind, id }) => ({ resources: [{ kind, id }], fields: ["draft"], methods: [], destinations: [] }),
    project: (value) => decodeJsonValue(output.parse(value)),
  };
  const assertTarget = (args: z.infer<typeof input>, context: ExtensionOperationContext, services: ExtensionOperationServices) => {
    if (!services.drafts || !exactTarget(context.access.resources, args.kind, args.id) || !context.access.fields.includes("draft")) throw new Error("content draft is outside the approved grant");
  };
  return {
    metadata,
    review: async (args, context, services) => {
      assertTarget(args, context, services);
      const identity = principal(context);
      const draft = await services.drafts!.inspect(identity, args.draftId, context.access.resources);
      if (!draft || draft.kind !== args.kind || draft.targetId !== args.id) throw new Error("content draft is unavailable");
      if (draft.requiredOperations.some((operation) => !context.grantedOperations.includes(operation))) throw new Error("content draft requires an operation that is no longer granted");
      if (draft.fingerprint !== args.fingerprint) throw new Error("content draft changed; inspect it and request a new review");
      const review = await services.drafts!.review(identity, args.draftId, context.access.resources);
      if (!review) throw new Error("content draft review is unavailable");
      return decodeJsonValue(review);
    },
    execute: async (args, context, services) => {
      assertTarget(args, context, services);
      const identity = principal(context);
      const draft = await services.drafts!.inspect(identity, args.draftId, context.access.resources);
      if (!draft || draft.kind !== args.kind || draft.targetId !== args.id || draft.requiredOperations.some((operation) => !context.grantedOperations.includes(operation))) throw new Error("content draft is unavailable under current grants");
      if (draft.fingerprint !== args.fingerprint) throw new Error("content draft changed after review; inspect and review it again");
      const status = await services.drafts!.apply(identity, args.draftId, args.fingerprint, context.access.resources, context.commit);
      return output.parse({ status, kind: args.kind, id: args.id });
    },
  };
}
