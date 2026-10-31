/** Strict public projection shared by catalog description and discovery operations. */
import { z } from "zod";
import { EXTENSION_HTTP_METHODS } from "./destination";
import { isRecord } from "../../core/guards";
import { canonicalJsonString } from "../../core/sha256";
import type { HostFeature } from "./operation";
import type { JsonValue } from "./value";

const jsonSchemaObject = z.record(z.string().max(128), z.json());
export const operationMetadataSchema = z.strictObject({
  id: z.string().min(1).max(160), version: z.number().int().positive(), inputVersion: z.number().int().positive(),
  outputVersion: z.number().int().positive(), projectionVersion: z.number().int().positive(), title: z.string().max(240),
  description: z.string().max(1000), effect: z.enum(["read", "write", "external", "control"]), sensitivity: z.enum(["public", "private", "secret"]),
  delegates: z.array(z.string().min(1).max(160)).max(16).optional(),
  activationOrigins: z.array(z.enum(["command", "event", "prompt", "background", "host"])).min(1).max(5).optional(),
  hosts: z.array(z.enum(["desktop", "browser", "terminal"])).min(1),
  hostNotes: z.partialRecord(z.enum(["desktop", "browser", "terminal"]), z.string().trim().min(1).max(500)).optional(),
  policy: z.strictObject({ resources: z.array(z.string()), fields: z.array(z.string()), destinations: z.array(z.string()), methods: z.array(z.enum(EXTENSION_HTTP_METHODS)), destinationMode: z.enum(["none", "approved-public-https", "host-selected-connection", "fixed-origins"]), budget: z.enum(["metadata", "read-small", "read-large", "write", "external"]), confirmation: z.enum(["none", "effect", "sensitive-send"]) }),
  input: jsonSchemaObject, output: jsonSchemaObject,
});
export type PublicOperationMetadata = z.infer<typeof operationMetadataSchema>;
export const availableOperationMetadataSchema = operationMetadataSchema.omit({ input: true, output: true })
  .extend({ inputSchema: z.string().max(240_000), outputSchema: z.string().max(240_000), granted: z.boolean() }).strict();
export type AvailableOperationMetadata = z.infer<typeof availableOperationMetadataSchema>;
export const MAX_OPERATION_PAGE_BYTES = 250_000;
export const operationPageSchema = z.strictObject({ operations: z.array(availableOperationMetadataSchema).max(20), total: z.number().int().nonnegative(), nextOffset: z.number().int().nonnegative().nullable() });
export type OperationMetadataPage = z.infer<typeof operationPageSchema>;

/** The single JSON Schema projection used by generated metadata and permission identity. */
export function operationSchemaJson(schema: z.ZodType): Record<string, unknown> {
  const result: unknown = z.toJSONSchema(schema, { unrepresentable: "throw" });
  if (!isRecord(result)) throw new Error("operation schema must serialize to a JSON object");
  return result;
}

/** Canonical serialization for trusted generated JSON Schema trees, which can exceed guest tree limits. */
export function canonicalSchemaJson(value: unknown): string {
  return canonicalJsonString(value);
}

/** Adds only the caller's own trusted grant bit to public host-available catalog metadata. */
export function projectAvailableOperations(entries: readonly JsonValue[], host: HostFeature, grants: readonly string[]): AvailableOperationMetadata[] {
  return entries.flatMap((entry) => {
    const parsed = operationMetadataSchema.safeParse(entry);
    if (!parsed.success || !parsed.data.hosts.includes(host)) return [];
    const { input, output, ...metadata } = parsed.data;
    return [availableOperationMetadataSchema.parse({ ...metadata, inputSchema: canonicalSchemaJson(input), outputSchema: canonicalSchemaJson(output), granted: grants.includes(parsed.data.id) })];
  });
}

/** Pages whole validated descriptors while keeping each reply below the common wire byte ceiling. */
export function pageAvailableOperations(rows: readonly AvailableOperationMetadata[], offset: number, limit: number): OperationMetadataPage {
  const selected: AvailableOperationMetadata[] = [];
  for (const row of rows.slice(offset, offset + limit)) {
    const candidate = [...selected, row];
    const nextOffset = offset + candidate.length < rows.length ? offset + candidate.length : null;
    const page = { operations: candidate, total: rows.length, nextOffset };
    if (new TextEncoder().encode(JSON.stringify(page)).byteLength > MAX_OPERATION_PAGE_BYTES) {
      if (!selected.length) throw new Error("one operation descriptor exceeds the public metadata page limit");
      break;
    }
    selected.push(row);
  }
  return operationPageSchema.parse({ operations: selected, total: rows.length, nextOffset: offset + selected.length < rows.length ? offset + selected.length : null });
}
