/**
 * The SQLite ChatStore's soft-delete methods: cutting and
 * restoring messages, renaming, deleting, and restoring takes, and moving a chat to a newer card.
 * Split from chat-store.ts for the file-size cap; it works on that file's rows and helpers, so each
 * write is still one transaction taking the write lock first. Migration 9 holds the columns.
 */
import type { Branch, CastSnapshot, CastSnapshotCodec, Chat, ChatStore, Message, WriteGuard } from "../../contracts/chat-store";
import type { PartChange } from "../../contracts/content-store";
import { checkCast, checkGuard, checkRecast, checkScope, checkTitle, fail, MAIN_UNDELETABLE, requireCastVersion } from "../chat-rules";
import { checkPersonaInput, refusePersonaChange, requireSnapshotVersion, revertMovesPersona, revertedCast, turnOpenConflict } from "../cast-rules";
import type { CellCipher } from "../../crypto/cell-cipher";
import { BRANCH_COLUMNS, MESSAGE_COLUMNS, type BranchSql, type ChatSql, type MessageSql } from "./chat-store";
import type { StageDatabase } from "./database";
import { requireExtensionCommit } from "./extension-commit-guard";
import { statsCounters } from "./chat-store-stats";
import type { StateSql } from "./chat-store-state";
import { applyPartChange, openPartSnapshot, snapshotPartsAt } from "./piece-parts-sql";

type Param = string | number | null;

/** What chat-store.ts hands over: its database, cipher, clock, and row helpers. */
export interface ChatSqlKit {
  database: StageDatabase;
  cipher: CellCipher;
  snapshotCodec: CastSnapshotCodec;
  clock: () => number;
  newId: () => string;
  one<T>(sql: string, ...params: Param[]): T | null;
  run(sql: string, ...params: Param[]): number;
  chatRow(id: string): ChatSql | null;
  liveChat(id: string): ChatSql | null;
  branchRow(id: string): BranchSql | null;
  writableBranch(id: string): BranchSql | null;
  writableMessage(id: string): MessageSql | null;
  requireVersion(branch: BranchSql, expected: number | undefined): void;
  bump(branchId: string): number;
  touch(chatId: string): number;
  toChat(r: ChatSql): Chat;
  toBranch(r: BranchSql): Branch;
  messageById(id: string): Message;
  copyMessage(m: MessageSql, toBranchId: string, current: number): void;
  insertBranch(chatId: string, name: string, parent: string | null, forkMessageId: string | null, forkSwipeId: string | null): string;
  /** Scene state (rule 17): each method that changes what a take shows rebuilds it from the first message it changed. */
  state: StateSql;
  /** One transaction that waits for another connection's lock, up to `limitMs` (chat-store.ts). */
  write<T>(work: () => T, limitMs?: number): Promise<T>;
}

type CutMethods = Pick<
  ChatStore,
  "cutMessages" | "restoreCut" | "renameBranch" | "deleteBranch" | "branchGraveyard" | "restoreBranch" | "setCast" | "revertCast" | "setPersona"
>;

export function cutMethods(k: ChatSqlKit): CutMethods {
  const { statement } = k.database;
  const messagesOf = (branchId: string, where: string, ...params: Param[]) =>
    statement(`SELECT ${MESSAGE_COLUMNS} FROM messages WHERE branch_id = ? AND ${where} ORDER BY seq`).all(branchId, ...params) as MessageSql[];
  const swipeIdAt = (m: MessageSql) =>
    k.one<{ swipe_id: string }>("SELECT swipe_id FROM swipes WHERE message_id = ? AND position = ?", m.id, m.current_swipe)!.swipe_id;
  const snapshotDoc = (chatId: string) => k.cipher.index(chatId);
  const readSnapshot = async (chatId: string, version: number) => {
    if (version === 0) return null;
    const captured = k.database.transaction(() => snapshotPartsAt(statement, "snapshot", snapshotDoc(chatId), version));
    return k.snapshotCodec.assemble(await openPartSnapshot(k.cipher, captured));
  };
  /** Snapshot columns are migration-22 markers; content and history belong to versioned parts. */
  const writeCasts = (
    chatId: string,
    now: { cast: Chat["cast"]; snapshot: unknown },
    before: { cast: Chat["cast"] },
    beforeVersion: number,
    change: PartChange = { put: k.snapshotCodec.prepare(now.snapshot as CastSnapshot), drop: [] },
    keepPrevious = false,
  ) => {
    const version = beforeVersion + 1;
    if (keepPrevious) k.run("UPDATE chats SET cast_json = ?, snapshot_version = ?, updated_at = ? WHERE id = ?", k.cipher.seal("chats.cast_json", JSON.stringify(now.cast)), version, k.clock(), chatId);
    else k.run(
      `UPDATE chats SET cast_json = ?, cast_snapshot_json = '', previous_cast_json = ?, previous_snapshot_json = ?, snapshot_version = ?, updated_at = ?
         WHERE id = ?`,
      k.cipher.seal("chats.cast_json", JSON.stringify(now.cast)),
      k.cipher.seal("chats.previous_cast_json", JSON.stringify(before.cast)),
      beforeVersion > 0 ? String(beforeVersion) : null,
      version,
      k.clock(),
      chatId,
    );
    applyPartChange(statement, k.cipher, "snapshot", snapshotDoc(chatId), version, change, true);
  };

  const stats = statsCounters(k);
  /** Rule 26: no recast while a live take of the scene has an open checkpoint. */
  const refuseWhileTurnOpen = (chatId: string) => {
    if (k.one("SELECT 1 FROM turn_checkpoints c JOIN branches b ON b.id = c.branch_id WHERE b.chat_id = ? AND b.deleted_at IS NULL", chatId)) throw turnOpenConflict();
  };

  return {
    async cutMessages(branchId, messageId, scopeRaw, guard, extensionCommit) {
      const scope = checkScope(scopeRaw);
      const expected = checkGuard(guard);
      return k.write(() => {
        if (extensionCommit) requireExtensionCommit(k.database, k.cipher, extensionCommit);
        const m = k.writableMessage(messageId);
        if (!m || m.branch_id !== branchId) return null;
        const branch = k.branchRow(branchId)!;
        k.requireVersion(branch, expected);
        const cutId = k.newId();
        const { tail } = k.one<{ tail: number }>("SELECT max(seq) AS tail FROM messages WHERE branch_id = ?", branchId)!;
        // One statement and one time for the whole cut, however long (spec rule 11).
        const count = k.run(
          `UPDATE messages SET cut_id = ?, cut_at = ?, cut_scope = ?, cut_tail = ?
             WHERE branch_id = ? AND cut_id IS NULL AND ${scope === "one" ? "id = ?" : "seq >= ?"}`,
          cutId, k.clock(), scope, tail, branchId, scope === "one" ? messageId : m.seq,
        );
        k.bump(branchId);
        k.state.refresh(branchId, m.seq);
        k.touch(branch.chat_id);
        return { cutId, count };
      });
    },

    async restoreCut(branchId, cutId, guard: WriteGuard | undefined) {
      const expected = checkGuard(guard);
      return k.write(() => {
        const branch = k.writableBranch(branchId);
        const cut = branch ? messagesOf(branchId, "cut_id = ?", cutId) : [];
        if (!branch || cut.length === 0) return null;
        k.requireVersion(branch, expected);
        const first = cut[0]!;
        // A "from here" cut with anything written after it, cut since or not, comes back as a new take
        // (spec rule 11): restoring it in place would put it before messages that answered what replaced it.
        const asTake = first.cut_scope === "from" && k.one("SELECT 1 FROM messages WHERE branch_id = ? AND seq > ?", branchId, first.cut_tail!) !== null;
        k.run("UPDATE messages SET cut_id = NULL, cut_at = NULL, cut_scope = NULL, cut_tail = NULL WHERE branch_id = ? AND cut_id = ?", branchId, cutId);
        k.bump(branchId);
        k.touch(branch.chat_id);
        if (!asTake) {
          k.state.refresh(branchId, first.seq);
          return { branchId, count: cut.length };
        }
        const before = messagesOf(branchId, "seq < ? AND cut_id IS NULL", first.seq);
        const at = before[before.length - 1];
        const take = k.insertBranch(branch.chat_id, "Restored take", branchId, at?.id ?? null, at ? swipeIdAt(at) : null);
        for (const m of before) k.copyMessage(m, take, m.current_swipe);
        for (const m of cut) k.run("UPDATE messages SET branch_id = ? WHERE id = ?", take, m.id);
        k.state.refresh(branchId, first.seq);
        k.state.copyBase(branchId, take);
        k.run("UPDATE chats SET active_branch_id = ?, updated_at = ? WHERE id = ?", take, k.clock(), branch.chat_id);
        return { branchId: take, count: cut.length };
      });
    },

    async renameBranch(branchId, nameRaw) {
      const name = checkTitle(nameRaw);
      return k.write(() => {
        const branch = k.writableBranch(branchId);
        if (!branch) return null;
        if (k.cipher.open("branches.name", branch.name) !== name) {
          k.run("UPDATE branches SET name = ? WHERE id = ?", k.cipher.seal("branches.name", name), branchId);
        }
        return k.toBranch(k.branchRow(branchId)!);
      });
    },

    async deleteBranch(branchId) {
      return k.write(() => {
        const branch = k.writableBranch(branchId);
        if (!branch) return false;
        if (branch.parent_branch_id === null) fail(MAIN_UNDELETABLE);
        k.run("UPDATE branches SET deleted_at = ? WHERE id = ?", k.clock(), branchId);
        k.state.drop(branchId);
        const chat = k.liveChat(branch.chat_id)!;
        if (chat.active_branch_id === branchId) {
          const parent = k.writableBranch(branch.parent_branch_id);
          const main = k.one<{ id: string }>("SELECT id FROM branches WHERE chat_id = ? AND parent_branch_id IS NULL", branch.chat_id)!;
          k.run("UPDATE chats SET active_branch_id = ?, updated_at = ? WHERE id = ?", parent?.id ?? main.id, k.clock(), branch.chat_id);
        }
        return true;
      });
    },

    async branchGraveyard() {
      const rows = statement(
        `SELECT ${BRANCH_COLUMNS} FROM branches WHERE deleted_at IS NOT NULL
           AND chat_id IN (SELECT id FROM chats WHERE deleted_at IS NULL) ORDER BY deleted_at DESC, rowid`,
      ).all() as BranchSql[];
      return rows.map((r) => ({ ...k.toBranch(r), deletedAt: r.deleted_at! }));
    },

    async restoreBranch(branchId) {
      return k.write(() => {
        const branch = k.branchRow(branchId);
        if (!branch || branch.deleted_at === null || !k.liveChat(branch.chat_id)) return null;
        k.run("UPDATE branches SET deleted_at = NULL WHERE id = ?", branchId);
        k.state.refresh(branchId);
        return k.toBranch(k.branchRow(branchId)!);
      });
    },

    async setCast(chatId, input) {
      for (let attempt = 0; attempt < 3; attempt++) {
        const row = k.liveChat(chatId);
        if (!row) {
          checkCast(input?.cast);
          return null;
        }
        const current = k.toChat(row);
        const snapshot = await readSnapshot(chatId, row.snapshot_version) ?? input.snapshot;
        const next = checkRecast(input, { cast: current.cast, snapshot: snapshot as CastSnapshot });
        if (!next) return current;
        refusePersonaChange(current.cast, next.cast);
        const result = await k.write(() => {
          const latest = k.liveChat(chatId);
          if (!latest) return { stale: false as const, chat: null };
          if (latest.snapshot_version !== row.snapshot_version) return { stale: true as const, chat: null };
          refuseWhileTurnOpen(chatId);
          writeCasts(chatId, next, { cast: current.cast }, row.snapshot_version);
          return { stale: false as const, chat: k.toChat(k.chatRow(chatId)!) };
        });
        if (result.stale) continue;
        return result.chat;
      }
      throw new Error("the scene cast changed repeatedly while it was being updated");
    },

    async setPersona(chatId, input) {
      for (let attempt = 0; attempt < 3; attempt++) {
        const row = k.liveChat(chatId);
        if (!row) return null;
        const current = k.toChat(row);
        const { cast, persona, expected } = checkPersonaInput(current.cast, input);
        requireSnapshotVersion(row.snapshot_version, expected);
        const snapshot = await readSnapshot(chatId, row.snapshot_version);
        if (!snapshot) fail("this scene has no frozen cast to change the persona of");
        const next = checkRecast({ cast, snapshot: { character: snapshot.character, ...(persona ? { persona } : {}) } }, { cast: current.cast, snapshot });
        if (!next) return current;
        const result = await k.write(() => {
          const latest = k.liveChat(chatId);
          if (!latest) return { stale: false as const, chat: null };
          if (latest.snapshot_version !== row.snapshot_version) return { stale: true as const, chat: null };
          refuseWhileTurnOpen(chatId);
          // The way back stays as it is: this is not a card move (rule 13).
          writeCasts(chatId, next, { cast: current.cast }, row.snapshot_version, undefined, true);
          if (next.cast.persona?.id !== current.cast.persona?.id) {
            stats.scenes(chatId, current.cast.persona?.id, -1);
            stats.scenes(chatId, next.cast.persona?.id, 1);
          }
          return { stale: false as const, chat: k.toChat(k.chatRow(chatId)!) };
        });
        if (result.stale) continue;
        return result.chat;
      }
      throw new Error("the scene cast changed repeatedly while its persona was being changed");
    },

    async revertCast(chatId, opts) {
      for (let attempt = 0; attempt < 3; attempt++) {
        const row = k.liveChat(chatId);
        if (!row || !row.previous_cast_json) return null;
        const chat = k.toChat(row);
        if (!chat.previousCast) return null;
        requireCastVersion(chat, opts?.fromVersion);
        const pointer = k.one<{ previous_snapshot_json: string | null }>("SELECT previous_snapshot_json FROM chats WHERE id = ?", chatId);
        const previousVersion = pointer?.previous_snapshot_json === null || !pointer ? 0 : Number(pointer.previous_snapshot_json);
        if (!Number.isSafeInteger(previousVersion) || previousVersion <= 0) return null;
        const previous = await readSnapshot(chatId, previousVersion);
        if (!previous) return null;
        const current = revertMovesPersona(chat.cast, chat.previousCast) ? await readSnapshot(chatId, row.snapshot_version) : null;
        const result = await k.write(() => {
          const latest = k.liveChat(chatId);
          const marker = k.one<{ previous_snapshot_json: string | null }>("SELECT previous_snapshot_json FROM chats WHERE id = ?", chatId);
          if (!latest || latest.snapshot_version !== row.snapshot_version || marker?.previous_snapshot_json !== String(previousVersion)) return { stale: true as const, chat: null };
          refuseWhileTurnOpen(chatId);
          // A way back saved under another persona restores the card only: the persona stays (rule 13).
          if (revertMovesPersona(chat.cast, chat.previousCast!)) {
            const now = { cast: revertedCast(chat.cast, chat.previousCast!), snapshot: { character: previous.character, ...(current?.persona ? { persona: current.persona } : {}) } };
            writeCasts(chatId, now, { cast: chat.cast }, row.snapshot_version);
          } else writeCasts(chatId, { cast: chat.previousCast!, snapshot: previous }, { cast: chat.cast }, row.snapshot_version, { restore: previousVersion });
          return { stale: false as const, chat: k.toChat(k.chatRow(chatId)!) };
        });
        if (result.stale) continue;
        return result.chat;
      }
      throw new Error("the scene cast changed repeatedly while it was being reverted");
    },
  };
}
