/** One volatile extension authority per Browser Studio page and its in-memory content store. */
import { createBrowserExtensionOperations } from "../generated/browser-extension-operations";
import { allCapabilities } from "../generated/capabilities";
import { extensionContentServices } from "../extensions/runtime/content-services";
import { createExtensionDraftServices } from "../extensions/runtime/draft-services";
import { createExtensionAssetServices } from "../extensions/runtime/asset-services";
import { createExtensionSceneServices } from "../extensions/runtime/scene-services";
import { createExtensionSceneStateServices } from "../extensions/runtime/scene-state-services";
import { extensionCollectionStateServices } from "../extensions/runtime/collection-services";
import { extensionSettingsServices } from "../extensions/runtime/settings-services";
import { createExtensionStorageServices } from "../extensions/runtime/storage-services";
import { createExtensionLogServices } from "../extensions/runtime/log-services";
import { createExtensionConfirmations } from "../extensions/runtime/confirmation";
import { createHostActionPort } from "../extensions/runtime/host-action-port";
import { createExtensionService, type ExtensionManagerApi } from "../extensions/runtime/service";
import { operationMetadataSchema } from "../extensions/contracts/operation-metadata";
import { decodeJsonValue, type JsonValue } from "../extensions/contracts/value";
import { adaptBundledThemePackage } from "../extensions/contracts/package-validation";
import type { ExtensionStore } from "../stage/contracts/extension-store";
import type { ContentStore } from "../stage/contracts/content-store";
import type { StateStore } from "../stage/contracts/state-store";
import type { ChatStore } from "../stage/contracts/chat-store";
import { readLegacyThemeMigrations } from "../extensions/legacy-theme-migrations";
import type { ThemePackageInput } from "../extensions/theme-contract";
import type { ThemeReadService } from "../extensions/theme-read-routes";
import { extensionCommandServices } from "../extensions/runtime/command-services";
import { createExtensionEventServices } from "../extensions/runtime/event-services";
import { projectContentStoreChange } from "../extensions/contracts/events";
import { createContentExtensionPromptPreviewer, listExtensionPromptScenes } from "../studio/scene-forecast";

export type PocketExtensionRuntime = ExtensionManagerApi & {
  close(): Promise<void>;
  themeEffective: ThemeReadService["effective"];
  themeAsset: ThemeReadService["asset"];
  themeRevision: ThemeReadService["revisionStamp"];
  themeMarkBroken: ThemeReadService["markBroken"];
  themeConfirmHealthy: ThemeReadService["confirmHealthy"];
};

export async function createPocketExtensionOwner(input: {
  content: ContentStore;
  chats: ChatStore;
  state: StateStore;
  themes: readonly ThemePackageInput[];
  store: ExtensionStore;
  browserSandbox?: { workerSource: string; wasmBase64: string; regexWorkerSource?: string };
}): Promise<PocketExtensionRuntime> {
  const store = input.store;
  const storage = createExtensionStorageServices(store);
  const hostActions = createHostActionPort({ now: Date.now, id: () => crypto.randomUUID() });
  const catalog = createBrowserExtensionOperations({
    content: extensionContentServices(input.content), drafts: createExtensionDraftServices(input.content, allCapabilities),
    storage, logs: createExtensionLogServices(store, { now: Date.now, id: () => crypto.randomUUID() }),
    settings: extensionSettingsServices(store), assets: createExtensionAssetServices(input.content), collections: extensionCollectionStateServices(input.state), scenes: createExtensionSceneServices(input.chats, input.content), sceneState: createExtensionSceneStateServices(input.chats),
    commands: extensionCommandServices(store),
    events: createExtensionEventServices(store),
    hostActions,
  });
  const confirmations = createExtensionConfirmations({ now: Date.now, id: () => crypto.randomUUID() });
  const builtinPackages = await Promise.all(input.themes.map(async (theme) => adaptBundledThemePackage(theme, String((theme.manifest as { id: string }).id))));
  const metadata = JSON.parse(JSON.stringify(catalog.metadata())) as unknown[];
  const operationMetadata = metadata.map((value) => operationMetadataSchema.parse(value) as JsonValue);
  const service = createExtensionService({
    store, storeId: `browser:${crypto.randomUUID()}`, host: "browser", operations: catalog.all(), operationMetadata,
    builtinPackages, legacyThemes: await readLegacyThemeMigrations(input.state), browserSandbox: input.browserSandbox,
    now: Date.now, id: () => crypto.randomUUID(),
    confirmEffect: (packageId, packageName, effect, signal) => confirmations.request(packageId, packageName, effect, signal),
    pendingEffects: () => confirmations.list(), answerEffect: (id, approved) => confirmations.answer(id, approved),
    previewPrompts: createContentExtensionPromptPreviewer(input.chats, input.state, input.content),
    promptScenes: () => listExtensionPromptScenes(input.chats),
    hostActions,
  });
  await service.start();
  const unsubscribeContent = input.content.subscribeChanges((change) => {
    void service.dispatchSceneEvent(projectContentStoreChange(change), change.originPackageId).catch(() => undefined);
  });
  return { ...service, async close() { unsubscribeContent(); confirmations.close(); await service.close(); } };
}
