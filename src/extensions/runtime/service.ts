/** Composes per-store extension admission, host services, execution, and lifecycle. */
import type { ExtensionGrant, ExtensionGrantSet } from "../contracts/grants";
import { extensionGrantSchema } from "../contracts/grants";
import { inspectExtensionPackage } from "../contracts/package-validation";
import type { ThemeScope } from "../theme-appearance";
import type { ExtensionPackageInput } from "../contracts/package";
import { MAX_EXTENSION_PACKAGE_BYTES, canonicalJsonBytes, decodeJsonValue, digestJson } from "../contracts/value";
import type { ExtensionOperationDescriptor, ExtensionPromptInvocation, HostFeature, OperationPrincipal, ResolvedOperationAccess } from "../contracts/operation";
import type { ExtensionWireReply, ExtensionWireRequest } from "../contracts/wire";
import type { JsonValue } from "../contracts/value";
import { validateInteractiveDescriptor } from "../contracts/interactive";
import type { ExtensionCommitContext, ExtensionRuntimeFence, ExtensionStore, StoredExtensionControl } from "../../stage/contracts/extension-store";
import type { ExtensionBudget, ExtensionBudgetReservation } from "../../stage/contracts/extension-store";
import { createExtensionBroker } from "../broker/invoke";
import { runJavaScriptInWorker } from "../../sandbox/javascript/run-in-worker";
import { extensionErrorCode } from "../contracts/errors";
import type { PendingExtensionEffect } from "./confirmation";
import { createExtensionMutationQueue } from "./mutation-queue";
import { expireSessionGrants } from "./session-grants";
import { createExtensionThemeService } from "./theme-service";
import { createExtensionEventDispatcher } from "./event-dispatch";
import { createPromptHookRunner } from "./prompt-hooks";
import type { HostFileActionPort } from "./file-action-port";
import type { HostActionPort } from "./host-action-port";
import { createExtensionPackagePolicy } from "./package-policy";
import { ExtensionServiceError, serviceError } from "./service-errors";
import { createExtensionHostActionView } from "./host-action-view";
import { extensionActivationResultSchema, type ExtensionActivationResult, type ExtensionManagerApi, type ExtensionPackagePreview, type ExtensionPromptPreview, type ExtensionPromptScene, type InstalledExtensionSummary } from "./service-api";
import { extensionSettingsServices } from "./settings-services";
import type { LegacyThemeMigration } from "../legacy-theme-migrations";
import { isRecord } from "../../core/guards";
import { contributionIdSchema } from "../contracts/contribution-id";
import { createExtensionPackageReviews } from "./package-reviews";
import { createExtensionHostActionApi } from "./service-host-actions";
import { createExtensionPromptManagerApi } from "./service-prompts";
import { createSceneNavigationNotifications } from "./service-scene-navigation";
import { snapshotInvocationResources, type ExtensionInvocationContext } from "../contracts/invocation-context";
import { createExtensionRunStopper } from "./run-lifecycle";
import { createLiveFenceGuard, EXTENSION_RUNTIME_FENCE_TTL_MS } from "./live-fence";
export { extensionActivationResultSchema, extensionPromptPreviewSchema, extensionPromptScenesSchema } from "./service-api";
export type { ExtensionActivationResult, ExtensionManagerApi, ExtensionPackagePreview, ExtensionPromptPreview, ExtensionPromptScene, InstalledExtensionSummary } from "./service-api";
export { ExtensionServiceError } from "./service-errors";
export interface ExtensionServiceOptions {
  store: ExtensionStore;
  storeId: string;
  host: HostFeature;
  operations: readonly ExtensionOperationDescriptor[];
  operationMetadata?: readonly JsonValue[];
  builtinPackages?: readonly ExtensionPackageInput[];
  legacyThemes?: LegacyThemeMigration[];
  safeThemes?: boolean;
  now(): number;
  id(): string;
  sandboxOrigin?: string | (() => string);
  browserSandbox?: { workerSource: string; wasmBase64: string };
  quickJsWasmBinary?: Uint8Array;
  selectedScope?(): readonly { kind: string; id: string }[];
  confirmEffect?(packageId: string, packageName: string, effect: JsonValue, signal: AbortSignal): Promise<boolean>;
  pendingEffects?(): readonly PendingExtensionEffect[] | Promise<readonly PendingExtensionEffect[]>;
  answerEffect?(id: string, approved: boolean): boolean | Promise<boolean>;
  fileActions?: HostFileActionPort;
  hostActions?: HostActionPort;
  previewPrompts?(sceneId: string, draft: string, signal: AbortSignal): Promise<ExtensionPromptPreview>;
  promptScenes?(): Promise<readonly ExtensionPromptScene[]>;
  closeHost?(): Promise<void>;
}
/** Creates one explicit owner; no guest can choose the principal, store, host or lease. */
export function createExtensionService(options: ExtensionServiceOptions) {
  const operations = new Map(options.operations.map((operation) => [operation.id, operation]));
  if (operations.size !== options.operations.length) throw new Error("duplicate extension operation id");
  const packagePolicy = createExtensionPackagePolicy(options.host, operations);
  const hostSettings = extensionSettingsServices(options.store);
  let fence: ExtensionRuntimeFence | null = null;
  let closed = false;
  let closing = false;
  const stoppingPackages = new Set<string>();
  const activeRuns = new Map<string, Set<AbortController>>();
  const activePrincipals = new Map<string, Set<OperationPrincipal>>();
  const runPrincipals = new Map<AbortController, OperationPrincipal>();
  const brokerCalls = new Map<AbortController, Set<{ operation: string; settled: Promise<void> }>>();
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  let runEpoch = 0;
  const MAX_ACTIVE_WORKERS = 16;
  const MAX_PACKAGE_WORKERS = 4;
  const runSettled = new Map<AbortController, Promise<void>>();
  const completedFileEffects = new Map<string, "written" | "ambiguous">();
  let eventDispatcher: ReturnType<typeof createExtensionEventDispatcher>;
  let promptHookRunner: ReturnType<typeof createPromptHookRunner>;
  async function requireFence(): Promise<ExtensionRuntimeFence> {
    if (closed || !fence) throw new ExtensionServiceError("RUNTIME_UNAVAILABLE", "Extension runtime is not started.");
    return fence;
  }
  const assertLiveFence = createLiveFenceGuard({ store: options.store, current: () => fence, replace: (next) => { fence = next; },
    unavailable: () => closed || closing, blocked: (packageId) => stoppingPackages.has(packageId), now: options.now,
    onLost: () => { closing = true; if (heartbeat) clearInterval(heartbeat); },
    fail: () => new ExtensionServiceError("RUNTIME_UNAVAILABLE", "Extension runtime lease is unavailable or changing.") });
  const packageReviews = createExtensionPackageReviews({ store: options.store, storeId: options.storeId, host: options.host, operations,
    builtinPackages: options.builtinPackages ?? [], now: options.now, id: options.id, requireFence });
  const mutations = createExtensionMutationQueue();
  const stopRuns = createExtensionRunStopper({ stoppingPackages, activeRuns, activePrincipals, runPrincipals, brokerCalls,
    fileActions: options.fileActions, hostActions: options.hostActions,
    answerFileAction: (id, result) => service.answerFileAction(id, result) });
  const sceneNavigation = createSceneNavigationNotifications({ now: options.now, requireFence, dispatch: (payload, origin) => eventDispatcher.dispatch(payload, origin) });
  const hostActionView = createExtensionHostActionView({ store: options.store, port: options.hostActions, storeId: options.storeId,
    host: options.host, operations, active: activePrincipals, requireFence, assertLiveFence });
  const themes = createExtensionThemeService({ store: options.store, builtinPackages: options.builtinPackages ?? [], legacyThemes: options.legacyThemes ?? [],
    safeThemes: options.safeThemes ?? false, policyFingerprint: (scopes) => packagePolicy.fingerprint([], scopes) });
  const expireCurrentSessionGrants = (liveFence: ExtensionRuntimeFence) => expireSessionGrants(options.store, liveFence, packagePolicy.fingerprint, stopRuns);
  async function install(challenge: string, grantsInput: readonly ExtensionGrant[], themeScopes: readonly ThemeScope[], expectedRevision: number): Promise<StoredExtensionControl> {
    const review = await packageReviews.takeChallenge(challenge, expectedRevision);
    if (review.hostTrusted) {
      const inventory = (options.builtinPackages ?? []).find((item) => item.manifest.id === review.packageId);
      const prior = await options.store.readControl(review.packageId);
      if (!prior?.hostTrusted || !inventory || await digestJson(inventory, MAX_EXTENSION_PACKAGE_BYTES) !== review.digest) serviceError("PERMISSION_DENIED", "Trusted built-in review no longer matches host inventory.");
    }
    const grants = grantsInput.map((grant) => extensionGrantSchema.parse(grant));
    packagePolicy.validateGrants(review.package, grants);
    packagePolicy.validateThemeScopes(review.package, themeScopes);
    const policyFingerprint = await packagePolicy.fingerprint(grants, themeScopes);
    return mutations.exclusive(async () => {
      const liveFence = await requireFence();
      const prior = await options.store.readControl(review.packageId);
      if ((prior?.revision ?? -1) !== expectedRevision || (prior?.policyFingerprint ?? null) !== review.priorPolicy) serviceError("CONFLICT", "Extension state changed; review and retry.");
      const revision = (prior?.revision ?? -1) + 1;
      const grantRevision = (prior?.grantRevision ?? -1) + 1;
      const registeredCommands = review.package.manifest.contributions.filter((item) => item.type === "command").map((item) => item.id);
      const control: StoredExtensionControl = {
        id: review.packageId, revision, packageDigest: review.digest, policyFingerprint, grantRevision, grants, themeScopes: [...themeScopes], eventSubscriptions: [], registeredCommands, promptFailures: [], suspendedPromptIds: [], hostTrusted: review.hostTrusted,
        enabled: false, recoveryRequired: false, dataVersion: prior?.dataVersion ?? 0, legacyThemeImport: prior?.legacyThemeImport ?? "pending",
      };
      const bytes = canonicalJsonBytes(review.package, MAX_EXTENSION_PACKAGE_BYTES);
      await options.store.savePackage({ digest: review.digest, bytes }, liveFence);
      if (await options.store.compareAndSaveControl(control, prior?.revision ?? -1, liveFence) !== "saved") throw new Error("extension state changed; review and retry");
      await stopRuns(control.id);
      return control;
    });
  }
  async function updateControl(id: string, expectedRevision: number, transform: (current: StoredExtensionControl) => StoredExtensionControl, allowHostTrusted = false): Promise<StoredExtensionControl> {
    return mutations.exclusive(async () => {
      const liveFence = await requireFence();
      const current = await options.store.readControl(id);
      if (!current) throw new Error("extension is not installed");
      if (current.hostTrusted && !allowHostTrusted) serviceError("PERMISSION_DENIED", "Host-owned extensions cannot be changed through the package manager.");
      if (current.revision !== expectedRevision) serviceError("CONFLICT", "Extension state changed; review and retry.");
      const next = transform(current);
      const blockAdmission = current.enabled && !next.enabled;
      if (blockAdmission) stoppingPackages.add(id);
      if (await options.store.compareAndSaveControl(next, current.revision, liveFence) !== "saved") {
        if (blockAdmission) stoppingPackages.delete(id);
        throw new Error("extension state changed; retry");
      }
      if (next.enabled) stoppingPackages.delete(id);
      if (!next.enabled) await stopRuns(id);
      return next;
    });
  }
  async function pendingEffectForFileAction(ticketId: string) {
    const pending = await options.pendingEffects?.() ?? [];
    return pending.find((effect) => isRecord(effect.review) && isRecord(effect.review.hostAction) && effect.review.hostAction.ticketId === ticketId);
  }
  const hostManagerApi = createExtensionHostActionApi({
    store: options.store, storeId: options.storeId, fileActions: options.fileActions, hostActions: options.hostActions,
    activePrincipals, mutations, hostActionView, requireFence, assertLiveFence, pendingEffects: options.pendingEffects, answerEffect: options.answerEffect,
    pendingEffectForFileAction: async (id) => await pendingEffectForFileAction(id) ?? null, completedFileEffects,
    recordSceneNavigation: sceneNavigation.record,
  });
  const promptManagerApi = createExtensionPromptManagerApi({
    requireFence,
    preview: options.previewPrompts,
    scenes: options.promptScenes,
    apply: (sceneId, messages, signal) => promptHookRunner(sceneId, messages, signal),
  });
  const service = {
    async start() {
      if (fence) throw new Error("extension runtime already started");
      const acquired = await options.store.acquireRuntimeFence(options.id(), options.now(), EXTENSION_RUNTIME_FENCE_TTL_MS);
      if (!acquired) throw new Error("another extension runtime owns this store");
      fence = { owner: acquired.owner, epoch: acquired.epoch };
      runEpoch = acquired.epoch * 1_000_000;
      heartbeat = setInterval(() => {
        const live = fence;
        if (!live || closed) return;
        void options.store.renewRuntimeFence(live, options.now(), EXTENSION_RUNTIME_FENCE_TTL_MS).then(async (renewed) => {
          if (!renewed) {
            if (heartbeat) clearInterval(heartbeat);
            for (const id of [...activeRuns.keys()]) await stopRuns(id);
            closed = true; fence = null; options.fileActions?.close(); options.hostActions?.close();
          }
        }).catch(async () => {
          if (heartbeat) clearInterval(heartbeat);
          for (const id of [...activeRuns.keys()]) await stopRuns(id);
          closed = true; fence = null; options.fileActions?.close(); options.hostActions?.close();
        });
      }, 10_000);
      try {
        if (acquired.recoveryRequired) {
          for (const control of await options.store.listControls()) await options.store.finalizeAbandonedBudget(control.id, fence);
        }
        await mutations.exclusive(async () => { await themes.seed(fence!); await themes.migrate(fence!); await expireCurrentSessionGrants(fence!); });
        if (acquired.recoveryRequired) {
          for (const control of await options.store.listControls()) {
            if (control.enabled) await options.store.compareAndSaveControl({ ...control, enabled: false, recoveryRequired: true, revision: control.revision + 1 }, control.revision, fence);
          }
        }
        return acquired;
      } catch (error) {
        closed = true;
        if (heartbeat) clearInterval(heartbeat);
        fence = null;
        await options.store.releaseRuntimeFence({ owner: acquired.owner, epoch: acquired.epoch }).catch(() => false);
        throw error;
      }
    },
    preview: packageReviews.preview,
    install,
    async revision() {
      await requireFence();
      const controls = await options.store.listControls();
      return digestJson(controls.map(({ id, revision, packageDigest, grantRevision, enabled, themeScopes, eventSubscriptions, registeredCommands, promptFailures, suspendedPromptIds }) => ({ id, revision, packageDigest, grantRevision, enabled, themeScopes, eventSubscriptions, registeredCommands, promptFailures, suspendedPromptIds })).sort((a, b) => a.id.localeCompare(b.id)));
    },
    themeEffective: themes.effective,
    themeAsset: themes.asset,
    themeMarkBroken: themes.markBroken,
    themeConfirmHealthy: themes.confirmHealthy,
    async themeRevision() {
      await requireFence();
      return themes.revision();
    },
    async list(): Promise<readonly InstalledExtensionSummary[]> {
      await requireFence();
      const controls = await options.store.listControls();
      return Promise.all(controls.map(async (control) => {
        const stored = await options.store.readPackage(control.packageDigest);
        if (!stored) throw new Error("installed extension package is missing");
        const decoded = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(stored.bytes)) as unknown;
        const inspected = await inspectExtensionPackage(decoded, { allowHostTheme: control.hostTrusted });
        if (inspected.package.manifest.id !== control.id) throw new Error("installed extension identity mismatch");
        const dataKeys = await options.store.listDataKeys(control.id, 200);
        const values = await Promise.all(dataKeys.map((key) => options.store.readData(control.id, key)));
        const dataBytes = values.reduce((sum, item) => sum + (item ? new TextEncoder().encode(JSON.stringify(item.value)).byteLength : 0), 0);
        const activity = await options.store.listReceipts(control.id, null, 20);
        return { id: control.id, hostTrusted: control.hostTrusted, revision: control.revision, digest: control.packageDigest, name: inspected.package.manifest.name,
          version: inspected.package.manifest.version, description: inspected.package.manifest.description, enabled: control.enabled,
          recoveryRequired: control.recoveryRequired, grants: control.grants, requirements: inspected.package.manifest.requirements,
          contributions: inspected.package.manifest.contributions, settings: inspected.package.manifest.settings, theme: inspected.theme, themeScopes: control.themeScopes, eventSubscriptions: control.eventSubscriptions,
          registeredCommands: control.registeredCommands, promptFailures: control.promptFailures, suspendedPromptIds: control.suspendedPromptIds, dataKeys, dataBytes, activity };
      }));
    },
    async previewInstalled(id: string): Promise<ExtensionPackagePreview> {
      await requireFence();
      const control = await options.store.readControl(id);
      const stored = control ? await options.store.readPackage(control.packageDigest) : null;
      if (!control || !stored) throw new Error("extension is not installed");
      if (control.hostTrusted) {
        const inventory = (options.builtinPackages ?? []).find((item) => item.manifest.id === id);
        if (!inventory) serviceError("PERMISSION_DENIED", "The host package is not in the trusted built-in inventory.");
        const inspected = await inspectExtensionPackage(inventory, { allowHostTheme: true });
        const digest = await digestJson(inspected.package, MAX_EXTENSION_PACKAGE_BYTES);
        if (!inspected.theme || digest !== control.packageDigest) serviceError("PACKAGE_CHANGED", "The trusted built-in package changed; restart the host before reviewing it.");
        return packageReviews.createPreview(inspected.package, digest, control, true);
      }
      return packageReviews.preview(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(stored.bytes)) as unknown);
    },
    async enable(id: string, expectedRevision: number) {
      const control = await options.store.readControl(id);
      const stored = control ? await options.store.readPackage(control.packageDigest) : null;
      if (!control || !stored) throw new Error("extension is not installed");
      const trusted = control.hostTrusted ? (options.builtinPackages ?? []).find((item) => item.manifest.id === id) : undefined;
      if (control.hostTrusted && (!trusted || await digestJson(trusted, MAX_EXTENSION_PACKAGE_BYTES) !== control.packageDigest)) serviceError("PERMISSION_DENIED", "The host package is not in the trusted built-in inventory.");
      const pkg = await inspectExtensionPackage(trusted ?? JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(stored.bytes)) as unknown, { allowHostTheme: control.hostTrusted });
      const granted = new Set(control.grants.map((grant) => grant.operation));
      if (control.recoveryRequired || pkg.package.manifest.requirements.some((requirement) => requirement.required && !granted.has(requirement.operation))) serviceError("RECOVERY_REQUIRED", "Extension needs grant review before activation.");
      return updateControl(id, expectedRevision, (current) => ({ ...current, enabled: true, promptFailures: [], suspendedPromptIds: [], grantRevision: current.grantRevision + 1, revision: current.revision + 1 }), control.hostTrusted);
    },
    disable(id: string, expectedRevision: number) { return updateControl(id, expectedRevision, (control) => ({ ...control, enabled: false, grantRevision: control.grantRevision + 1, revision: control.revision + 1 }), true); },
    revoke(id: string, expectedRevision: number) { return updateControl(id, expectedRevision, (control) => ({ ...control, enabled: false, grants: [], themeScopes: [], eventSubscriptions: [], grantRevision: control.grantRevision + 1, policyFingerprint: "0".repeat(64), revision: control.revision + 1, recoveryRequired: true }), true); },
    async readSettings(id: string) {
      await requireFence();
      const control = await options.store.readControl(id);
      if (!control) throw new ExtensionServiceError("CONFLICT", "Extension is no longer installed.");
      const settings = await hostSettings.read(id, control.packageDigest);
      if (settings.schema === null) return { schema: null, value: null, revision: -1 };
      return settings;
    },
    async writeSettings(id: string, value: JsonValue, expectedRevision: number) {
      const liveFence = await requireFence();
      const control = await options.store.readControl(id);
      const stored = control ? await options.store.readPackage(control.packageDigest) : null;
      if (!control || !stored) throw new ExtensionServiceError("CONFLICT", "Extension is no longer installed.");
      if (!control.enabled || control.recoveryRequired || !control.grants.some((grant) => grant.operation === "settings.update")) {
        serviceError("PERMISSION_DENIED", "Approve settings.update and enable the extension before editing its settings.");
      }
      const commit: ExtensionCommitContext = { owner: liveFence.owner, epoch: liveFence.epoch, packageId: id, packageDigest: control.packageDigest,
        policyFingerprint: control.policyFingerprint, grantRevision: control.grantRevision, operation: "settings.update",
        access: { resources: [], fields: ["settings"], methods: [], destinations: [] }, now: options.now };
      const result = await hostSettings.write(id, control.packageDigest, decodeJsonValue(value), expectedRevision, commit);
      if (result.status === "stale") serviceError("CONFLICT", "Settings changed elsewhere. Reload before saving.");
      return result;
    },
    async uninstall(id: string, expectedRevision: number) {
      const liveFence = await requireFence();
      const control = await options.store.readControl(id);
      if (!control) throw new ExtensionServiceError("CONFLICT", "Extension is no longer installed.");
      if (control.hostTrusted) throw new ExtensionServiceError("PERMISSION_DENIED", "Host-owned extensions cannot be uninstalled.");
      if (control.revision !== expectedRevision) serviceError("CONFLICT", "Extension state changed. Reload before uninstalling.");
      stoppingPackages.add(id);
      const pending = [...(activeRuns.get(id) ?? [])].map((controller) => runSettled.get(controller)).filter((value): value is Promise<void> => value !== undefined);
      await stopRuns(id);
      if (await options.store.removeInstalled(id, expectedRevision, liveFence) !== "saved") serviceError("CONFLICT", "Extension state changed. Reload before uninstalling.");
      await Promise.allSettled(pending);
      return true;
    },
    async setGrants(id: string, challenge: string, grantsInput: readonly ExtensionGrant[], themeScopes: readonly ThemeScope[], expectedRevision: number) {
      const review = await packageReviews.takeChallenge(challenge, expectedRevision);
      if (review.packageId !== id) throw new Error("review belongs to another package");
      if (review.hostTrusted) {
        const inventory = (options.builtinPackages ?? []).find((item) => item.manifest.id === id);
        if (!inventory || await digestJson(inventory, MAX_EXTENSION_PACKAGE_BYTES) !== review.digest || grantsInput.length !== 0) serviceError("PERMISSION_DENIED", "Trusted built-in access can only use host-declared appearance scopes.");
      }
      const grants = grantsInput.map((grant) => extensionGrantSchema.parse(grant));
      packagePolicy.validateGrants(review.package, grants);
      packagePolicy.validateThemeScopes(review.package, themeScopes);
      const policyFingerprint = await packagePolicy.fingerprint(grants, themeScopes);
      const current = await options.store.readControl(id);
      if (!current || current.packageDigest !== review.digest || current.policyFingerprint !== review.priorPolicy) throw new Error("extension state changed; review again");
      return updateControl(id, expectedRevision, (control) => ({ ...control, enabled: false, grants, themeScopes: [...themeScopes], eventSubscriptions: [], promptFailures: [], suspendedPromptIds: [], policyFingerprint, grantRevision: control.grantRevision + 1, revision: control.revision + 1, recoveryRequired: false }), review.hostTrusted);
    },
    async activate(id: string, kind: "command" | "event", contributionId: string, input: JsonValue, activationContext?: ExtensionInvocationContext | ExtensionPromptInvocation, externalSignal?: AbortSignal, hostContext?: ExtensionInvocationContext): Promise<ExtensionActivationResult> {
      const promptInvocation = activationContext && "contribute" in activationContext ? activationContext : undefined;
      const hostInvocation = hostContext ?? (promptInvocation ? undefined : activationContext);
      await requireFence();
      contributionIdSchema.parse(contributionId);
      const control = await options.store.readControl(id);
      if (!control?.enabled || control.recoveryRequired) throw new Error("extension is disabled or needs access review");
      const stored = await options.store.readPackage(control.packageDigest);
      if (!stored) throw new Error("installed extension package is missing");
      const pkg = (await inspectExtensionPackage(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(stored.bytes)) as unknown)).package;
      if (await digestJson(pkg, MAX_EXTENSION_PACKAGE_BYTES) !== control.packageDigest) throw new Error("installed extension digest is invalid");
      const entry = pkg.manifest.entry;
      if (!entry) throw new Error("extension has no executable entry");
      const commands = pkg.manifest.contributions.filter((part) => part.type === "command").map((part) => part.id);
      const events = pkg.manifest.contributions.flatMap((part) => part.type === "panel" ? part.events : part.type === "prompt" ? [part.id] : []);
      if (!(kind === "command" ? commands : events).includes(contributionId)) throw new Error("extension invocation is not declared");
      if (kind === "command" && !control.registeredCommands.includes(contributionId)) throw new ExtensionServiceError("PERMISSION_DENIED", "This command is not registered with the host.");
      const activeForPackage = activeRuns.get(id)?.size ?? 0;
      const activeTotal = [...activeRuns.values()].reduce((sum, runs) => sum + runs.size, 0);
      if (closing) throw new ExtensionServiceError("RUNTIME_UNAVAILABLE", "The extension runtime is closing.");
      if (stoppingPackages.has(id)) throw new ExtensionServiceError("PERMISSION_DENIED", "Extension access is changing; retry after reviewing its current state.");
      if (activeForPackage >= MAX_PACKAGE_WORKERS || activeTotal >= MAX_ACTIVE_WORKERS) throw new ExtensionServiceError("LIMIT_EXCEEDED", "The extension worker limit is reached.");
      const controller = new AbortController();
      const abortFromHost = () => controller.abort(externalSignal?.reason);
      if (externalSignal?.aborted) abortFromHost();
      else externalSignal?.addEventListener("abort", abortFromHost, { once: true });
      const runs = activeRuns.get(id) ?? new Set<AbortController>(); runs.add(controller); activeRuns.set(id, runs);
      let settleRun!: () => void;
      runSettled.set(controller, new Promise<void>((resolve) => { settleRun = resolve; }));
      const basePrincipal = { storeId: options.storeId, packageId: id, packageDigest: control.packageDigest, apiMajor: pkg.manifest.api.major, policyFingerprint: control.policyFingerprint, grantRevision: control.grantRevision, runEpoch: ++runEpoch };
      runPrincipals.set(controller, basePrincipal);
      const principals = activePrincipals.get(id) ?? new Set<OperationPrincipal>();
      principals.add(basePrincipal);
      activePrincipals.set(id, principals);
      let current = control;
      const refresh = async (): Promise<void> => {
        if (closing || stoppingPackages.has(id)) throw new ExtensionServiceError("PERMISSION_DENIED", "Extension access is changing; retry after reviewing its current state.");
        const activeFence = await requireFence();
        const renewed = await options.store.renewRuntimeFence(activeFence, options.now(), EXTENSION_RUNTIME_FENCE_TTL_MS);
        if (!renewed) {
          closed = true;
          if (heartbeat) clearInterval(heartbeat);
          fence = null;
          throw new ExtensionServiceError("RUNTIME_UNAVAILABLE", "The extension runtime lease was lost.");
        }
        fence = renewed;
        const live = await options.store.readControl(id);
        if (!live || !live.enabled || live.recoveryRequired
          || live.packageDigest !== basePrincipal.packageDigest || live.policyFingerprint !== basePrincipal.policyFingerprint
          || live.grantRevision !== basePrincipal.grantRevision) {
          current = live ?? { ...control, enabled: false, recoveryRequired: true, revision: control.revision + 1 };
          throw new ExtensionServiceError("PERMISSION_DENIED", "Extension access changed; restart after reviewing its current access.");
        }
        current = live;
      };
      const hostSelectedResources = hostContext?.resources
        ?? (activationContext && "resources" in activationContext ? activationContext.resources : undefined);
      const selectedScope = snapshotInvocationResources(hostSelectedResources ?? (promptInvocation
        ? [{ kind: "scene", id: promptInvocation.sceneId }]
        : options.selectedScope?.() ?? []));
      const authority = {
        refresh,
        declarations: { commands, panels: pkg.manifest.contributions.filter((part) => part.type === "panel").map((part) => part.id),
          assets: current.themeScopes.includes("appearance.assets") ? pkg.manifest.theme?.assets.map((asset) => asset.id) ?? [] : [] },
        activationOrigin: promptInvocation ? "prompt" as const : kind === "event" ? "event" as const : "command" as const,
        principal: () => ({ ...basePrincipal, packageDigest: current.packageDigest, policyFingerprint: current.policyFingerprint, grantRevision: current.grantRevision }),
        grants: () => ({ packageId: id, packageDigest: current.packageDigest, policyFingerprint: current.policyFingerprint, revision: current.grantRevision, grants: [...current.grants] }),
        host: options.host, operationMetadata: options.operationMetadata ?? [], selectedScope: () => selectedScope, signal: controller.signal,
        confirm: (effect: JsonValue) => options.confirmEffect?.(id, pkg.manifest.name, effect, controller.signal) ?? Promise.resolve(false),
        confirmedEffectResult: async (effect: JsonValue): Promise<"none" | "written" | "ambiguous"> => {
          if (!isRecord(effect)) return "none";
          const review = effect.review;
          if (!isRecord(review)) return "none";
          const action = review.hostAction;
          if (!isRecord(action)) return "none";
          const ticketId = action.ticketId;
          if (typeof ticketId !== "string") return "none";
          const outcome = completedFileEffects.get(ticketId) ?? "none";
          completedFileEffects.delete(ticketId);
          return outcome;
        },
        reserveBudget: (reservation: ExtensionBudgetReservation, limits: ExtensionBudget) => options.store.reserveBudget(reservation, limits, fence!),
        settleBudget: (packageId: string, reservationId: string, bytes: number, tokens: number) => options.store.settleBudget(packageId, reservationId, bytes, tokens, fence!),
        record: (receipt: import("../contracts/grants").EffectReceipt) => options.store.appendReceipt(receipt, fence!), now: options.now, id: options.id,
        readReceipts: (packageId: string, limit: number) => options.store.listReceipts(packageId, null, limit),
        promptInvocation: () => promptInvocation,
        commitContext: (principal: OperationPrincipal, operation: string, access: ResolvedOperationAccess): ExtensionCommitContext => {
          const activeFence = fence;
          if (!activeFence) return serviceError("RUNTIME_UNAVAILABLE", "The extension runtime lease is unavailable.");
          return { owner: activeFence.owner, epoch: activeFence.epoch, packageId: principal.packageId, packageDigest: principal.packageDigest,
            policyFingerprint: principal.policyFingerprint, grantRevision: principal.grantRevision, operation,
            access: { resources: access.resources.map((resource) => ({ ...resource })), fields: [...access.fields], methods: [...access.methods], destinations: [...access.destinations] },
            signal: controller.signal, now: options.now };
        },
      };
      const broker = createExtensionBroker(options.operations, authority);
      const dispatch = async (request: ExtensionWireRequest, _signal: AbortSignal): Promise<ExtensionWireReply> => {
        if (closing || stoppingPackages.has(id)) return { v: 1, type: "reply", id: request.id, ok: false,
          error: { code: "PERMISSION_DENIED", message: "Extension access is changing; retry after reviewing its current state." } };
        const pending = broker(request);
        const calls = brokerCalls.get(controller) ?? new Set<{ operation: string; settled: Promise<void> }>();
        const call = { operation: request.operation, settled: pending.then(() => undefined, () => undefined) };
        calls.add(call); brokerCalls.set(controller, calls);
        try { return { v: 1, type: "reply", id: request.id, ok: true, value: await pending as JsonValue }; }
        catch (error) { return { v: 1, type: "reply", id: request.id, ok: false, error: { code: extensionErrorCode(error instanceof Error && "code" in error ? String(error.code) : "OPERATION_FAILED"), message: error instanceof Error ? error.message.slice(0, 500) : "Operation failed" } }; }
        finally { calls.delete(call); if (calls.size === 0) brokerCalls.delete(controller); }
      };
      try {
        const sandboxOrigin = typeof options.sandboxOrigin === "function" ? options.sandboxOrigin() : options.sandboxOrigin;
        const invocationResources = snapshotInvocationResources(selectedScope.filter((resource) => current.grants.some((grant) => grant.resources.some((allowed) => allowed.kind === resource.kind && allowed.id === resource.id))));
        const value = await runJavaScriptInWorker(pkg.files[entry]!, dispatch, { sandboxOrigin, opaqueBrowser: options.browserSandbox, quickJsWasmBinary: options.quickJsWasmBinary, invocationResources, signal: controller.signal, invocation: { kind, id: contributionId, input, commands, events } });
        const normalized = value === undefined ? null : decodeJsonValue(value);
        if (isRecord(normalized) && normalized.type === "bunzai.ui") {
          const envelope = normalized as Record<string, JsonValue>;
          if (Object.keys(envelope).length !== 2 || !("descriptor" in envelope)) throw new Error("extension UI result envelope is invalid");
          const descriptor = validateInteractiveDescriptor(envelope.descriptor, { commands, assets: pkg.manifest.theme?.assets.map((asset) => asset.id) ?? [] });
          return extensionActivationResultSchema.parse({ status: "completed", output: null, descriptor });
        }
        return extensionActivationResultSchema.parse({ status: "completed", output: normalized as JsonValue | null });
      } finally {
        runs.delete(controller);
        if (runs.size === 0) activeRuns.delete(id);
        principals.delete(basePrincipal);
        if (principals.size === 0) activePrincipals.delete(id);
        runSettled.delete(controller);
        runPrincipals.delete(controller);
        brokerCalls.delete(controller);
        externalSignal?.removeEventListener("abort", abortFromHost);
        settleRun();
      }
    },
    ...promptManagerApi,
    async notifySceneOpened(sceneId: string, navigationTicketId: string | null = null): Promise<boolean> { return sceneNavigation.notify(sceneId, navigationTicketId); },
    async dispatchSceneEvent(payloadInput: unknown, originPackageId?: string): Promise<void> { await eventDispatcher.dispatch(payloadInput, originPackageId); },
    grantSet(control: StoredExtensionControl): ExtensionGrantSet { return { packageId: control.id, packageDigest: control.packageDigest, policyFingerprint: control.policyFingerprint, revision: control.grantRevision, grants: [...control.grants] }; },
    ...hostManagerApi,
    async close() {
      if (closed) return;
      closing = true;
      if (heartbeat) clearInterval(heartbeat);
      for (const id of [...activeRuns.keys()]) await stopRuns(id);
      closed = true;
      await Promise.all([...runSettled.values()]);
      await eventDispatcher.close();
      sceneNavigation.close();
      options.fileActions?.close();
      options.hostActions?.close();
      await options.closeHost?.();
      if (fence) {
        const liveFence = fence;
        try { await mutations.exclusive(() => expireCurrentSessionGrants(liveFence)); }
        finally { await options.store.releaseRuntimeFence(liveFence); fence = null; }
      }
    },
  };
  options.fileActions?.setStartedWriteExpiryHandler(async (ticket) => {
    await service.answerFileAction(ticket.id, { status: "ambiguous", bytes: ticket.proposedBytes,
      digest: ticket.proposedDigest, consistency: "commit-unknown" });
  });
  eventDispatcher = createExtensionEventDispatcher(options.store, requireFence, (id, kind, contributionId, input, hostContext) => service.activate(id, kind, contributionId, input, hostContext));
  promptHookRunner = createPromptHookRunner(options.store, [operations.get("prompts.contribute"), operations.get("prompts.transform")].filter((item): item is ExtensionOperationDescriptor => item !== undefined), requireFence,
    (id, kind, contributionId, input, invocation, signal) => service.activate(id, kind, contributionId, input, invocation, signal));
  return service satisfies ExtensionManagerApi;
}
