/** Sealed pending package metadata becomes authoritative only with its exact successful Core message. */
import { z } from "zod";
import type { Entry } from "rp-core";
import type { CoreStateTurnBinding } from "../../contracts/core-extension-state";
import type { ExtensionCommitContext } from "../../contracts/extension-store";
import { extensionTurnOwnerSchema } from "../../contracts/extension-turn-owner";
import type { CellCipher } from "../../crypto/cell-cipher";
import { MAX_VALUE_BYTES } from "../../../extensions/contracts/limits";
import { checkExtensionDeltas } from "../scene-state-rules";
import { requireCommitResource } from "../extension-commit-access";
import { extensionTurnOwnerOf } from "../extension-turn-owner";
import { requireExtensionCommit } from "./extension-commit-guard";
import { coreRecordAuthority, type CoreInvocation } from "./core-record-authority";
import type { StageDatabase } from "./database";

const id = z.string().min(1).max(200);
const MAX_PENDING_WRITES = 64;
const bindingSchema = z.strictObject({ sceneId: id, takeId: id, sessionId: id, turnId: id, turnOperationId: id,
  kind: z.enum(["reply", "swipe"]), expectedVersion: z.number().int().nonnegative() });
const bodySchema = z.strictObject({ stateInvocationId: id, turn: bindingSchema, owner: extensionTurnOwnerSchema, deltas: z.unknown(), ordinal: z.number().int().min(0).max(MAX_PENDING_WRITES - 1) });
export interface CorePendingRow { state_hash: string; turn_operation_hash: string; turn_id: string; session_id: string; branch_id: string;
  phase: "staged" | "accepted" | "applied"; ordinal: number; accepted_seq: number | null; core_message_id: string | null; bytes: number; body_cell: string }

export function corePendingState(database: StageDatabase, cipher: CellCipher, now: () => number = Date.now) {
  const authority = coreRecordAuthority(database, cipher);
  const body = (row: CorePendingRow) => {
    const value = bodySchema.parse(JSON.parse(cipher.open("core_pending_extension_state.body_cell", row.body_cell)));
    if (cipher.index(value.stateInvocationId) !== row.state_hash || cipher.index(value.turn.turnOperationId) !== row.turn_operation_hash
      || value.turn.turnId !== row.turn_id || value.turn.sessionId !== row.session_id || value.turn.takeId !== row.branch_id || value.ordinal !== row.ordinal) throw new Error("Core pending state identity is damaged");
    return { ...value, deltas: checkExtensionDeltas(value.deltas, value.owner.packageId) };
  };
  const requireStateCommit = (commit: ExtensionCommitContext, target: CoreStateTurnBinding) => {
    if (commit.operation !== "state.write.apply") throw new Error("Core state requires its dedicated write operation");
    requireExtensionCommit(database, cipher, commit);
    requireCommitResource(commit, { kind: "scene", id: target.sceneId }, ["state"]);
    requireCommitResource(commit, { kind: "take", id: target.takeId });
  };
  const journal = (sessionId: string, first: number, last: number): Entry[] =>
    (database.statement("SELECT entry_cell FROM core_entries WHERE session_id = ? AND seq >= ? AND seq <= ? ORDER BY seq").all(sessionId, first, last) as { entry_cell: string }[])
      .map((row) => JSON.parse(cipher.open("core_entries.entry_cell", row.entry_cell)) as Entry);
  const stage = (commit: ExtensionCommitContext, rawTarget: CoreStateTurnBinding, rawDeltas: unknown): boolean => {
    const target = bindingSchema.parse(rawTarget), deltas = checkExtensionDeltas(rawDeltas, commit.packageId);
    requireStateCommit(commit, target);
    if (!commit.invocationId || !deltas.length) throw new Error("Core pending state needs a broker receipt and nonempty deltas");
    const operation = authority.operation(target.turnOperationId);
    const owner = operation && authority.body(operation);
    if (!operation || !owner || owner.origin !== "extension" || owner.packageId !== commit.packageId || owner.owner !== commit.owner || owner.epoch !== commit.epoch
      || owner.packageDigest !== commit.packageDigest || owner.policyFingerprint !== commit.policyFingerprint || owner.grantRevision !== commit.grantRevision
      || owner.operation !== (target.kind === "reply" ? "turns.start" : "turns.regenerate") || operation.session_id !== target.sessionId || operation.chat_id !== target.sceneId || operation.branch_id !== target.takeId) throw new Error("Core pending state does not own this turn");
    const branch = database.statement("SELECT 1 FROM branches b JOIN chats c ON c.id = b.chat_id JOIN core_scene_links l ON l.chat_id = c.id JOIN core_sessions s ON s.id = l.session_id WHERE b.id = ? AND c.id = ? AND c.active_branch_id = b.id AND l.branch_id = b.id AND s.id = ? AND b.version = ? AND b.deleted_at IS NULL AND c.deleted_at IS NULL AND s.lease_owner IS NOT NULL AND s.lease_until > ?").get(target.takeId, target.sceneId, target.sessionId, target.expectedVersion, commit.now());
    if (!branch) return false;
    const rows = journal(target.sessionId, operation.first_seq, operation.last_seq);
    const turn = rows.find((entry) => entry.t === "turn" && entry.turn === target.turnId);
    if (!turn || turn.t !== "turn" || turn.kind !== target.kind || turn.hostPolicy !== "extension-owned"
      || rows.some((entry) => "turn" in entry && entry.turn === target.turnId && (entry.t === "msg" || entry.t === "edit" || entry.t === "end" || entry.t === "held"))) return false;
    const value = { stateInvocationId: commit.invocationId, turn: target, owner: extensionTurnOwnerOf(commit), deltas };
    const existing = database.statement("SELECT * FROM core_pending_extension_state WHERE state_hash = ?").get(cipher.index(commit.invocationId)) as CorePendingRow | null;
    if (existing) {
      if (JSON.stringify(body(existing)) !== JSON.stringify({ ...value, ordinal: existing.ordinal })) throw new Error("Core pending state receipt was reused for different data");
      return existing.phase === "staged";
    }
    const usage = database.statement("SELECT COUNT(*) AS n, COALESCE(SUM(bytes), 0) AS bytes, COALESCE(MAX(ordinal), -1) + 1 AS next FROM core_pending_extension_state WHERE turn_operation_hash = ? AND turn_id = ?").get(cipher.index(target.turnOperationId), target.turnId) as { n: number; bytes: number; next: number };
    const text = JSON.stringify({ ...value, ordinal: usage.next }), bytes = new TextEncoder().encode(text).byteLength;
    if (usage.n >= MAX_PENDING_WRITES || usage.next >= MAX_PENDING_WRITES || usage.bytes + bytes > MAX_VALUE_BYTES) throw new Error("Core pending state exceeds the per-turn buffer limit");
    database.statement("INSERT INTO core_pending_extension_state (state_hash, turn_operation_hash, turn_id, session_id, branch_id, phase, ordinal, accepted_seq, core_message_id, bytes, body_cell) VALUES (?, ?, ?, ?, ?, 'staged', ?, NULL, NULL, ?, ?)").run(
      cipher.index(commit.invocationId), cipher.index(target.turnOperationId), target.turnId, target.sessionId, target.takeId, usage.next, bytes,
      cipher.seal("core_pending_extension_state.body_cell", text));
    return true;
  };
  const discard = (operationId: string, turnId: string): void => {
    const rows = database.statement("SELECT * FROM core_pending_extension_state WHERE turn_operation_hash = ? AND turn_id = ? AND phase = 'staged'").all(cipher.index(operationId), turnId) as CorePendingRow[];
    for (const row of rows) body(row);
    database.statement("DELETE FROM core_pending_extension_state WHERE turn_operation_hash = ? AND turn_id = ? AND phase = 'staged'").run(cipher.index(operationId), turnId);
  };
  const discardAbandoned = (sessionId: string): void => {
    const lease = database.statement("SELECT lease_owner, lease_until FROM core_sessions WHERE id = ?").get(sessionId) as { lease_owner: string | null; lease_until: number | null } | null;
    const rows = database.statement("SELECT * FROM core_pending_extension_state WHERE session_id = ? AND phase = 'staged'").all(sessionId) as CorePendingRow[];
    const checked = new Set<string>();
    for (const row of rows) {
      const value = body(row);
      if (checked.has(value.turn.turnOperationId)) continue;
      checked.add(value.turn.turnOperationId);
      const operation = authority.operation(value.turn.turnOperationId);
      const last = (database.statement("SELECT COALESCE(MAX(seq), 0) AS n FROM core_entries WHERE session_id = ?").get(sessionId) as { n: number }).n;
      const terminal = operation && journal(sessionId, operation.first_seq, last).some((entry) => "turn" in entry && entry.turn === row.turn_id
        && (entry.t === "msg" || entry.t === "edit" || entry.t === "end" || entry.t === "held"));
      // A still-held session may belong to another live host. Never discard its proposal merely on a read.
      if (terminal || !lease?.lease_owner || lease.lease_until === null || lease.lease_until <= now()) discard(value.turn.turnOperationId, row.turn_id);
    }
  };
  const accept = (scope: CoreInvocation, entries: readonly Entry[]): void => {
    const rows = database.statement("SELECT * FROM core_pending_extension_state WHERE turn_operation_hash = ? AND phase = 'staged'").all(cipher.index(scope.target.operationId)) as CorePendingRow[];
    for (const row of rows) {
      const terminal = entries.find((entry) => "turn" in entry && entry.turn === row.turn_id && (entry.t === "msg" || entry.t === "end" || entry.t === "held" || entry.t === "edit"));
      if (!terminal) continue;
      const value = body(row);
      if (terminal.t !== "msg" || terminal.role !== "assistant" || terminal.tail || terminal.gen?.kind !== "model" || !terminal.gen.finish || terminal.gen.finish === "stopped" || terminal.gen.finish === "interrupted") {
        discard(scope.target.operationId, row.turn_id); continue;
      }
      if (scope.commit.packageId !== value.owner.packageId || scope.target.sceneId !== value.turn.sceneId || scope.target.takeId !== value.turn.takeId || terminal.id === "") throw new Error("Core state commit changed its owned turn target");
      const turn = journal(row.session_id, 1, terminal.seq).find((entry) => entry.t === "turn" && entry.turn === row.turn_id);
      if (!turn || turn.t !== "turn" || turn.kind !== value.turn.kind || turn.hostPolicy !== "extension-owned" || turn.msgId !== terminal.id) throw new Error("Core state commit does not match the accepted turn message");
      const commit: ExtensionCommitContext = { ...value.owner, operation: "state.write.apply", invocationId: value.stateInvocationId,
        access: { resources: [{ kind: "scene", id: value.turn.sceneId }, { kind: "take", id: value.turn.takeId }], fields: ["state"], methods: [], destinations: [] }, now: scope.commit.now, signal: scope.commit.signal };
      requireStateCommit(commit, value.turn);
      if (!database.statement("SELECT 1 FROM branches WHERE id = ? AND chat_id = ? AND version = ? AND deleted_at IS NULL").get(value.turn.takeId, value.turn.sceneId, value.turn.expectedVersion)) throw new Error("Core pending state take changed during its turn");
      database.statement("UPDATE core_pending_extension_state SET phase = 'accepted', accepted_seq = ?, core_message_id = ? WHERE state_hash = ? AND phase = 'staged'").run(terminal.seq, terminal.id, row.state_hash);
    }
  };
  const accepted = (sessionId: string, coreMessageId?: string): CorePendingRow[] => (coreMessageId
    ? database.statement("SELECT * FROM core_pending_extension_state WHERE session_id = ? AND core_message_id = ? AND phase = 'accepted' ORDER BY accepted_seq, ordinal").all(sessionId, coreMessageId)
    : database.statement("SELECT * FROM core_pending_extension_state WHERE session_id = ? AND phase = 'accepted' ORDER BY accepted_seq, ordinal").all(sessionId)) as CorePendingRow[];
  const verifyAccepted = (row: CorePendingRow) => {
    const value = body(row), operation = authority.operation(value.turn.turnOperationId);
    if (row.phase !== "accepted" || row.accepted_seq === null || !operation || row.accepted_seq < operation.first_seq || row.accepted_seq > operation.last_seq) throw new Error("Core state was never accepted by its journal operation");
    const owner = authority.body(operation);
    if (owner.origin !== "extension" || owner.packageId !== value.owner.packageId || owner.owner !== value.owner.owner || owner.epoch !== value.owner.epoch
      || owner.grantRevision !== value.owner.grantRevision || owner.packageDigest !== value.owner.packageDigest || owner.policyFingerprint !== value.owner.policyFingerprint
      || operation.session_id !== row.session_id || operation.chat_id !== value.turn.sceneId || operation.branch_id !== value.turn.takeId) throw new Error("Core accepted state operation identity is damaged");
    const entry = journal(row.session_id, row.accepted_seq, row.accepted_seq)[0];
    if (!entry || entry.t !== "msg" || entry.id !== row.core_message_id || entry.turn !== row.turn_id || entry.tail || entry.gen?.kind !== "model" || !entry.gen.finish || entry.gen.finish === "stopped" || entry.gen.finish === "interrupted") throw new Error("Core state accepted message proof is damaged");
    return value;
  };
  return { stage, accept, discard, discardAbandoned, accepted, verifyAccepted };
}
