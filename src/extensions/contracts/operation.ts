/** Host-owned operation metadata and executor seam. */
import type { z } from "zod";
import type { JsonValue } from "./value";
import type { ExtensionInvocationContext } from "./invocation-context";
import type { ContentKind } from "../../entities/capabilities/types";
import type { PieceSummary } from "../../stage/contracts/content-store-summary";
import type { VersionSummary } from "../../stage/contracts/content-store";
import type { ExtensionCommitContext } from "../../stage/contracts/extension-store";
import type { DestinationPolicy } from "./destination";
import type { EffectReceipt } from "./grants";

export type HostFeature = "desktop" | "browser" | "terminal";
export type ExtensionActivationOrigin = "command" | "event" | "prompt" | "background" | "host";
export const PROMPT_SAFE_READ_ORIGINS: readonly ExtensionActivationOrigin[] = ["command", "event", "prompt", "background", "host"];
/** The closed host enum; operation descriptors list only hosts with a proven adapter. */
export const EXTENSION_HOSTS: readonly HostFeature[] = ["desktop", "browser", "terminal"];
export const DESKTOP_EXTENSION_HOSTS: readonly HostFeature[] = ["desktop"];
export const BROWSER_EXTENSION_HOSTS: readonly HostFeature[] = ["desktop", "browser"];
export const DESKTOP_TERMINAL_EXTENSION_HOSTS: readonly HostFeature[] = ["desktop", "terminal"];
export const EXTENSION_COMMAND_HOSTS: readonly HostFeature[] = ["desktop", "browser", "terminal"];
export const CORE_LINKED_SCENE_HOST_NOTES: Readonly<Partial<Record<HostFeature, string>>> = {
  desktop: "Core-linked scenes support append and exact mapped edit; delete and fork remain unavailable.",
  terminal: "Core-linked scenes support append and exact mapped edit; delete and fork remain unavailable.",
};
export const CORE_LINKED_TURN_HOST_NOTES: Readonly<Partial<Record<HostFeature, string>>> = {
  desktop: "Core-linked turns use the Core prompt and event pipeline; summary and Compendium follow-on jobs are refused.",
  terminal: "Core-linked turns use the Core prompt and event pipeline; summary and Compendium follow-on jobs are refused.",
};
export const CORE_SCENE_SETTING_HOST_NOTES: Readonly<Partial<Record<HostFeature, string>>> = {
  desktop: "Core-linked scenes support only connection and backdrop setting selectors; legacy-only selectors are refused.",
  terminal: "Core-linked scenes support only connection and backdrop setting selectors; legacy-only selectors are refused.",
};
export type EffectClass = "read" | "write" | "external" | "control";
export type DataSensitivity = "public" | "private" | "secret";
export type ConfirmationClass = "none" | "effect" | "sensitive-send";
export type BudgetClass = "metadata" | "read-small" | "read-large" | "write" | "external";
/** One host-owned cumulative quota preset per reviewed effect class; user approvals may only narrow these. */
export const EXTENSION_BUDGET_PRESETS: Readonly<Record<BudgetClass, { requests: number; bytes: number; tokens: number }>> = {
  metadata: { requests: 100, bytes: 25_600_000, tokens: 0 },
  "read-small": { requests: 200, bytes: 5_000_000, tokens: 0 },
  "read-large": { requests: 40, bytes: 20_000_000, tokens: 0 },
  write: { requests: 30, bytes: 5_000_000, tokens: 0 },
  external: { requests: 10, bytes: 1_000_000, tokens: 50_000 },
};
export interface ResourceRef { kind: string; id: string }
/** Narrow read-only host port; implementation must filter scope before ranking/counting and fields before returning. */
export interface ExtensionContentServices {
  listSummaries(scope: readonly ResourceRef[], kinds: readonly ContentKind[], limit: number, fields: readonly string[]): Promise<readonly PieceSummary[]>;
  searchSummaries(query: string, scope: readonly ResourceRef[], kinds: readonly ContentKind[], limit: number, fields: readonly string[]): Promise<readonly PieceSummary[]>;
  readSummary(kind: ContentKind, id: string, scope: readonly ResourceRef[], fields: readonly string[]): Promise<PieceSummary | null>;
  readBody(kind: ContentKind, id: string, scope: readonly ResourceRef[], fields: readonly string[]): Promise<JsonValue | null>;
  readSelectedFields(kind: ContentKind, id: string, scope: readonly ResourceRef[], fields: readonly string[]): Promise<readonly { path: string; value: JsonValue }[] | null>;
  readFields(kind: "character", id: string, group: "character.identity", scope: readonly ResourceRef[], fields: readonly string[]): Promise<JsonValue | null>;
  readPersonaIdentity(kind: "persona", id: string, group: "persona.identity", scope: readonly ResourceRef[], fields: readonly string[]): Promise<JsonValue | null>;
  readLinks(kind: "character", id: string, scope: readonly ResourceRef[], fields: readonly string[]): Promise<JsonValue | null>;
  listHistory(kind: ContentKind, id: string, scope: readonly ResourceRef[], fields: readonly string[]): Promise<readonly VersionSummary[]>;
  readHistory(kind: ContentKind, id: string, version: number, scope: readonly ResourceRef[], fields: readonly string[]): Promise<readonly { path: string; value: JsonValue }[] | null>;
  trash(kind: ContentKind, id: string, expectedRevision: string, scope: readonly ResourceRef[], commit: ExtensionCommitContext): Promise<boolean>;
  readGrave(kind: ContentKind, id: string, graveId: string, scope: readonly ResourceRef[]): Promise<{ graveId: string; kind: string; id: string; name: string; deletedAt: number } | null>;
  restore(kind: ContentKind, id: string, graveId: string, scope: readonly ResourceRef[], commit: ExtensionCommitContext): Promise<PieceSummary | null>;
}
export interface ResolvedOperationAccess {
  resources: readonly ResourceRef[];
  fields: readonly string[];
  methods: readonly string[];
  destinations: readonly string[];
}
export interface ExtensionBudgetEstimate { bytes: number; tokens: number }
export interface ExtensionOperationPolicy {
  resources: readonly string[];
  fields: readonly string[];
  methods: readonly string[];
  destinationMode: DestinationPolicy;
  destinations: readonly string[];
  budget: BudgetClass;
  confirmation: ConfirmationClass;
}
export interface OperationPrincipal {
  storeId: string;
  packageId: string;
  packageDigest: string;
  apiMajor: number;
  policyFingerprint: string;
  grantRevision: number;
  runEpoch: number;
}
export interface ExtensionPromptInvocation {
  sceneId: string;
  stage: "system.append";
  messages: readonly { role: "system" | "user" | "assistant" | "tool"; content: string }[];
  contribute(text: string): boolean;
  transform(text: string): boolean;
}
export interface ExtensionOperationContext {
  principal: OperationPrincipal;
  /** Manifest-bound declarations supplied by the host for the current activation. */
  declaredCommands?: readonly string[];
  declaredPanels?: readonly string[];
  declaredAssets?: readonly string[];
  /** Host-derived call origin; never included in the wire protocol. */
  activationOrigin?: ExtensionActivationOrigin;
  /** Frozen host-selected resources filtered to this operation's exact grant. */
  invocation: ExtensionInvocationContext;
  signal: AbortSignal;
  resources: readonly ResourceRef[];
  grantedOperations: readonly string[];
  availableGrants: readonly JsonValue[];
  operationReceipts: readonly JsonValue[];
  host: HostFeature;
  availableOperations: readonly JsonValue[];
  access: ResolvedOperationAccess;
  /** Exact host-produced review detail carried to execute; never supplied by the extension. */
  hostReview?: JsonValue;
  commit: ExtensionCommitContext;
  /** Recheck lease, enabled control, package digest, and grant revision immediately before an external/native effect. */
  assertCurrent(): Promise<void>;
  confirm(effect: JsonValue): Promise<boolean>;
  /** Trusted recursive dispatch for tools; the same principal, grant checks and receipt path apply. */
  invoke?(operation: string, args: JsonValue): Promise<JsonValue>;
  /** Bound only while a manifest-declared prompt hook is running; never serialized to the worker. */
  promptInvocation?: ExtensionPromptInvocation;
}
export interface ExtensionOperationDescriptor<I = unknown, O = unknown> {
  id: string;
  version: number;
  inputVersion: number;
  outputVersion: number;
  projectionVersion: number;
  title: string;
  description: string;
  input: z.ZodType<I>;
  output: z.ZodType<O>;
  effect: EffectClass;
  /** Fixed child operation IDs for a trusted wrapper that delegates its entire effect through the broker. */
  delegates?: readonly string[];
  /** Restricts which host-created activation contexts may call this operation. */
  activationOrigins?: readonly ExtensionActivationOrigin[];
  sensitivity: DataSensitivity;
  hosts: readonly HostFeature[];
  hostNotes?: Readonly<Partial<Record<HostFeature, string>>>;
  policy: ExtensionOperationPolicy;
  estimateBudget(args: I): ExtensionBudgetEstimate;
  measureTokens(value: O): number;
  resolveAccess(args: I): ResolvedOperationAccess;
  project(value: O, principal: OperationPrincipal, access: ResolvedOperationAccess): JsonValue;
  review?(args: I, context: ExtensionOperationContext): Promise<JsonValue>;
  execute(args: I, context: ExtensionOperationContext): Promise<O>;
  /** Classifies a successful structured result when it did not commit the advertised mutation. */
  receiptStatus?(value: O): Extract<EffectReceipt["status"], "committed" | "completed" | "conflicted" | "ambiguous">;
}

/** Drop-ins keep reviewable metadata beside their executor; generation can inspect metadata without running IO. */
export type ExtensionOperationMetadata<I = unknown, O = unknown> = Omit<ExtensionOperationDescriptor<I, O>, "execute">;
export type ExtensionOperationMetadataInput<I = unknown, O = unknown> = Omit<ExtensionOperationMetadata<I, O>, "version" | "inputVersion" | "outputVersion" | "projectionVersion">;
export interface ExtensionOperationDefinition<I = unknown, O = unknown, D = unknown> {
  metadata: ExtensionOperationMetadata<I, O>;
  review?(args: I, context: ExtensionOperationContext, services: D): Promise<JsonValue>;
  execute(args: I, context: ExtensionOperationContext, services: D): Promise<O>;
}

/** Applies the one current metadata schema version tuple to source-owned descriptors. */
export function defineExtensionOperationMetadata<I, O>(metadata: ExtensionOperationMetadataInput<I, O>): ExtensionOperationMetadata<I, O> {
  return { ...metadata, version: 1, inputVersion: 1, outputVersion: 1, projectionVersion: 1 };
}

/** Bind host-owned service ports once when the trusted runtime composes the generated operation catalog. */
export function bindExtensionOperation<I, O, D>(definition: ExtensionOperationDefinition<I, O, D>, services: D): ExtensionOperationDescriptor<I, O> {
  return { ...definition.metadata, ...(definition.review ? { review: (args, context) => definition.review!(args, context, services) } : {}), execute: (args, context) => definition.execute(args, context, services) };
}

/** Erase per-operation schema variance only at this trusted heterogeneous binding boundary. */
export function bindExtensionDefinitions<D>(definitions: readonly unknown[], services: D): ExtensionOperationDescriptor[] {
  return definitions.map((candidate) => {
    if (typeof candidate !== "object" || candidate === null || !("metadata" in candidate) || !("execute" in candidate)
      || typeof candidate.metadata !== "object" || candidate.metadata === null
      || typeof candidate.execute !== "function") throw new Error("invalid extension operation definition");
    return bindExtensionOperation(candidate as ExtensionOperationDefinition<unknown, unknown, D>, services);
  });
}
