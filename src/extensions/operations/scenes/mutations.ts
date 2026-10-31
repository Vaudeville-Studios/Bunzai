/** Fenced message and take mutations over ChatStore's existing versioned domain methods. */
import { z } from "zod";
import { MAX_VALUE_BYTES } from "../../contracts/limits";
import { decodeJsonValue, type JsonValue } from "../../contracts/value";
import { bindExtensionDefinitions, EXTENSION_HOSTS, type ExtensionOperationDefinition, type ExtensionOperationMetadata, type ResourceRef } from "../../contracts/operation";
import type { ExtensionOperationServices } from "../_services";
import type { ExtensionSceneServices } from "./_services";
import { messageSchema, sceneIdSchema } from "./_schemas";

const pair = z.strictObject({ sceneId: sceneIdSchema, takeId: sceneIdSchema });
const sendInput = pair.extend({ content: z.string().min(1).max(16_000), expectedVersion: z.number().int().nonnegative() });
const editInput = pair.extend({ seq: z.number().int().nonnegative(), content: z.string().min(1).max(3_000), expectedVersion: z.number().int().nonnegative() });
const targetInput = pair.extend({ seq: z.number().int().nonnegative(), expectedVersion: z.number().int().nonnegative() });
const forkInput = pair.extend({ messageId: sceneIdSchema, swipeId: sceneIdSchema.optional(), name: z.string().min(1).max(120), expectedVersion: z.number().int().nonnegative() });
const saved = z.strictObject({ id: sceneIdSchema, seq: z.number().int().nonnegative(), role: z.enum(["user", "assistant", "system"]), branchVersion: z.number().int().nonnegative().nullable() }).nullable();
const deleted = z.strictObject({ id: sceneIdSchema, seq: z.number().int().nonnegative(), cutId: sceneIdSchema, count: z.number().int().positive(), branchVersion: z.number().int().nonnegative().nullable() }).nullable();
const take = z.strictObject({ id: sceneIdSchema, sceneId: sceneIdSchema, name: z.string().max(120), parentId: sceneIdSchema.nullable(), version: z.number().int().nonnegative(), createdAt: z.number().int().nonnegative() }).nullable();
const editPreview = z.strictObject({ id: sceneIdSchema, seq: z.number().int().nonnegative(), before: z.string().max(3_000), after: z.string().max(3_000), expectedVersion: z.number().int().nonnegative() }).nullable();
const access = (sceneId: string, takeId: string, fields: readonly string[]) => ({ resources: [{ kind: "scene", id: sceneId }, { kind: "take", id: takeId }], fields: [...fields], methods: [], destinations: [] });
const fields = ["message.seq", "message.id", "message.content"] as const;
const versionBytes = MAX_VALUE_BYTES;
const metadata = <I extends { sceneId: string; takeId: string }, O>(id: string, title: string, description: string, input: z.ZodType<I>, output: z.ZodType<O>, effect: "read" | "write", budget: "read-small" | "write", sensitivity: "private" | "secret", fields: readonly string[]): ExtensionOperationMetadata<I, O> => ({
  id, version: 1, inputVersion: 1, outputVersion: 1, projectionVersion: 1, title, description, input, output,
  effect, sensitivity, hosts: EXTENSION_HOSTS,
  ...(effect === "write" ? { receiptStatus: (value: O) => value === null ? "conflicted" as const : "committed" as const } : {}),
  policy: { resources: ["scene", "take"], fields: [...fields], methods: [], destinationMode: "none", destinations: [], budget, confirmation: effect === "write" ? "effect" : "none" },
  estimateBudget: () => ({ bytes: versionBytes, tokens: 0 }), measureTokens: () => 0,
  resolveAccess: (raw) => { const { sceneId, takeId } = input.parse(raw) as I; return access(sceneId, takeId, fields); }, project: (value) => output.parse(value) as JsonValue,
});
function assertContext(context: { access: { resources: readonly ResourceRef[]; fields: readonly string[] } }, sceneId: string, takeId: string, requiredFields: readonly string[]): void {
  if (!context.access.resources.some((item) => item.kind === "scene" && item.id === sceneId)
    || !context.access.resources.some((item) => item.kind === "take" && item.id === takeId)
    || requiredFields.some((field) => !context.access.fields.includes(field))) throw new Error("PERMISSION_DENIED: message target is outside approved access");
}
const message = async (services: ExtensionSceneServices, sceneId: string, takeId: string, seq: number, scope: readonly ResourceRef[]) => {
  const result = await services.readMessage(sceneId, takeId, seq, scope, fields);
  return result === null ? null : messageSchema.parse(result);
};

const send: ExtensionOperationDefinition<z.infer<typeof sendInput>, z.infer<typeof saved>, ExtensionSceneServices> = {
  metadata: metadata<z.infer<typeof sendInput>, z.infer<typeof saved>>("messages.send", "Add a message", "Append one user-authored message to an approved take after host review.", sendInput, saved, "write", "write", "private", ["message.content"]),
  review: async ({ sceneId, takeId, content, expectedVersion }, context) => {
    assertContext(context, sceneId, takeId, ["message.content"]);
    return { action: "append message", sceneId, takeId, expectedVersion, content };
  },
  execute: async ({ sceneId, takeId, content, expectedVersion }, context, services) => {
    assertContext(context, sceneId, takeId, ["message.content"]);
    const result = await services.sendMessage(sceneId, takeId, content, expectedVersion, context.access.resources, context.commit);
    return result === null ? null : saved.parse(result);
  },
};
const preview: ExtensionOperationDefinition<z.infer<typeof editInput>, z.infer<typeof editPreview>, ExtensionSceneServices> = {
  metadata: metadata<z.infer<typeof editInput>, z.infer<typeof editPreview>>("messages.edit.preview", "Preview message edit", "Preview an exact message edit without writing it.", editInput, editPreview, "read", "read-small", "private", fields),
  execute: async ({ sceneId, takeId, seq, content, expectedVersion }, context, services) => {
    assertContext(context, sceneId, takeId, fields);
    const current = await message(services, sceneId, takeId, seq, context.access.resources);
    return current ? editPreview.parse({ id: current.id, seq, before: current.content ?? "", after: content, expectedVersion }) : null;
  },
};
const edit: ExtensionOperationDefinition<z.infer<typeof editInput>, z.infer<typeof saved>, ExtensionSceneServices> = {
  metadata: metadata<z.infer<typeof editInput>, z.infer<typeof saved>>("messages.edit.apply", "Apply message edit", "Replace the selected message version after a host review and expected-version check.", editInput, saved, "write", "write", "private", fields),
  review: async ({ sceneId, takeId, seq, content, expectedVersion }, context, services) => {
    assertContext(context, sceneId, takeId, fields);
    const current = await message(services, sceneId, takeId, seq, context.access.resources);
    if (!current?.id) return decodeJsonValue({ action: "edit message", sceneId, takeId, seq, missing: true });
    return decodeJsonValue({ action: "edit message", sceneId, takeId, seq, messageId: current.id, before: current.content ?? "", after: content, expectedVersion });
  },
  execute: async ({ sceneId, takeId, seq, content, expectedVersion }, context, services) => {
    assertContext(context, sceneId, takeId, fields);
    const result = await services.editMessage(sceneId, takeId, seq, content, expectedVersion, context.access.resources, context.commit);
    return result === null ? null : saved.parse(result);
  },
};
const remove: ExtensionOperationDefinition<z.infer<typeof targetInput>, z.infer<typeof deleted>, ExtensionSceneServices> = {
  metadata: metadata<z.infer<typeof targetInput>, z.infer<typeof deleted>>("messages.delete", "Delete message", "Soft-delete one approved message after host review; retained history remains recoverable by the host.", targetInput, deleted, "write", "write", "private", ["message.seq", "message.id"]),
  review: async ({ sceneId, takeId, seq, expectedVersion }, context, services) => {
    assertContext(context, sceneId, takeId, ["message.seq", "message.id"]);
    const current = await message(services, sceneId, takeId, seq, context.access.resources);
    return { action: "soft-delete message", sceneId, takeId, seq, ...(current?.id ? { messageId: current.id, excerpt: (current.content ?? "").slice(0, 240) } : { missing: true }), expectedVersion };
  },
  execute: async ({ sceneId, takeId, seq, expectedVersion }, context, services) => {
    assertContext(context, sceneId, takeId, ["message.seq", "message.id"]);
    const result = await services.deleteMessage(sceneId, takeId, seq, expectedVersion, context.access.resources, context.commit);
    return result === null ? null : deleted.parse(result);
  },
};
const fork: ExtensionOperationDefinition<z.infer<typeof forkInput>, z.infer<typeof take>, ExtensionSceneServices> = {
  metadata: metadata<z.infer<typeof forkInput>, z.infer<typeof take>>("takes.fork", "Fork a take", "Create a new take through ChatStore at an approved message and version.", forkInput, take, "write", "write", "private", ["message.id"]),
  review: async ({ sceneId, takeId, messageId, swipeId, name, expectedVersion }, context) => {
    assertContext(context, sceneId, takeId, ["message.id"]);
    return { action: "fork take", sceneId, takeId, messageId, ...(swipeId ? { swipeId } : {}), name, expectedVersion };
  },
  execute: async ({ sceneId, takeId, messageId, swipeId, name, expectedVersion }, context, services) => {
    assertContext(context, sceneId, takeId, ["message.id"]);
    const result = await services.forkTake(sceneId, takeId, messageId, swipeId, name, expectedVersion, context.access.resources, context.commit);
    return result === null ? null : take.parse(result);
  },
};

export const sceneMutationOperations = [send, preview, edit, remove, fork] as const;
export const createOperations = (services: ExtensionOperationServices) => bindExtensionDefinitions(sceneMutationOperations, services.scenes!);
export default sceneMutationOperations;
