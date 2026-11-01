/**
 * The SQLite ChatStore's versions of a message: adding one and choosing which one shows (a bounded transcript selects by
 * cell). Split from chat-store.ts for the file-size cap. Each rebuilds the take's scene state from the message it changed,
 * inside its own transaction (rule 17).
 */
import type { ChatStore, Generation } from "../../contracts/chat-store";
import { checkGeneration, checkGuard, checkSwipeIndex, checkText } from "../chat-rules";
import type { ChatSqlKit } from "./chat-store-cuts";
import { appendSwipe, LIVE, setCurrentSwipe } from "./swipe-sql";

export interface VersionSqlKit extends ChatSqlKit {
  insertSwipe(messageId: string, position: number, content: string, generation: Generation | undefined, createdAt: number): number;
}
export function addSwipeInTransaction(k: VersionSqlKit, messageId: string, input: { content: string; generation?: Generation }, guard?: Parameters<ChatStore["addSwipe"]>[2]) {
  const content = checkText(input?.content, "content"), generation = checkGeneration(input?.generation), expected = checkGuard(guard);
  const message = k.writableMessage(messageId);
  if (!message) return null;
  k.requireVersion(k.branchRow(message.branch_id)!, expected);
  appendSwipe(k, messageId, content, generation, k.clock());
  k.bump(message.branch_id);
  k.state.refresh(message.branch_id, message.seq);
  return k.messageById(messageId);
}

export function versionMethods(k: VersionSqlKit): Pick<ChatStore, "addSwipe" | "selectSwipe" | "selectTranscriptSwipe"> {
  /** The position of a message's `index`th live version (rule 32), or null when it has fewer. */
  const livePosition = (messageId: string, index: number): number | null =>
    k.one<{ position: number }>(`SELECT position FROM swipes WHERE message_id = ? AND ${LIVE} ORDER BY position LIMIT 1 OFFSET ?`, messageId, index)?.position ?? null;
  /** Points the message at `position` and rebuilds the take's state from it; nothing when it already shows there. */
  const show = (m: { id: string; branch_id: string; seq: number; current_swipe: number }, position: number): void => {
    if (m.current_swipe === position) return;
    setCurrentSwipe(k, m.id, position);
    k.bump(m.branch_id);
    k.state.refresh(m.branch_id, m.seq);
  };

  return {
    async addSwipe(messageId, input, guard) {
      return k.write(() => addSwipeInTransaction(k, messageId, input, guard));
    },

    async selectSwipe(messageId, indexRaw, guard) {
      const index = checkSwipeIndex(indexRaw);
      const expected = checkGuard(guard);
      return k.write(() => {
        const m = k.writableMessage(messageId);
        if (!m) return null;
        const position = livePosition(messageId, index);
        if (position === null) return null; // spec edge case 5: refused, not clamped; rule 32: live versions only
        k.requireVersion(k.branchRow(m.branch_id)!, expected);
        show(m, position);
        return k.messageById(messageId);
      });
    },

    async selectTranscriptSwipe(chatId, branchId, messageId, indexRaw, guard) {
      const index = checkSwipeIndex(indexRaw);
      const expected = checkGuard(guard);
      return k.write(() => {
        const m = k.writableMessage(messageId);
        const owner = k.liveChat(chatId);
        const branch = k.writableBranch(branchId);
        const position = m ? livePosition(messageId, index) : null;
        if (!owner || owner.active_branch_id !== branchId || !branch || branch.chat_id !== chatId || !m || m.branch_id !== branchId || position === null) return null;
        k.requireVersion(branch, expected);
        show(m, position);
        const row = k.one<{ version: number; swipe_count: number }>(`
          SELECT b.version, (SELECT count(*) FROM swipes WHERE message_id = ? AND ${LIVE}) AS swipe_count
          FROM branches b JOIN messages m ON m.branch_id = b.id JOIN swipes s ON s.message_id = m.id AND s.position = ?
          WHERE b.id = ? AND m.id = ?
        `, messageId, position, m.branch_id, messageId);
        if (!row) return null;
        return {
          branchId: m.branch_id,
          branchVersion: row.version,
          swipeCount: row.swipe_count,
        };
      });
    },
  };
}
