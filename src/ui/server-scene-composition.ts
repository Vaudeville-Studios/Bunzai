/** Desktop and terminal composition of the reusable engine with the current library's readers and background jobs. */
import { createRoleplayCore } from "../rp-core";
import type { ChatStore } from "../stage/contracts/chat-store";
import type { StateStore } from "../stage/contracts/state-store";
import type { SettingsStoreLike, StudioStoreLike } from "../studio/contracts";
import type { ReadPreset } from "../studio/scene-turn-load";
import type { ReadLorebook } from "../studio/scene-lore";
import type { CompendiumDeps } from "../studio/compendium-deps";
import { connect } from "../kit/providers/scene-connect";
import { narratorTools } from "../studio/library-tools";
import { finalCutBanksOf } from "../studio/final-cut-library";
import { onTurnEvent } from "../studio/compendium-hooks";
import { summarizeAfter } from "../studio/scene-summary";
import { sceneReaders } from "./server-scene-readers";
import { sceneRuntimeFor } from "./server-scene-runtime";
import { projectSceneTurnEvent } from "../extensions/contracts/events";
import { EXTENSION_BACKGROUND_FIELDS } from "../extensions/contracts/background-fields";
import type { ExtensionCommitContext } from "../stage/contracts/extension-store";
import type { ProviderRequestGuard } from "../rp-core";
import { guardedProviderConnect } from "../studio/guarded-provider-connect";

export function createSceneCore(chats: ChatStore, state: StateStore, readPreset: ReadPreset, readLorebook: ReadLorebook, studio?: Pick<StudioStoreLike, "read">, settings?: SettingsStoreLike, compendium?: CompendiumDeps | null, dispatchExtensionEvent?: (payload: unknown) => Promise<void>, applyExtensionPrompts?: (sceneId: string, messages: readonly { role: "system" | "user" | "assistant" | "tool"; content: string }[], signal: AbortSignal) => Promise<readonly string[]>, connectProvider: typeof connect = connect) {
  const readLibrary = studio ? (kind: string, id: string) => studio.read(kind, id) : undefined;
  return createRoleplayCore({
    chats, state, connect: connectProvider, readPreset, readLorebook, readLibrary,
    narratorTools: narratorTools(readLibrary), finalCutBanks: () => finalCutBanksOf(state),
    ...(applyExtensionPrompts ? { applyExtensionPrompts } : {}),
    ...sceneReaders(studio, settings), now: Date.now, randomSeed: () => Math.floor(Math.random() * 2 ** 31),
    afterEvent: async (input, event, extensionCommit?: ExtensionCommitContext, providerGuard?: ProviderRequestGuard) => {
      // Extension-originated jobs run only from reviewed access and carry the same fence and provider guard.
      const filing = compendium ? onTurnEvent(compendium, input.chatId, input.kind, event, extensionCommit, providerGuard) : Promise.resolve();
      const summary = event.type === "done" && summaryScope(extensionCommit, input.chatId)
        ? summarizeAfter({ chats, connect: guardedProviderConnect(connectProvider, providerGuard), readLibrary }, input.chatId, input.kind, event.message, extensionCommit)
        : Promise.resolve();
      const projected = projectSceneTurnEvent(input.chatId, input, event);
      const extensionEvent = projected && dispatchExtensionEvent ? dispatchExtensionEvent(projected).catch(() => undefined) : Promise.resolve();
      await Promise.all([filing, summary, extensionEvent]);
    },
  }, sceneRuntimeFor(chats));
}

function summaryScope(context: ExtensionCommitContext | undefined, chatId: string): boolean {
  if (!context) return true;
  const access = context.access;
  return !!access?.resources.some((resource) => resource.kind === "scene" && resource.id === chatId)
    && access.fields.includes(EXTENSION_BACKGROUND_FIELDS.summaryAutomatic)
    && access.fields.includes(EXTENSION_BACKGROUND_FIELDS.summaryError);
}
