/**
 * The SQLite ChatStore's Compendium half. Split from chat-store.ts for the
 * file-size cap. Rule 38's choices are the sealed cell `chats.compendium_json` (migration 34); rule 39's receipts are
 * `compendium_receipts` (migration 35), where the ids, the take, the message, the kind, the status and the times stay
 * readable and the writes, model and reason are one sealed cell. Rule 40's stored tree layouts (chat-store-trees.ts) and rule 41's
 * participant roster (chat-store-participants.ts) are spread in beside them, and so is rule 48's Dramaturg (chat-store-dramaturg.ts). Every write is one transaction, so a settle that
 * fails leaves the receipt as it was. Nothing here deletes a receipt; the scene's purge cascades them.
 */
import type { ChatCompendium, ChatStore, CompendiumReceipt, ReceiptKind, ReceiptStatus } from "../../contracts/chat-store";
import { StudioConflictError } from "../../../studio/errors";
import type { ExtensionCommitContext } from "../../contracts/extension-store";
import { EXTENSION_BACKGROUND_FIELDS } from "../../../extensions/contracts/background-fields";
import { fail } from "../chat-rules";
import { requireCommitResource } from "../extension-commit-access";
import { checkCompendium, mergeCompendium } from "../compendium-rules";
import { applySettle, checkReceiptInput, checkReceiptPage, checkSettle, receiptBody, requireReceiptSize } from "../receipt-rules";
import { participantMethods } from "./chat-store-participants";
import { regexMethods } from "./chat-store-regex";
import { finalCutMethods } from "./chat-store-final-cut";
import { trackerMethods } from "./chat-store-trackers";
import { summaryMethods } from "./chat-store-summary";
import { directorMethods } from "./chat-store-director";
import { dramaturgMethods } from "./chat-store-dramaturg";
import { treeMethods } from "./chat-store-trees";
import type { ChatSqlKit } from "./chat-store-cuts";
import { isQuarantinableDecodeError } from "./quarantine";
import { requireExtensionCommit } from "./extension-commit-guard";

interface ReceiptSql {
  id: string; chat_id: string; branch_id: string; message_id: string | null; swipe_id: string | null;
  kind: ReceiptKind; status: ReceiptStatus; at: number; settled_at: number; cell: string;
}

const COLUMNS = "id, chat_id, branch_id, message_id, swipe_id, kind, status, at, settled_at, cell";
const COLUMN = "compendium_receipts.cell";

type CompendiumMethods = Pick<ChatStore, "setCompendium" | "appendReceipt" | "settleReceipt" | "receipt" | "listReceipts" | "sweepReceipts" | "appendTree" | "currentTree" | "undoTree" | "updateParticipants" | "setRegex" | "setFinalCut" | "setTracker" | "setSummarySettings" | "setSummaryError" | "setDirectorSettings" | "archiveDirector" | "getDirector" | "putDirector" | "getDramaturg" | "setDramaturgSettings" | "appendDramaturg" | "clearDramaturg">;

export function compendiumMethods(k: ChatSqlKit): CompendiumMethods {
  const { cipher } = k;
  /** A cell that cannot be decoded (rule 25's two decode errors only) leaves the readable columns: the receipt comes back flagged `damaged` with no writes, so one bad row never hides the scene's others. */
  const toReceipt = (r: ReceiptSql): CompendiumReceipt => {
    const columns = {
      id: r.id, chatId: r.chat_id, branchId: r.branch_id, kind: r.kind, status: r.status, at: r.at, settledAt: r.settled_at,
      ...(r.message_id === null ? {} : { messageId: r.message_id }), ...(r.swipe_id === null ? {} : { swipeId: r.swipe_id }),
    };
    try {
      return { ...columns, ...(JSON.parse(cipher.open(COLUMN, r.cell)) as Pick<CompendiumReceipt, "writes" | "model" | "undoes" | "undoneBy" | "reason">) };
    } catch (error) {
      if (!isQuarantinableDecodeError(error)) throw error;
      return { ...columns, writes: [], damaged: true };
    }
  };
  const seal = (r: CompendiumReceipt) => cipher.seal(COLUMN, JSON.stringify(receiptBody(r)));
  /** A receipt whose scene is live; the only kind a read or settle may touch. */
  const live = (id: string) => {
    const row = k.one<ReceiptSql>(`SELECT ${COLUMNS} FROM compendium_receipts WHERE id = ? AND chat_id IN (SELECT id FROM chats WHERE deleted_at IS NULL)`, id);
    return row ? toReceipt(row) : null;
  };
  const settle = (found: CompendiumReceipt, next: CompendiumReceipt) => {
    // Resealing would overwrite the broken cell, the only evidence of what it held: only the readable columns move.
    if (found.damaged) {
      if (next !== found) k.run("UPDATE compendium_receipts SET status = ?, settled_at = ? WHERE id = ?", next.status, next.settledAt, next.id);
      return next;
    }
    if (next !== found) k.run("UPDATE compendium_receipts SET status = ?, settled_at = ?, cell = ? WHERE id = ?", next.status, next.settledAt, seal(next), next.id);
    return next;
  };

  return {
    ...treeMethods(k),
    ...participantMethods(k),
    ...regexMethods(k),
    ...finalCutMethods(k),
    ...trackerMethods(k),
    ...summaryMethods(k),
    ...directorMethods(k),
    ...dramaturgMethods(k),

    async setCompendium(chatId, patchRaw) {
      const patch = checkCompendium(patchRaw);
      // Read and write in one transaction, so two quick patches (a toggle and a guidance edit) never overwrite each other.
      const found = await k.write(() => {
        const row = k.one<{ compendium_json: string | null }>("SELECT compendium_json FROM chats WHERE id = ? AND deleted_at IS NULL", chatId);
        if (!row) return false;
        const old = row.compendium_json === null ? undefined : (JSON.parse(cipher.open("chats.compendium_json", row.compendium_json)) as ChatCompendium);
        const next = mergeCompendium(old, patch);
        k.run("UPDATE chats SET compendium_json = ? WHERE id = ?", next && cipher.seal("chats.compendium_json", JSON.stringify(next)), chatId);
        return true;
      });
      return found ? k.toChat(k.chatRow(chatId)!) : null;
    },

    async appendReceipt(chatId, inputRaw, extensionCommit) {
      const input = checkReceiptInput(inputRaw);
      return k.write(() => {
        if (!k.liveChat(chatId)) return null;
        if (k.branchRow(input.branchId)?.chat_id !== chatId) fail("branchId is not a take of this scene");
        if (extensionCommit) {
          requireCommitResource(extensionCommit, { kind: "scene", id: chatId }, [EXTENSION_BACKGROUND_FIELDS.compendiumReceipts]);
          requireExtensionCommit(k.database, cipher, extensionCommit);
        }
        if (input.undoes !== undefined && k.one<{ chat_id: string }>("SELECT chat_id FROM compendium_receipts WHERE id = ?", input.undoes)?.chat_id !== chatId) fail("undoes is not a receipt of this scene");
        const at = k.clock();
        const receipt: CompendiumReceipt = { id: k.newId(), chatId, ...input, at, settledAt: at };
        requireReceiptSize(receiptBody(receipt));
        k.run(
          "INSERT INTO compendium_receipts (id, chat_id, branch_id, message_id, swipe_id, kind, status, at, settled_at, cell) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
          receipt.id, chatId, receipt.branchId, receipt.messageId ?? null, receipt.swipeId ?? null, receipt.kind, receipt.status, at, at, seal(receipt),
        );
        return receipt;
      });
    },

    async settleReceipt(receiptId, settleRaw, extensionCommit) {
      const change = checkSettle(settleRaw);
      return k.write(() => {
        const found = live(receiptId);
        if (found?.damaged) throw new StudioConflictError("that receipt is damaged and cannot be changed");
        if (found && extensionCommit) {
          requireCommitResource(extensionCommit, { kind: "scene", id: found.chatId }, [EXTENSION_BACKGROUND_FIELDS.compendiumReceipts]);
          requireExtensionCommit(k.database, cipher, extensionCommit);
        }
        return found && settle(found, applySettle(found, change, k.clock()));
      });
    },

    async receipt(receiptId) {
      return live(receiptId);
    },

    async listReceipts(chatId, pageRaw) {
      const page = checkReceiptPage(pageRaw);
      if (!k.liveChat(chatId)) return [];
      let before = Number.MAX_SAFE_INTEGER;
      if (page.before !== undefined) {
        const cursor = k.one<{ seq: number }>("SELECT seq FROM compendium_receipts WHERE id = ? AND chat_id = ?", page.before, chatId);
        if (!cursor) fail("before is not a receipt of this scene");
        before = cursor.seq;
      }
      const rows = k.database.statement(
        `SELECT ${COLUMNS} FROM compendium_receipts WHERE chat_id = ? AND seq < ? AND (? IS NULL OR branch_id = ?) AND (? IS NULL OR message_id = ?) ORDER BY seq DESC LIMIT ?`,
      ).all(chatId, before, page.branchId ?? null, page.branchId ?? null, page.messageId ?? null, page.messageId ?? null, page.limit) as ReceiptSql[];
      return rows.map(toReceipt);
    },

    async sweepReceipts(chatId) {
      return k.write(() => {
        if (!k.liveChat(chatId)) return 0;
        const rows = k.database.statement(`SELECT ${COLUMNS} FROM compendium_receipts WHERE chat_id = ? AND status IN ('queued', 'running')`).all(chatId) as ReceiptSql[];
        for (const row of rows) {
          const found = toReceipt(row);
          settle(found, applySettle(found, { status: "interrupted", reason: "stopped before it finished" }, k.clock()));
        }
        return rows.length;
      });
    },
  };
}
