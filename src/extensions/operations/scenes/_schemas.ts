/** Closed schemas and selectors for scene/take/message reads. */
import { z } from "zod";

export const sceneResourceSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("library"), id: z.literal("library") }),
  z.strictObject({ kind: z.enum(["scene", "take"]), id: z.string().min(1).max(120) }),
]);
export const sceneScopeSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("library") }),
  z.strictObject({ type: z.literal("selected"), resources: z.array(sceneResourceSchema).min(1).max(50) }),
]).refine((scope) => scope.type !== "selected" || new Set(scope.resources.map(({ kind, id }) => `${kind}:${id}`)).size === scope.resources.length);
export const sceneIdSchema = z.string().min(1).max(120);
export const sceneSummarySchema = z.strictObject({ id: sceneIdSchema, title: z.string().max(200), activeTakeId: sceneIdSchema, updatedAt: z.number().int().nonnegative(), character: z.strictObject({ id: sceneIdSchema, name: z.string().max(200) }) });
export const sceneDetailFields = ["scene.connection", "scene.preset", "scene.folder", "scene.favorite", "scene.variant"] as const;
export const sceneDetailFieldSchema = z.enum(sceneDetailFields);
export const sceneDetailSchema = sceneSummarySchema.extend({
  connection: z.strictObject({ id: z.string().max(120), model: z.string().max(200) }).nullable().optional(),
  preset: z.strictObject({ kind: z.string().max(40), id: z.string().max(120) }).nullable().optional(),
  folderId: z.string().max(120).nullable().optional(), favoredAt: z.number().int().nonnegative().nullable().optional(),
  variantId: z.string().max(120).nullable().optional(),
});
export const messageFields = ["message.seq", "message.id", "message.role", "message.createdAt", "message.hidden", "message.content"] as const;
export const messageFieldSchema = z.enum(messageFields);
export const messageFieldsSchema = z.array(messageFieldSchema).min(1).max(messageFields.length)
  .refine((fields) => new Set(fields).size === fields.length && fields.includes("message.seq"));
export const takeSummarySchema = z.strictObject({ id: sceneIdSchema, sceneId: sceneIdSchema, name: z.string().max(120), parentId: sceneIdSchema.nullable(), version: z.number().int().nonnegative(), createdAt: z.number().int().nonnegative(), forkPosition: z.number().int().nonnegative().nullable() });
export const messageSchema = z.strictObject({ id: sceneIdSchema.optional(), seq: z.number().int().nonnegative(), role: z.enum(["user", "assistant", "system"]).optional(), createdAt: z.number().int().nonnegative().optional(), hidden: z.boolean().optional(), content: z.string().max(3_000).optional(), contentTruncated: z.boolean().optional() });
