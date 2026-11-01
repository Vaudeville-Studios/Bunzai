/** Media import and attach previews backed by the reviewed character media capability. */
import { z } from "zod";
import { rasterImageMimeFromBytes } from "../../../core/media/mime";
import { SHA256_HEX_PATTERN } from "../../../core/sha256";
import { bytesToBase64 } from "../../../core/base64";
import { STUDIO_ENTITY_KINDS } from "../../../studio/path-policy";
import { bindExtensionDefinitions, EXTENSION_HOSTS, type ExtensionOperationDefinition, type ExtensionOperationMetadata, type ResourceRef } from "../../contracts/operation";
import { decodeJsonValue } from "../../contracts/value";
import type { ExtensionOperationServices } from "../_services";
import { extensionDraftProjectionSchema } from "../content/_draft-services";
import { MAX_EXTENSION_ASSET_READ_BYTES } from "./operations";
import { decodeFileBytes, digestFileBytes } from "../files/_bytes";

const id = z.string().min(1).max(120);
const sha = z.string().regex(SHA256_HEX_PATTERN);
const importInput = z.strictObject({ id, base64: z.string().max(Math.ceil(MAX_EXTENSION_ASSET_READ_BYTES / 3) * 4) });
const attachInput = z.strictObject({ sourceKind: z.enum(STUDIO_ENTITY_KINDS), sourceId: id, sha, id });
const applyInput = z.strictObject({ id, draftId: id, fingerprint: sha });
const assetInfo = z.strictObject({ sha, mime: z.enum(["image/png", "image/jpeg", "image/gif", "image/webp"]), bytes: z.number().int().positive().max(MAX_EXTENSION_ASSET_READ_BYTES) });
const previewOutput = z.strictObject({ asset: assetInfo, draft: extensionDraftProjectionSchema });
const applyOutput = z.strictObject({ status: z.enum(["applied", "stale", "missing", "failed"]), kind: z.literal("character"), id });
type ImportInput = z.infer<typeof importInput>;
type AttachInput = z.infer<typeof attachInput>;
type ApplyInput = z.infer<typeof applyInput>;
type PreviewOutput = z.infer<typeof previewOutput>;
type ApplyOutput = z.infer<typeof applyOutput>;

function metadata<I, O>(
  operationId: string, title: string, description: string, input: z.ZodType<I>, output: z.ZodType<O>,
  access: (args: I) => { resources: ResourceRef[]; fields: string[] }, effect: "read" | "write",
): ExtensionOperationMetadata<I, O> {
  return {
    id: operationId, version: 1, inputVersion: 1, outputVersion: 1, projectionVersion: 1,
    title, description, input, output, effect, sensitivity: "private", hosts: EXTENSION_HOSTS,
    policy: { resources: effect === "write" ? ["character"] : [...STUDIO_ENTITY_KINDS], fields: effect === "write" ? ["draft"] : ["media", "draft"], methods: [], destinations: [], destinationMode: "none", budget: effect === "write" ? "write" : "read-large", confirmation: "none" },
    ...(effect === "write" ? { delegates: ["content.draft.apply"] } : {}),
    estimateBudget: () => ({ bytes: effect === "write" ? 8_000 : 32_000, tokens: 0 }), measureTokens: () => 0,
    resolveAccess: (args) => ({ ...access(args), methods: [], destinations: [] }),
    project: (value) => decodeJsonValue(output.parse(value)),
  };
}

function safeDraft(value: unknown, asset: z.infer<typeof assetInfo>) {
  const draft = extensionDraftProjectionSchema.parse(value);
  return extensionDraftProjectionSchema.parse({ ...draft, changes: draft.changes.map((change) => change.path === "body.media.portrait"
    ? { ...change, before: change.before === null ? null : { existingMedia: true }, after: { role: "portrait", sha: asset.sha, mime: asset.mime, bytes: asset.bytes } }
    : change) });
}

async function stagePortrait(context: Parameters<ExtensionOperationDefinition<ImportInput, PreviewOutput, ExtensionOperationServices>["execute"]>[1],
  id: string, bytes: Uint8Array): Promise<PreviewOutput> {
  if (!context.invoke || !context.access.fields.includes("media") || !context.access.fields.includes("draft")
    || !context.access.resources.some((resource) => resource.kind === "character" && resource.id === id)) throw new Error("portrait import is outside the approved target");
  const mime = rasterImageMimeFromBytes(bytes);
  if (!mime) throw new Error("only valid PNG, JPEG, GIF and WebP media can be imported");
  const asset = assetInfo.parse({ sha: digestFileBytes(bytes), mime, bytes: bytes.byteLength });
  const base64 = bytesToBase64(bytes);
  const result = await context.invoke("content.draft.character.media.update", {
    target: { id }, patch: { portrait: { role: "portrait", ref: `data:${mime};base64,${base64}`, mime } },
  });
  const child = z.strictObject({ draft: extensionDraftProjectionSchema.nullable() }).parse(result).draft;
  if (!child) throw new Error("the character media capability could not stage this portrait");
  return previewOutput.parse({ asset, draft: safeDraft(child, asset) });
}

const importDefinition: ExtensionOperationDefinition<ImportInput, PreviewOutput, ExtensionOperationServices> = {
  metadata: metadata("assets.import.preview", "Preview portrait import", "Stage one bounded raster image as a character portrait through the reviewed media capability.", importInput, previewOutput,
    ({ id: targetId }) => ({ resources: [{ kind: "character", id: targetId }], fields: ["media", "draft"] }), "read"),
  execute: async ({ id: targetId, base64 }, context, services) => {
    return stagePortrait(context, targetId, decodeFileBytes(base64));
  },
};

const attachDefinition: ExtensionOperationDefinition<AttachInput, PreviewOutput, ExtensionOperationServices> = {
  metadata: metadata("assets.attach.preview", "Preview portrait attachment", "Stage one referenced raster asset as a character portrait under exact source and target grants.", attachInput, previewOutput,
    ({ sourceKind, sourceId, id: targetId }) => ({ resources: [{ kind: sourceKind, id: sourceId }, { kind: "character", id: targetId }], fields: ["media", "draft"] }), "read"),
  execute: async ({ sourceKind, sourceId, sha: assetSha, id: targetId }, context, services) => {
    if (!services.assets || !context.access.resources.some((resource) => resource.kind === sourceKind && resource.id === sourceId)) throw new Error("source media is outside the approved grant");
    const result = await services.assets.read(sourceKind, sourceId, assetSha, context.access.resources, MAX_EXTENSION_ASSET_READ_BYTES);
    if (!result || result.status !== "ok" || digestFileBytes(result.bytes) !== assetSha) throw new Error("the selected media is unavailable or exceeds the asset limit");
    return stagePortrait(context, targetId, result.bytes);
  },
};

function applyDefinition(operationId: "assets.import.apply" | "assets.attach.apply", title: string): ExtensionOperationDefinition<ApplyInput, ApplyOutput, ExtensionOperationServices> {
  const operationMetadata = metadata(operationId, title, "Apply a reviewed portrait draft through the independently granted canonical draft operation.", applyInput, applyOutput,
    ({ id: targetId }) => ({ resources: [{ kind: "character", id: targetId }], fields: ["draft"] }), "write");
  return {
    metadata: { ...operationMetadata, receiptStatus: (result) => result.status === "applied" ? "committed" : result.status === "failed" ? "ambiguous" : "conflicted" },
    execute: async ({ id: targetId, draftId, fingerprint }, context) => {
      if (!context.invoke || !context.access.fields.includes("draft") || !context.access.resources.some((resource) => resource.kind === "character" && resource.id === targetId)) throw new Error("portrait draft is outside the approved grant");
      return applyOutput.parse(await context.invoke("content.draft.apply", { kind: "character", id: targetId, draftId, fingerprint }));
    },
  };
}

export const assetMutationOperations = [importDefinition, applyDefinition("assets.import.apply", "Apply portrait import"), attachDefinition, applyDefinition("assets.attach.apply", "Apply portrait attachment")] as const;
export const createOperations = (services: ExtensionOperationServices) => bindExtensionDefinitions(assetMutationOperations, services);
export default assetMutationOperations;
