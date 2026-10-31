/** Native atomic ChatStore door for one-group reviewed scene settings changes. */
import type { ChatStore } from "../../contracts/chat-store";
import type { ExtensionCommitContext } from "../../contracts/extension-store";
import type { SceneSettingChange, SceneSettingSelector } from "../../contracts/scene-settings";
import { sceneSettingCompareValue, sceneSettingRevision, projectSceneSetting, applySceneSettingChange } from "../scene-settings";
import { turnOpenConflict } from "../cast-rules";
import type { ChatRecord } from "./chat-records";

type Methods = Pick<ChatStore, "readSceneSetting" | "previewSceneSetting" | "applySceneSetting">;

export function sceneSettingMethods(input: {
  chats: Map<string, ChatRecord>;
  turnOpen(chatId: string): boolean;
  authorizeExtensionCommit(context: ExtensionCommitContext): void;
}): Methods {
  const live = (chatId: string) => {
    const record = input.chats.get(chatId);
    return record && record.deletedAt === null ? record : null;
  };
  return {
    async readSceneSetting(chatId, selector) {
      const record = live(chatId);
      if (!record) return null;
      const value = projectSceneSetting(record.chat, selector);
      return { value, revision: sceneSettingRevision(sceneSettingCompareValue(record.chat, selector)) };
    },
    async previewSceneSetting(chatId, selector, change) {
      const record = live(chatId);
      if (!record) return null;
      const next = applySceneSettingChange(record.chat, selector, change);
      return { before: projectSceneSetting(record.chat, selector), after: projectSceneSetting(next, selector),
        revision: sceneSettingRevision(sceneSettingCompareValue(record.chat, selector)) };
    },
    async applySceneSetting(chatId, selector, change, expectedRevision, commit) {
      input.authorizeExtensionCommit(commit);
      const record = live(chatId);
      if (!record) return null;
      const currentRevision = sceneSettingRevision(sceneSettingCompareValue(record.chat, selector));
      if (currentRevision !== expectedRevision) return { status: "stale" };
      if (selector.group === "variant" && input.turnOpen(chatId)) throw turnOpenConflict();
      const next = applySceneSettingChange(record.chat, selector, change);
      record.chat = next;
      return { status: "saved", revision: sceneSettingRevision(sceneSettingCompareValue(next, selector)) };
    },
  };
}
