/** Versioned value-only protocol shared by the worker, host bridge and broker. */
import { z } from "zod";
import { decodeJsonValue, jsonValueSchemaBounded, type JsonValue } from "./value";
import { extensionErrorSchema } from "./errors";
import { operationIdSchema } from "./operation-id";

export const EXTENSION_WIRE_VERSION = 1;
const requestShape = z.object({
  v: z.literal(EXTENSION_WIRE_VERSION), type: z.literal("request"), id: z.number().int().positive(),
  operation: operationIdSchema, args: jsonValueSchemaBounded,
}).strict();
const replyShape = z.discriminatedUnion("ok", [
  z.object({ v: z.literal(EXTENSION_WIRE_VERSION), type: z.literal("reply"), id: z.number().int().positive(), ok: z.literal(true), value: jsonValueSchemaBounded }).strict(),
  z.object({ v: z.literal(EXTENSION_WIRE_VERSION), type: z.literal("reply"), id: z.number().int().positive(), ok: z.literal(false), error: extensionErrorSchema }).strict(),
]);
const cancelShape = z.object({ v: z.literal(EXTENSION_WIRE_VERSION), type: z.literal("cancel"), id: z.number().int().positive() }).strict();
const boundedEnvelope = <T extends z.ZodType>(shape: T) => z.preprocess((value, context) => {
  try { return decodeJsonValue(value); }
  catch { context.addIssue({ code: "custom", message: "invalid bounded wire envelope" }); return z.NEVER; }
}, shape);
export const extensionWireRequestSchema = boundedEnvelope(requestShape);
export const extensionWireReplySchema = boundedEnvelope(replyShape);
export const extensionWireCancelSchema = boundedEnvelope(cancelShape);
const invocationShape = z.object({
  kind: z.enum(["command", "event"]), id: z.string().min(1).max(120), input: jsonValueSchemaBounded,
  commands: z.array(z.string().min(1).max(120)).max(128), events: z.array(z.string().min(1).max(120)).max(128),
}).strict().superRefine((invocation, ctx) => {
  const ids = invocation.kind === "command" ? invocation.commands : invocation.events;
  if (!ids.includes(invocation.id)) ctx.addIssue({ code: "custom", path: ["id"], message: "invocation is not declared by package" });
  if (new Set(invocation.commands).size !== invocation.commands.length || new Set(invocation.events).size !== invocation.events.length) {
    ctx.addIssue({ code: "custom", message: "duplicate manifest invocation id" });
  }
});
export const extensionInvocationSchema = boundedEnvelope(invocationShape);
export type ExtensionWireRequest = z.infer<typeof extensionWireRequestSchema>;
export type ExtensionWireReply = z.infer<typeof extensionWireReplySchema>;
export type ExtensionWireCancel = z.infer<typeof extensionWireCancelSchema>;
export type ExtensionInvocation = z.infer<typeof extensionInvocationSchema>;
export type ExtensionWireValue = JsonValue;
