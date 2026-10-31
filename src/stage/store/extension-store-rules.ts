/** Shared identifier, quota, byte and fence validation for extension persistence backends. */
import { decodeJsonValue, type JsonValue } from "../../extensions/contracts/value";
import { MAX_EXTENSION_LOG_MESSAGE_BYTES, MAX_EXTENSION_PACKAGE_BYTES } from "../../extensions/contracts/limits";
export { MAX_EXTENSION_PACKAGE_BYTES } from "../../extensions/contracts/limits";
import { z } from "zod";
import { effectReceiptSchema, extensionGrantSchema, type EffectReceipt, type ExtensionGrant } from "../../extensions/contracts/grants";
import type { ExtensionRuntimeFence, StoredExtensionControl, StoredExtensionPackage } from "../contracts/extension-store";
import { THEME_SCOPES } from "../../extensions/theme-appearance";
import { isSha256Hex, sha256HexBytes } from "../../core/sha256";
import { deepEq } from "../../core/guards";
import { extensionEventSubscriptionSchema } from "../../extensions/contracts/events";
import { contributionIdSchema } from "../../extensions/contracts/contribution-id";
import { isWhole } from "./scalar-rules";

export const MAX_EXTENSION_DATA_BYTES = 64_000;
export const MAX_EXTENSION_DATA_TOTAL_BYTES = 5_000_000;
export const MAX_EXTENSION_DATA_KEYS = 256;
export const MAX_EXTENSION_RECEIPTS = 1_000;
export const MAX_EXTENSION_LOGS = 1_000;
export const MAX_EXTENSION_CONTROLS = 100;
export const MAX_EXTENSION_PACKAGE_TOTAL_BYTES = 100_000_000;
export const MAX_EXTENSION_BUDGET_RESERVATIONS = 256;
export const MAX_EXTENSION_LIST = 200;
const ID = /^[a-z0-9][a-z0-9.-]{0,159}$/;
export const storedExtensionControlSchema = z.object({
  id: z.string().regex(ID), revision: z.number().int().nonnegative(), packageDigest: z.string().refine(isSha256Hex),
  policyFingerprint: z.string().refine(isSha256Hex), grantRevision: z.number().int().nonnegative(), grants: z.array(extensionGrantSchema).max(256),
  themeScopes: z.array(z.enum(THEME_SCOPES)).max(THEME_SCOPES.length), eventSubscriptions: z.array(extensionEventSubscriptionSchema).max(256).default([]), hostTrusted: z.boolean().default(false),
  registeredCommands: z.array(contributionIdSchema).max(64).default([]),
  promptFailures: z.array(z.object({ id: contributionIdSchema, count: z.number().int().min(1).max(2) }).strict()).max(64).default([]),
  suspendedPromptIds: z.array(contributionIdSchema).max(64).default([]),
  enabled: z.boolean(), recoveryRequired: z.boolean(), dataVersion: z.number().int().nonnegative(), legacyThemeImport: z.enum(["pending", "complete"]),
}).strict().superRefine((control, context) => {
  const subscriptions = control.eventSubscriptions.map((item) => item.scope === "scene"
    ? `${item.scope}\0${item.event}\0${item.sceneId}`
    : `${item.scope}\0${item.event}\0${item.resource.kind}\0${item.resource.id}`);
  if (new Set(subscriptions).size !== subscriptions.length) context.addIssue({ code: "custom", path: ["eventSubscriptions"], message: "duplicate event subscription" });
  if (new Set(control.registeredCommands).size !== control.registeredCommands.length) context.addIssue({ code: "custom", path: ["registeredCommands"], message: "duplicate registered command" });
  if (new Set(control.promptFailures.map((item) => item.id)).size !== control.promptFailures.length) context.addIssue({ code: "custom", path: ["promptFailures"], message: "duplicate prompt failure entry" });
  if (new Set(control.suspendedPromptIds).size !== control.suspendedPromptIds.length || control.suspendedPromptIds.some((id) => control.promptFailures.some((item) => item.id === id))) context.addIssue({ code: "custom", path: ["suspendedPromptIds"], message: "invalid suspended prompt IDs" });
});
export const checkExtensionId = (id: string): string => { if (!ID.test(id)) throw new Error("invalid extension id"); return id; };
export function checkExtensionPackageDigest(value: string): string {
  if (!isSha256Hex(value)) throw new Error("invalid package digest");
  return value;
}
export const checkExtensionKey = (key: string): string => { if (!/^[a-z0-9][a-z0-9._-]{0,127}$/.test(key)) throw new Error("invalid extension data key"); return key; };
export const checkedValue = (value: JsonValue): JsonValue => {
  const parsed = decodeJsonValue(value);
  if (new TextEncoder().encode(JSON.stringify(parsed)).byteLength > MAX_EXTENSION_DATA_BYTES) throw new Error("extension data exceeds its size limit");
  return parsed;
};
export const checkedPackage = async (pkg: StoredExtensionPackage): Promise<StoredExtensionPackage> => {
  if (!isSha256Hex(pkg.digest) || !(pkg.bytes instanceof Uint8Array) || pkg.bytes.byteLength > MAX_EXTENSION_PACKAGE_BYTES) throw new Error("invalid extension package bytes");
  const digest = sha256HexBytes(pkg.bytes);
  if (digest !== pkg.digest) throw new Error("extension package digest mismatch");
  return { digest, bytes: pkg.bytes.slice() };
};
export function checkedControl(control: unknown): StoredExtensionControl {
  return structuredClone(storedExtensionControlSchema.parse(control)) as StoredExtensionControl;
}
export function checkedFence(fence: ExtensionRuntimeFence): ExtensionRuntimeFence {
  if (!fence || typeof fence.owner !== "string" || !/^[a-f0-9-]{36}$/.test(fence.owner) || !isWhole(fence.epoch, 1)) throw new Error("invalid extension runtime fence");
  return fence;
}
export function checkedReceipt(receipt: EffectReceipt): EffectReceipt {
  const value = effectReceiptSchema.parse(decodeJsonValue(receipt));
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(value.id) || !ID.test(value.packageId)) throw new Error("invalid extension receipt");
  return value;
}
export function receiptUpdate(existing: EffectReceipt | null, incoming: EffectReceipt): "insert" | "same" | "update" {
  if (!existing) return "insert";
  if (deepEq(existing, incoming)) return "same";
  const sameIdentity = existing.id === incoming.id && existing.packageId === incoming.packageId
    && existing.operation === incoming.operation && existing.effect === incoming.effect
    && existing.createdAt === incoming.createdAt && existing.resourceCount === incoming.resourceCount;
  if (sameIdentity && existing.status === "admitted" && incoming.status !== "admitted") return "update";
  throw new Error("extension receipt ID was reused");
}
export function checkedExtensionLog(input: unknown): import("../contracts/extension-store").StoredExtensionLog {
  const schema = z.object({ id: z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/), createdAt: z.number().int().nonnegative(), level: z.enum(["debug", "info", "warn", "error"]), message: z.string() }).strict();
  const log = schema.parse(input);
  if (new TextEncoder().encode(log.message).byteLength > MAX_EXTENSION_LOG_MESSAGE_BYTES) throw new Error("extension log message exceeds its size limit");
  return log;
}
