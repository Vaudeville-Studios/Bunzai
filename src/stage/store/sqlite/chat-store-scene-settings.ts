/** SQLite transaction boundary for reviewed scene settings compare-and-write. */
import type { ChatStore } from "../../contracts/chat-store";
import type { ExtensionCommitContext } from "../../contracts/extension-store";
import type { SceneSettingChange, SceneSettingSelector } from "../../contracts/scene-settings";
import { sceneSettingCompareValue, sceneSettingRevision, projectSceneSetting, applySceneSettingChange } from "../scene-settings";
import { turnOpenConflict } from "../cast-rules";
import { requireExtensionCommit } from "./extension-commit-guard";
import type { ChatSqlKit } from "./chat-store-cuts";

type Methods = Pick<ChatStore, "readSceneSetting" | "previewSceneSetting" | "applySceneSetting">;

export function sceneSettingMethods(k: ChatSqlKit): Methods {
  const read = (chatId: string) => {
    const row = k.liveChat(chatId);
    return row ? { row, chat: k.toChat(row) } : null;
  };
  const save = (chatId: string, selector: SceneSettingSelector, chat: ReturnType<ChatSqlKit["toChat"]>) => {
    const column = selector.group === "connection" ? "connection_json"
      : selector.group === "preset" ? "preset_json"
        : selector.group === "lore" ? "lore_json"
          : selector.group === "props" ? "props_json"
            : selector.group === "opening" ? "opening_json"
              : selector.group === "prompting" ? "prompting_json"
                : selector.group === "backdrop" ? "backdrop_json"
                  : selector.group === "compendium" ? "compendium_json"
                    : selector.group === "regex" ? "regex_json"
                      : selector.group === "finalCut" ? "final_cut_json"
                        : selector.group === "tracker" ? "trackers_json"
                          : selector.group === "summary" ? "summary_json"
                            : selector.group === "director" ? "director_json" : null;
    if (selector.group === "variant") {
      k.run("UPDATE chats SET variant_id = ? WHERE id = ? AND deleted_at IS NULL", chat.variantId ?? null, chatId);
      return;
    }
    if (!column) throw new TypeError("unknown scene setting group");
    const value = selector.group === "connection" ? chat.connection
      : selector.group === "preset" ? chat.preset
        : selector.group === "lore" ? chat.lore
          : selector.group === "props" ? chat.props
            : selector.group === "opening" ? chat.opening
              : selector.group === "prompting" ? chat.prompting
                : selector.group === "backdrop" ? chat.backdrop
                  : selector.group === "compendium" ? chat.compendium
                    : selector.group === "regex" ? chat.regex
                      : selector.group === "finalCut" ? chat.finalCut
                        : selector.group === "tracker" ? chat.trackers
                          : selector.group === "summary" ? chat.summary : chat.director;
    const serialized = value === undefined ? null : JSON.stringify(value);
    const sealed = serialized === null ? null : k.cipher.seal(`chats.${column}`, serialized);
    k.run(`UPDATE chats SET ${column} = ? WHERE id = ? AND deleted_at IS NULL`, sealed, chatId);
  };
  return {
    async readSceneSetting(chatId, selector) {
      const found = read(chatId);
      if (!found) return null;
      return { value: projectSceneSetting(found.chat, selector), revision: sceneSettingRevision(sceneSettingCompareValue(found.chat, selector)) };
    },
    async previewSceneSetting(chatId, selector, change) {
      const found = read(chatId);
      if (!found) return null;
      const next = applySceneSettingChange(found.chat, selector, change);
      return { before: projectSceneSetting(found.chat, selector), after: projectSceneSetting(next, selector),
        revision: sceneSettingRevision(sceneSettingCompareValue(found.chat, selector)) };
    },
    async applySceneSetting(chatId, selector, change, expectedRevision, commit) {
      return k.write(() => {
        requireExtensionCommit(k.database, k.cipher, commit);
        const found = read(chatId);
        if (!found) return null;
        if (sceneSettingRevision(sceneSettingCompareValue(found.chat, selector)) !== expectedRevision) return { status: "stale" } as const;
        if (selector.group === "variant" && k.one("SELECT 1 FROM turn_checkpoints c JOIN branches b ON b.id = c.branch_id WHERE b.chat_id = ? AND b.deleted_at IS NULL", chatId)) throw turnOpenConflict();
        const next = applySceneSettingChange(found.chat, selector, change);
        save(chatId, selector, next);
        return { status: "saved", revision: sceneSettingRevision(sceneSettingCompareValue(next, selector)) } as const;
      });
    },
  };
}
