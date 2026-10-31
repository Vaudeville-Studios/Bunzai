/**
 * The memory ChatStore's cut messages (spec rule 11): cutting one message or everything from it on, and restoring a cut in place
 * or, when the take moved on, as a new take. Each rebuilds the scene state of the takes it touched from the first message it
 * changed (rule 17).
 */
import type { Branch, ChatStore } from "../../contracts/chat-store";
import type { ExtensionCommitContext } from "../../contracts/extension-store";
import { checkGuard, checkScope } from "../chat-rules";
import { copyRecord, type ChatRecord, type MessageRecord } from "./chat-records";

export function cutMethods(k: {
  branches: Map<string, Branch>;
  messages: Map<string, MessageRecord>;
  branchOrder: Map<string, string[]>;
  clock(): number;
  newId(): string;
  writableMessage(id: string): MessageRecord | null;
  liveMessages(branchId: string): MessageRecord[];
  liveChatOfBranch(branchId: string): ChatRecord | null;
  requireVersion(branchId: string, expected: number | undefined): void;
  bump(branchId: string): void;
  touch(record: ChatRecord): void;
  refresh(branchId: string, fromSeq?: number): void;
  copyMessageDeltas(fromId: string, toId: string): void;
  copyBase(fromBranchId: string, toBranchId: string): void;
  authorizeExtensionCommit(context: ExtensionCommitContext): void;
}): Pick<ChatStore, "cutMessages" | "restoreCut"> {
  return {
    async cutMessages(branchId, messageId, scopeRaw, guard, extensionCommit) {
      if (extensionCommit) k.authorizeExtensionCommit(extensionCommit);
      const scope = checkScope(scopeRaw);
      const expected = checkGuard(guard);
      const m = k.writableMessage(messageId);
      if (!m || m.branchId !== branchId) return null;
      k.requireVersion(branchId, expected);
      const order = k.branchOrder.get(branchId)!;
      const cut = { id: k.newId(), at: k.clock(), scope, tail: k.messages.get(order[order.length - 1]!)!.seq };
      const targets = scope === "one" ? [m] : k.liveMessages(branchId).filter((x) => x.seq >= m.seq);
      for (const x of targets) x.cut = cut;
      k.bump(branchId);
      k.refresh(branchId, m.seq);
      k.touch(k.liveChatOfBranch(branchId)!);
      return { cutId: cut.id, count: targets.length };
    },

    async restoreCut(branchId, cutId, guard) {
      const expected = checkGuard(guard);
      const record = k.liveChatOfBranch(branchId);
      const order = k.branchOrder.get(branchId) ?? [];
      const cut = order.map((id) => k.messages.get(id)!).filter((m) => m.cut?.id === cutId);
      if (!record || cut.length === 0) return null;
      k.requireVersion(branchId, expected);
      const first = cut[0]!;
      // A "from here" cut with anything written after it, cut since or not, comes back as a new take
      // (spec rule 11): restoring it in place would put it before messages that answered what replaced it.
      const { scope, tail } = first.cut!;
      const asTake = scope === "from" && order.some((id) => k.messages.get(id)!.seq > tail);
      for (const m of cut) delete m.cut;
      k.bump(branchId);
      k.touch(record);
      if (!asTake) {
        k.refresh(branchId, first.seq);
        return { branchId, count: cut.length };
      }
      const before = k.liveMessages(branchId).filter((m) => m.seq < first.seq);
      const at = before[before.length - 1];
      const take: Branch = {
        id: k.newId(),
        chatId: record.chat.id,
        name: "Restored take",
        parentBranchId: branchId,
        forkMessageId: at?.id ?? null,
        forkSwipeId: at ? at.swipes[at.current]!.id : null,
        createdAt: k.clock(),
        version: 1,
      };
      const copies = before.map((m) => copyRecord(m, k.newId(), take.id, m.current));
    before.forEach((m, i) => k.copyMessageDeltas(m.id, copies[i]!.id));
      for (const m of cut) m.branchId = take.id;
      for (const m of copies) k.messages.set(m.id, m);
      k.branches.set(take.id, take);
      k.branchOrder.set(take.id, [...copies, ...cut].map((m) => m.id));
      k.branchOrder.set(branchId, order.filter((id) => !cut.includes(k.messages.get(id)!)));
      k.refresh(branchId, first.seq);
      k.copyBase(branchId, take.id);
      record.chat = { ...record.chat, activeBranchId: take.id, updatedAt: k.clock() };
      return { branchId: take.id, count: cut.length };
    },
  };
}
