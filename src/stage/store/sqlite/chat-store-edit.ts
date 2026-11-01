/** Synchronous swipe editing inside the caller's existing SQLite transaction. */
import type { WriteGuard } from "../../contracts/chat-store";
import { checkGuard, checkText } from "../chat-rules";
import type { ChatSqlKit } from "./chat-store-cuts";
import type { SwipeSql } from "./chat-store-rows";
import { LIVE } from "./swipe-sql";

export function editSwipeInTransaction(k: ChatSqlKit, messageId: string, swipeId: string, contentRaw: string, guard?: WriteGuard) {
  const content = checkText(contentRaw, "content"), expected = checkGuard(guard);
  const message = k.writableMessage(messageId);
  const swipe = message && k.one<SwipeSql>(`SELECT * FROM swipes WHERE message_id = ? AND swipe_id = ? AND ${LIVE}`, messageId, swipeId);
  if (!message || !swipe) return null;
  k.requireVersion(k.branchRow(message.branch_id)!, expected);
  const before = k.cipher.open("swipes.content", swipe.content);
  if (before !== content) {
    k.run(`INSERT INTO swipe_history (message_id, swipe_id, n, content)
      SELECT ?, ?, coalesce(max(n), 0) + 1, ? FROM swipe_history WHERE message_id = ? AND swipe_id = ?`,
      messageId, swipeId, k.cipher.seal("swipe_history.content", before), messageId, swipeId);
    k.run("UPDATE swipes SET content = ? WHERE message_id = ? AND swipe_id = ?", k.cipher.seal("swipes.content", content), messageId, swipeId);
    k.bump(message.branch_id);
    k.touch(k.branchRow(message.branch_id)!.chat_id);
  }
  return k.messageById(messageId);
}
