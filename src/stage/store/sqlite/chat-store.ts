/**
 * The SQLite ChatStore. Tables are migrations 2, 9 to 16 (migrations.ts).
 * Bounded transcript and macro reads live in chat-store-transcript.ts. Cuts, deleted takes, and recasting live in chat-store-cuts.ts; checkpoints, traces, variables, the
 * connection, preset, lorebook choices, and Props switch in chat-store-turns.ts; Fan Favorites and
 * story folders (rules 23, 24) in chat-store-folders.ts. Every write is one transaction (BEGIN
 * IMMEDIATE takes the write lock first) through `write`, which waits for another connection's lock
 * without stalling the app (`patiently`, "Before the turn loop" item 3).
 * Encrypted at rest: titles, casts, branch and folder names, swipe text,
 * edit history, and generation details are sealed; the character id a chat is listed by is a keyed
 * hash; ids, sequence numbers, roles, and times (favored_at included) stay readable.
 */
import { StudioConflictError } from "../../../studio/errors";
import { coreRecordProjection } from "./core-record-projection";
import type { Branch, CastSnapshotCodec, Chat, ChatStore, Generation, Message, WriteGuard } from "../../contracts/chat-store";
import type { ExtensionCommitContext } from "../../contracts/extension-store";
import type { CoreMessageProjection } from "../../contracts/core-record-store";
import {
  checkCast, checkCutoff, checkGuard, checkMessageInputs,
  checkPage, checkPinned, checkSnapshot, checkText, checkTitle, requireVersion as checkVersion,
} from "../chat-rules";
import { refuseWhileLocked, type CellCipher } from "../../crypto/cell-cipher";
import { personaStamp } from "../cast-rules";
import { cutMethods } from "./chat-store-cuts";
import { statsCounters } from "./chat-store-stats";
import { createChatMethod } from "./chat-store-history";
import { hiddenMethods } from "./chat-store-hidden";
import { swipeCutMethods } from "./chat-store-swipe-cuts";
import { folderMethods } from "./chat-store-folders";
import { compendiumMethods } from "./chat-store-compendium";
import { summaryOnSlot } from "../summary-slot";
import { splitQuarantine } from "./chat-store-quarantine";
import { turnMethods } from "./chat-store-turns";
import { sceneSettingMethods } from "./chat-store-scene-settings";
import { stateMethods } from "./chat-store-state";
import { checkDeltas } from "../scene-state-rules";
import { addSwipeInTransaction, versionMethods } from "./chat-store-versions";
import { editSwipeInTransaction } from "./chat-store-edit";
import { coreStateMethods } from "./chat-store-core-state";
import { transcriptMethods } from "./chat-store-transcript";
import type { StageDatabase } from "./database";
import { applyPartChange, deletePartsForOwner } from "./piece-parts-sql";
import { attachRowFingerprints } from "./row-fingerprints";
import { snapshotMethods } from "./chat-store-snapshots";
import { LIVE, LIVE_COUNT_SQL, liveBefore, liveOf } from "./swipe-sql";
import { requireExtensionCommit } from "./extension-commit-guard";
import { CHAT_COLUMNS, BRANCH_COLUMNS, FORK_POSITION, MESSAGE_COLUMNS, sceneCells, type ChatSql, type BranchSql, type MessageSql, type SwipeSql } from "./chat-store-rows";
export type { ChatSql, BranchSql, MessageSql, SwipeSql } from "./chat-store-rows";
export { BRANCH_COLUMNS, MESSAGE_COLUMNS } from "./chat-store-rows";

export function sqliteChatStoreBackend(
  database: StageDatabase,
  cipher: CellCipher,
  snapshotCodec: CastSnapshotCodec,
  clock: () => number = Date.now,
  newId: () => string = () => crypto.randomUUID(),
): ChatStore {
  const { statement, transaction } = database;
  attachRowFingerprints(database, cipher);
  /** One transaction, retried while another connection holds the lock, up to `limitMs` (default 10 s). */
  const write = <T>(work: () => T, limitMs?: number): Promise<T> => database.patiently(() => transaction(work), limitMs);
  const toChat = (r: ChatSql): Chat => ({
    id: r.id,
    title: cipher.open("chats.title", r.title),
    cast: JSON.parse(cipher.open("chats.cast_json", r.cast_json)) as Chat["cast"],
    activeBranchId: r.active_branch_id,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    snapshotVersion: r.snapshot_version,
    ...(r.previous_cast_json === null ? {} : { previousCast: JSON.parse(cipher.open("chats.previous_cast_json", r.previous_cast_json)) as Chat["cast"] }),
    ...(r.connection_json === null ? {} : { connection: JSON.parse(cipher.open("chats.connection_json", r.connection_json)) as NonNullable<Chat["connection"]> }),
    ...(r.preset_json === null ? {} : { preset: JSON.parse(cipher.open("chats.preset_json", r.preset_json)) as NonNullable<Chat["preset"]> }),
    ...(r.lore_json === null ? {} : { lore: JSON.parse(cipher.open("chats.lore_json", r.lore_json)) as NonNullable<Chat["lore"]> }),
    ...(r.props_json === null ? {} : { props: JSON.parse(cipher.open("chats.props_json", r.props_json)) as NonNullable<Chat["props"]> }),
    ...(r.opening_json === null ? {} : { opening: JSON.parse(cipher.open("chats.opening_json", r.opening_json)) as NonNullable<Chat["opening"]> }),
    ...(r.prompting_json === null ? {} : { prompting: JSON.parse(cipher.open("chats.prompting_json", r.prompting_json)) as NonNullable<Chat["prompting"]> }),
    ...(r.compendium_json === null ? {} : { compendium: JSON.parse(cipher.open("chats.compendium_json", r.compendium_json)) as NonNullable<Chat["compendium"]> }),
    ...(r.participants_json === null ? {} : { participants: JSON.parse(cipher.open("chats.participants_json", r.participants_json)) as NonNullable<Chat["participants"]> }),
    ...sceneCells(r, (column, cell) => JSON.parse(cipher.open(column, cell))),
    ...(r.backdrop_json === null ? {} : { backdrop: JSON.parse(cipher.open("chats.backdrop_json", r.backdrop_json)) as NonNullable<Chat["backdrop"]> }),
    ...(r.favored_at === null ? {} : { favoredAt: r.favored_at }), ...(r.folder_id === null ? {} : { folderId: r.folder_id }),
    ...(r.variant_id === null ? {} : { variantId: r.variant_id }),
  });
  const toBranch = (r: BranchSql): Branch => ({
    id: r.id,
    chatId: r.chat_id,
    name: cipher.open("branches.name", r.name),
    parentBranchId: r.parent_branch_id,
    forkMessageId: r.fork_message_id,
    forkSwipeId: r.fork_swipe_id,
    createdAt: r.created_at,
    version: r.version,
  });
  const one = <T>(sql: string, ...params: (string | number | null)[]) => statement(sql).get(...params) as T | null;
  const run = (sql: string, ...params: (string | number | null)[]) => statement(sql).run(...params).changes;

  const chatRow = (id: string) => one<ChatSql>(`SELECT ${CHAT_COLUMNS} FROM chats WHERE id = ?`, id);
  const liveChat = (id: string) => one<ChatSql>(`SELECT ${CHAT_COLUMNS} FROM chats WHERE id = ? AND deleted_at IS NULL`, id);
  const branchRow = (id: string) => one<BranchSql>(`SELECT ${BRANCH_COLUMNS} FROM branches WHERE id = ?`, id);
  /** A live branch whose chat is live: the only kind a write may touch (spec edge case 4, rule 12). */
  const writableBranch = (id: string) => {
    const b = branchRow(id);
    return b && b.deleted_at === null && liveChat(b.chat_id) ? b : null;
  };
  /** A message a write may touch: on a writable branch, and not cut (spec rule 11). */
  const writableMessage = (id: string) => {
    const m = one<MessageSql>(`SELECT ${MESSAGE_COLUMNS} FROM messages WHERE id = ?`, id);
    return m && m.cut_id === null && writableBranch(m.branch_id) ? m : null;
  };
  const requireVersion = (branch: BranchSql, expected: number | undefined) => {
    checkVersion(branch.version, expected);
  };
  const bump = (branchId: string) => run("UPDATE branches SET version = version + 1 WHERE id = ?", branchId);
  const touch = (chatId: string) => run("UPDATE chats SET updated_at = ? WHERE id = ?", clock(), chatId);

  const swipesOf = (messageIds: string[]): Map<string, SwipeSql[]> => {
    const out = new Map<string, SwipeSql[]>(messageIds.map((id) => [id, []]));
    if (messageIds.length === 0) return out;
    // One statement for any page size, so the statement cache stays small.
    const rows = statement(
      "SELECT * FROM swipes WHERE message_id IN (SELECT value FROM json_each(?)) ORDER BY message_id, position",
    ).all(JSON.stringify(messageIds)) as SwipeSql[];
    for (const r of rows) out.get(r.message_id)!.push(r);
    return out;
  };
  const toMessage = (m: MessageSql, swipes: SwipeSql[]): Message => ({
    id: m.id,
    branchId: m.branch_id,
    seq: m.seq,
    role: m.role,
    createdAt: m.created_at,
    ...(m.cut_id === null ? {} : { cut: { id: m.cut_id, at: m.cut_at! } }),
    ...(m.hidden === 1 ? { hidden: true as const } : {}),
    ...(m.persona_json === null ? {} : { persona: JSON.parse(cipher.open("messages.persona_json", m.persona_json)) as Message["persona"] }),
    // Public numbers count live versions only (rule 32): `current` is the live ordinal of the showing position.
    current: swipes.filter((s) => s.cut_at === null && s.position < m.current_swipe).length,
    swipes: swipes.filter((s) => s.cut_at === null).map((s) => ({
      id: s.swipe_id,
      content: cipher.open("swipes.content", s.content),
      createdAt: s.created_at,
      pinned: s.pinned === 1,
      ...(s.generation_json === null
        ? {}
        : { generation: JSON.parse(cipher.open("swipes.generation_json", s.generation_json)) as Generation }),
    })),
  });
  const transcript = transcriptMethods({
    statement, one, branchRow, swipesOf, toMessage,
    openSwipeContent: (content) => cipher.open("swipes.content", content),
    openGenerationJson: (content) => cipher.open("swipes.generation_json", content),
  });
  const messageById = (id: string): Message => {
    const m = one<MessageSql>(`SELECT ${MESSAGE_COLUMNS} FROM messages WHERE id = ?`, id)!;
    return toMessage(m, swipesOf([id]).get(id)!);
  };
  const insertSwipe = (messageId: string, position: number, content: string, generation: Generation | undefined, createdAt: number) =>
    run(
      "INSERT INTO swipes (message_id, position, swipe_id, content, created_at, pinned, generation_json) VALUES (?, ?, ?, ?, ?, 0, ?)",
      messageId,
      position,
      newId(),
      cipher.seal("swipes.content", content),
      createdAt,
      generation === undefined ? null : cipher.seal("swipes.generation_json", JSON.stringify(generation)),
    );

  /** Copies a message onto another branch with a new id: live swipes renumbered from 0, with history and traces (rules 6, 32); `current` is a source position. */
  const copyMessage = (m: MessageSql, toBranchId: string, current: number) => {
    const copyId = newId();
    run(
      "INSERT INTO messages (id, branch_id, seq, role, current_swipe, created_at, persona_json, hidden) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      copyId, toBranchId, m.seq, m.role,
      one<{ n: number }>(`${LIVE_COUNT_SQL} AND position < ?`, m.id, current)!.n,
      m.created_at, m.persona_json, m.hidden,
    );
    run(
      `INSERT INTO swipes (message_id, position, swipe_id, content, created_at, pinned, generation_json)
         SELECT ?, ${liveBefore("s", "s.position")}, s.swipe_id, s.content, s.created_at, s.pinned, s.generation_json
           FROM swipes s WHERE s.message_id = ? AND ${liveOf("s")}`,
      copyId, m.id,
    );
    run(
      `INSERT INTO swipe_history (message_id, swipe_id, n, content)
         SELECT ?, h.swipe_id, h.n, h.content FROM swipe_history h
           JOIN swipes s ON s.message_id = h.message_id AND s.swipe_id = h.swipe_id
          WHERE h.message_id = ? AND ${liveOf("s")}`,
      copyId, m.id,
    );
    // What the message carries is per take, so its copy gets its own rows (a version's deltas are shared by swipe id and are not copied).
    run("INSERT INTO message_deltas (message_id, seq, slot, path_json, value_json, removed, at, swipe_id) SELECT ?, seq, slot, path_json, value_json, removed, at, swipe_id FROM message_deltas WHERE message_id = ?", copyId, m.id);
    run(`INSERT INTO director_states (message_id, position, version, cell) SELECT ?, ${liveBefore("d", "d.position")}, d.version, d.cell FROM director_states d JOIN swipes s ON s.message_id = d.message_id AND s.position = d.position WHERE d.message_id = ? AND ${liveOf("s")}`, copyId, m.id);
    run(
      `INSERT INTO swipe_traces (message_id, position, trace_json)
         SELECT ?, ${liveBefore("t", "t.position")}, t.trace_json FROM swipe_traces t
           JOIN swipes s ON s.message_id = t.message_id AND s.position = t.position
          WHERE t.message_id = ? AND ${liveOf("s")}`,
      copyId, m.id,
    );
  };
  const insertBranch = (chatId: string, name: string, parent: string | null, forkMessageId: string | null, forkSwipeId: string | null) => {
    const id = newId();
    run(
      "INSERT INTO branches (id, chat_id, name, parent_branch_id, fork_message_id, fork_swipe_id, created_at, version) VALUES (?, ?, ?, ?, ?, ?, ?, 1)",
      id, chatId, cipher.seal("branches.name", name), parent, forkMessageId, forkSwipeId, clock(),
    );
    return id;
  };

  /** Every append: all of the messages or none. Runs inside its caller's transaction (`write`, or commitTurn's). */
  const appendMany = (branchId: string, inputs: unknown, guard: WriteGuard | undefined): Message[] | null => {
    const checked = checkMessageInputs(inputs);
    const expected = checkGuard(guard);
    const branch = writableBranch(branchId);
    if (!branch) return null;
    requireVersion(branch, expected);
    // Past every sequence and every waiting cut's recorded end, so a purge never frees a number a
    // restore would read as "before" (spec rule 11).
    let { last } = one<{ last: number }>("SELECT max(coalesce(max(seq), 0), coalesce(max(cut_tail), 0)) AS last FROM messages WHERE branch_id = ?", branchId)!;
    // The stamp comes from the scene's cast inside this transaction, so a concurrent swap cannot split it (rule 26).
    const cast = toChat(liveChat(branch.chat_id)!).cast;
    const stamp = personaStamp(cast);
    stats.messages(branch.chat_id, cast.persona?.id, checked.filter((m) => m.role === "user").length);
    const stampCell = stamp === undefined ? null : cipher.seal("messages.persona_json", JSON.stringify(stamp));
    const ids = checked.map(({ role, content, generation }) => {
      const id = newId();
      const t = clock();
      run("INSERT INTO messages (id, branch_id, seq, role, current_swipe, created_at, persona_json) VALUES (?, ?, ?, ?, 0, ?, ?)", id, branchId, ++last, role, t, role === "user" ? stampCell : null);
      insertSwipe(id, 0, content, generation, t);
      bump(branchId);
      return id;
    });
    touch(branch.chat_id);
    return ids.map((id) => messageById(id)!);
  };

  const snapshotDoc = (id: string) => cipher.index(id);
  const state = stateMethods({ database, cipher, one, run, writableBranch, writableMessage, requireVersion, write });
  const kit = {
    database, cipher, clock, newId, one, run, chatRow, liveChat, branchRow, writableBranch, writableMessage,
    requireVersion, bump, touch, toChat, toBranch, messageById, copyMessage, insertBranch, write,
    snapshotCodec, state,
  };
  const stats = statsCounters(kit);
  const projectCoreMessages = (inputs: readonly CoreMessageProjection[]): Promise<string[]> => {
    let inserted = 0;
    return coreRecordProjection(database, cipher).projectMessages(inputs, (input, target) => {
      const guard = { expectedVersion: input.expectedVersion + inserted };
      const payload = { content: input.content, ...(input.generation ? { generation: input.generation } : {}) };
      const before = target ? messageById(target.messageId) : null;
      if (target && (!before || before.branchId !== input.takeId || (input.mode !== "edit" && before.swipes[before.current]?.id !== target.swipeId))) throw new Error("Core projection target is not the selected UI swipe");
      const message = !target ? appendMany(input.takeId, [{ role: input.role, ...payload }], guard)?.[0]
        : input.mode === "swipe" ? addSwipeInTransaction({ ...kit, insertSwipe }, target.messageId, payload, guard)
        : editSwipeInTransaction(kit, target.messageId, target.swipeId, input.content, guard);
      if (!message) throw new Error("Core projection take is unavailable");
      if (input.trace && (input.mode ?? "append") !== "continue" && input.mode !== "edit") {
        // The version this projection just wrote is the message's newest.
        const { position } = one<{ position: number }>("SELECT MAX(position) AS position FROM swipes WHERE message_id = ?", message.id)!;
        run("INSERT INTO swipe_traces (message_id, position, trace_json) VALUES (?, ?, ?)", message.id, position, cipher.seal("swipe_traces.trace_json", JSON.stringify(input.trace)));
      }
      if (input.deltas?.length && (input.mode ?? "append") !== "continue" && input.mode !== "edit") {
        state.stampSwipe(message.swipes[message.current]!.id, checkDeltas(input.deltas, "turn"));
        state.refresh(input.takeId, message.seq);
      }
      inserted++;
      return message.id;
    });
  };
  return refuseWhileLocked(cipher, {
    ...createChatMethod({ ...kit, insertSwipe, stats }),
    ...hiddenMethods(kit),
    ...swipeCutMethods(kit),
    async getChat(id) {
      const r = liveChat(id);
      return r ? toChat(r) : null;
    },

    ...snapshotMethods(database, cipher, snapshotCodec, liveChat),

    async listChats(filter) {
      const rows = (
        filter?.characterId === undefined
          ? statement(`SELECT ${CHAT_COLUMNS} FROM chats WHERE deleted_at IS NULL ORDER BY created_at, rowid`).all()
          : statement(`SELECT ${CHAT_COLUMNS} FROM chats WHERE deleted_at IS NULL AND character_id = ? ORDER BY created_at, rowid`)
              .all(cipher.index(filter.characterId))
      ) as ChatSql[];
      return splitQuarantine(toChat, rows);
    },

    async renameChat(id, titleRaw) {
      const title = checkTitle(titleRaw);
      const changed = await write(() =>
        run("UPDATE chats SET title = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL", cipher.seal("chats.title", title), clock(), id),
      );
      return changed ? toChat(chatRow(id)!) : null;
    },

    async deleteChat(id) {
      return (await write(() => {
        const n = run("UPDATE chats SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL", clock(), id);
        if (n) stats.sceneOf(id, -1);
        return n;
      })) > 0;
    },

    async chatGraveyard() {
      const rows = statement(`SELECT ${CHAT_COLUMNS} FROM chats WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC, rowid`)
        .all() as ChatSql[];
      return splitQuarantine((row) => ({ ...toChat(row), deletedAt: row.deleted_at! }), rows);
    },

    async restoreChat(id) {
      const changed = await write(() => {
        const n = run("UPDATE chats SET deleted_at = NULL WHERE id = ? AND deleted_at IS NOT NULL", id); // rule 24: its folder may be gone
        if (n) run("UPDATE chats SET folder_id = NULL WHERE id = ? AND folder_id NOT IN (SELECT id FROM scene_folders)", id);
        if (n) stats.sceneOf(id, 1);
        return n;
      });
      return changed ? toChat(chatRow(id)!) : null;
    },

    async purgeChats(beforeRaw, cutBeforeRaw = beforeRaw) {
      const before = checkCutoff(beforeRaw);
      const cutBefore = checkCutoff(cutBeforeRaw);
      return write(() => {
        // Counted first: the cascade to branches, messages, and swipes inflates each delete's count.
        const count = (sql: string, ...params: number[]) => one<{ n: number }>(sql, ...params)!.n;
        const n =
          count("SELECT count(*) AS n FROM chats WHERE deleted_at < ?1", before) +
          count("SELECT count(*) AS n FROM branches WHERE deleted_at < ?1 AND chat_id NOT IN (SELECT id FROM chats WHERE deleted_at < ?1)", before) +
          count(
            "SELECT count(*) AS n FROM messages WHERE cut_at < ?2 AND branch_id NOT IN " +
              "(SELECT b.id FROM branches b JOIN chats c ON c.id = b.chat_id WHERE b.deleted_at < ?1 OR c.deleted_at < ?1)",
            before, cutBefore,
          );
        const purgedChats = statement("SELECT id FROM chats WHERE deleted_at < ?").all(before) as { id: string }[];
        for (const chat of purgedChats) deletePartsForOwner(statement, "snapshot", snapshotDoc(chat.id));
        run("DELETE FROM chats WHERE deleted_at < ?", before);
        // A live take forked from a purged one now hangs from that one's own parent (rule 14).
        run(
          `UPDATE branches SET parent_branch_id = (SELECT p.parent_branch_id FROM branches p WHERE p.id = branches.parent_branch_id)
             WHERE parent_branch_id IN (SELECT id FROM branches WHERE deleted_at < ?)`,
          before,
        );
        run("DELETE FROM branches WHERE deleted_at < ?", before);
        run("DELETE FROM messages WHERE cut_at < ?", cutBefore);
        run("DELETE FROM swipe_deltas WHERE swipe_id NOT IN (SELECT swipe_id FROM swipes)");
        return n;
      });
    },

    async listBranches(chatId) {
      const rows = statement(`SELECT ${BRANCH_COLUMNS}, ${FORK_POSITION} AS fork_position FROM branches WHERE chat_id = ? AND deleted_at IS NULL ORDER BY rowid`).all(chatId) as (BranchSql & { fork_position: number | null })[];
      return rows.map((r) => ({ ...toBranch(r), forkPosition: r.fork_position }));
    },

    async setActiveBranch(chatId, branchId) {
      const changed = await write(() =>
        run(
          `UPDATE chats SET active_branch_id = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL
             AND EXISTS (SELECT 1 FROM branches WHERE id = ? AND chat_id = ? AND deleted_at IS NULL)`,
          branchId, clock(), chatId, branchId, chatId,
        ),
      );
      return changed ? toChat(chatRow(chatId)!) : null;
    },

    async fork(branchId, atMessageId, opts, extensionCommit) {
      const expected = checkGuard(opts);
      const name = opts?.name === undefined ? "branch" : checkTitle(opts.name);
      return write(() => {
        if (extensionCommit) requireExtensionCommit(database, cipher, extensionCommit);
        const source = writableBranch(branchId);
        const at = one<MessageSql>(`SELECT ${MESSAGE_COLUMNS} FROM messages WHERE id = ?`, atMessageId);
        if (!source || !at || at.branch_id !== branchId || at.cut_id !== null) return null; // spec edge case 1, rule 11
        const atSwipes = swipesOf([at.id]).get(at.id)!;
        const shown = opts?.swipeId === undefined
          ? atSwipes.find((s) => s.position === at.current_swipe)
          : atSwipes.find((s) => s.swipe_id === opts.swipeId && s.cut_at === null); // spec edge case 2, rule 32
        if (!shown) return null;
        const kept = shown.position;
        requireVersion(source, expected);
        const id = insertBranch(source.chat_id, name, branchId, atMessageId, shown.swipe_id);
        // Copies, not references, and never of a cut message (spec rules 6 and 11).
        const copies = statement(`SELECT ${MESSAGE_COLUMNS} FROM messages WHERE branch_id = ? AND seq <= ? AND cut_id IS NULL ORDER BY seq`)
          .all(branchId, at.seq) as MessageSql[];
        for (const m of copies) copyMessage(m, id, m.id === atMessageId ? kept : m.current_swipe);
        state.copyBase(branchId, id);
        run("UPDATE chats SET active_branch_id = ?, updated_at = ? WHERE id = ?", id, clock(), source.chat_id);
        return toBranch(branchRow(id)!);
      });
    },

    async projectCoreMessage(input) {
      return (await projectCoreMessages([input]))[0]!;
    },
    projectCoreMessages,
    ...coreStateMethods({ database, cipher, one, run, writableBranch, writableMessage, requireVersion, write, state, clock }),
    async appendMessage(branchId, input, guard, extensionCommit) {
      return (await write(() => { if (extensionCommit) requireExtensionCommit(database, cipher, extensionCommit); return appendMany(branchId, [input], guard); }))?.[0] ?? null;
    },

    async appendMessages(branchId, inputs, guard, extensionCommit) {
      return write(() => { if (extensionCommit) requireExtensionCommit(database, cipher, extensionCommit); return appendMany(branchId, inputs, guard); });
    },

    async countMessages(branchId) {
      return one<{ n: number }>("SELECT count(*) AS n FROM messages WHERE branch_id = ? AND cut_id IS NULL", branchId)!.n;
    },

    async readMessages(branchId, pageRaw) {
      const { fromSeq, limit } = checkPage(pageRaw);
      const branch = branchRow(branchId);
      if (!branch) return { messages: [], nextSeq: null, branchVersion: null };
      const rows = statement(`SELECT ${MESSAGE_COLUMNS} FROM messages WHERE branch_id = ? AND seq >= ? ORDER BY seq LIMIT ?`)
        .all(branchId, fromSeq, limit + 1) as MessageSql[];
      const page = rows.slice(0, limit);
      const swipes = swipesOf(page.map((m) => m.id));
      return {
        messages: page.map((m) => toMessage(m, swipes.get(m.id)!)),
        nextSeq: rows.length > limit ? rows[limit]!.seq : null,
        branchVersion: branch.version,
      };
    },

    async editSwipe(messageId, swipeId, contentRaw, guard, extensionCommit) {
      return write(() => {
        if (extensionCommit) requireExtensionCommit(database, cipher, extensionCommit);
        return editSwipeInTransaction(kit, messageId, swipeId, contentRaw, guard);
      });
    },

    async swipeHistory(messageId, swipeId) {
      const rows = statement("SELECT content FROM swipe_history WHERE message_id = ? AND swipe_id = ? ORDER BY n")
        .all(messageId, swipeId) as { content: string }[];
      return rows.map((r) => cipher.open("swipe_history.content", r.content));
    },

    async setPinned(messageId, swipeId, pinnedRaw, guard) {
      const pinned = checkPinned(pinnedRaw);
      const expected = checkGuard(guard);
      return write(() => {
        const m = writableMessage(messageId);
        const swipe = m && one<SwipeSql>(`SELECT * FROM swipes WHERE message_id = ? AND swipe_id = ? AND ${LIVE}`, messageId, swipeId);
        if (!m || !swipe) return null;
        requireVersion(branchRow(m.branch_id)!, expected);
        if ((swipe.pinned === 1) !== pinned) {
          run("UPDATE swipes SET pinned = ? WHERE message_id = ? AND swipe_id = ?", pinned ? 1 : 0, messageId, swipeId);
          bump(m.branch_id);
        }
        return messageById(messageId);
      });
    },

    ...transcript,
    ...state.api,
    ...versionMethods({ ...kit, insertSwipe }),
    ...stats.api,
    ...cutMethods(kit),
    ...turnMethods({ ...kit, insertSwipe, appendMany }),
    ...sceneSettingMethods(kit),
    ...folderMethods(kit),
    ...compendiumMethods(kit),
    ...summaryOnSlot({
      sceneState: state.api.sceneState, recordMessageDeltas: state.api.recordMessageDeltas, now: clock, newId,
      tip: async (b) => one<{ id: string }>("SELECT id FROM messages WHERE branch_id = ? AND cut_id IS NULL ORDER BY seq DESC LIMIT 1", b)?.id ?? null,
    }),
  } satisfies ChatStore, database.idle);
}
