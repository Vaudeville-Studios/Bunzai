/**
 * The SQLite ChatStore's summary settings: one sealed cell, `chats.summary_json` (migration 41), holding the scene's settings and its last failure. The read, the change and the write are
 * one transaction, so two quick changes never overwrite each other. The take's text is the `summary` slot (summary-slot.ts); a per-take text an older build kept in this cell is no longer read and is dropped by the next write.
 */
import type { ChatStore, SummarySettings } from "../../contracts/chat-store";
import type { ExtensionCommitContext } from "../../contracts/extension-store";
import { EXTENSION_BACKGROUND_FIELDS } from "../../../extensions/contracts/background-fields";
import { requireCommitResource } from "../extension-commit-access";
import { checkSummaryError, checkSummarySettings, mergeSummarySettings } from "../summary-rules";
import type { ChatSqlKit } from "./chat-store-cuts";
import { requireExtensionCommit } from "./extension-commit-guard";

const COLUMN = "chats.summary_json";

export interface SummaryCell { settings?: SummarySettings; error?: string }

export function summaryMethods(k: ChatSqlKit): Pick<ChatStore, "setSummarySettings" | "setSummaryError"> {
  const read = (chatId: string, live: boolean): SummaryCell | null => {
    const row = k.one<{ summary_json: string | null }>(`SELECT summary_json FROM chats WHERE id = ?${live ? " AND deleted_at IS NULL" : ""}`, chatId);
    if (!row) return null;
    return row.summary_json === null ? {} : (JSON.parse(k.cipher.open(COLUMN, row.summary_json)) as SummaryCell);
  };
  const write = (chatId: string, cell: SummaryCell): void => {
    const next: SummaryCell = { ...(cell.settings ? { settings: cell.settings } : {}), ...(cell.error ? { error: cell.error } : {}) };
    k.run("UPDATE chats SET summary_json = ? WHERE id = ?", Object.keys(next).length > 0 ? k.cipher.seal(COLUMN, JSON.stringify(next)) : null, chatId);
  };
  const change = async (chatId: string, edit: (cell: SummaryCell) => SummaryCell, extensionCommit?: ExtensionCommitContext) => {
    const found = await k.write(() => {
      const cell = read(chatId, true);
      if (!cell) return false;
      if (extensionCommit) {
        requireCommitResource(extensionCommit, { kind: "scene", id: chatId }, [EXTENSION_BACKGROUND_FIELDS.summaryError]);
        requireExtensionCommit(k.database, k.cipher, extensionCommit);
      }
      write(chatId, edit(cell));
      return true;
    });
    return found ? k.toChat(k.chatRow(chatId)!) : null;
  };
  return {
    setSummarySettings(chatId, patchRaw) {
      const patch = checkSummarySettings(patchRaw);
      return change(chatId, (cell) => ({ ...cell, settings: mergeSummarySettings(cell.settings, patch) }));
    },
    setSummaryError(chatId, errorRaw, extensionCommit) {
      const error = checkSummaryError(errorRaw);
      return change(chatId, ({ error: _old, ...cell }) => (error ? { ...cell, error } : cell), extensionCommit);
    },
  };
}
