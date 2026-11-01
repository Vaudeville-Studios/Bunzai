/**
 * The snapshot jobs the background lane runs on its own connection (maintenance-worker.ts): write a
 * clean copy of the library, compare a snapshot with the library as it is
 * now, and restore one in a single transaction. Every table is classified here, and an unclassified
 * one stops a restore: a table added by a later migration must be a deliberate choice, never copied
 * or kept by accident.
 */
import { Database } from "bun:sqlite";
import { copyFileSync } from "node:fs";
import { openStageDatabase } from "./database";
import { MIGRATIONS } from "./migrations";

/** Rows that describe who can unlock this library or what it is doing now: a restore never changes them. */
export const KEEP_TABLES = ["_migrations", "keyring", "devices", "lock_settings", "maintenance", "library_meta", "derived_usage", "extension_runtime_lease", "sqlite_stat1", "sqlite_sequence"] as const;
/** Rebuildable caches: emptied by a restore, since they describe content that just changed. */
export const CLEARED_TABLES = ["derived_rows"] as const;
/** The change journal: emptied and its sequence skipped, so every follower sees a gap and reloads. */
export const JOURNAL_TABLE = "piece_changes";
/** Everything a person wrote or collected: replaced whole by a restore. */
export const CONTENT_TABLES = [
  "blob_refs", "blobs", "branch_base", "branch_state", "branch_variables", "branches", "chats", "compendium_receipts", "compendium_trees", "core_entries", "core_scene_links", "core_sessions", "director_states", "document_graves", "document_summaries", "document_versions",
  "extension_budget_reservations", "extension_budget_usage", "extension_controls", "extension_data", "extension_logs", "extension_packages", "extension_receipts",
  "core_scene_creation_bindings", "core_operation_projections", "core_message_links",
  "core_pending_extension_state",
  "documents", "dramaturg_threads", "grave_summaries", "grave_versions", "kit_sessions", "legacy_document_graves_v17", "legacy_document_summaries_v17",
  "legacy_document_versions_v17", "legacy_documents_v17", "legacy_grave_summaries_v17", "legacy_grave_versions_v17", "message_deltas", "messages",
  "persona_stats",
  "piece_parts", "retired_ids", "scene_folders", "set_aside", "state_keyframes", "studio_state", "swipe_deltas", "swipe_history", "swipe_traces", "swipes", "turn_checkpoints",
] as const;

/**
 * The health check's fingerprints travel with the content they describe,
 * copied after it: the content tables' own triggers queue and drop fingerprint rows while they are
 * replaced, so these two are replaced last, as the snapshot had them (a consistent pair, since one
 * read made both). A snapshot older than the health check has none, and its rows are "not yet
 * covered" until a scan adopts them, never damage. `fp_dirty` is the queue of rows whose fingerprint
 * is stale: the store's afterRestore step drains it inside a normal transaction, which re-signs them.
 */
export const FINGERPRINT_TABLES = ["row_fingerprints", "fp_dirty"] as const;

export type SchemaRelation = "same" | "older" | "different";
export interface Diff { now: number; inSnapshot: number; onlyNow: number; onlySnapshot: number; changed: number }
export interface Inspection {
  schema: SchemaRelation;
  chats: Diff;
  cards: Diff;
  messages: Diff;
  otherPieces: Diff;
  /** A few sealed cells, for the caller to open with the current key (is this snapshot from this library?). */
  probes: { where: string; cell: string }[];
}

const q = (name: string) => `"${name.replace(/"/g, '""')}"`;
/** Every query is prepared and finalized here: a statement left open keeps a read lock and fails the close. */
const rows = <T>(db: Database, sql: string): T[] => {
  const statement = db.prepare(sql);
  try {
    return statement.all() as T[];
  } finally {
    statement.finalize();
  }
};
const count = (db: Database, sql: string): number => rows<{ n: number }>(db, sql)[0]!.n;

/** Copies the library into `dest` (a file that does not exist yet) and takes this computer's key copies out of it. */
export function writeSnapshot(livePath: string, dest: string): void {
  const src = new Database(livePath, { strict: true });
  try {
    src.run("PRAGMA busy_timeout = 30000");
    // VACUUM INTO writes one consistent copy from a read transaction, so the app keeps writing meanwhile.
    src.run("VACUUM INTO ?", [dest]);
  } finally {
    src.close(true);
  }
  const out = new Database(dest, { strict: true });
  try {
    out.run("PRAGMA journal_mode = DELETE");
    out.run("PRAGMA secure_delete = ON");
    // Rule 16: a backup carries the recovery copy (and the password copy) but never a computer's copy.
    out.run("DELETE FROM devices");
    const check = rows<{ integrity_check: string }>(out, "PRAGMA integrity_check");
    if (check.length !== 1 || check[0]!.integrity_check !== "ok") throw new Error("the snapshot failed its integrity check");
  } finally {
    out.close(true);
  }
}

const migrationsOf = (db: Database, schema: string): string[] =>
  rows<{ id: number; name: string }>(db, `SELECT id, name FROM ${schema}._migrations ORDER BY id`).map((m) => `${m.id}:${m.name}`);

/** "same", or "older" when the snapshot's migrations are exactly the first ones of this library's. */
function relation(db: Database): SchemaRelation {
  const live = migrationsOf(db, "main");
  const snap = migrationsOf(db, "snap");
  if (snap.length === live.length && snap.every((m, i) => m === live[i])) return "same";
  return snap.length < live.length && snap.every((m, i) => m === live[i]) ? "older" : "different";
}

/** `where` filters rows, `changedWhen` compares a row here (x) with its twin there (y) by `keys`. */
function diff(db: Database, table: string, keys: string[], where: string, changedWhen: string): Diff {
  const same = keys.map((k) => `y.${k} = x.${k}`).join(" AND ");
  const rows = (side: "main" | "snap") => count(db, `SELECT count(*) AS n FROM ${side}.${table} x WHERE ${where}`);
  const only = (a: "main" | "snap", b: "main" | "snap") =>
    count(db, `SELECT count(*) AS n FROM ${a}.${table} x WHERE ${where} AND NOT EXISTS (SELECT 1 FROM ${b}.${table} y WHERE ${same})`);
  return {
    now: rows("main"),
    inSnapshot: rows("snap"),
    onlyNow: only("main", "snap"),
    onlySnapshot: only("snap", "main"),
    changed: count(db, `SELECT count(*) AS n FROM main.${table} x JOIN snap.${table} y ON ${same} WHERE ${where} AND (${changedWhen})`),
  };
}

const NOT_A_SNAPSHOT = "this file is not a Bunzai snapshot, or it is damaged";
/** Attaches a snapshot as `snap`; a file that is no database is a plain refusal, not SQLite's own words. */
function attachSnap(db: Database, file: string): void {
  try {
    db.run("ATTACH DATABASE ? AS snap", [file]);
    db.query("SELECT count(*) FROM snap.sqlite_master").get();
  } catch {
    throw new Error(NOT_A_SNAPSHOT);
  }
}
/** The tables a comparison reads; every content table besides must be there before a same-version restore copies it. */
const COMPARED = ["documents", "chats", "messages", "swipes"] as const;

/**
 * How the attached `snap` relates to this build, or a plain sentence when it lacks tables the SQL below would only fail on with a
 * raw error: this build's every content table when the versions match, the ones a comparison reads when it is older.
 */
function checkedRelation(db: Database): SchemaRelation {
  const have = (): Set<string> => new Set(rows<{ name: string }>(db, "SELECT name FROM snap.sqlite_master WHERE type = 'table'").map((t) => t.name));
  const lacking = (need: readonly string[]): void => {
    const missing = need.filter((t) => !have().has(t));
    if (missing.length > 0) throw new Error(`it is missing parts of the library (${missing.join(", ")}), so it cannot be compared or restored`);
  };
  lacking(["_migrations"]);
  const schema = relation(db);
  lacking(schema === "same" ? CONTENT_TABLES : COMPARED);
  return schema;
}

/** How many chats, cards, and messages differ between the snapshot and the library now. Reads only. */
export function inspectSnapshot(livePath: string, snapshot: string): Inspection {
  const db = new Database(livePath, { strict: true, readonly: true });
  try {
    db.run("PRAGMA busy_timeout = 30000");
    attachSnap(db, snapshot);
    const snapCheck = rows<{ integrity_check: string }>(db, "PRAGMA snap.integrity_check");
    if (snapCheck.length !== 1 || snapCheck[0]!.integrity_check !== "ok") throw new Error("the snapshot is damaged (it failed its integrity check)");

    // A message is "changed" when any of its takes (swipes) is missing or different on the other side.
    const edited = (a: string, b: string) =>
      `EXISTS (SELECT 1 FROM ${a}.swipes s WHERE s.message_id = x.id AND NOT EXISTS (SELECT 1 FROM ${b}.swipes t WHERE t.message_id = s.message_id AND t.position = s.position AND t.content = s.content))`;
    const schema = checkedRelation(db);
    const cell = (sql: string, where: string) => rows<{ cell: string }>(db, sql).map((r) => ({ where, cell: r.cell }));
    return {
      schema,
      chats: diff(db, "chats", ["id"], "x.deleted_at IS NULL", "x.updated_at <> y.updated_at OR x.title <> y.title"),
      cards: diff(db, "documents", ["kind", "id"], "x.kind = 'character'", "x.version <> y.version OR x.revision <> y.revision"),
      messages: diff(db, "messages", ["id"], "1", `${edited("main", "snap")} OR ${edited("snap", "main")}`),
      otherPieces: diff(db, "documents", ["kind", "id"], "x.kind <> 'character'", "x.version <> y.version OR x.revision <> y.revision"),
      probes: [
        // The one cell every snapshot made since it was introduced carries: a sealed marker, so an empty library can be checked too.
        ...cell("SELECT value AS cell FROM snap.library_meta WHERE key = 'key_check'", "library_meta.key_check"),
        ...cell("SELECT id_cell AS cell FROM snap.documents LIMIT 2", "documents.id_cell"),
        ...cell("SELECT title AS cell FROM snap.chats LIMIT 2", "chats.title"),
      ],
    };
  } finally {
    db.close(true);
  }
}

/**
 * Replaces everything the person wrote with the snapshot's, in ONE transaction: any failure, or a
 * crash, leaves the library exactly as it was. `work` is a scratch path for migrating an older snapshot
 * up to this build's schema (the snapshot itself is never touched).
 */
export function restoreSnapshot(livePath: string, snapshot: string, work: string): void {
  let source = snapshot;
  const probe = new Database(livePath, { strict: true, readonly: true });
  let schema: SchemaRelation;
  try {
    attachSnap(probe, snapshot);
    schema = checkedRelation(probe);
  } finally {
    probe.close(true);
  }
  if (schema === "different") throw new Error("this snapshot was made by a different version of Bunzai and cannot be restored here");
  if (schema === "older") {
    copyFileSync(snapshot, work);
    openStageDatabase(work, MIGRATIONS).close();
    source = work;
  }
  const check = new Database(source, { strict: true, readonly: true });
  try {
    check.run("ATTACH DATABASE ? AS snap", [source]);
    checkedRelation(check); // the (migrated) copy must now have every table the restore copies
  } finally {
    check.close(true);
  }
  const db = new Database(livePath, { strict: true });
  try {
    db.run("PRAGMA busy_timeout = 30000");
    db.run("PRAGMA secure_delete = ON");
    db.run("PRAGMA foreign_keys = OFF"); // checked as a whole before the commit instead
    db.run("ATTACH DATABASE ? AS snap", [source]);
    const tables = rows<{ name: string }>(db, "SELECT name FROM main.sqlite_master WHERE type = 'table'").map((t) => t.name);
    const known = new Set<string>([...KEEP_TABLES, ...CLEARED_TABLES, JOURNAL_TABLE, ...CONTENT_TABLES, ...FINGERPRINT_TABLES]);
    const stray = tables.filter((t) => !known.has(t));
    if (stray.length > 0) throw new Error(`the restore does not know the table ${stray.join(", ")} and stopped before changing anything`);
    db.run("BEGIN IMMEDIATE");
    try {
      for (const table of [...CONTENT_TABLES, ...FINGERPRINT_TABLES].filter((t) => tables.includes(t))) {
        const cols = rows<{ name: string }>(db, `PRAGMA main.table_info(${q(table)})`).map((c) => q(c.name)).join(", ");
        db.run(`DELETE FROM main.${q(table)}`);
        db.run(`INSERT INTO main.${q(table)} (${cols}) SELECT ${cols} FROM snap.${q(table)}`);
      }
      db.run("DELETE FROM main.derived_rows");
      // The journal's sequence skips ahead past anything a follower already holds, so each one sees a gap
      // and reloads instead of silently missing the restore (piece-change-journal.ts readPieceChanges).
      db.run(`DELETE FROM main.${JOURNAL_TABLE}`);
      db.run(`UPDATE main.sqlite_sequence SET seq = seq + 2 WHERE name = '${JOURNAL_TABLE}'`);
      const broken = rows(db, "PRAGMA main.foreign_key_check");
      if (broken.length > 0) throw new Error("the snapshot has broken references, so nothing was restored");
      db.run("COMMIT");
    } catch (error) {
      if (db.inTransaction) db.run("ROLLBACK");
      throw error;
    }
  } finally {
    db.close(true);
  }
}
