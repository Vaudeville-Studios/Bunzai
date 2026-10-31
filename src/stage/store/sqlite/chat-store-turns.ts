/**
 * The SQLite ChatStore's turn half ('s lorebook
 * choices, rule 21's Props switch, and rule 22's request text): checkpoints, the commit that stores a
 * reply with its trace, the take's latest request text and the scene-state deltas the turn made (rule 17), and the scene's
 * connection, preset, lorebook choices, and switched-on Props. Split from chat-store.ts for the
 * file-size cap; each write is one transaction taking the write lock first, waiting for another
 * connection's lock up to its limit. Migration 10 holds the checkpoint tables, migration 11 the
 * connection, migration 12 the preset, migration 13 the lorebook choices, migration 14 the Props
 * switch, and migration 15 the branch's last request text; checkpoint text, traces, the request id,
 * the pending deltas (migration 43), the connection, the preset, the lorebook choices, the Props switch, and the last request
 * text are sealed.
 */
import { checkVariantId, turnOpenConflict } from "../cast-rules";
import { StudioConflictError } from "../../../studio/errors";
import type { Delta } from "../../../core/scene-state/types";
import type { ChatPrompting, ChatStore, Generation, JsonObject, Message, TurnCheckpoint, WriteGuard } from "../../contracts/chat-store";
import type { ExtensionCommitContext } from "../../contracts/extension-store";
import { extensionTurnOwnerOf, openExtensionTurnOwner, sameExtensionTurnOwner } from "../extension-turn-owner";
import { checkConnection, checkGuard, checkLore, checkProgress, checkProps, checkTurnResult, checkTurnTarget } from "../chat-rules";
import { checkPreset } from "../preset-rules";
import { checkOpening } from "../opening-rules";
import { checkBackdrop } from "../backdrop-rules";
import { checkPrompting, mergePrompting } from "../prompting-rules";
import { continuedGeneration } from "../continue-rules";
import { checkRerun, traceWithRerun } from "../final-cut-rules";
import type { ChatSqlKit } from "./chat-store-cuts";
import { appendSwipe } from "./swipe-sql";
import { requireExtensionCommit } from "./extension-commit-guard";
import { requireCommitResource } from "../extension-commit-access";
import { checkExtensionDeltas } from "../scene-state-rules";

interface CheckpointSql {
  id: string;
  chat_id: string;
  branch_id: string;
  kind: "reply" | "swipe" | "continue";
  message_id: string | null;
  content: string;
  trace_json: string | null;
  provider_request_id: string | null;
  deltas_json: string | null;
  extension_owner_json: string | null;
  base_version: number;
  started_at: number;
  saved_at: number;
}

export interface TurnSqlKit extends ChatSqlKit {
  insertSwipe(messageId: string, position: number, content: string, generation: Generation | undefined, createdAt: number): number;
  appendMany(branchId: string, inputs: unknown, guard: WriteGuard | undefined): Message[] | null;
}

type TurnMethods = Pick<
  ChatStore,
  | "swipeTrace"
  | "appendFinalCutRerun"
  | "beginTurn"
  | "saveCheckpoint"
  | "appendPendingExtensionDeltas"
  | "commitTurn"
  | "dropTurn"
  | "resumeIncomplete"
  | "setConnection"
  | "setPreset"
  | "setLore"
  | "setProps"
  | "setOpening"
  | "setPrompting"
  | "setBackdrop"
  | "setVariant"
  | "lastRequest"
>;

/** Checkpoints joined to their branch and chat; `live` keeps only those a caller may see (rule 16). */
const CHECKPOINTS = `SELECT c.id, b.chat_id, c.branch_id, c.kind, c.message_id, c.content, c.trace_json, c.provider_request_id, c.deltas_json, c.extension_owner_json, c.base_version, c.started_at, c.saved_at
  FROM turn_checkpoints c JOIN branches b ON b.id = c.branch_id JOIN chats h ON h.id = b.chat_id`;
const LIVE = "b.deleted_at IS NULL AND h.deleted_at IS NULL";

export function turnMethods(k: TurnSqlKit): TurnMethods {
  const { statement } = k.database;
  // How long a write waits for another connection's lock (turn-loop spec, "Before the turn loop" item 3):
  // a save that gives up is skipped, since the next supersedes it; a reply, or a save carrying the turn's scene-state deltas (nothing supersedes those), is worth 30 s.
  const saveWrite = <T>(work: () => T) => k.write(work, 250);
  const longWrite = <T>(work: () => T) => k.write(work, 30_000);
  const { cipher } = k;
  const toCheckpoint = (r: CheckpointSql): TurnCheckpoint => ({
    id: r.id,
    chatId: r.chat_id,
    branchId: r.branch_id,
    kind: r.kind,
    messageId: r.message_id,
    content: cipher.open("turn_checkpoints.content", r.content),
    ...(r.trace_json === null ? {} : { trace: JSON.parse(cipher.open("turn_checkpoints.trace_json", r.trace_json)) as JsonObject }),
    ...(r.provider_request_id === null ? {} : { providerRequestId: cipher.open("turn_checkpoints.provider_request_id", r.provider_request_id) }),
    ...(r.deltas_json === null ? {} : { deltas: JSON.parse(cipher.open("turn_checkpoints.deltas_json", r.deltas_json)) as Delta[] }),
    ...(r.extension_owner_json === null ? {} : { extensionOwner: openExtensionTurnOwner(cipher, r.extension_owner_json) }),
    baseVersion: r.base_version,
    startedAt: r.started_at,
    savedAt: r.saved_at,
  });
  const open = (turnId: string) => k.one<CheckpointSql>(`${CHECKPOINTS} WHERE c.id = ? AND ${LIVE}`, turnId);
  const sealTrace = (where: string, trace: JsonObject) => cipher.seal(where, JSON.stringify(trace));

  return {
    async appendFinalCutRerun(messageId, swipeId, entryRaw) {
      const entry = checkRerun(entryRaw);
      return k.write(() => {
        const r = k.one<{ trace_json: string; position: number }>(
          "SELECT t.trace_json, t.position FROM swipe_traces t JOIN swipes s ON s.message_id = t.message_id AND s.position = t.position WHERE s.message_id = ? AND s.swipe_id = ?",
          messageId, swipeId,
        );
        if (!r || !k.writableMessage(messageId)) return false;
        const next = traceWithRerun(JSON.parse(cipher.open("swipe_traces.trace_json", r.trace_json)) as JsonObject, entry);
        if (!next) return false;
        k.run("UPDATE swipe_traces SET trace_json = ? WHERE message_id = ? AND position = ?", sealTrace("swipe_traces.trace_json", next), messageId, r.position);
        return true;
      });
    },

    async swipeTrace(messageId, swipeId) {
      const r = k.one<{ trace_json: string }>(
        "SELECT t.trace_json FROM swipe_traces t JOIN swipes s ON s.message_id = t.message_id AND s.position = t.position WHERE s.message_id = ? AND s.swipe_id = ?",
        messageId, swipeId,
      );
      return r ? (JSON.parse(cipher.open("swipe_traces.trace_json", r.trace_json)) as JsonObject) : null;
    },

    async beginTurn(branchId, targetRaw, guard, extensionCommit) {
      const target = checkTurnTarget(targetRaw);
      const expected = checkGuard(guard);
      return k.write(() => {
        if (extensionCommit) requireExtensionCommit(k.database, cipher, extensionCommit);
        const branch = k.writableBranch(branchId);
        if (!branch) return null;
        if (target.kind !== "reply") {
          const m = k.writableMessage(target.messageId);
          if (m?.branch_id !== branchId || m.role !== "assistant") return null;
        }
        k.requireVersion(branch, expected);
        if (k.one("SELECT 1 FROM turn_checkpoints WHERE branch_id = ?", branchId)) {
          throw new StudioConflictError("a reply is already in progress on this branch");
        }
        const id = k.newId();
        const t = k.clock();
        k.run(
          "INSERT INTO turn_checkpoints (id, branch_id, kind, message_id, content, base_version, started_at, saved_at, extension_owner_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
          id, branchId, target.kind, target.kind === "reply" ? null : target.messageId, cipher.seal("turn_checkpoints.content", ""), branch.version, t, t,
          extensionCommit ? cipher.seal("turn_checkpoints.extension_owner_json", JSON.stringify(extensionTurnOwnerOf(extensionCommit))) : null,
        );
        return toCheckpoint(open(id)!);
      });
    },

    async saveCheckpoint(turnId, progressRaw, extensionCommit) {
      const { content, trace, providerRequestId, deltas } = checkProgress(progressRaw);
      return (deltas === undefined ? saveWrite : longWrite)(() => {
        if (extensionCommit) requireExtensionCommit(k.database, cipher, extensionCommit);
        const checkpoint = open(turnId);
        if (!checkpoint) return null;
        const mergedDeltas = deltas === undefined ? undefined : [
          ...deltas.filter(({ slot }) => !slot.startsWith("ext:")),
          ...(checkpoint.deltas_json === null ? [] : (JSON.parse(cipher.open("turn_checkpoints.deltas_json", checkpoint.deltas_json)) as Delta[]).filter(({ slot }) => slot.startsWith("ext:"))),
        ];
        // Omitted fields keep what an earlier save recorded: the request id arrives once, early.
        k.run(
          `UPDATE turn_checkpoints SET content = ?, trace_json = coalesce(?, trace_json),
             provider_request_id = coalesce(?, provider_request_id), deltas_json = coalesce(?, deltas_json), saved_at = ? WHERE id = ?`,
          cipher.seal("turn_checkpoints.content", content),
          trace === undefined ? null : sealTrace("turn_checkpoints.trace_json", trace),
          providerRequestId === undefined ? null : cipher.seal("turn_checkpoints.provider_request_id", providerRequestId),
          mergedDeltas === undefined ? null : cipher.seal("turn_checkpoints.deltas_json", JSON.stringify(mergedDeltas)),
          k.clock(), turnId,
        );
        return toCheckpoint(open(turnId)!);
      });
    },

    async appendPendingExtensionDeltas(turnId, packageId, expectedVersion, deltasRaw, extensionCommit) {
      const deltas = checkExtensionDeltas([...deltasRaw], packageId);
      if (extensionCommit.operation !== "state.write.apply" || packageId !== extensionCommit.packageId || deltas.length === 0) {
        throw new Error("pending extension state must stay inside its package namespace");
      }
      return longWrite(() => {
        requireExtensionCommit(k.database, cipher, extensionCommit);
        const checkpoint = open(turnId);
        if (!checkpoint || checkpoint.base_version !== expectedVersion || checkpoint.kind === "continue") return false;
        const owner = checkpoint.extension_owner_json === null ? undefined : openExtensionTurnOwner(cipher, checkpoint.extension_owner_json);
        if (!sameExtensionTurnOwner(owner, extensionCommit)) return false;
        const branch = k.branchRow(checkpoint.branch_id);
        if (!branch || branch.chat_id !== checkpoint.chat_id || branch.version !== expectedVersion) return false;
        requireCommitResource(extensionCommit, { kind: "scene", id: checkpoint.chat_id }, ["state"]);
        requireCommitResource(extensionCommit, { kind: "take", id: checkpoint.branch_id }, ["state"]);
        const existing = checkpoint.deltas_json === null ? [] : JSON.parse(cipher.open("turn_checkpoints.deltas_json", checkpoint.deltas_json)) as Delta[];
        k.run("UPDATE turn_checkpoints SET deltas_json = ?, saved_at = ? WHERE id = ? AND base_version = ?",
          cipher.seal("turn_checkpoints.deltas_json", JSON.stringify([...existing, ...deltas])), k.clock(), turnId, expectedVersion);
        return true;
      });
    },

    async commitTurn(turnId, resultRaw, guard, extensionCommit) {
      const { content, generation, trace, request } = checkTurnResult(resultRaw);
      const expected = checkGuard(guard);
      return longWrite(() => {
        if (extensionCommit) requireExtensionCommit(k.database, cipher, extensionCommit);
        const c = open(turnId);
        if (!c) return null;
        const pendingExtensionState = c.deltas_json !== null && (JSON.parse(cipher.open("turn_checkpoints.deltas_json", c.deltas_json)) as Delta[]).some(({ slot }) => slot.startsWith("ext:"));
        const owner = c.extension_owner_json === null ? undefined : openExtensionTurnOwner(cipher, c.extension_owner_json);
        if (pendingExtensionState && (!extensionCommit || !sameExtensionTurnOwner(owner, extensionCommit))) throw new StudioConflictError("the extension that owns pending state is no longer authorized to commit it");
        let messageId: string;
        let position: number;
        if (c.kind === "reply") {
          // appendMany checks the version before it writes, so a conflict leaves the checkpoint.
          const appended = k.appendMany(c.branch_id, [{ role: "assistant", content, generation }], guard);
          if (!appended) return null;
          messageId = appended[0]!.id;
          position = 0;
        } else if (c.kind === "continue") {
          // Rule 31: more text on the current swipe, kept as an edit keeps it (rule 5).
          const m = k.writableMessage(c.message_id!);
          if (!m || m.branch_id !== c.branch_id) return null;
          k.requireVersion(k.branchRow(m.branch_id)!, expected);
          const swipe = k.one<{ swipe_id: string; content: string; generation_json: string | null }>(
            "SELECT swipe_id, content, generation_json FROM swipes WHERE message_id = ? AND position = ?", m.id, m.current_swipe,
          )!;
          const before = cipher.open("swipes.content", swipe.content);
          k.run(
            `INSERT INTO swipe_history (message_id, swipe_id, n, content)
               SELECT ?, ?, coalesce(max(n), 0) + 1, ? FROM swipe_history WHERE message_id = ? AND swipe_id = ?`,
            m.id, swipe.swipe_id, cipher.seal("swipe_history.content", before), m.id, swipe.swipe_id,
          );
          const was = swipe.generation_json === null ? undefined : (JSON.parse(cipher.open("swipes.generation_json", swipe.generation_json)) as Generation);
          const merged = continuedGeneration(was, generation);
          k.run(
            "UPDATE swipes SET content = ?, generation_json = ? WHERE message_id = ? AND position = ?",
            cipher.seal("swipes.content", before + content),
            merged === undefined ? null : cipher.seal("swipes.generation_json", JSON.stringify(merged)),
            m.id, m.current_swipe,
          );
          k.bump(m.branch_id);
          messageId = m.id;
          position = m.current_swipe;
        } else {
          // A message moved to another take by a restore is not this turn's any more (rule 16).
          const m = k.writableMessage(c.message_id!);
          if (!m || m.branch_id !== c.branch_id) return null;
          k.requireVersion(k.branchRow(m.branch_id)!, expected);
          position = appendSwipe(k, m.id, content, generation, k.clock());
          k.bump(m.branch_id);
          messageId = m.id;
        }
        if (trace && c.kind !== "continue") {
          k.run("INSERT INTO swipe_traces (message_id, position, trace_json) VALUES (?, ?, ?)", messageId, position, sealTrace("swipe_traces.trace_json", trace));
        }
        if (c.kind !== "continue") {
          const swipeId = k.one<{ swipe_id: string }>("SELECT swipe_id FROM swipes WHERE message_id = ? AND position = ?", messageId, position)!.swipe_id;
          // The turn's scene-state deltas belong to the version it stored (a continue extends one that has its own), and the take's state is rebuilt with them (rule 17).
          k.state.stampSwipe(swipeId, c.deltas_json === null ? [] : (JSON.parse(cipher.open("turn_checkpoints.deltas_json", c.deltas_json)) as Delta[]));
          k.state.refresh(c.branch_id, k.one<{ seq: number }>("SELECT seq FROM messages WHERE id = ?", messageId)!.seq);
          if (request) k.run(
            "UPDATE branches SET last_request_json = ? WHERE id = ?",
            cipher.seal("branches.last_request_json", JSON.stringify({ messageId, swipeId, texts: request.texts })),
            c.branch_id,
          );
        }
        k.run("DELETE FROM turn_checkpoints WHERE id = ?", turnId);
        return k.messageById(messageId);
      });
    },

    async dropTurn(turnId, extensionCommit) {
      return k.write(() => {
        if (extensionCommit) requireExtensionCommit(k.database, cipher, extensionCommit);
        return open(turnId) ? k.run("DELETE FROM turn_checkpoints WHERE id = ?", turnId) > 0 : false;
      });
    },

    async resumeIncomplete() {
      return (statement(`${CHECKPOINTS} WHERE ${LIVE} ORDER BY c.started_at, c.rowid`).all() as CheckpointSql[]).map(toCheckpoint);
    },

    async setConnection(chatId, connectionRaw) {
      const connection = checkConnection(connectionRaw);
      const sealed = connection && cipher.seal("chats.connection_json", JSON.stringify(connection));
      const changed = await k.write(() => k.run("UPDATE chats SET connection_json = ? WHERE id = ? AND deleted_at IS NULL", sealed, chatId));
      return changed ? k.toChat(k.chatRow(chatId)!) : null;
    },

    async setPreset(chatId, presetRaw) {
      const preset = checkPreset(presetRaw);
      const sealed = preset && cipher.seal("chats.preset_json", JSON.stringify(preset));
      const changed = await k.write(() => k.run("UPDATE chats SET preset_json = ? WHERE id = ? AND deleted_at IS NULL", sealed, chatId));
      return changed ? k.toChat(k.chatRow(chatId)!) : null;
    },

    async setLore(chatId, loreRaw) {
      const lore = checkLore(loreRaw);
      const sealed = lore && cipher.seal("chats.lore_json", JSON.stringify(lore));
      const changed = await k.write(() => k.run("UPDATE chats SET lore_json = ? WHERE id = ? AND deleted_at IS NULL", sealed, chatId));
      return changed ? k.toChat(k.chatRow(chatId)!) : null;
    },

    async setVariant(chatId, variantRaw) {
      const variantId = checkVariantId(variantRaw);
      const changed = await k.write(() => {
        // The prompt of a reply being written was built from the old look (rule 27).
        if (k.one("SELECT 1 FROM turn_checkpoints c JOIN branches b ON b.id = c.branch_id WHERE b.chat_id = ? AND b.deleted_at IS NULL", chatId) && k.liveChat(chatId)) throw turnOpenConflict();
        return k.run("UPDATE chats SET variant_id = ? WHERE id = ? AND deleted_at IS NULL", variantId, chatId);
      });
      return changed ? k.toChat(k.chatRow(chatId)!) : null;
    },

    async setProps(chatId, propsRaw) {
      const props = checkProps(propsRaw);
      const sealed = props && cipher.seal("chats.props_json", JSON.stringify(props));
      const changed = await k.write(() => k.run("UPDATE chats SET props_json = ? WHERE id = ? AND deleted_at IS NULL", sealed, chatId));
      return changed ? k.toChat(k.chatRow(chatId)!) : null;
    },

    async setOpening(chatId, openingRaw) {
      const opening = checkOpening(openingRaw);
      const sealed = opening && cipher.seal("chats.opening_json", JSON.stringify(opening));
      const changed = await k.write(() => k.run("UPDATE chats SET opening_json = ? WHERE id = ? AND deleted_at IS NULL", sealed, chatId));
      return changed ? k.toChat(k.chatRow(chatId)!) : null;
    },

    async setPrompting(chatId, patchRaw) {
      const patch = checkPrompting(patchRaw);
      // Read and write in one transaction, so two quick patches (a guide switch and a note edit) never overwrite each other.
      const found = await k.write(() => {
        const row = k.one<{ prompting_json: string | null }>("SELECT prompting_json FROM chats WHERE id = ? AND deleted_at IS NULL", chatId);
        if (!row) return false;
        const old = row.prompting_json === null ? undefined : (JSON.parse(cipher.open("chats.prompting_json", row.prompting_json)) as ChatPrompting);
        const next = mergePrompting(old, patch);
        k.run("UPDATE chats SET prompting_json = ? WHERE id = ?", next && cipher.seal("chats.prompting_json", JSON.stringify(next)), chatId);
        return true;
      });
      return found ? k.toChat(k.chatRow(chatId)!) : null;
    },

    async setBackdrop(chatId, backdropRaw) {
      const backdrop = checkBackdrop(backdropRaw);
      const sealed = backdrop && cipher.seal("chats.backdrop_json", JSON.stringify(backdrop));
      const changed = await k.write(() => k.run("UPDATE chats SET backdrop_json = ? WHERE id = ? AND deleted_at IS NULL", sealed, chatId));
      return changed ? k.toChat(k.chatRow(chatId)!) : null;
    },

    async lastRequest(branchId) {
      if (!k.writableBranch(branchId)) return null;
      const r = k.one<{ last_request_json: string | null }>("SELECT last_request_json FROM branches WHERE id = ?", branchId)!;
      return r.last_request_json === null ? null : (JSON.parse(cipher.open("branches.last_request_json", r.last_request_json)) as { messageId: string; swipeId: string; texts: string[] });
    },
  };
}
