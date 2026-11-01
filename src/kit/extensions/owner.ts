/** One fenced Terminal extension service over Kit's already-open encrypted library. */
import { createExtensionOperations } from "../../generated/extension-operations";
import { extensionOperationMetadata } from "../../generated/extension-operation-metadata";
import { operationMetadataSchema } from "../../extensions/contracts/operation-metadata";
import { decodeJsonValue, type JsonValue } from "../../extensions/contracts/value";
import type { ExtensionManagerApi } from "../../extensions/runtime/service";
import { createExtensionService } from "../../extensions/runtime/service";
import { extensionContentServices } from "../../extensions/runtime/content-services";
import { createExtensionAssetServices } from "../../extensions/runtime/asset-services";
import { createExtensionFormatServices } from "../../extensions/runtime/format-services";
import { createExtensionTransferServices } from "../../extensions/runtime/transfer-services";
import { createExtensionDraftServices } from "../../extensions/runtime/draft-services";
import { extensionCollectionStateServices } from "../../extensions/runtime/collection-services";
import { createExtensionSceneServices } from "../../extensions/runtime/scene-services";
import { extensionSettingsServices } from "../../extensions/runtime/settings-services";
import { createExtensionStorageServices } from "../../extensions/runtime/storage-services";
import { createExtensionLogServices } from "../../extensions/runtime/log-services";
import { createExtensionSceneStateServices } from "../../extensions/runtime/scene-state-services";
import { allCapabilities } from "../../generated/capabilities";
import type { ContentStore } from "../../stage/contracts/content-store";
import type { ExtensionStore } from "../../stage/contracts/extension-store";
import type { StateStore } from "../../stage/contracts/state-store";
import type { ChatStore } from "../../stage/contracts/chat-store";
import quickJsWasmAsset from "@jitl/quickjs-wasmfile-release-sync/wasm" with { type: "file" };
import { createExtensionKitTools } from "./tool-services";
import { createTerminalRegexPreviewServices } from "./regex-preview";
import { createExtensionModelServices } from "../../extensions/runtime/model-services";
import { createVettedExtensionNetwork } from "../../extensions/operations/network/_vetted";
import { createExtensionConfirmations } from "../../extensions/runtime/confirmation";
import type { PendingExtensionEffect } from "../../extensions/runtime/confirmation";
import type { PendingExtensionHostAction, ExtensionHostActionAnswer } from "../../extensions/contracts/host-actions";
import type { ExtensionHostActionSnapshot } from "../../extensions/contracts/host-actions";
import type { ExtensionModelServices } from "../../extensions/operations/models/_services";
import { extensionCommandServices } from "../../extensions/runtime/command-services";
import { createExtensionEventServices } from "../../extensions/runtime/event-services";
import { createExtensionTurnServices, type ExtensionTurnConnectionReader } from "../../extensions/runtime/turn-services";
import { createTerminalFileActions } from "./file-actions";
import { terminalTurnRegexRequest } from "./turn-regex-actions";
import type { FileActionAnswer, PendingExtensionFileAction } from "../../extensions/contracts/file-actions";
import { projectContentStoreChange } from "../../extensions/contracts/events";
import { createContentExtensionPromptPreviewer, listExtensionPromptScenes } from "../../studio/scene-forecast";
import { createSceneCore } from "../../ui/server-scene-composition";
import { createExtensionCoreSceneSession, INCOMPLETE_CORE_SCENE_MESSAGE, resolveCoreScene } from "../../studio/core-scene";
import { presetReader } from "../../studio/scene-turn-load";
import { lorebookReader } from "../../studio/scene-lore";
import { connect as connectScene } from "../providers/scene-connect";
import type { Connected } from "../../studio/scene-turn";
import type { ChatConnection } from "../../stage/contracts/chat-store";
import { assertStudioEntityKind, isStudioEntityKind } from "../../studio/path-policy";
import type { ParsedCanonicalEntity } from "../../entities/runtime-schema";
import { libraryFor } from "../../studio/library-content";
import { assertExtensionSceneNotCore } from "../../extensions/runtime/core-scene-guard";
import type { ExtensionCoreSceneLookup } from "../../extensions/runtime/core-scene-guard";
import { ExtensionServiceError } from "../../extensions/runtime/service-errors";

export type TerminalExtensionRuntime = Pick<ExtensionManagerApi, "list" | "preview" | "install" | "enable" | "activate" | "beginFileWrite" | "promptScenes" | "previewPrompts"> & {
  pendingEffects(): Promise<readonly PendingExtensionEffect[]>;
  answerEffect(id: string, approved: boolean): Promise<boolean>;
  pendingHostActions(): Promise<ExtensionHostActionSnapshot>;
  claimHostAction(id: string): Promise<PendingExtensionHostAction | null>;
  answerHostAction(id: string, answer: ExtensionHostActionAnswer): Promise<boolean>;
  pendingFileActions(): Promise<readonly PendingExtensionFileAction[]>;
  answerFileAction(id: string, answer: FileActionAnswer): Promise<boolean>;
  processFileAction(id: string, selectedPath?: string): Promise<void>;
  close(): Promise<void>;
};

/** Starts only operation adapters whose generated metadata declares Terminal support. */
export async function createTerminalExtensionRuntime(input: {
  store: ExtensionStore;
  content: ContentStore;
  stateStore: StateStore;
  chats: ChatStore;
  storeId: string;
  wasmBinary?: Uint8Array;
  modelServices?: ExtensionModelServices;
  /** Test seam; production resolves the scene's saved connection through Kit's provider vault. */
  connectScene?: (connection: ChatConnection, signal?: AbortSignal) => Promise<Connected | null>;
  turnConnectionReader?: ExtensionTurnConnectionReader;
  /** Test seam; production resolves ownership from the opened library registry. */
  isCoreScene?: ExtensionCoreSceneLookup | null;
  now?: () => number;
  id?: () => string;
}): Promise<TerminalExtensionRuntime> {
  const now = input.now ?? Date.now;
  const id = input.id ?? (() => crypto.randomUUID());
  const fileActions = createTerminalFileActions({ now, id });
  const sceneConnect = input.connectScene ?? connectScene;
  const coreLibrary = libraryFor(input.storeId);
  const isCoreScene = input.isCoreScene === undefined ? async (sceneId: string): Promise<boolean> => {
    const stores = coreLibrary;
    if (!stores?.core || stores.chats !== input.chats) throw new Error("Core scene ownership is unavailable.");
    const resolved = await resolveCoreScene(stores.core, sceneId);
    if (resolved.incomplete) throw new ExtensionServiceError("UNSUPPORTED_HOST", INCOMPLETE_CORE_SCENE_MESSAGE);
    return resolved.link !== null;
  } : input.isCoreScene;
  const coreTurns = coreLibrary?.chats === input.chats ? coreLibrary.coreTurns : undefined;
  const previewPrompts = createContentExtensionPromptPreviewer(input.chats, input.stateStore, input.content);
  const turnLibrary = {
    async read(kind: string, pieceId: string): Promise<ParsedCanonicalEntity | null> {
      if (!isStudioEntityKind(kind)) return null;
      return (await input.content.readHeld(assertStudioEntityKind(kind), pieceId))?.entity ?? null;
    },
  };
  const compendium = {
    chats: input.chats,
    state: input.stateStore,
    store: {
      read: (kind: string, pieceId: string) => turnLibrary.read(kind, pieceId),
      async comparePatch(kind: string, pieceId: string, revision: string, patch: import("../../stage/contracts/piece-patch").PiecePatch, uploads?: readonly import("../../stage/contracts/content-store").PartBlob[], intent?: import("../../stage/contracts/content-store").SaveIntent, commit?: import("../../stage/contracts/extension-store").ExtensionCommitContext) {
        if (kind !== "lorebook") throw new Error("Only lorebook writes belong to the Compendium adapter.");
        const parts = uploads ?? [];
        const saveIntent = intent ?? "manual";
        const saved = commit ? await input.content.patchWithCommit("lorebook", pieceId, revision, patch, parts, saveIntent, commit)
          : await input.content.patch("lorebook", pieceId, revision, patch, parts, saveIntent);
        return saved.status === "saved" ? { status: "saved" as const, summary: saved.summary, revision: saved.summary.revision } : { status: saved.status };
      },
    },
    connect: sceneConnect,
    readLibrary: (kind: string, pieceId: string) => turnLibrary.read(kind, pieceId),
    now,
    newId: id,
  };
  const extensions = { current: null as Awaited<ReturnType<typeof createExtensionService>> | null };
  const turnRegex = terminalTurnRegexRequest(now, id);
  const roleplay = createSceneCore(input.chats, input.stateStore, presetReader(turnLibrary), lorebookReader(turnLibrary), turnLibrary, undefined, compendium,
    (payload) => extensions.current?.dispatchSceneEvent(payload) ?? Promise.resolve(),
    (sceneId, messages, signal) => extensions.current?.applyPromptContributions(sceneId, messages, signal) ?? Promise.resolve([]), sceneConnect);
  const catalog = createExtensionOperations({
    content: extensionContentServices(input.content),
    drafts: createExtensionDraftServices(input.content, allCapabilities),
    assets: createExtensionAssetServices(input.content),
    formats: createExtensionFormatServices(),
    transfers: createExtensionTransferServices(input.content),
    collections: extensionCollectionStateServices(input.stateStore),
    scenes: createExtensionSceneServices(input.chats, input.content, isCoreScene,
      coreLibrary?.core && coreLibrary.chats === input.chats ? (sceneId, takeId, commit) => createExtensionCoreSceneSession(input.chats, coreLibrary.core!, input.storeId, sceneId, takeId, commit) : undefined,
      coreTurns ? (input) => coreTurns.appendUserMessage(input) : undefined,
      coreTurns ? (input) => coreTurns.editMessage(input) : undefined),
    sceneState: createExtensionSceneStateServices(input.chats, isCoreScene, coreTurns),
    settings: extensionSettingsServices(input.store),
    storage: createExtensionStorageServices(input.store),
    logs: createExtensionLogServices(input.store, { now: input.now ?? Date.now, id: input.id ?? (() => crypto.randomUUID()) }),
    tools: await createExtensionKitTools("terminal"),
    regex: createTerminalRegexPreviewServices(),
    models: input.modelServices ?? createExtensionModelServices(),
    network: createVettedExtensionNetwork(),
    commands: extensionCommandServices(input.store),
    events: createExtensionEventServices(input.store),
    files: fileActions.port,
    turns: createExtensionTurnServices(roleplay, input.chats, turnRegex, input.turnConnectionReader, isCoreScene, coreTurns,
      (payload, origin) => extensions.current?.dispatchSceneEvent(payload, origin) ?? Promise.resolve(),
      (sceneId, messages, signal) => extensions.current?.applyPromptContributions(sceneId, messages, signal) ?? Promise.resolve([]),
      (sceneId) => extensions.current?.hasPromptContributors(sceneId) ?? Promise.resolve(false)),
  });
  const operationMetadata = extensionOperationMetadata.map((row) => operationMetadataSchema.parse(row) as JsonValue);
  const confirmations = createExtensionConfirmations({ now, id });
  const service = createExtensionService({
    store: input.store, storeId: input.storeId, host: "terminal", operations: catalog.all(), operationMetadata,
    now, id, quickJsWasmBinary: input.wasmBinary, fileActions: fileActions.port, closeHost: () => roleplay.close(),
    confirmEffect: (packageId, packageName, effect, signal) => confirmations.request(packageId, packageName, effect, signal),
    pendingEffects: () => confirmations.list(), answerEffect: (id, approved) => confirmations.answer(id, approved),
    previewPrompts: async (sceneId, draft) => {
      await assertExtensionSceneNotCore(isCoreScene, sceneId);
      return previewPrompts(sceneId, draft);
    },
    previewCorePrompts: async (sceneId, draft, signal, apply, hasHooks) => {
      if (isCoreScene === null || !await isCoreScene(sceneId)) return null;
      if (!coreTurns) throw new Error("UNSUPPORTED_HOST: RP-Core prompt preview is unavailable for this library.");
      return coreTurns.preview(sceneId, draft, signal, apply, hasHooks);
    },
    promptScenes: () => listExtensionPromptScenes(input.chats),
  });
  extensions.current = service;
  await service.start();
  const unsubscribeContent = input.content.subscribeChanges((change) => {
    void service.dispatchSceneEvent(projectContentStoreChange(change), change.originPackageId).catch(() => undefined);
  });
  fileActions.bindService({ answer: service.answerFileAction, completeReadChunk: service.completeFileReadChunk, beginWrite: service.beginFileWrite });
  return { ...service, pendingFileActions: service.pendingFileActions, answerFileAction: service.answerFileAction, processFileAction: fileActions.process,
    pendingHostActions: service.hostActions,
    async close() { unsubscribeContent(); fileActions.close(); confirmations.close(); await service.close(); } };
}

/** Resolve the selected QuickJS WASM at runtime; Bun compiles and terminates the worker itself. */
export async function readTerminalQuickJsWasm(): Promise<Uint8Array> {
  const file = Bun.file(quickJsWasmAsset);
  if (!(await file.exists())) throw new Error("Terminal extensions need the packaged QuickJS WASM asset.");
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.byteLength === 0 || bytes.byteLength > 1_000_000) throw new Error("QuickJS WASM asset is missing or outside its size bound.");
  return bytes;
}
