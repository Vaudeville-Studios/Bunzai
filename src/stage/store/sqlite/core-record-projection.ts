/** Repair derived message identities only from committed Core journal operations. */
import type { Entry } from "rp-core";
import type { CoreMessageIdentity, CoreMessageLink, CoreMessageProjection, CoreSceneRecords } from "../../contracts/core-record-store";
import type { CellCipher } from "../../crypto/cell-cipher";
import type { StageDatabase } from "./database";
import { coreOperationBody, coreRecordAuthority, requireCoreBirth, requireHostCoreBirth } from "./core-record-authority";

export function coreRecordProjection(database: StageDatabase, cipher: CellCipher, requireHost: () => void = () => {}): Pick<CoreSceneRecords,
  "pendingProjection" | "projectionEntries" | "pendingCreation" | "unlinkedBirth" | "unlinkedBirthForBranch" | "hostProjection" | "recoverCreation" | "messageFor" | "messageIdentityFor" | "linkMessage" | "linkMessages" | "markProjected" | "projectMessage" | "projectMessages"> {
  const authority = coreRecordAuthority(database, cipher);
  const write = <T>(run: () => T): Promise<T> => database.patiently(() => database.transaction(() => { requireHost(); cipher.ready(); return run(); }));
  const entries = (sessionId: string, throughSeq: number): Entry[] => (database.statement("SELECT entry_cell FROM core_entries WHERE session_id = ? AND seq <= ? ORDER BY seq").all(sessionId, throughSeq) as { entry_cell: string }[])
    .map((row) => JSON.parse(cipher.open("core_entries.entry_cell", row.entry_cell)) as Entry);
  const committed = (operationId: string, throughSeq: number) => {
    const row = authority.operation(operationId);
    if (!row || !Number.isSafeInteger(throughSeq) || throughSeq < row.first_seq || throughSeq > row.last_seq) throw new Error("Core projection has no accepted journal range");
    authority.body(row);
    const linked = database.statement("SELECT 1 FROM core_scene_links l JOIN branches b ON b.id = l.branch_id WHERE l.session_id = ? AND l.chat_id = ? AND l.branch_id = ? AND b.chat_id = l.chat_id").get(row.session_id, row.chat_id, row.branch_id);
    if (!linked) throw new Error("Core projection no longer matches its persisted scene link");
    return row;
  };
  const proof = (input: Omit<CoreMessageLink, "chatMessageId">) => {
    const row = committed(input.operationId, input.throughSeq);
    if (row.session_id !== input.sessionId || row.branch_id !== input.takeId) throw new Error("Core projection target differs from its committed operation");
    const rows = entries(input.sessionId, input.throughSeq);
    const message = rows.find((entry) => entry.t === "msg" && entry.id === input.coreMessageId);
    if (!message || message.t !== "msg") throw new Error("Core projection message is absent from the committed journal");
    const relevant = rows.filter((entry) => (entry.t === "msg" && entry.id === input.coreMessageId) || (entry.t === "edit" && entry.target === input.coreMessageId));
    const latest = relevant.at(-1)!;
    if (latest.seq < row.first_seq && authority.body(row).origin !== "host") throw new Error("Core message was not changed by this committed operation");
    if (latest.t !== "msg" && latest.t !== "edit") throw new Error("Core projection entry is not a message");
    const content = (latest.blocks ?? []).filter((block) => block.k === "text").map((block) => block.text).join("");
    return { row, role: message.role, content, message, latest, rows };
  };
  const mapped = (sessionId: string, coreMessageId: string, takeId: string): CoreMessageIdentity | null => {
    const row = database.statement("SELECT message_id, swipe_id FROM core_message_links WHERE session_id = ? AND core_message_id = ? AND branch_id = ?").get(sessionId, coreMessageId, takeId) as { message_id: string; swipe_id: string } | null;
    return row ? { messageId: row.message_id, swipeId: row.swipe_id } : null;
  };
  const visible = (messageId: string, swipeId?: string) => database.statement(`SELECT m.branch_id, m.role, s.content, s.swipe_id, s.position FROM messages m JOIN swipes s ON s.message_id = m.id
    WHERE m.id = ? AND m.cut_at IS NULL AND s.cut_at IS NULL AND ${swipeId ? "s.swipe_id = ?" : "s.position = m.current_swipe"}`).get(...(swipeId ? [messageId, swipeId] : [messageId])) as { branch_id: string; role: string; content: string; swipe_id: string; position: number } | null;
  const link = (input: CoreMessageLink): void => {
    const shown = proof(input);
    const message = visible(input.chatMessageId, input.chatSwipeId);
    if (!message || message.branch_id !== input.takeId || message.role !== shown.role || cipher.open("swipes.content", message.content) !== shown.content) throw new Error("Core message identity does not match its committed projection");
    const previous = mapped(input.sessionId, input.coreMessageId, input.takeId);
    if (previous && (previous.messageId !== input.chatMessageId || previous.swipeId !== message.swipe_id)) throw new Error("Core message already has another projection identity");
    if (!previous) database.statement("INSERT INTO core_message_links (session_id, core_message_id, branch_id, message_id, swipe_id, swipe_position) VALUES (?, ?, ?, ?, ?, ?)").run(input.sessionId, input.coreMessageId, input.takeId, input.chatMessageId, message.swipe_id, message.position);
  };
  const projectOne = (input: CoreMessageProjection, project: (target: CoreMessageIdentity | null) => string): string => {
    const shown = proof(input);
    if (shown.role !== input.role || shown.content !== input.content) throw new Error("Core projection contents differ from the committed message");
    const previous = mapped(input.sessionId, input.coreMessageId, input.takeId);
    if (previous) {
      const current = visible(previous.messageId, previous.swipeId);
      if (current && current.role === shown.role && cipher.open("swipes.content", current.content) === shown.content) {
        link({ ...input, chatMessageId: previous.messageId, chatSwipeId: previous.swipeId }); return previous.messageId;
      }
    }
    const mode = input.mode ?? "append";
    let target: CoreMessageIdentity | null = null;
    if (mode === "append") {
      if (previous || input.targetCoreMessageId) throw new Error("An append cannot replace an existing Core message");
    } else if (mode === "swipe") {
      const source = shown.rows.find((entry) => entry.t === "msg" && entry.id === input.targetCoreMessageId);
      if (previous || !source || source.t !== "msg" || source.id === input.coreMessageId || source.role !== "assistant" || shown.role !== "assistant" || source.parent !== shown.message.parent) throw new Error("Core swipe projection requires exact assistant siblings");
      target = mapped(input.sessionId, source.id, input.takeId);
    } else {
      if (!previous || shown.latest.t !== "edit" || shown.latest.reason !== (mode === "continue" ? "continue" : "user") || (input.targetCoreMessageId && input.targetCoreMessageId !== input.coreMessageId)) throw new Error("Core edit projection requires the exact committed edit identity");
      target = previous;
    }
    if (mode !== "append" && !target) throw new Error("Core projection target has no stable message and swipe identity");
    const chatMessageId = project(target);
    if (typeof chatMessageId !== "string") throw new Error("Core projection callback must return a synchronous message id");
    link({ ...input, chatMessageId, ...(target && mode !== "swipe" ? { chatSwipeId: target.swipeId } : {}) });
    return chatMessageId;
  };
  const linkMessages = async (inputs: readonly CoreMessageLink[], expectedVersion: number): Promise<void> => {
    if (!inputs.length) return;
    const first = inputs[0]!;
    if (inputs.some((input) => input.sessionId !== first.sessionId || input.takeId !== first.takeId)
      || new Set(inputs.map((input) => input.coreMessageId)).size !== inputs.length) throw new Error("Core identity batch requires distinct messages in one take snapshot");
    await write(() => {
      const current = database.statement("SELECT 1 FROM branches b JOIN chats c ON c.id = b.chat_id WHERE b.id = ? AND b.version = ? AND c.active_branch_id = b.id AND b.deleted_at IS NULL AND c.deleted_at IS NULL").get(first.takeId, expectedVersion);
      if (!Number.isSafeInteger(expectedVersion) || !current) throw new Error("Core identity snapshot revision changed");
      for (const input of inputs) link(input);
    });
  };
  return {
    async *projectionEntries(operationId) {
      requireHost(); cipher.ready(); await database.idle();
      const row = authority.operation(operationId);
      if (!row) throw new Error("Core projection operation never committed");
      const identity = JSON.stringify(authority.projection(row));
      for (let seq = row.first_seq; seq > 0 && seq <= row.last_seq; seq++) {
        const current = authority.operation(operationId);
        if (!current || JSON.stringify(authority.projection(current)) !== identity) throw new Error("Core projection snapshot changed during recovery");
        const stored = database.statement("SELECT entry_cell FROM core_entries WHERE session_id = ? AND seq = ?").get(row.session_id, seq) as { entry_cell: string } | null;
        if (!stored) throw new Error("Core projection is missing an accepted journal entry");
        const entry = JSON.parse(cipher.open("core_entries.entry_cell", stored.entry_cell)) as Entry;
        if (entry.seq !== seq) throw new Error("Core projection entry has a damaged sequence binding");
        yield entry;
      }
    },
    async pendingProjection(sessionId) {
      cipher.ready(); await database.idle();
      return (database.statement("SELECT * FROM core_operation_projections o WHERE session_id = ? AND (projected_seq < last_seq OR NOT EXISTS (SELECT 1 FROM core_scene_links l WHERE l.session_id = o.session_id AND l.chat_id = o.chat_id AND l.branch_id = o.branch_id)) ORDER BY first_seq").all(sessionId) as ReturnType<typeof committed>[]).map(authority.projection);
    },
    async pendingCreation(sceneId) {
      cipher.ready(); await database.idle();
      const row = database.statement("SELECT o.* FROM core_operation_projections o JOIN core_scene_creation_bindings b ON b.chat_id = o.chat_id AND b.branch_id = o.branch_id AND b.operation_hash = o.operation_hash WHERE o.chat_id = ? AND NOT EXISTS (SELECT 1 FROM core_scene_links l WHERE l.chat_id = o.chat_id)").get(sceneId) as ReturnType<typeof committed> | null;
      if (!row) return null;
      const body = authority.body(row);
      if (body.operation !== "scenes.create") throw new Error("Core scene birth proof is damaged");
      if (body.origin === "extension") requireCoreBirth(database, cipher, { operationId: body.operationId, sceneId: row.chat_id, takeId: row.branch_id, sessionId: null }, body.packageId);
      else requireHostCoreBirth(database, cipher, row.chat_id, row.branch_id);
      return authority.projection(row);
    },
    async unlinkedBirth(sceneId) {
      cipher.ready(); await database.idle();
      return authority.unlinkedBirth(sceneId);
    },
    async unlinkedBirthForBranch(branchId) {
      cipher.ready(); await database.idle();
      return authority.unlinkedBirthForBranch(branchId);
    },
    async recoverCreation(operationId) {
      await write(() => {
        const row = authority.operation(operationId);
        if (!row) throw new Error("Core creation never committed");
        const body = authority.body(row);
        if (body.operation !== "scenes.create") throw new Error("This Core operation is not a committed scene birth");
        if (body.origin === "extension") requireCoreBirth(database, cipher, { operationId, sceneId: row.chat_id, takeId: row.branch_id, sessionId: null }, body.packageId);
        else requireHostCoreBirth(database, cipher, row.chat_id, row.branch_id);
        const existing = database.statement("SELECT session_id, branch_id FROM core_scene_links WHERE chat_id = ?").get(row.chat_id) as { session_id: string; branch_id: string } | null;
        if (existing) {
          if (existing.session_id !== row.session_id || existing.branch_id !== row.branch_id) throw new Error("Core scene birth already has another link");
          return;
        }
        database.statement("INSERT INTO core_scene_links (chat_id, session_id, branch_id) VALUES (?, ?, ?)").run(row.chat_id, row.session_id, row.branch_id);
      });
    },
    async hostProjection(sessionId, expectedVersion) {
      return write(() => {
        const target = database.statement("SELECT l.chat_id, l.branch_id FROM core_scene_links l JOIN branches b ON b.id = l.branch_id JOIN chats c ON c.id = l.chat_id WHERE l.session_id = ? AND b.chat_id = c.id AND b.version = ? AND c.active_branch_id = b.id AND b.deleted_at IS NULL AND c.deleted_at IS NULL").get(sessionId, expectedVersion) as { chat_id: string; branch_id: string } | null;
        if (!target) throw new Error("Core projection snapshot revision changed");
        const last = (database.statement("SELECT COALESCE(MAX(seq), 0) AS n FROM core_entries WHERE session_id = ?").get(sessionId) as { n: number }).n;
        const operationId = `host:${sessionId}`;
        const existing = authority.operation(operationId);
        if (existing && (authority.body(existing).origin !== "host" || existing.session_id !== sessionId || existing.branch_id !== target.branch_id)) throw new Error("Core host projection identity changed");
        if (existing) database.statement("UPDATE core_operation_projections SET last_seq = ? WHERE operation_hash = ?").run(last, existing.operation_hash);
        else database.statement("INSERT INTO core_operation_projections (operation_hash, session_id, chat_id, branch_id, first_seq, last_seq, projected_seq, body_cell) VALUES (?, ?, ?, ?, ?, ?, 0, ?)").run(
          cipher.index(operationId), sessionId, target.chat_id, target.branch_id, last ? 1 : 0, last, cipher.seal("core_operation_projections.body_cell", JSON.stringify(coreOperationBody.parse({
            origin: "host", operationId, packageId: "host", packageDigest: "host", policyFingerprint: "host", grantRevision: 0, operation: "host.projection", owner: "host", epoch: 0, accessHash: "host",
          }))));
        return authority.projection(authority.operation(operationId)!);
      });
    },
    async messageFor(sessionId, coreMessageId, takeId) { cipher.ready(); await database.idle(); return mapped(sessionId, coreMessageId, takeId)?.messageId ?? null; },
    async messageIdentityFor(sessionId, coreMessageId, takeId) { cipher.ready(); await database.idle(); return mapped(sessionId, coreMessageId, takeId); },
    linkMessages,
    async linkMessage(input, expectedVersion) { await linkMessages([input], expectedVersion); },
    async markProjected(operationId, throughSeq) {
      await write(() => {
        const row = committed(operationId, throughSeq);
        database.statement("UPDATE core_operation_projections SET projected_seq = MAX(projected_seq, ?) WHERE operation_hash = ?").run(throughSeq, row.operation_hash);
      });
    },
    async projectMessage(input: CoreMessageProjection, project) {
      return write(() => projectOne(input, project));
    },
    async projectMessages(inputs, project) {
      if (!inputs.length) return [];
      const first = inputs[0]!;
      if (inputs.some((input) => input.sessionId !== first.sessionId || input.takeId !== first.takeId || input.expectedVersion !== first.expectedVersion)
        || new Set(inputs.map((input) => input.coreMessageId)).size !== inputs.length) throw new Error("Core projection batch must name distinct messages in one take snapshot");
      return write(() => inputs.map((input) => projectOne(input, (target) => project(input, target))));
    },
  };
}
