/**
 * The memory ChatStore's Compendium receipts and, beside them, its stored tree layouts (rule 40;
 * chat-store-trees.ts). Receipts live in append order, which is the newest-first order reversed; every value handed out is a deep
 * copy. A deleted scene's receipts and layouts stay hidden and come back with it; `drop` removes them when the scene is purged.
 */
import type { Branch, ChatStore, CompendiumReceipt } from "../../contracts/chat-store";
import type { ExtensionCommitContext } from "../../contracts/extension-store";
import { EXTENSION_BACKGROUND_FIELDS } from "../../../extensions/contracts/background-fields";
import { requireCommitResource } from "../extension-commit-access";
import { treeMethods } from "./chat-store-trees";
import { dramaturgMethods } from "./chat-store-dramaturg";
import { applySettle, checkReceiptInput, checkReceiptPage, checkSettle, receiptBody, requireReceiptSize } from "../receipt-rules";
import { fail } from "../chat-rules";
import type { ChatRecord } from "./chat-records";

export interface ReceiptDeps {
  chats: Map<string, ChatRecord>;
  branches: Map<string, Branch>;
  clock: () => number;
  newId: () => string;
  authorizeExtensionCommit?(context: ExtensionCommitContext): void;
}

type ReceiptMethods = Pick<ChatStore, "appendReceipt" | "settleReceipt" | "receipt" | "listReceipts" | "sweepReceipts" | "appendTree" | "currentTree" | "undoTree" | "getDramaturg" | "setDramaturgSettings" | "appendDramaturg" | "clearDramaturg">;

export function receiptMethods(d: ReceiptDeps): ReceiptMethods & { drop: (chatId: string) => void } {
  let all: CompendiumReceipt[] = [];
  const isLive = (chatId: string) => d.chats.get(chatId)?.deletedAt === null;
  const find = (id: string) => all.find((r) => r.id === id && isLive(r.chatId));
  const replace = (next: CompendiumReceipt) => void (all = all.map((r) => (r.id === next.id ? next : r)));

  const { drop: dropTrees, ...trees } = treeMethods(d);
  const { drop: dropDramaturg, ...dramaturg } = dramaturgMethods(d);
  return {
    ...trees,
    ...dramaturg,
    drop: (chatId) => { all = all.filter((r) => r.chatId !== chatId); dropTrees(chatId); dropDramaturg(chatId); },

    async appendReceipt(chatId, inputRaw, extensionCommit) {
      const input = checkReceiptInput(inputRaw);
      if (extensionCommit) {
        requireCommitResource(extensionCommit, { kind: "scene", id: chatId }, [EXTENSION_BACKGROUND_FIELDS.compendiumReceipts]);
        if (!d.authorizeExtensionCommit) throw new Error("extension commits are unsupported by this memory ChatStore");
        d.authorizeExtensionCommit(extensionCommit);
      }
      if (!isLive(chatId)) return null;
      if (d.branches.get(input.branchId)?.chatId !== chatId) fail("branchId is not a take of this scene");
      if (input.undoes !== undefined && all.find((r) => r.id === input.undoes)?.chatId !== chatId) fail("undoes is not a receipt of this scene");
      const at = d.clock();
      const receipt: CompendiumReceipt = { id: d.newId(), chatId, ...input, at, settledAt: at };
      requireReceiptSize(receiptBody(receipt));
      all.push(receipt);
      return structuredClone(receipt);
    },

    async settleReceipt(receiptId, settleRaw, extensionCommit) {
      const settle = checkSettle(settleRaw);
      const found = find(receiptId);
      if (!found) return null;
      if (extensionCommit) {
        requireCommitResource(extensionCommit, { kind: "scene", id: found.chatId }, [EXTENSION_BACKGROUND_FIELDS.compendiumReceipts]);
        if (!d.authorizeExtensionCommit) throw new Error("extension commits are unsupported by this memory ChatStore");
        d.authorizeExtensionCommit(extensionCommit);
      }
      const next = applySettle(found, settle, d.clock());
      replace(next);
      return structuredClone(next);
    },

    async receipt(receiptId) {
      const found = find(receiptId);
      return found ? structuredClone(found) : null;
    },

    async listReceipts(chatId, pageRaw) {
      const page = checkReceiptPage(pageRaw);
      if (!isLive(chatId)) return [];
      const mine = all.filter((r) => r.chatId === chatId);
      const end = page.before === undefined ? mine.length : mine.findIndex((r) => r.id === page.before);
      if (end < 0) fail("before is not a receipt of this scene");
      return mine.slice(0, end).reverse().filter((r) => (page.branchId === undefined || r.branchId === page.branchId) && (page.messageId === undefined || r.messageId === page.messageId)).slice(0, page.limit).map((r) => structuredClone(r));
    },

    async sweepReceipts(chatId) {
      if (!isLive(chatId)) return 0;
      const stuck = all.filter((r) => r.chatId === chatId && (r.status === "queued" || r.status === "running"));
      for (const r of stuck) replace(applySettle(r, { status: "interrupted", reason: "stopped before it finished" }, d.clock()));
      return stuck.length;
    },
  };
}
