/** Exact-piece asset inventory and bounded reads; opaque blob hashes are never ambient file paths. */
import { z } from "zod";
import { bytesToBase64 } from "../../../core/base64";
import { ASSET_MAX_BYTES } from "../../../core/media/limits";
import { SHA256_HEX_PATTERN } from "../../../core/sha256";
import { STUDIO_ENTITY_KINDS } from "../../../studio/path-policy";
import { MAX_EXTENSION_FILE_TRANSFER_BYTES } from "../../contracts/limits";
import { bindExtensionDefinitions, type ExtensionOperationDefinition, type ExtensionOperationMetadata, type HostFeature } from "../../contracts/operation";
import { decodeJsonValue } from "../../contracts/value";
import type { ExtensionOperationServices } from "../_services";

const HOSTS = ["desktop", "browser", "terminal"] as const satisfies readonly HostFeature[];
export const MAX_EXTENSION_ASSET_READ_BYTES = MAX_EXTENSION_FILE_TRANSFER_BYTES;
const scopeFields = ["media"] as const;
const resourcePolicy = [...STUDIO_ENTITY_KINDS];
const resourceAccess = ({ kind, id }: { kind: string; id: string }) => ({ resources: [{ kind, id }], fields: ["media"], methods: [], destinations: [] });

const listInput = z.strictObject({ kind: z.enum(STUDIO_ENTITY_KINDS), id: z.string().min(1).max(120), offset: z.number().int().min(0).max(256).default(0), limit: z.number().int().min(1).max(32).default(20) });
const sha = z.string().regex(SHA256_HEX_PATTERN);
const assetRow = z.strictObject({ sha, mime: z.string().max(120).nullable(), bytes: z.number().int().nonnegative().max(ASSET_MAX_BYTES).nullable() });
const listOutput = z.strictObject({ assets: z.array(assetRow).max(32), total: z.number().int().nonnegative().max(256), nextOffset: z.number().int().nonnegative().nullable() });
type ListInput = z.infer<typeof listInput>;
type ListOutput = z.infer<typeof listOutput>;
const listMetadata: ExtensionOperationMetadata<ListInput, ListOutput> = {
  id: "assets.list", version: 1, inputVersion: 1, outputVersion: 1, projectionVersion: 1,
  title: "List media assets", description: "List stored blobs referenced by one exactly granted canonical piece's declared media fields.",
  input: listInput, output: listOutput, effect: "read", sensitivity: "private", hosts: HOSTS,
  policy: { resources: resourcePolicy, fields: [...scopeFields], methods: [], destinations: [], destinationMode: "none", budget: "read-small", confirmation: "none" },
  estimateBudget: () => ({ bytes: 24_000, tokens: 0 }), measureTokens: () => 0,
  resolveAccess: resourceAccess, project: (value) => decodeJsonValue(listOutput.parse(value)),
};
const listDefinition: ExtensionOperationDefinition<ListInput, ListOutput, ExtensionOperationServices> = {
  metadata: listMetadata,
  execute: async ({ kind, id, offset, limit }, context, services) => {
    if (!services.assets || !context.access.fields.includes("media") || !context.access.resources.some((ref) => ref.kind === kind && ref.id === id)) throw new Error("asset access is outside the approved grant");
    const all = await services.assets.list(kind, id, context.access.resources);
    const assets = all.slice(offset, offset + limit);
    return listOutput.parse({ assets, total: all.length, nextOffset: offset + assets.length < all.length ? offset + assets.length : null });
  },
};

const readInput = z.strictObject({ kind: z.enum(STUDIO_ENTITY_KINDS), id: z.string().min(1).max(120), sha, maxBytes: z.number().int().min(1).max(MAX_EXTENSION_ASSET_READ_BYTES) });
const readOutput = z.strictObject({ status: z.enum(["ok", "too-large"]), sha, mime: z.string().max(120).nullable(), bytes: z.number().int().nonnegative().max(ASSET_MAX_BYTES).nullable(), base64: z.string().max(Math.ceil(MAX_EXTENSION_ASSET_READ_BYTES / 3) * 4).nullable() });
type ReadInput = z.infer<typeof readInput>;
type ReadOutput = z.infer<typeof readOutput>;
const readMetadata: ExtensionOperationMetadata<ReadInput, ReadOutput> = {
  id: "assets.read", version: 1, inputVersion: 1, outputVersion: 1, projectionVersion: 1,
  title: "Read a media asset", description: "Read at most 180 KB when the hash is referenced by the selected piece; base64 and DTO overhead stay inside the shared guest JSON limit.",
  input: readInput, output: readOutput, effect: "read", sensitivity: "private", hosts: HOSTS,
  policy: { resources: resourcePolicy, fields: [...scopeFields], methods: [], destinations: [], destinationMode: "none", budget: "read-large", confirmation: "none" },
  estimateBudget: ({ maxBytes }) => ({ bytes: Math.ceil(maxBytes / 3) * 4 + 1_000, tokens: 0 }), measureTokens: () => 0,
  resolveAccess: resourceAccess, project: (value) => decodeJsonValue(readOutput.parse(value)),
};
const readDefinition: ExtensionOperationDefinition<ReadInput, ReadOutput, ExtensionOperationServices> = {
  metadata: readMetadata,
  execute: async ({ kind, id, sha, maxBytes }, context, services) => {
    if (!services.assets || !context.access.fields.includes("media") || !context.access.resources.some((ref) => ref.kind === kind && ref.id === id)) throw new Error("asset access is outside the approved grant");
    const asset = await services.assets.read(kind, id, sha, context.access.resources, maxBytes);
    if (!asset) throw new Error("the selected media hash is not referenced by this piece");
    return readOutput.parse({ status: asset.status === "ok" ? "ok" : "too-large", sha, mime: asset.mime, bytes: asset.status === "ok" ? asset.bytes.byteLength : asset.bytes, base64: asset.status === "ok" ? bytesToBase64(asset.bytes) : null });
  },
};

export const assetOperations = [listDefinition, readDefinition] as const;
export const createOperations = (services: ExtensionOperationServices) => bindExtensionDefinitions(assetOperations, services);
export default assetOperations;
