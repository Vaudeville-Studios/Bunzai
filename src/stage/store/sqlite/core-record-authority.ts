/** Transaction-local extension authority and durable accepted Core operation proofs. */
import { z } from "zod";
import type { CoreInvocationTarget, CoreProjection } from "../../contracts/core-record-store";
import type { ExtensionCommitContext } from "../../contracts/extension-store";
import type { CellCipher } from "../../crypto/cell-cipher";
import { requireCommitResource, snapshotExtensionCommit } from "../extension-commit-access";
import { requireExtensionCommit } from "./extension-commit-guard";
import { checkCast } from "../chat-rules";
import type { StageDatabase } from "./database";

const id = z.string().min(1).max(200);
const targetSchema = z.strictObject({ operationId: id, sceneId: id, takeId: id, sessionId: id.nullable(), expectedJournalSeq: z.number().int().nonnegative().optional() });
export const coreOperationBody = z.strictObject({ origin: z.enum(["extension", "host"]), operationId: id, packageId: id, packageDigest: id, policyFingerprint: id, accessHash: id,
  grantRevision: z.number().int().nonnegative(), operation: id, owner: id, epoch: z.number().int().nonnegative() });
export interface OperationRow { operation_hash: string; session_id: string; chat_id: string; branch_id: string; first_seq: number; last_seq: number; projected_seq: number; body_cell: string }
export interface CoreInvocation { commit: ExtensionCommitContext; target: CoreInvocationTarget }
const birthSchema = z.discriminatedUnion("origin", [
  z.strictObject({ origin: z.literal("extension"), invocationId: id, packageId: id, cast: z.unknown() }),
  z.strictObject({ origin: z.literal("host"), invocationId: id, cast: z.unknown() }),
]);
type CoreBirth = z.infer<typeof birthSchema>;
function readCoreBirth(database: StageDatabase, cipher: CellCipher, sceneId: string, takeId: string): { birth: CoreBirth; cast: ReturnType<typeof checkCast> } {
  const born = database.statement("SELECT operation_hash, package_hash, body_cell FROM core_scene_creation_bindings WHERE chat_id = ? AND branch_id = ?").get(sceneId, takeId) as
    { operation_hash: string; package_hash: string | null; body_cell: string } | null;
  if (!born) throw new Error("Core creation has no matching committed scene birth");
  const value = birthSchema.parse(JSON.parse(cipher.open("core_scene_creation_bindings.body_cell", born.body_cell)));
  if (cipher.index(value.invocationId) !== born.operation_hash || (value.origin === "extension" ? cipher.index(value.packageId) !== born.package_hash : born.package_hash !== null)) throw new Error("Core creation birth identity is damaged");
  const current = database.statement("SELECT cast_json FROM chats WHERE id = ?").get(sceneId) as { cast_json: string } | null;
  const cast = checkCast(value.cast);
  if (!current || JSON.stringify(checkCast(JSON.parse(cipher.open("chats.cast_json", current.cast_json)))) !== JSON.stringify(cast)) throw new Error("Core creation cast changed after its committed birth");
  return { birth: value, cast };
}
export function requireCoreBirth(database: StageDatabase, cipher: CellCipher, target: CoreInvocationTarget, packageId: string) {
  const { birth, cast } = readCoreBirth(database, cipher, target.sceneId, target.takeId);
  if (birth.origin !== "extension" || birth.invocationId !== target.operationId || birth.packageId !== packageId) throw new Error("Core creation birth identity is damaged");
  return cast;
}
export function requireHostCoreBirth(database: StageDatabase, cipher: CellCipher, sceneId: string, takeId: string) {
  const result = readCoreBirth(database, cipher, sceneId, takeId);
  if (result.birth.origin !== "host") throw new Error("Core scene was not created through the host Core path");
  return result;
}
export function hostCoreBirthId(sceneId: string): string { return `host:create:${sceneId}`; }
export function hostCoreOperationBody(operationId: string) {
  return coreOperationBody.parse({ origin: "host", operationId, packageId: "host", packageDigest: "host", policyFingerprint: "host", grantRevision: 0,
    operation: "scenes.create", owner: "host", epoch: 0, accessHash: "host" });
}
export function coreInvocation(commit: ExtensionCommitContext, target: CoreInvocationTarget): CoreInvocation {
  const copy = Object.freeze(targetSchema.parse(target));
  if (!commit.invocationId || commit.invocationId !== copy.operationId) throw new Error("Core writes require the broker invocation identity");
  return Object.freeze({ commit: Object.freeze(snapshotExtensionCommit(commit)), target: copy });
}

export function coreRecordAuthority(database: StageDatabase, cipher: CellCipher) {
  const operation = (operationId: string): OperationRow | null => database.statement("SELECT * FROM core_operation_projections WHERE operation_hash = ?").get(cipher.index(operationId)) as OperationRow | null;
  const body = (row: OperationRow) => {
    const value = coreOperationBody.parse(JSON.parse(cipher.open("core_operation_projections.body_cell", row.body_cell)));
    if (cipher.index(value.operationId) !== row.operation_hash) throw new Error("Core operation identity is damaged");
    return value;
  };
  const projection = (row: OperationRow): CoreProjection => {
    const value = body(row);
    return { operationId: value.operationId, origin: value.origin, operation: value.operation, sessionId: row.session_id,
      sceneId: row.chat_id, takeId: row.branch_id, firstSeq: row.first_seq, lastSeq: row.last_seq, projectedSeq: row.projected_seq,
      linked: !!database.statement("SELECT 1 FROM core_scene_links WHERE session_id = ? AND chat_id = ? AND branch_id = ?").get(row.session_id, row.chat_id, row.branch_id) };
  };
  const expectedBody = ({ commit, target }: CoreInvocation) => coreOperationBody.parse({ origin: "extension", operationId: target.operationId, packageId: commit.packageId,
    packageDigest: commit.packageDigest, policyFingerprint: commit.policyFingerprint, grantRevision: commit.grantRevision,
    operation: commit.operation, owner: commit.owner, epoch: commit.epoch, accessHash: cipher.index(JSON.stringify(commit.access)) });
  const unlinkedBirth = (sceneId: string): { origin: "host" | "extension"; operationId: string; packageId?: string } | null => {
    const row = database.statement(`SELECT b.branch_id, b.body_cell FROM core_scene_creation_bindings b
      WHERE b.chat_id = ? AND NOT EXISTS (SELECT 1 FROM core_scene_links l WHERE l.chat_id = b.chat_id)`).get(sceneId) as
      { branch_id: string; body_cell: string } | null;
    if (!row) return null;
    const birth = birthSchema.parse(JSON.parse(cipher.open("core_scene_creation_bindings.body_cell", row.body_cell)));
    const checked = readCoreBirth(database, cipher, sceneId, row.branch_id).birth;
    if (checked.origin !== birth.origin || checked.invocationId !== birth.invocationId) throw new Error("Core scene birth identity is damaged");
    return birth.origin === "extension" ? { origin: birth.origin, operationId: birth.invocationId, packageId: birth.packageId } : { origin: birth.origin, operationId: birth.invocationId };
  };
  const unlinkedBirthForBranch = (branchId: string): { sceneId: string; origin: "host" | "extension"; operationId: string; packageId?: string } | null => {
    const row = database.statement(`SELECT b.chat_id FROM core_scene_creation_bindings b WHERE b.branch_id = ?
      AND NOT EXISTS (SELECT 1 FROM core_scene_links l WHERE l.chat_id = b.chat_id)`).get(branchId) as { chat_id: string } | null;
    const birth = row ? unlinkedBirth(row.chat_id) : null;
    return row && birth ? { sceneId: row.chat_id, ...birth } : null;
  };
  const authorize = (scope: CoreInvocation, sessionId: string, creating = false): void => {
    const { commit, target } = scope;
    requireExtensionCommit(database, cipher, commit);
    const branch = database.statement("SELECT b.chat_id, b.deleted_at, c.active_branch_id, c.cast_json, c.deleted_at AS chat_deleted FROM branches b JOIN chats c ON c.id = b.chat_id WHERE b.id = ?").get(target.takeId) as
      { chat_id: string; deleted_at: number | null; active_branch_id: string; cast_json: string; chat_deleted: number | null } | null;
    if (!branch || branch.chat_id !== target.sceneId || branch.deleted_at !== null || branch.chat_deleted !== null || branch.active_branch_id !== target.takeId) throw new Error("Core invocation target is not the active scene take");
    const row = operation(target.operationId);
    if (!row && !creating && target.expectedJournalSeq !== undefined) {
      const last = database.statement("SELECT COALESCE(MAX(seq), 0) AS n FROM core_entries WHERE session_id = ?").get(sessionId) as { n: number };
      if (last.n !== target.expectedJournalSeq) throw new Error("Core journal changed after the reviewed invocation snapshot");
    }
    if (row && (row.session_id !== sessionId || row.chat_id !== target.sceneId || row.branch_id !== target.takeId || JSON.stringify(body(row)) !== JSON.stringify(expectedBody(scope)))) throw new Error("Core invocation identity was already bound to another operation");
    if (target.sessionId === null) {
      if (commit.operation !== "scenes.create") throw new Error("Core creation requires the scene creation operation");
      const cast = requireCoreBirth(database, cipher, target, commit.packageId);
      requireCommitResource(commit, { kind: "character", id: cast.character.id }, ["scene.create"]);
      if (cast.persona) requireCommitResource(commit, { kind: "persona", id: cast.persona.id });
      if (!creating && !row) throw new Error("Core creation has not committed a session binding");
      if (creating && (row || database.statement("SELECT 1 FROM core_scene_links WHERE chat_id = ?").get(target.sceneId) || database.statement("SELECT 1 FROM messages WHERE branch_id = ?").get(target.takeId))) throw new Error("Core creation requires a new unlinked scene");
    } else {
      const turn = commit.operation === "turns.start" || commit.operation === "turns.continue" || commit.operation === "turns.regenerate";
      const send = commit.operation === "messages.send";
      const edit = commit.operation === "messages.edit.apply";
      if (!turn && !send && !edit) throw new Error("This extension operation cannot write the RP-Core journal");
      requireCommitResource(commit, { kind: "scene", id: target.sceneId }, turn ? ["turn.run", "model.prompt"] : edit ? ["message.seq", "message.id", "message.content"] : ["message.content"]);
      if (send || edit) requireCommitResource(commit, { kind: "take", id: target.takeId });
      if (turn && !commit.access.resources.some((resource) => resource.kind === "host-connection")) throw new Error("Core turns require the reviewed host connection");
      const linked = database.statement("SELECT 1 FROM core_scene_links WHERE chat_id = ? AND branch_id = ? AND session_id = ?").get(target.sceneId, target.takeId, sessionId);
      if (creating || target.sessionId !== sessionId || !linked) throw new Error("Core invocation is outside its persisted session link");
    }
  };
  const acceptedHostCreation = (sceneId: string, takeId: string, sessionId: string, firstSeq: number, lastSeq: number): void => {
    const { birth } = requireHostCoreBirth(database, cipher, sceneId, takeId);
    const branch = database.statement("SELECT b.chat_id, b.deleted_at, c.active_branch_id, c.deleted_at AS chat_deleted FROM branches b JOIN chats c ON c.id = b.chat_id WHERE b.id = ?").get(takeId) as
      { chat_id: string; deleted_at: number | null; active_branch_id: string; chat_deleted: number | null } | null;
    if (!branch || branch.chat_id !== sceneId || branch.deleted_at !== null || branch.chat_deleted !== null || branch.active_branch_id !== takeId
      || database.statement("SELECT 1 FROM core_scene_links WHERE chat_id = ?").get(sceneId)) throw new Error("Host Core creation target is no longer a new active scene");
    const operationId = birth.invocationId;
    database.statement("INSERT INTO core_operation_projections (operation_hash, session_id, chat_id, branch_id, first_seq, last_seq, projected_seq, body_cell) VALUES (?, ?, ?, ?, ?, ?, 0, ?)").run(
      cipher.index(operationId), sessionId, sceneId, takeId, firstSeq, lastSeq, cipher.seal("core_operation_projections.body_cell", JSON.stringify(hostCoreOperationBody(operationId))));
    database.statement("INSERT INTO core_scene_links (chat_id, session_id, branch_id) VALUES (?, ?, ?)").run(sceneId, sessionId, takeId);
  };
  const accepted = (scope: CoreInvocation, sessionId: string, firstSeq: number, lastSeq: number): void => {
    const row = operation(scope.target.operationId);
    if (row) {
      if (row.last_seq !== firstSeq - 1 && lastSeq !== 0) throw new Error("Core operation journal ranges cannot interleave");
      database.statement("UPDATE core_operation_projections SET first_seq = CASE WHEN last_seq = 0 THEN ? ELSE first_seq END, last_seq = ? WHERE operation_hash = ?").run(firstSeq, lastSeq, row.operation_hash);
    } else database.statement("INSERT INTO core_operation_projections (operation_hash, session_id, chat_id, branch_id, first_seq, last_seq, projected_seq, body_cell) VALUES (?, ?, ?, ?, ?, ?, 0, ?)").run(
      cipher.index(scope.target.operationId), sessionId, scope.target.sceneId, scope.target.takeId, firstSeq, lastSeq,
      cipher.seal("core_operation_projections.body_cell", JSON.stringify(expectedBody(scope))));
  };
  return { operation, body, projection, authorize, accepted, acceptedHostCreation, unlinkedBirth, unlinkedBirthForBranch };
}
