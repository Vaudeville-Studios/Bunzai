/** Encrypted, revisioned persistence contract for installed executable extensions. */
import type { EffectReceipt, ExtensionGrant } from "../../extensions/contracts/grants";
import type { JsonValue } from "../../extensions/contracts/value";
import type { ThemeScope } from "../../extensions/theme-appearance";
import type { ExtensionEventSubscription } from "../../extensions/contracts/events";

export interface ExtensionRuntimeFence { owner: string; epoch: number }
/** Immutable access resolved by the broker for this exact invocation. */
export interface ExtensionCommitAccess {
  resources: readonly { kind: string; id: string }[];
  fields: readonly string[];
  methods: readonly string[];
  destinations: readonly string[];
}
/** Trusted, host-created authority carried to a durable content mutation door. Never a guest DTO. */
export interface ExtensionCommitContext extends ExtensionRuntimeFence {
  packageId: string;
  packageDigest: string;
  policyFingerprint: string;
  grantRevision: number;
  operation: string;
  access: ExtensionCommitAccess;
  /** Invocation cancellation is checked synchronously at native commit doors. */
  signal?: AbortSignal;
  now(): number;
}
export type ExtensionWriteFence = ExtensionRuntimeFence | ExtensionCommitContext;
export interface ExtensionFenceAcquisition extends ExtensionRuntimeFence { recoveryRequired: boolean }
export interface StoredExtensionControl {
  id: string;
  revision: number;
  packageDigest: string;
  policyFingerprint: string;
  grantRevision: number;
  grants: readonly ExtensionGrant[];
  themeScopes: readonly ThemeScope[];
  eventSubscriptions: readonly ExtensionEventSubscription[];
  /** Host-visible subset of immutable manifest command IDs; decoded old records default to empty. */
  registeredCommands: readonly string[];
  /** Optional prompt hooks are suspended after three consecutive host-observed failures. */
  promptFailures: readonly { id: string; count: number }[];
  suspendedPromptIds: readonly string[];
  hostTrusted: boolean;
  enabled: boolean;
  recoveryRequired: boolean;
  dataVersion: number;
  legacyThemeImport: "pending" | "complete";
}
export interface StoredExtensionData { value: JsonValue; revision: number }
export interface StoredExtensionPackage { digest: string; bytes: Uint8Array }
export interface StoredExtensionLog { id: string; createdAt: number; level: "debug" | "info" | "warn" | "error"; message: string }
export interface ExtensionBudget { requests: number; bytes: number; tokens: number }
export interface ExtensionBudgetReservation { packageId: string; operation: string; grantRevision: number; id: string; bytes: number; tokens: number }
export type ExtensionCompareResult = "saved" | "stale";

/** Every write requires the live lease fence at the backend commit boundary. */
export interface ExtensionStore {
  acquireRuntimeFence(owner: string, now: number, ttlMs: number): Promise<ExtensionFenceAcquisition | null>;
  renewRuntimeFence(fence: ExtensionRuntimeFence, now: number, ttlMs: number): Promise<ExtensionRuntimeFence | null>;
  releaseRuntimeFence(fence: ExtensionRuntimeFence): Promise<boolean>;
  savePackage(pkg: StoredExtensionPackage, fence: ExtensionRuntimeFence): Promise<void>;
  readPackage(digest: string): Promise<StoredExtensionPackage | null>;
  listControls(): Promise<readonly StoredExtensionControl[]>;
  readControl(id: string): Promise<StoredExtensionControl | null>;
  compareAndSaveControl(control: StoredExtensionControl, expectedRevision: number, fence: ExtensionWriteFence): Promise<ExtensionCompareResult>;
  removeInstalled(packageId: string, expectedRevision: number, fence: ExtensionRuntimeFence): Promise<ExtensionCompareResult>;
  readData(packageId: string, key: string): Promise<StoredExtensionData | null>;
  listDataKeys(packageId: string, limit: number): Promise<readonly string[]>;
  compareAndSaveData(packageId: string, key: string, value: JsonValue, expectedRevision: number, fence: ExtensionWriteFence): Promise<ExtensionCompareResult>;
  deleteData(packageId: string, key: string, expectedRevision: number, fence: ExtensionWriteFence): Promise<ExtensionCompareResult>;
  reserveBudget(reservation: ExtensionBudgetReservation, limits: ExtensionBudget, fence: ExtensionRuntimeFence): Promise<boolean>;
  settleBudget(packageId: string, reservationId: string, bytes: number, tokens: number, fence: ExtensionRuntimeFence): Promise<boolean>;
  finalizeAbandonedBudget(packageId: string, fence: ExtensionRuntimeFence): Promise<number>;
  appendReceipt(receipt: EffectReceipt, fence: ExtensionRuntimeFence): Promise<void>;
  listReceipts(packageId: string, after: string | null, limit: number): Promise<readonly EffectReceipt[]>;
  appendLog(packageId: string, log: StoredExtensionLog, fence: ExtensionCommitContext): Promise<void>;
  listLogs(packageId: string, after: string | null, limit: number): Promise<{ records: readonly StoredExtensionLog[]; nextCursor: string | null }>;
}
