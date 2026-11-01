/**
 * Row fingerprints: a keyed hash of each covered row,
 * kept in `row_fingerprints` and re-made inside the transaction that changed the row. Migration 24's
 * triggers queue changed rows in `fp_dirty`; `attachRowFingerprints` registers the step that drains
 * the queue right before the outermost COMMIT. A cell contributes only its first 43 characters (`e1:`
 * plus the base64 of the IV and the GCM tag): the tag authenticates the whole ciphertext, so the cost
 * never depends on a cell's size. Rows are addressed by the JSON array of their declared primary key
 * (SQLite's own `json_array`, never rebuilt in JavaScript), never by rowid.
 */
import type { Statement } from "bun:sqlite";
import type { CellCipher } from "../../crypto/cell-cipher";
import { LockedError } from "../../crypto/keyring-errors";
import type { StageDatabase } from "./database";

export interface FpSpec {
  readonly table: string;
  /** Bump when `plain` or `cells` change: older fingerprints are then adopted, not flagged. */
  readonly v: number;
  readonly key: readonly string[];
  readonly plain: readonly string[];
  /** Columns that may hold sealed cells; only their IV and tag are hashed. */
  readonly cells: readonly string[];
}

const s = (table: string, key: string[], cells: string[], plain: string[], v = 1): FpSpec => ({ table, v, key, cells, plain });
const VERSION_PLAIN = ["saved_at", "reason", "autosave_started_at"];
const GRAVE_PLAIN = ["kind", "id", "version", "created_at", "updated_at", "deleted_at", "write_id", "autosave_started_at"];

export const FP_SPECS: readonly FpSpec[] = [
  s("documents", ["kind", "id"], ["id_cell", "revision"], ["version", "created_at", "updated_at", "write_id", "autosave_started_at"]),
  s("document_versions", ["kind", "id", "version"], ["revision"], VERSION_PLAIN),
  s("document_graves", ["grave_id"], ["id_cell", "revision"], GRAVE_PLAIN),
  s("grave_versions", ["grave_id", "version"], ["revision"], VERSION_PLAIN),
  s("document_summaries", ["kind", "id"], ["summary_cell", "revision_cell"], ["derived_version", "updated_at"]),
  s("grave_summaries", ["grave_id"], ["summary_cell", "revision_cell"], ["derived_version", "updated_at"]),
  s("piece_parts", ["id"], ["cell"], ["kind", "doc", "part", "from_version", "to_version"]),
  s("blobs", ["key"], ["cell"], ["bytes"]),
  s(
    "chats", ["id"],
    ["title", "cast_json", "cast_snapshot_json", "previous_cast_json", "previous_snapshot_json", "connection_json", "preset_json", "lore_json", "props_json", "opening_json", "prompting_json", "backdrop_json", "compendium_json", "participants_json", "regex_json", "trackers_json", "final_cut_json", "summary_json", "director_json"],
    ["character_id", "active_branch_id", "created_at", "updated_at", "deleted_at", "favored_at", "folder_id", "snapshot_version", "variant_id", "stats_state", "import_key"],
    13, // v13: director_json (migration 42); v12: summary_json (migration 41); v11: final_cut_json (migration 40); v10: trackers_json (migration 39); v9: regex_json (migration 38); v8: participants_json (migration 37); v7: compendium_json (migration 34); v6: backdrop_json (migration 33); v5: prompting_json (migration 32); v4: opening_json (migration 31); v3: import_key (migration 30); v2: the Cast wing's variant_id and stats_state (migrations 25 and 26); an older fingerprint is adopted, not flagged
  ),
  s("branches", ["id"], ["name", "last_request_json"], ["chat_id", "parent_branch_id", "fork_message_id", "fork_swipe_id", "created_at", "version", "deleted_at"]),
  s("messages", ["id"], ["persona_json"], ["branch_id", "seq", "role", "current_swipe", "created_at", "cut_id", "cut_at", "cut_scope", "cut_tail", "hidden"], 3), // v3: hidden (migration 27); v2: persona_json, the persona stamp (migration 25)
  s("swipes", ["message_id", "position"], ["content", "generation_json"], ["swipe_id", "created_at", "pinned", "cut_at"], 2), // v2: cut_at (migration 29)
  s("swipe_history", ["message_id", "swipe_id", "n"], ["content"], []),
  s("swipe_traces", ["message_id", "position"], ["trace_json"], []),
  s("director_states", ["message_id", "position"], ["cell"], ["version"]),
  s("turn_checkpoints", ["id"], ["content", "trace_json", "provider_request_id", "deltas_json", "extension_owner_json"], ["branch_id", "kind", "message_id", "base_version", "started_at", "saved_at"], 3), // v3: extension_owner_json (migration 51); v2: deltas_json (migration 43)
  s("swipe_deltas", ["swipe_id", "seq"], ["path_json", "value_json"], ["slot", "removed", "at"]),
  s("message_deltas", ["message_id", "seq"], ["path_json", "value_json"], ["slot", "removed", "at", "swipe_id"], 2), // v2: swipe_id (migration 44)
  s("state_keyframes", ["branch_id", "message_id"], ["state_json"], []),
  s("branch_base", ["branch_id"], ["state_json"], []),
  s("branch_state", ["branch_id"], ["state_json"], ["tip_message_id", "tip_swipe_id"]),
  s("branch_variables", ["branch_id"], ["variables_json"], []),
  s("scene_folders", ["id"], ["name"], ["created_at"]),
  s("extension_packages", ["digest"], ["body_cell"], ["bytes"]),
  s("extension_controls", ["id_hash"], ["body_cell"], ["revision"]),
  s("extension_data", ["package_hash", "key_hash"], ["body_cell"], ["revision", "bytes"]),
  s("extension_receipts", ["seq"], ["body_cell"], ["package_hash", "receipt_hash"]),
  s("extension_logs", ["seq"], ["body_cell"], ["package_hash", "log_hash"]),
  s("extension_budget_usage", ["package_hash", "operation_hash", "grant_revision"], ["body_cell"], []),
  s("extension_budget_reservations", ["reservation_hash"], ["body_cell"], ["package_hash"]),
  s("extension_runtime_lease", ["singleton"], ["owner_cell"], ["epoch", "expires_at", "last_now"]),
  s("core_scene_creation_bindings", ["chat_id"], ["body_cell"], ["branch_id", "operation_hash", "package_hash"]),
  s("core_operation_projections", ["operation_hash"], ["body_cell"], ["session_id", "chat_id", "branch_id", "first_seq", "last_seq", "projected_seq"]),
  s("core_message_links", ["session_id", "core_message_id", "branch_id"], [], ["message_id", "swipe_id", "swipe_position"]),
  s("core_pending_extension_state", ["state_hash"], ["body_cell"], ["turn_operation_hash", "turn_id", "session_id", "branch_id", "phase", "ordinal", "accepted_seq", "core_message_id", "bytes"]),
];

export const specOf = (table: string): FpSpec | undefined => FP_SPECS.find((spec) => spec.table === table);

const list = (columns: readonly string[]) => `json_array(${columns.join(", ")})`;
const facts = (columns: readonly string[]) =>
  `json_array(${columns.map((c) => `CASE WHEN ${c} IS NULL THEN NULL ELSE substr(${c}, 1, 43) END`).join(", ")})`;

/** The columns SQLite builds a row's fingerprint input from, as three JSON arrays. */
export const factsSql = (spec: FpSpec): string => `${list(spec.key)} AS rk, ${list(spec.plain)} AS pl, ${facts(spec.cells)} AS cl`;

export interface RowFacts {
  rk: string;
  pl: string;
  cl: string;
}

/** The keyed hash of one row's facts. */
export const fingerprintOf = (cipher: CellCipher, spec: FpSpec, f: RowFacts): string =>
  cipher.index(`${spec.table}\u0000${spec.v}\u0000${f.rk}\u0000${f.pl}\u0000${f.cl}`);

type Stmt = (sql: string) => Statement;

/** Facts of the row addressed by `rowKey` (its `json_array` text), or null when no such row exists. */
export function readFacts(statement: Stmt, spec: FpSpec, rowKey: string): RowFacts | null {
  const where = spec.key.map((c) => `${c} = ?`).join(" AND ");
  const row = statement(`SELECT ${factsSql(spec)} FROM ${spec.table} WHERE ${where}`).get(...(JSON.parse(rowKey) as (string | number)[]));
  return (row as RowFacts | null) ?? null;
}

/** Signs (or re-signs) the row at `rowKey`, or drops its fingerprint when the row is gone. */
export function signRow(statement: Stmt, cipher: CellCipher, spec: FpSpec, rowKey: string): void {
  const facts = readFacts(statement, spec, rowKey);
  if (!facts) {
    statement("DELETE FROM row_fingerprints WHERE tbl = ? AND row_key = ?").run(spec.table, rowKey);
    return;
  }
  statement(
    `INSERT INTO row_fingerprints (tbl, row_key, v, fp) VALUES (?, ?, ?, ?)
     ON CONFLICT (tbl, row_key) DO UPDATE SET v = excluded.v, fp = excluded.fp`,
  ).run(spec.table, facts.rk, spec.v, fingerprintOf(cipher, spec, facts));
}

/** Drains `fp_dirty`. A no-op, touching no key, when the queue is empty or the cipher is locked. */
function drain(statement: Stmt, cipher: CellCipher): void {
  const dirty = statement("SELECT tbl, row_key FROM fp_dirty").all() as { tbl: string; row_key: string }[];
  if (dirty.length === 0) return;
  try {
    cipher.ready();
  } catch (error) {
    // A migration's own writes (run before any key exists) or a locked store: left queued for the
    // next unlocked transaction rather than failing keyring work.
    if (error instanceof LockedError) return;
    throw error;
  }
  for (const { tbl, row_key } of dirty) {
    const spec = specOf(tbl);
    if (spec) signRow(statement, cipher, spec, row_key);
  }
  statement("DELETE FROM fp_dirty").run();
}

/** Makes every outermost transaction on `database` sign the rows it changed, with `cipher`'s keys. */
export function attachRowFingerprints(database: StageDatabase, cipher: CellCipher): void {
  database.setCommitSeal(() => drain(database.statement, cipher));
}
