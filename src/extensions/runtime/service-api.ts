/** Host-facing manager DTOs shared by the local UI and service owner. */
import type { EffectReceipt, ExtensionGrant } from "../contracts/grants";
import type { ExtensionPackageInput } from "../contracts/package";
import type { JsonValue } from "../contracts/value";
import { decodeJsonValue } from "../contracts/value";
import { MAX_VALUE_BYTES } from "../contracts/limits";
import type { ExtensionEventSubscription } from "../contracts/events";
import type { ThemeScope } from "../theme-appearance";
import type { ThemePackagePreview } from "../theme-contract";
import { interactiveDescriptorSchema } from "../contracts/interactive";
import type { PendingExtensionEffect } from "./confirmation";
import type { HostFileActionPort } from "./file-action-port";
import type { ExtensionHostActionAnswer, ExtensionHostActionSnapshot, PendingExtensionHostAction } from "../contracts/host-actions";
import type { FileActionAnswer, PendingExtensionFileAction } from "../contracts/file-actions";
import type { ExtensionInvocationContext } from "../contracts/invocation-context";
import type { ProviderRole } from "../../stage/contracts/provider";
import { z } from "zod";

const jsonValueSchema = z.custom<JsonValue>((value) => { try { decodeJsonValue(value); return true; } catch { return false; } });
export const extensionActivationResultSchema = z.union([
  z.strictObject({ status: z.literal("completed"), output: z.null(), descriptor: interactiveDescriptorSchema }),
  z.strictObject({ status: z.literal("completed"), output: jsonValueSchema }),
]);
export type ExtensionActivationResult = z.infer<typeof extensionActivationResultSchema>;

export interface ExtensionPromptPreview {
  sceneId: string;
  label: "Local prompt preview; no model called; unshaped and unbudgeted." | "RP-Core prompt preview; local only; canonical shaping and budget applied.";
  messages: readonly { role: ProviderRole; content: string }[];
}
export const extensionPromptPreviewSchema = z.strictObject({
  sceneId: z.string().min(1).max(120),
  label: z.enum(["Local prompt preview; no model called; unshaped and unbudgeted.", "RP-Core prompt preview; local only; canonical shaping and budget applied."]),
  messages: z.array(z.strictObject({ role: z.enum(["system", "user", "assistant", "tool"]), content: z.string().max(MAX_VALUE_BYTES) })).max(256),
});
export const extensionPromptScenesSchema = z.array(z.strictObject({ id: z.string().min(1).max(120), title: z.string().max(256) })).max(500);
export type ExtensionPromptScene = z.infer<typeof extensionPromptScenesSchema>[number];

export interface ExtensionPackagePreview { challenge: string; expiresAt: number; expectedRevision: number; digest: string; package: ExtensionPackageInput; requestedOperations: readonly string[]; unsupported: readonly string[] }
export interface InstalledExtensionSummary {
  id: string; hostTrusted: boolean; revision: number; digest: string; name: string; version: string; description: string; enabled: boolean; recoveryRequired: boolean;
  grants: readonly ExtensionGrant[]; requirements: readonly ExtensionPackageInput["manifest"]["requirements"][number][];
  contributions: readonly ExtensionPackageInput["manifest"]["contributions"][number][]; settings: ExtensionPackageInput["manifest"]["settings"];
  theme: ThemePackagePreview | null; themeScopes: readonly ThemeScope[]; eventSubscriptions: readonly ExtensionEventSubscription[]; dataKeys: readonly string[]; dataBytes: number;
  registeredCommands: readonly string[];
  promptFailures: readonly { id: string; count: number }[];
  suspendedPromptIds: readonly string[];
  activity: readonly EffectReceipt[];
}
export interface ExtensionManagerApi {
  revision(): Promise<string>;
  list(): Promise<readonly InstalledExtensionSummary[]>;
  preview(input: unknown): Promise<ExtensionPackagePreview>;
  install(challenge: string, grants: readonly ExtensionGrant[], themeScopes: readonly ThemeScope[], expectedRevision: number): Promise<import("../../stage/contracts/extension-store").StoredExtensionControl>;
  previewInstalled(id: string): Promise<ExtensionPackagePreview>;
  setGrants(id: string, challenge: string, grants: readonly ExtensionGrant[], themeScopes: readonly ThemeScope[], expectedRevision: number): Promise<import("../../stage/contracts/extension-store").StoredExtensionControl>;
  enable(id: string, expectedRevision: number): Promise<import("../../stage/contracts/extension-store").StoredExtensionControl>;
  disable(id: string, expectedRevision: number): Promise<import("../../stage/contracts/extension-store").StoredExtensionControl>;
  revoke(id: string, expectedRevision: number): Promise<import("../../stage/contracts/extension-store").StoredExtensionControl>;
  readSettings(id: string): Promise<{ schema: JsonValue | null; value: JsonValue | null; revision: number }>;
  writeSettings(id: string, value: JsonValue, expectedRevision: number): Promise<{ status: "saved"; revision: number } | { status: "stale" }>;
  uninstall(id: string, expectedRevision: number): Promise<boolean>;
  activate(id: string, kind: "command" | "event", contributionId: string, input: JsonValue, hostContextOrPrompt?: ExtensionInvocationContext | import("../contracts/operation").ExtensionPromptInvocation, externalSignal?: AbortSignal, hostContext?: ExtensionInvocationContext): Promise<ExtensionActivationResult>;
  previewPrompts(sceneId: string, draft: string, signal?: AbortSignal): Promise<ExtensionPromptPreview>;
  promptScenes(): Promise<readonly ExtensionPromptScene[]>;
  notifySceneOpened(sceneId: string, navigationTicketId?: string | null): Promise<boolean>;
  pendingEffects(): Promise<readonly PendingExtensionEffect[]>;
  answerEffect(id: string, approved: boolean): Promise<boolean>;
  pendingFileActions(): Promise<readonly PendingExtensionFileAction[]>;
  beginFileWrite(id: string): Promise<boolean>;
  answerFileAction(id: string, result: FileActionAnswer): Promise<boolean>;
  hostActions(): Promise<ExtensionHostActionSnapshot>;
  claimHostAction(id: string): Promise<PendingExtensionHostAction | null>;
  answerHostAction(id: string, answer: ExtensionHostActionAnswer): Promise<boolean>;
  completeFileReadChunk(id: string, offset: number, totalBytes: number, bytes: Uint8Array, final: boolean): Promise<boolean>;
  fileWriteChunk(id: string, offset: number): Promise<ReturnType<HostFileActionPort["writeChunk"]>>;
}
