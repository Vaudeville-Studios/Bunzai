/**
 * The in-memory ChatStore, for tests and the contract suite. Records live
 * in chat-records.ts; bounded transcript reads in chat-store-transcript.ts; checkpoints and traces
 * in chat-store-turns.ts; scene state (the macro variables) in chat-store-state.ts; versions and cuts in chat-store-versions.ts and chat-store-cuts.ts; the connection,
 * preset, lore, Props, and Compendium settings in chat-store-settings.ts; Compendium receipts (rule 39) in
 * chat-store-receipts.ts; Fan Favorites and story folders (rules 23, 24) in chat-store-folders.ts. No method awaits between reading state and changing it, so each is
 * atomic the way one SQLite transaction is: every value handed out is a deep copy, so a caller can
 * never reach inside the store.
 */
import { StudioConflictError, ChatAlreadyImportedError } from "../../../studio/errors";

import type { Branch, CastSnapshotCodec, Chat, ChatStore, Message, SceneFolder, WriteGuard } from "../../contracts/chat-store";
import type { ExtensionCommitContext } from "../../contracts/extension-store";
import { copyRecord, forkPositionOf, publicMessage, type ChatRecord, type MessageRecord } from "./chat-records";
import { folderMethods } from "./chat-store-folders";
import { receiptMethods } from "./chat-store-receipts";
import { settingsMethods } from "./chat-store-settings";
import { sceneSettingMethods } from "./chat-store-scene-settings";
import { summaryMethods } from "./chat-store-summary";
import { summaryOnSlot } from "../summary-slot";
import { directorMethods } from "./chat-store-director";
import { turnMethods } from "./chat-store-turns";
import { stateMethods } from "./chat-store-state";
import { versionMethods } from "./chat-store-versions";
import { cutMethods } from "./chat-store-cuts";
import { hiddenMethods } from "./chat-store-hidden";
import { swipeCutMethods } from "./chat-store-swipe-cuts";
import { transcriptMethods } from "./chat-store-transcript";
import { snapshotMethods } from "./chat-store-snapshots";
import {
  checkCast, checkCutoff, checkGuard, checkMessageInputs,
  checkPage, checkPinned, checkSnapshot, checkText, checkTitle, fail, MAIN_UNDELETABLE, requireCastVersion,
  requireVersion as checkVersion,
} from "../chat-rules";
import { castMethods } from "./chat-store-cast";
import { statsCounters } from "./chat-store-stats";
import { personaStamp } from "../cast-rules";
import { checkHistory } from "../chat-history-rules";
import { seedHistory } from "./chat-history";

export function memoryChatStoreBackend(
  snapshotCodec: CastSnapshotCodec,
  clock: () => number = Date.now,
  newId: () => string = () => crypto.randomUUID(),
  options: { authorizeExtensionCommit?: (context: ExtensionCommitContext) => void } = {},
): ChatStore {
  const chats = new Map<string, ChatRecord>();
  const branches = new Map<string, Branch>();
  const messages = new Map<string, MessageRecord>();
  /** Message ids per branch, in sequence order. */
  const branchOrder = new Map<string, string[]>();
  /** When each soft-deleted branch was deleted (spec rule 12). */
  const deletedBranches = new Map<string, number>();
  /** Story folders (spec rule 24), shared with restoreChat's dangling-folderId clear. */
  const folders = new Map<string, SceneFolder>();

  const chatOfBranch = (branchId: string): ChatRecord | null => {
    const branch = branches.get(branchId);
    return branch ? (chats.get(branch.chatId) ?? null) : null;
  };
  /** The chat of a live branch in a live chat: the only kind a write may touch (spec edge case 4, rule 12). */
  const liveChatOfBranch = (branchId: string): ChatRecord | null => {
    const record = chatOfBranch(branchId);
    return record && record.deletedAt === null && !deletedBranches.has(branchId) ? record : null;
  };
  /** A message a write may touch: on a live branch, and not cut (spec rule 11). */
  const writableMessage = (messageId: string): MessageRecord | null => {
    const m = messages.get(messageId);
    return m && !m.cut && liveChatOfBranch(m.branchId) ? m : null;
  };
  const liveMessages = (branchId: string): MessageRecord[] =>
    (branchOrder.get(branchId) ?? []).map((id) => messages.get(id)!).filter((m) => !m.cut);
  const authorizeExtensionCommit = (context: ExtensionCommitContext): void => {
    if (!options.authorizeExtensionCommit) throw new Error("extension commit authorization is unavailable");
    options.authorizeExtensionCommit(context);
  };
  const touch = (record: ChatRecord): void => { record.chat = { ...record.chat, updatedAt: clock() }; };
  /** Throws, before anything changes, when a guarded write's base is out of date (edge case 9). */
  const requireVersion = (branchId: string, expected: number | undefined): void => {
    const branch = branches.get(branchId)!;
    checkVersion(branch.version, expected);
  };
  const bump = (branchId: string): void => {
    const branch = branches.get(branchId)!;
    branches.set(branchId, { ...branch, version: branch.version + 1 });
  };
  /** Every append: all or none, numbered past every waiting cut's end too (rule 11). No await inside, so it is atomic. */
  const appendMany = (branchId: string, inputs: unknown, guard: WriteGuard | undefined): Message[] | null => {
    const checked = checkMessageInputs(inputs);
    const expected = checkGuard(guard);
    const record = liveChatOfBranch(branchId);
    const order = branchOrder.get(branchId);
    if (!record || !order) return null;
    requireVersion(branchId, expected);
    let last = order.reduce((n, id) => Math.max(n, messages.get(id)!.seq, messages.get(id)!.cut?.tail ?? 0), 0);
    const stamp = personaStamp(record.chat.cast);
    const out = checked.map(({ role, content, generation }) => {
      const t = clock();
      const message: MessageRecord = {
        id: newId(),
        branchId,
        seq: ++last,
        role,
        swipes: [{ id: newId(), content, createdAt: t, pinned: false, history: [], ...(generation ? { generation } : {}) }],
        current: 0,
        createdAt: t,
        ...(role === "user" && stamp !== undefined ? { persona: stamp } : {}),
      };
      messages.set(message.id, message);
      order.push(message.id);
      bump(branchId);
      return publicMessage(message);
    });
    stats.messages(record.chat.cast.persona?.id, checked.filter((m) => m.role === "user").length);
    touch(record);
    return out;
  };

  const stats = statsCounters(clock);
  let branchTurnOpen = (_branchId: string): boolean => false;
  const scene = stateMethods({ messages, branchOrder, liveChatOfBranch, requireVersion, authorizeExtensionCommit, branchTurnOpen: (branchId) => branchTurnOpen(branchId) });
  const { turnOpen, branchTurnOpen: hasBranchTurn, ...turns } = turnMethods({
    clock, newId, messages, branchVersion: (id) => branches.get(id)!.version, liveChatOfBranch, writableMessage, requireVersion, bump, appendMany, state: scene,
    authorizeExtensionCommit,
  });
  branchTurnOpen = hasBranchTurn;
  const { drop: dropReceipts, ...receiptApi } = receiptMethods({ chats, branches, clock, newId, authorizeExtensionCommit });
  const castApi = castMethods({ chats, snapshotCodec, clock, turnOpen, stats });
  const transcript = transcriptMethods({ branches, messages, branchOrder, liveMessages });

  const store: ChatStore = {
    ...turns,
    ...scene.api,
    ...versionMethods({ chats, branches, clock, newId, writableMessage, requireVersion, bump, refresh: scene.refresh }),
    ...cutMethods({ branches, messages, branchOrder, clock, newId, writableMessage, liveMessages, liveChatOfBranch, requireVersion, bump, touch, refresh: scene.refresh, copyMessageDeltas: scene.copyMessageDeltas, copyBase: scene.copyBase, authorizeExtensionCommit }),
    ...hiddenMethods({ writableMessage, requireVersion, bump }),
    ...swipeCutMethods({ messages, branchOrder, deletedBranches, chats, branches, clock, writableMessage, requireVersion, bump, touch, liveChatOfBranch, refresh: scene.refresh }),
    ...castApi,
    ...stats.api,
    ...transcript,
    ...receiptApi, ...settingsMethods({ chats, turnOpen, clock, newId }), ...sceneSettingMethods({ chats, turnOpen, authorizeExtensionCommit }), ...summaryMethods({ chats, authorizeExtensionCommit }),
    ...summaryOnSlot({ sceneState: scene.api.sceneState, tip: async (b) => (branchOrder.get(b) ?? []).map((id) => messages.get(id)!).findLast((m) => !m.cut)?.id ?? null, recordMessageDeltas: scene.api.recordMessageDeltas, now: clock, newId }), ...directorMethods({ chats, branches, messages, branchOrder, clock }),
    ...folderMethods({ clock, newId, chats, folders }),
    async createChat(input, extensionCommit) {
      if (extensionCommit) authorizeExtensionCommit(extensionCommit);
      const title = checkTitle(input?.title);
      const cast = checkCast(input?.cast);
      const snapshot = checkSnapshot(input?.snapshot, cast);
      const history = input.history === undefined ? undefined : checkHistory(input.history);
      const held = history?.source === undefined ? undefined : [...chats.values()].find((r) => r.deletedAt === null && r.source === history.source);
      if (held) throw new ChatAlreadyImportedError(held.chat.id);
      const t = history?.createdAt ?? clock();
      const main: Branch = {
        id: newId(),
        chatId: newId(),
        name: "main",
        parentBranchId: null,
        forkMessageId: null,
        forkSwipeId: null,
        createdAt: t,
        version: 1,
      };
      const chat: Chat = { id: main.chatId, title, cast, activeBranchId: main.id, createdAt: t, updatedAt: history?.updatedAt ?? t, snapshotVersion: 1 };
      chats.set(chat.id, { chat, snapshotParts: [...snapshotCodec.prepare(snapshot)], deletedAt: null, ...(history?.source === undefined ? {} : { source: history.source }) });
      stats.scenes(cast.persona?.id, 1);
      branches.set(main.id, main);
      const order: string[] = [];
      branchOrder.set(main.id, order);
      if (history) seedHistory(history, main, cast, messages, order, newId, stats);
      return structuredClone(chat);
    },

    async getChat(id) {
      const record = chats.get(id);
      return record && record.deletedAt === null ? structuredClone(record.chat) : null;
    },

    ...snapshotMethods(chats, snapshotCodec),

    async listChats(filter) {
      // In-memory records hold already-live objects, never sealed cells or serialized JSON, so
      // nothing here can fail to decrypt or parse: quarantined is always empty (chat-store.ts's
      // ChatStore contract, rule 25 - the SQLite backend is the one that can quarantine a row).
      const chatsOut = [...chats.values()]
        .filter((r) => r.deletedAt === null)
        .filter((r) => filter?.characterId === undefined || r.chat.cast.character.id === filter.characterId)
        .map((r) => structuredClone(r.chat));
      return { chats: chatsOut, quarantined: [] };
    },

    async renameChat(id, titleRaw) {
      const title = checkTitle(titleRaw);
      const record = chats.get(id);
      if (!record || record.deletedAt !== null) return null;
      record.chat = { ...record.chat, title, updatedAt: clock() };
      return structuredClone(record.chat);
    },

    async deleteChat(id) {
      const record = chats.get(id);
      if (!record || record.deletedAt !== null) return false;
      record.deletedAt = clock();
      stats.scenes(record.chat.cast.persona?.id, -1);
      return true;
    },

    async chatGraveyard() {
      // Same non-quarantine note as listChats: nothing in-memory can fail to decode.
      const chatsOut = [...chats.values()]
        .filter((r): r is ChatRecord & { deletedAt: number } => r.deletedAt !== null)
        .sort((a, b) => b.deletedAt - a.deletedAt)
        .map((r) => ({ ...structuredClone(r.chat), deletedAt: r.deletedAt }));
      return { chats: chatsOut, quarantined: [] };
    },

    async restoreChat(id) {
      const record = chats.get(id);
      if (!record || record.deletedAt === null) return null;
      record.deletedAt = null;
      stats.scenes(record.chat.cast.persona?.id, 1);
      // Its folder may have been deleted while it was gone (rule 24).
      if (record.chat.folderId !== undefined && !folders.has(record.chat.folderId)) {
        const { folderId: _gone, ...rest } = record.chat;
        record.chat = rest;
      }
      return structuredClone(record.chat);
    },

    async purgeChats(before, cutBefore = before) {
      checkCutoff(before); // the loose compare below would pass every deleted chat through on NaN
      checkCutoff(cutBefore);
      let removed = 0;
      for (const [chatId, record] of chats) {
        if (record.deletedAt === null || record.deletedAt >= before) continue;
        for (const [branchId, branch] of branches) {
          if (branch.chatId !== chatId) continue;
          for (const messageId of branchOrder.get(branchId) ?? []) messages.delete(messageId);
          branchOrder.delete(branchId);
          branches.delete(branchId);
          scene.drop(branchId);
          deletedBranches.delete(branchId);
        }
        chats.delete(chatId);
        dropReceipts(chatId);
        removed += 1;
      }
      for (const [branchId, deletedAt] of deletedBranches) {
        if (deletedAt >= before) continue;
        // A live take forked from this one now hangs from this one's own parent (rule 14).
        const { parentBranchId } = branches.get(branchId)!;
        for (const [id, b] of branches) if (b.parentBranchId === branchId) branches.set(id, { ...b, parentBranchId });
        for (const messageId of branchOrder.get(branchId) ?? []) messages.delete(messageId);
        branchOrder.delete(branchId);
        branches.delete(branchId);
        scene.drop(branchId);
        deletedBranches.delete(branchId);
        removed += 1;
      }
      for (const [branchId, order] of branchOrder) {
        const kept = order.filter((id) => {
          const cut = messages.get(id)!.cut;
          if (!cut || cut.at >= cutBefore) return true;
          messages.delete(id);
          removed += 1;
          return false;
        });
        branchOrder.set(branchId, kept);
      }
      return removed;
    },

    async listBranches(chatId) {
      return [...branches.values()].filter((b) => b.chatId === chatId && !deletedBranches.has(b.id)).map((b) => ({ ...structuredClone(b), forkPosition: forkPositionOf(b, messages, branchOrder) }));
    },

    async setActiveBranch(chatId, branchId) {
      const record = chats.get(chatId);
      const branch = branches.get(branchId);
      if (!record || record.deletedAt !== null || !branch || branch.chatId !== chatId || deletedBranches.has(branchId)) return null;
      record.chat = { ...record.chat, activeBranchId: branchId, updatedAt: clock() };
      return structuredClone(record.chat);
    },

    async fork(branchId, atMessageId, opts, extensionCommit) {
      if (extensionCommit) authorizeExtensionCommit(extensionCommit);
      const expected = checkGuard(opts);
      const name = opts?.name === undefined ? "branch" : checkTitle(opts.name);
      const record = liveChatOfBranch(branchId);
      const source = branches.get(branchId);
      const at = messages.get(atMessageId);
      if (!record || !source || !at || at.branchId !== branchId || at.cut) return null; // spec edge case 1, rule 11
      let keptSwipe = at.current;
      if (opts?.swipeId !== undefined) {
        keptSwipe = at.swipes.findIndex((s) => s.id === opts.swipeId && s.cutAt === undefined);
        if (keptSwipe < 0) return null; // spec edge case 2, rule 32
      }
      requireVersion(branchId, expected);
      const t = clock();
      const branch: Branch = {
        id: newId(),
        chatId: source.chatId,
        name,
        parentBranchId: branchId,
        forkMessageId: atMessageId,
        forkSwipeId: at.swipes[keptSwipe]!.id,
        createdAt: t,
        version: 1,
      };
      const copiedIds: string[] = [];
      for (const messageId of branchOrder.get(branchId) ?? []) {
        const original = messages.get(messageId)!;
        if (original.seq > at.seq) break;
        if (original.cut) continue;
        // A copy, not a reference: the branches must share nothing afterwards (spec rule 6).
        // Live versions only (rule 32); the fork message shows the version the fork names.
        const copy = copyRecord(original, newId(), branch.id, original.id === atMessageId ? keptSwipe : original.current);
        messages.set(copy.id, copy);
        scene.copyMessageDeltas(original.id, copy.id);
        copiedIds.push(copy.id);
      }
      branches.set(branch.id, branch);
      branchOrder.set(branch.id, copiedIds);
      scene.copyBase(branchId, branch.id);
      record.chat = { ...record.chat, activeBranchId: branch.id, updatedAt: t };
      return structuredClone(branch);
    },

    async appendMessage(branchId, input, guard, extensionCommit) {
      if (extensionCommit) authorizeExtensionCommit(extensionCommit);
      return appendMany(branchId, [input], guard)?.[0] ?? null;
    },

    async appendMessages(branchId, inputs, guard, extensionCommit) {
      if (extensionCommit) authorizeExtensionCommit(extensionCommit);
      return appendMany(branchId, inputs, guard);
    },

    async countMessages(branchId) {
      return liveMessages(branchId).length;
    },

    async readMessages(branchId, page) {
      const { fromSeq, limit } = checkPage(page);
      const order = branchOrder.get(branchId);
      if (!order) return { messages: [], nextSeq: null, branchVersion: null };
      const from = order.map((id) => messages.get(id)!).filter((m) => m.seq >= fromSeq);
      const pageOf = from.slice(0, limit);
      return {
        messages: pageOf.map(publicMessage),
        nextSeq: from.length > limit ? from[limit]!.seq : null,
        branchVersion: branches.get(branchId)!.version,
      };
    },

    async editSwipe(messageId, swipeId, contentRaw, guard, extensionCommit) {
      if (extensionCommit) authorizeExtensionCommit(extensionCommit);
      const content = checkText(contentRaw, "content");
      const expected = checkGuard(guard);
      const m = writableMessage(messageId);
      const swipe = m?.swipes.find((s) => s.id === swipeId && s.cutAt === undefined);
      if (!m || !swipe) return null;
      requireVersion(m.branchId, expected);
      if (swipe.content !== content) {
        swipe.history.push(swipe.content); // D23: an edit never destroys the text it replaces
        swipe.content = content;
        bump(m.branchId);
        touch(liveChatOfBranch(m.branchId)!);
      }
      return publicMessage(m);
    },

    async swipeHistory(messageId, swipeId) {
      const swipe = messages.get(messageId)?.swipes.find((s) => s.id === swipeId);
      return swipe ? [...swipe.history] : [];
    },

    async setPinned(messageId, swipeId, pinned, guard) {
      checkPinned(pinned);
      const expected = checkGuard(guard);
      const m = writableMessage(messageId);
      const swipe = m?.swipes.find((s) => s.id === swipeId && s.cutAt === undefined);
      if (!m || !swipe) return null;
      requireVersion(m.branchId, expected);
      if (swipe.pinned !== pinned) {
        swipe.pinned = pinned;
        bump(m.branchId);
      }
      return publicMessage(m);
    },

    async renameBranch(branchId, nameRaw) {
      const name = checkTitle(nameRaw);
      const branch = branches.get(branchId);
      if (!branch || !liveChatOfBranch(branchId)) return null;
      if (branch.name !== name) branches.set(branchId, { ...branch, name });
      return structuredClone(branches.get(branchId)!);
    },

    async deleteBranch(branchId) {
      const branch = branches.get(branchId);
      const record = liveChatOfBranch(branchId);
      if (!branch || !record) return false;
      if (branch.parentBranchId === null) fail(MAIN_UNDELETABLE);
      deletedBranches.set(branchId, clock());
      scene.drop(branchId);
      if (record.chat.activeBranchId === branchId) {
        const parent = branch.parentBranchId;
        const main = [...branches.values()].find((b) => b.chatId === branch.chatId && b.parentBranchId === null)!;
        const next = branches.has(parent) && !deletedBranches.has(parent) ? parent : main.id;
        record.chat = { ...record.chat, activeBranchId: next, updatedAt: clock() };
      }
      return true;
    },

    async branchGraveyard() {
      return [...deletedBranches]
        .filter(([branchId]) => chatOfBranch(branchId)?.deletedAt === null)
        .sort((a, b) => b[1] - a[1])
        .map(([branchId, deletedAt]) => ({ ...structuredClone(branches.get(branchId)!), deletedAt }));
    },

    async restoreBranch(branchId) {
      const record = chatOfBranch(branchId);
      if (!record || record.deletedAt !== null || !deletedBranches.delete(branchId)) return null;
      scene.refresh(branchId);
      return structuredClone(branches.get(branchId)!);
    },

  };

  return store;
}
