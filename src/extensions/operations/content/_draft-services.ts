/** Narrow owner port for extension-scoped canonical semantic drafts. */
import type { OperationPrincipal, ResourceRef } from "../../contracts/operation";
import type { ExtensionCommitContext } from "../../../stage/contracts/extension-store";
import type { JsonValue } from "../../contracts/value";
import type { ContentKind, ContentCapability } from "../../../entities/capabilities/types";
import type { ParsedCanonicalEntity } from "../../../entities/runtime-schema";
import { z } from "zod";
import { SHA256_HEX_PATTERN } from "../../../core/sha256";
import { STUDIO_ENTITY_KINDS } from "../../../studio/path-policy";

export const extensionDraftProjectionSchema = z.strictObject({
  id: z.string().min(1).max(120), kind: z.enum(STUDIO_ENTITY_KINDS), targetId: z.string().min(1).max(120),
  name: z.string().max(400), revision: z.string().max(200), mode: z.enum(["create", "update"]),
  fingerprint: z.string().regex(SHA256_HEX_PATTERN),
  status: z.enum(["draft", "applying", "applied", "stale", "discarded", "failed"]),
  requiredOperations: z.array(z.string().min(1).max(160)).max(64),
  changes: z.array(z.strictObject({ path: z.string().min(1).max(180), before: z.json(), after: z.json() })).max(64),
  warnings: z.array(z.string().max(300)).max(20),
});
export type ExtensionDraftProjection = z.infer<typeof extensionDraftProjectionSchema>;
export type ExtensionDraftPrincipal = Pick<OperationPrincipal, "storeId" | "packageId" | "packageDigest" | "policyFingerprint" | "apiMajor" | "grantRevision">;
export interface ExtensionDraftReview {
  draft: ExtensionDraftProjection;
  createdBody?: { kind: ContentKind; id: string; body: JsonValue };
}
export interface ExtensionDraftServices {
  create(principal: ExtensionDraftPrincipal, entity: ParsedCanonicalEntity, scope: readonly ResourceRef[]): Promise<ExtensionDraftProjection | null>;
  duplicate(principal: ExtensionDraftPrincipal, kind: ContentKind, id: string, targetId: string, scope: readonly ResourceRef[]): Promise<ExtensionDraftProjection | null>;
  preview(principal: ExtensionDraftPrincipal, capability: ContentCapability, input: unknown, scope: readonly ResourceRef[]): Promise<ExtensionDraftProjection | null>;
  inspect(principal: ExtensionDraftPrincipal, draftId: string, scope: readonly ResourceRef[]): Promise<ExtensionDraftProjection | null>;
  review(principal: ExtensionDraftPrincipal, draftId: string, scope: readonly ResourceRef[]): Promise<ExtensionDraftReview | null>;
  discard(principal: ExtensionDraftPrincipal, draftId: string, scope: readonly ResourceRef[]): Promise<boolean>;
  apply(principal: ExtensionDraftPrincipal, draftId: string, fingerprint: string, scope: readonly ResourceRef[], commit: ExtensionCommitContext): Promise<"applied" | "stale" | "missing" | "failed">;
}
