/**
 * The SQLite ChatStore's createChat (spec rules 10 and 29): the chat, its main branch, its frozen cast,
 * and, for a scene born with its history, every message and swipe, all in one transaction.
 */
import type { Cast, Chat, ChatHistory, ChatStore, Generation } from "../../contracts/chat-store";
import type { CellCipher } from "../../crypto/cell-cipher";
import { ChatAlreadyImportedError } from "../../../studio/errors";
import { checkCast, checkSnapshot, checkTitle } from "../chat-rules";
import { checkHistory } from "../chat-history-rules";
import { personaDaysOf } from "../persona-stats-rules";
import type { ChatSqlKit } from "./chat-store-cuts";
import { applyPartChange } from "./piece-parts-sql";
import type { SqlStatsCounters } from "./chat-store-stats";
import type { ExtensionCommitContext } from "../../contracts/extension-store";
import { requireExtensionCommit } from "./extension-commit-guard";

export interface HistoryKit {
  cipher: CellCipher;
  newId: () => string;
  run(sql: string, ...params: (string | number | null)[]): number;
  insertSwipe(messageId: string, position: number, content: string, generation: Generation | undefined, createdAt: number): number;
  stats: SqlStatsCounters;
}

function seedHistory(k: HistoryKit, chatId: string, branchId: string, history: ChatHistory, cast: Cast): void {
  history.messages.forEach((m, i) => {
    const id = k.newId();
    const stamp = m.persona === undefined ? null : k.cipher.seal("messages.persona_json", JSON.stringify(m.persona));
    k.run("INSERT INTO messages (id, branch_id, seq, role, current_swipe, created_at, persona_json, hidden) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", id, branchId, i + 1, m.role, m.current, m.createdAt, stamp, m.hidden ? 1 : 0);
    m.swipes.forEach((s, position) => k.insertSwipe(id, position, s.content, s.generation, s.createdAt));
  });
  k.run("UPDATE branches SET version = version + ? WHERE id = ?", history.messages.length, branchId);
  for (const [who, written] of personaDaysOf(history, cast)) k.stats.messages(chatId, who, written.length, written);
}

export function createChatMethod(
  k: ChatSqlKit & { insertSwipe: HistoryKit["insertSwipe"]; stats: SqlStatsCounters },
): Pick<ChatStore, "createChat"> {
  const { statement } = k.database;
  return {
    async createChat(input, extensionCommit?: ExtensionCommitContext): Promise<Chat> {
      const title = checkTitle(input?.title);
      const cast = checkCast(input?.cast);
      const snapshot = checkSnapshot(input?.snapshot, cast);
      const snapshotParts = k.snapshotCodec.prepare(snapshot);
      const history = input.history === undefined ? undefined : checkHistory(input.history);
      const t = history?.createdAt ?? k.clock();
      const chatId = k.newId();
      const branchId = k.newId();
      const source = history?.source === undefined ? null : k.cipher.index(`chat-source\u0000${history.source}`);
      await k.write(() => {
        if (extensionCommit) requireExtensionCommit(k.database, k.cipher, extensionCommit);
        if (source !== null) {
          const held = k.one<{ id: string }>("SELECT id FROM chats WHERE import_key = ? AND deleted_at IS NULL", source);
          if (held) throw new ChatAlreadyImportedError(held.id);
        }
        k.run(
          "INSERT INTO chats (id, title, character_id, cast_json, cast_snapshot_json, active_branch_id, created_at, updated_at, snapshot_version, deleted_at, stats_state, import_key) VALUES (?, ?, ?, ?, '', ?, ?, ?, 1, NULL, 1, ?)",
          chatId,
          k.cipher.seal("chats.title", title),
          k.cipher.index(cast.character.id),
          k.cipher.seal("chats.cast_json", JSON.stringify(cast)),
          branchId, t, history?.updatedAt ?? t, source,
        );
        applyPartChange(statement, k.cipher, "snapshot", k.cipher.index(chatId), 1, { put: snapshotParts, drop: [] }, true);
        k.run(
          "INSERT INTO branches (id, chat_id, name, parent_branch_id, fork_message_id, fork_swipe_id, created_at, version) VALUES (?, ?, ?, NULL, NULL, NULL, ?, 1)",
          branchId, chatId, k.cipher.seal("branches.name", "main"), t,
        );
        k.stats.scenes(chatId, cast.persona?.id, 1);
        if (history) seedHistory(k, chatId, branchId, history, cast);
      });
      return k.toChat(k.chatRow(chatId)!);
    },
  };
}
