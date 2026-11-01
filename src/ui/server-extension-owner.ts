/** Binds one extension service to the current unlocked library and tears it down on lock/restore. */
import { createExtensionOperations } from "../generated/extension-operations";
import { createExtensionService, type ExtensionManagerApi } from "../extensions/runtime/service";
import { extensionContentServices } from "../extensions/runtime/content-services";
import { createExtensionConfirmations } from "../extensions/runtime/confirmation";
import { createHostFileActionPort } from "../extensions/runtime/file-action-port";
import { createHostActionPort } from "../extensions/runtime/host-action-port";
import { projectContentStoreChange } from "../extensions/contracts/events";
import { createExtensionEventServices } from "../extensions/runtime/event-services";
import { createVettedExtensionNetwork } from "../extensions/operations/network/_vetted";
import { operationMetadataSchema } from "../extensions/contracts/operation-metadata";
import { createExtensionDraftServices } from "../extensions/runtime/draft-services";
import { extensionSettingsServices } from "../extensions/runtime/settings-services";
import { extensionCommandServices } from "../extensions/runtime/command-services";
import { createExtensionModelServices } from "../extensions/runtime/model-services";
import { extensionCollectionServices } from "../extensions/runtime/collection-services";
import { CollectionsStore } from "../studio/collections";
import { createExtensionFormatServices } from "../extensions/runtime/format-services";
import { createExtensionTransferServices } from "../extensions/runtime/transfer-services";
import { createExtensionAssetServices } from "../extensions/runtime/asset-services";
import { createExtensionSceneServices } from "../extensions/runtime/scene-services";
import { createExtensionCoreSceneSession, INCOMPLETE_CORE_SCENE_MESSAGE, resolveCoreScene } from "../studio/core-scene";
import { createExtensionStorageServices } from "../extensions/runtime/storage-services";
import { createExtensionSceneStateServices } from "../extensions/runtime/scene-state-services";
import { createExtensionLogServices } from "../extensions/runtime/log-services";
import { createExtensionTurnServices, unavailableExtensionTurnServices } from "../extensions/runtime/turn-services";
import { createSceneCore } from "./server-scene-composition";
import { lorebookReader } from "../studio/scene-lore";
import { presetReader } from "../studio/scene-turn-load";
import { createExtensionKitTools } from "../kit/extensions/tool-services";
import { allCapabilities } from "../generated/capabilities";
import { themeInventory } from "../extensions/theme-inventory";
import { adaptBundledThemePackage } from "../extensions/contracts/package-validation";
import { readLegacyThemeMigrations } from "../extensions/legacy-theme-migrations";
import { isStudioEntityKind } from "../studio/path-policy";
import { libraryFor } from "../studio/library-content";
import { assertExtensionSceneNotCore } from "../extensions/runtime/core-scene-guard";
import { ExtensionServiceError } from "../extensions/runtime/service-errors";
import type { PackagedAssets } from "./assets";
import type { ThemeReadService } from "./server-theme-extensions";
import type { JsonValue } from "../extensions/contracts/value";
import type { LibraryHandle, OpenedLibrary } from "./library-root";

type RuntimeService = ExtensionManagerApi & { close(): Promise<void>; dispatchSceneEvent(payload: unknown, originPackageId?: string): Promise<void>; applyPromptContributions(sceneId: string, messages: readonly { role: "system" | "user" | "assistant" | "tool"; content: string }[], signal: AbortSignal): Promise<readonly string[]>; hasPromptContributors(sceneId: string): Promise<boolean>; themeEffective: ThemeReadService["effective"]; themeAsset: ThemeReadService["asset"]; themeRevision: ThemeReadService["revisionStamp"]; themeMarkBroken: ThemeReadService["markBroken"]; themeConfirmHealthy: ThemeReadService["confirmHealthy"] };

export function createExtensionRouteOwner(library: LibraryHandle | undefined, sandboxOrigin: () => string, packaged?: PackagedAssets, previewPrompts?: (sceneId: string, draft: string, signal: AbortSignal) => Promise<import("../extensions/runtime/service-api").ExtensionPromptPreview>, promptScenes?: () => Promise<readonly import("../extensions/runtime/service-api").ExtensionPromptScene[]>) {
  const quickJsWasmBinary = packaged?.quickJsWasmB64 ? new Uint8Array(Buffer.from(packaged.quickJsWasmB64, "base64")) : undefined;
  let source: OpenedLibrary | null = null;
  let current: RuntimeService | null = null;
  let pending: { source: OpenedLibrary; promise: Promise<RuntimeService | null> } | null = null;
  let stopContentChanges: (() => void) | null = null;
  let serial: Promise<unknown> = Promise.resolve();
  let generation = 0;
  let closed = false;

  const reset = (): Promise<void> => {
    generation++;
    source = null;
    const inflight = pending?.promise;
    pending = null;
    serial = serial.then(async () => {
      const active = current;
      current = null;
      stopContentChanges?.();
      stopContentChanges = null;
      if (active) await active.close();
      if (inflight) {
        const stale = await inflight.catch(() => null);
        if (stale && stale !== active) await stale.close();
      }
    }, async () => { current = null; });
    return serial.then(() => undefined);
  };
  const stopLock = library?.onLockChange((state) => { if (state === "locked") void reset(); });
  const stopRestore = library?.onRestore(() => { void reset(); });

  return {
    async get(): Promise<RuntimeService | null> {
      if (closed || !library) return null;
      const opened = library.opened();
      if (!opened || opened.state !== "unlocked") { await reset(); return null; }
      const activeOpened: OpenedLibrary = opened;
      if (source === opened && current) return current;
      if (pending?.source === opened) return pending.promise;
      const ticket = generation;
      source = opened;
      const promise = serial.then(async (): Promise<RuntimeService | null> => {
        if (ticket !== generation || closed) return null;
        const old = current;
        current = null;
        if (old) await old.close();
        if (ticket !== generation || closed || library.opened() !== activeOpened || activeOpened.state !== "unlocked") return null;
        const coreLibrary = libraryFor(library.studioDir);
        const isCoreScene = async (sceneId: string): Promise<boolean> => {
          const stores = coreLibrary;
          if (!stores?.core || stores.chats !== activeOpened.chats) throw new Error("Core scene ownership is unavailable.");
          const resolved = await resolveCoreScene(stores.core, sceneId);
          if (resolved.incomplete) throw new ExtensionServiceError("UNSUPPORTED_HOST", INCOMPLETE_CORE_SCENE_MESSAGE);
          return resolved.link !== null;
        };
        const coreTurns = coreLibrary?.chats === activeOpened.chats ? coreLibrary.coreTurns : undefined;
        const guardedPreviewPrompts = previewPrompts ? async (sceneId: string, draft: string, signal: AbortSignal) => {
          await assertExtensionSceneNotCore(isCoreScene, sceneId);
          return previewPrompts(sceneId, draft, signal);
        } : undefined;
        const previewCorePrompts = async (sceneId: string, draft: string, signal: AbortSignal, apply: (sceneId: string, messages: readonly { role: "system" | "user" | "assistant" | "tool"; content: string }[], signal: AbortSignal) => Promise<readonly string[]>, hasHooks: (sceneId: string) => Promise<boolean>) => {
          if (!await isCoreScene(sceneId)) return null;
          if (!coreTurns) throw new Error("UNSUPPORTED_HOST: RP-Core prompt preview is unavailable for this library.");
          return coreTurns.preview(sceneId, draft, signal, apply, hasHooks);
        };
        const storage = createExtensionStorageServices(activeOpened.extensionStore);
        const sceneState = createExtensionSceneStateServices(activeOpened.chats, isCoreScene, coreTurns);
        const events = createExtensionEventServices(activeOpened.extensionStore);
        const fileActions = createHostFileActionPort({ now: Date.now, id: () => crypto.randomUUID() });
        const hostActions = createHostActionPort({ now: Date.now, id: () => crypto.randomUUID() });
        const drafts = createExtensionDraftServices(activeOpened.content, allCapabilities);
        const turnLibrary = { read: async (kind: string, id: string) => isStudioEntityKind(kind) ? (await activeOpened.content.readHeld(kind, id))?.entity ?? null : null };
        const roleplay = activeOpened.stateStore ? createSceneCore(activeOpened.chats, activeOpened.stateStore, presetReader(turnLibrary), lorebookReader(turnLibrary), turnLibrary,
          undefined, null, (payload) => current?.dispatchSceneEvent(payload) ?? Promise.resolve(),
          (sceneId, messages, signal) => current?.applyPromptContributions(sceneId, messages, signal) ?? Promise.resolve([])) : null;
        const coreRecords = coreLibrary?.chats === activeOpened.chats ? coreLibrary.core : undefined;
        const catalog = createExtensionOperations({ content: extensionContentServices(activeOpened.content), drafts, storage, settings: extensionSettingsServices(activeOpened.extensionStore), logs: createExtensionLogServices(activeOpened.extensionStore, { now: Date.now, id: () => crypto.randomUUID() }), models: createExtensionModelServices(), network: createVettedExtensionNetwork(), sceneState, events, files: fileActions, hostActions, collections: extensionCollectionServices(new CollectionsStore(library.studioDir)), formats: createExtensionFormatServices(), transfers: createExtensionTransferServices(activeOpened.content), assets: createExtensionAssetServices(activeOpened.content), scenes: createExtensionSceneServices(activeOpened.chats, activeOpened.content, isCoreScene,
          coreRecords ? (sceneId, takeId, commit) => createExtensionCoreSceneSession(activeOpened.chats, coreRecords, library.studioDir, sceneId, takeId, commit) : undefined,
          coreTurns ? (input) => coreTurns.appendUserMessage(input) : undefined,
          coreTurns ? (input) => coreTurns.editMessage(input) : undefined), turns: roleplay ? createExtensionTurnServices(roleplay, activeOpened.chats, hostActions, undefined, isCoreScene, coreTurns, (payload, origin) => current?.dispatchSceneEvent(payload, origin) ?? Promise.resolve(), (sceneId, messages, signal) => current?.applyPromptContributions(sceneId, messages, signal) ?? Promise.resolve([]), (sceneId) => current?.hasPromptContributors(sceneId) ?? Promise.resolve(false)) : unavailableExtensionTurnServices(), tools: await createExtensionKitTools("desktop"), commands: extensionCommandServices(activeOpened.extensionStore) });
        const confirmations = createExtensionConfirmations({ now: Date.now, id: () => crypto.randomUUID() });
        const builtinPackages = await Promise.all((await themeInventory(packaged)).map(async (theme) => {
          const alias = String((theme.manifest as { id: string }).id);
          return adaptBundledThemePackage(theme, alias);
        }));
        const legacyThemes = activeOpened.stateStore ? await readLegacyThemeMigrations(activeOpened.stateStore, (issue) => {
          console.warn("A legacy appearance entry was kept in its original state and needs review.", issue);
        }) : [];
        const metadata = JSON.parse(JSON.stringify(catalog.metadata())) as unknown[];
        const operationMetadata = metadata.map((value) => operationMetadataSchema.parse(value) as JsonValue);
        const service = createExtensionService({
          store: activeOpened.extensionStore, storeId: library.studioDir, host: "desktop", operations: catalog.all(),
          builtinPackages, legacyThemes, safeThemes: process.env.BUNZAI_SAFE_THEMES === "1",
          fileActions, hostActions,
          ...(roleplay ? { closeHost: () => roleplay.close() } : {}),
          operationMetadata, now: Date.now,
          id: () => crypto.randomUUID(), sandboxOrigin, quickJsWasmBinary,
          confirmEffect: (packageId, packageName, effect, signal) => confirmations.request(packageId, packageName, effect, signal),
          pendingEffects: () => confirmations.list(), answerEffect: (id, approved) => confirmations.answer(id, approved),
          ...(guardedPreviewPrompts ? { previewPrompts: guardedPreviewPrompts } : {}),
          previewCorePrompts,
          ...(promptScenes ? { promptScenes } : {}),
        });
        const acquired = await service.start();
        if (ticket !== generation || closed || library.opened() !== activeOpened || activeOpened.state !== "unlocked") { await service.close(); return null; }
        stopContentChanges = activeOpened.content.subscribeChanges((change) => {
          try { void service.dispatchSceneEvent(projectContentStoreChange(change), change.originPackageId).catch(() => undefined); }
          catch { /* A listener cannot change the committed content result. */ }
        });
        current = service;
        return service;
      });
      pending = { source: opened, promise };
      serial = promise.then(() => undefined, () => undefined);
      try { return await promise; }
      finally { if (pending?.promise === promise) pending = null; }
    },
    async dispatchSceneEvent(payload: unknown): Promise<void> {
      const service = await this.get();
      await service?.dispatchSceneEvent(payload);
    },
    async applyPromptContributions(sceneId: string, messages: readonly { role: "system" | "user" | "assistant" | "tool"; content: string }[], signal: AbortSignal): Promise<readonly string[]> {
      const service = await this.get();
      return service ? service.applyPromptContributions(sceneId, messages, signal) : [];
    },
    async hasPromptContributors(sceneId: string): Promise<boolean> {
      const service = await this.get();
      return service ? service.hasPromptContributors(sceneId) : false;
    },
    async close() { if (closed) return; closed = true; stopLock?.(); stopRestore?.(); await reset(); },
  };
}
