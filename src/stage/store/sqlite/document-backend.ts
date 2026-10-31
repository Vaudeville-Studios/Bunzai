/**
 * The SQLite DocumentBackend. It never parses a body (D18 rule 1). Every method but the three
 * listings is one transaction (the listings read in pages, so they never freeze the app), and every
 * condition is part of the SQL that acts on it (a WHERE clause, a conflict clause), so no decision is
 * ever made on a row read earlier. Tables are migrations 6, 8, 17, and 18 (migrations.ts): live rows
 * in `documents`, deleted ones in `document_graves`, each with its versions, every id ever deleted in
 * `retired_ids` so no id is ever reused (spec behavior 10), each row's derived summary in
 * `document_summaries` / `grave_summaries`, and since
 * migration 18 a piece's body itself in `piece_parts`: a head row plus named item and escrow rows, each with a version range, instead of
 * one whole `body_json` cell. Since migration 19 a part's
 * large media and escrow strings live once each in the global `blobs` table, linked by `blob_refs`,
 * never duplicated into the part cell itself. `piece-parts-sql.ts` owns both tables' SQL (`blob-sql.ts`
 * owns `blobs`' own CRUD underneath it); this file calls it inside the SAME transaction as the row,
 * version, and summary it belongs beside.
 *
 * Encrypted at rest: the `id` column holds a keyed hash of the entity's
 * kind and folded id, because library ids are made from names (`vera-the-bard`) and would show them
 * on disk. The real id is kept sealed beside it. A grave keeps the cells exactly as they were sealed
 * for the live row, so burying and restoring move them in SQL without opening anything; graves are
 * therefore opened with the live columns' labels. `piece_parts` rows are keyed by the same `doc` value
 * as `documents.id`, and bury moves no part rows (encryption rule 12 allows a cell to be copied
 * between rows: the authenticated data binds table and column, not row), so a piece's history and a
 * buried piece's parts both stay reachable by that one unmoving key.
 */
import {
  foldId,
  type DocumentBackend,
  type DocumentRow,
  type DocumentVersionRow,
  type GraveRow,
  type GraveSummaryRow,
  type PartChange,
  type SummaryInput,
  type SummaryRow,
  type VersionRow,
} from "../../contracts/content-store";
import { compareDocumentOrder } from "../../contracts/document-order";
import { DamagedDataError } from "../../damaged-data-error";
import { refuseWhileLocked, type CellCipher } from "../../crypto/cell-cipher";
import { blobCounts } from "./blob-sql";
import { pagedQuarantined, PAGE, splitVersionQuarantine } from "./document-backend-quarantine";
import { documentMoveMethods } from "./document-backend-moves";
import { applyPartChange, keyIsBuried, pruneOrphanParts, purgePartsForGraves } from "./piece-parts-sql";
import { documentPartReads } from "./document-backend-parts";
import { appendPieceChange, onePieceSummary, readPieceChanges } from "./piece-change-journal";
import type { StageDatabase } from "./database";
import { attachRowFingerprints } from "./row-fingerprints";
import { requireExtensionCommit } from "./extension-commit-guard";

interface DocumentSql {
  kind: string;
  id: string;
  id_cell: string;
  revision: string;
  version: number;
  write_id: number;
  autosave_started_at: number | null;
  created_at: number;
  updated_at: number;
}
interface GraveSql extends DocumentSql {
  grave_id: string;
  deleted_at: number;
}
interface VersionSql {
  version: number;
  revision: string;
  saved_at: number;
  reason: VersionRow["reason"];
  autosave_started_at: number | null;
}
interface SummarySql {
  kind: string;
  id: string;
  id_cell: string;
  document_revision: string;
  version: number;
  write_id: number;
  summary_cell: string | null;
  revision_cell: string | null;
  derived_version: string | null;
  updated_at: number;
}
interface DocumentVersionSql {
  kind: string;
  id: string;
  id_cell: string;
  version: number;
  write_id: number;
}
interface GraveSummarySql {
  grave_id: string;
  kind: string;
  id: string;
  id_cell: string;
  summary_cell: string | null;
  revision_cell: string | null;
  derived_version: string | null;
  deleted_at: number;
}

  const COLUMNS = "kind, id, id_cell, revision, version, write_id, autosave_started_at, created_at, updated_at";

export function sqliteDocumentBackend(database: StageDatabase, cipher: CellCipher): DocumentBackend {
  const { statement, transaction } = database;
  attachRowFingerprints(database, cipher);
  /** The stored key for one entity: equal for equal kind and id in any spelling, and unreadable. Also
   * `piece_parts.doc`'s own value for the same piece (migration 18's schema comment). */
  const key = (kind: string, id: string) => cipher.index(`${kind}\u0000${foldId(id)}`);
  const moves = documentMoveMethods(database, cipher, key, COLUMNS);

  const toRow = (r: DocumentSql): DocumentRow => {
    const id = cipher.open("documents.id_cell", r.id_cell);
    // The opened id must hash to the row's key: a sealed id copied onto another row, which the
    // column-bound seal alone cannot catch, is caught here (the encryption review's finding).
    if (key(r.kind, id) !== r.id) throw new DamagedDataError("documents.id_cell", "the id does not belong to this row");
    return {
      kind: r.kind,
      id,
      revision: cipher.open("documents.revision", r.revision),
      version: r.version,
      writeId: r.write_id,
      autosaveStartedAt: r.autosave_started_at,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  };
  const toGrave = (r: GraveSql): GraveRow => ({ ...toRow(r), graveId: r.grave_id, deletedAt: r.deleted_at });
  const toSummary = (r: SummarySql): SummaryRow => {
    const id = cipher.open("documents.id_cell", r.id_cell);
    if (key(r.kind, id) !== r.id) throw new DamagedDataError("documents.id_cell", "the id does not belong to this row");
    return {
      kind: r.kind,
      id,
      liveRevision: cipher.open("documents.revision", r.document_revision),
      version: r.version,
      writeId: r.write_id,
      summary: r.summary_cell ? cipher.open("document_summaries.summary_cell", r.summary_cell) : null,
      revision: r.revision_cell ? cipher.open("document_summaries.revision_cell", r.revision_cell) : null,
      derivedVersion: r.derived_version,
      updatedAt: r.updated_at,
    };
  };
  const toDocumentVersion = (r: DocumentVersionSql): DocumentVersionRow => {
    const id = cipher.open("documents.id_cell", r.id_cell);
    if (key(r.kind, id) !== r.id) throw new DamagedDataError("documents.id_cell", "the id does not belong to this row");
    return { kind: r.kind, id, version: r.version, writeId: r.write_id };
  };
  const toGraveSummary = (r: GraveSummarySql): GraveSummaryRow => {
    const id = cipher.open("documents.id_cell", r.id_cell);
    if (key(r.kind, id) !== r.id) throw new DamagedDataError("documents.id_cell", "the id does not belong to this row");
    return {
      graveId: r.grave_id,
      kind: r.kind,
      id,
      summary: r.summary_cell ? cipher.open("document_summaries.summary_cell", r.summary_cell) : null,
      revision: r.revision_cell ? cipher.open("document_summaries.revision_cell", r.revision_cell) : null,
      derivedVersion: r.derived_version,
      deletedAt: r.deleted_at,
    };
  };
  const rowValues = (r: DocumentRow) =>
    [r.kind, key(r.kind, r.id), cipher.seal("documents.id_cell", r.id), cipher.seal("documents.revision", r.revision), r.version, r.writeId, r.autosaveStartedAt, r.createdAt, r.updatedAt] as const;
  const insertVersion = (version: VersionRow, onConflict = ""): void => {
    statement(`INSERT INTO document_versions (kind, id, version, revision, saved_at, reason, autosave_started_at) VALUES (?, ?, ?, ?, ?, ?, ?) ${onConflict}`).run(
      version.kind,
      key(version.kind, version.id),
      version.version,
      cipher.seal("document_versions.revision", version.revision),
      version.savedAt,
      version.reason,
      version.autosaveStartedAt,
    );
  };
  /**
   * One document_summaries row per document, kept in sync by every write (never left absent, so
   * "missing" always means damage, not an untouched row). `summary` null seals nothing: it records
   * "not computed yet" for the D2 rebuild step to find.
   */
  const upsertSummary = (kind: string, id: string, revision: string, updatedAt: number, summary: SummaryInput | null): void => {
    statement(
      `INSERT INTO document_summaries (kind, id, summary_cell, revision_cell, derived_version, updated_at) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (kind, id) DO UPDATE SET summary_cell = excluded.summary_cell, revision_cell = excluded.revision_cell,
         derived_version = excluded.derived_version, updated_at = excluded.updated_at`,
    ).run(
      kind,
      key(kind, id),
      summary ? cipher.seal("document_summaries.summary_cell", summary.text) : null,
      summary ? cipher.seal("document_summaries.revision_cell", revision) : null,
      summary?.derivedVersion ?? null,
      updatedAt,
    );
  };

  return refuseWhileLocked(cipher, {
    async get(kind, id) {
      const r = statement(`SELECT ${COLUMNS} FROM documents WHERE kind = ? AND id = ?`).get(kind, key(kind, id)) as DocumentSql | null;
      return r ? toRow(r) : null;
    },

    async summary(kind, id) {
      return onePieceSummary(database, cipher, kind, key(kind, id), key);
    },

    async pieceChanges(after, limit) {
      return readPieceChanges(database, cipher, key, after, limit);
    },

    async list(kind) {
      // Along the primary key, not the rowid, because a rebuild may renumber rowids between pages. A
      // write landing between pages is seen or not, but no row is listed twice.
      const { rows, quarantined } = await pagedQuarantined(
        { kind: "", id: "" },
        (after) =>
          (kind === undefined
            ? statement(`SELECT ${COLUMNS} FROM documents WHERE (kind, id) > (?, ?) ORDER BY kind, id LIMIT ${PAGE}`).all(after.kind, after.id)
            : statement(`SELECT ${COLUMNS} FROM documents WHERE kind = ? AND id > ? ORDER BY id LIMIT ${PAGE}`).all(kind, after.id)) as DocumentSql[],
        (r) => ({ kind: r.kind, id: r.id }),
        toRow,
      );
      // Stored keys are hashes, so order comes from the real ids once they are opened.
      return { rows: rows.sort(compareDocumentOrder), quarantined };
    },

    async write(row, version, condition, summary = null, change) {
      const values = rowValues(row);
      const docKey = values[1];
      return transaction(() => {
        if (condition.extensionCommit) requireExtensionCommit(database, cipher, condition.extensionCommit);
        if (condition.when === "writeId" && row.writeId !== condition.expected + 1) return false;
        if (condition.when === "writeId" && condition.valid && !condition.valid()) return false;
        if (condition.when === "always" && keyIsBuried(statement, row.kind, docKey)) return false;
        const current = condition.when === "writeId"
          ? statement("SELECT version, autosave_started_at FROM documents WHERE kind = ? AND id = ? AND write_id = ?").get(row.kind, docKey, condition.expected) as
              | { version: number; autosave_started_at: number | null }
              | null
          : null;
        const coalesce = version.reason === "autosave" && current !== null && current.version === row.version && current.autosave_started_at !== null &&
          current.autosave_started_at === row.autosaveStartedAt;
        let changed: number;
        switch (condition.when) {
          case "absent":
            changed = statement(
              `INSERT INTO documents (${COLUMNS}) SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?
               WHERE NOT EXISTS (SELECT 1 FROM retired_ids WHERE kind = ? AND id = ?) ON CONFLICT (kind, id) DO NOTHING`,
            ).run(...values, values[0], values[1]).changes;
            break;
          case "writeId":
            changed = statement(
              `UPDATE documents SET revision = ?, version = ?, write_id = ?, autosave_started_at = ?, created_at = ?, updated_at = ?
               WHERE kind = ? AND id = ? AND write_id = ?`,
            ).run(values[3], row.version, row.writeId, row.autosaveStartedAt, row.createdAt, row.updatedAt, row.kind, values[1], condition.expected).changes;
            break;
          case "always":
            changed = statement(
              `INSERT INTO documents (${COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
               ON CONFLICT (kind, id) DO UPDATE SET id_cell = excluded.id_cell, revision = excluded.revision,
                 version = excluded.version, write_id = excluded.write_id, autosave_started_at = excluded.autosave_started_at,
                 created_at = excluded.created_at, updated_at = excluded.updated_at`,
            ).run(...values).changes;
            break;
        }
        if (changed === 0) return false;
        // An autosave within its fixed window replaces its active version; always also replaces for repair.
        insertVersion(
          version,
          condition.when === "always" || coalesce
            ? "ON CONFLICT (kind, id, version) DO UPDATE SET revision = excluded.revision, saved_at = excluded.saved_at, reason = excluded.reason, autosave_started_at = excluded.autosave_started_at"
            : "",
        );
        applyPartChange(statement, cipher, row.kind, docKey, row.version, change, condition.when === "always", condition.when === "always" || coalesce);
        // Same transaction as the row: a summary can never be missing or stale relative to its row.
        upsertSummary(row.kind, row.id, row.revision, row.updatedAt, summary);
        appendPieceChange(database, cipher, key, { kind: row.kind, id: row.id, revision: row.revision, version: row.version, writeId: row.writeId, action: "upsert" });
        return true;
      });
    },

    ...documentPartReads({ database, cipher, key }),

    ...moves,

    async graves(kind) {
      // pagedQuarantined (rule 25), not the unguarded `paged` above: a grave's own identity cell
      // (`toGrave` -> `toRow`) can fail to open exactly like a live document's, and must not throw the
      // whole Trash listing away for every healthy grave beside it.
      return pagedQuarantined(
        "",
        (after) =>
          (kind === undefined
            ? statement(`SELECT grave_id, ${COLUMNS}, deleted_at FROM document_graves WHERE grave_id > ? ORDER BY grave_id LIMIT ${PAGE}`).all(after)
            : statement(`SELECT grave_id, ${COLUMNS}, deleted_at FROM document_graves WHERE kind = ? AND grave_id > ? ORDER BY grave_id LIMIT ${PAGE}`).all(kind, after)) as GraveSql[],
        (r) => r.grave_id,
        toGrave,
      );
    },

    async grave(graveId) {
      const r = statement(`SELECT grave_id, ${COLUMNS}, deleted_at FROM document_graves WHERE grave_id = ?`).get(graveId) as GraveSql | null;
      return r ? toGrave(r) : null;
    },

    async isRetired(kind, id) {
      return statement("SELECT 1 FROM retired_ids WHERE kind = ? AND id = ?").get(kind, key(kind, id)) !== null;
    },

    async versions(kind, id) {
      const sql = statement("SELECT version, revision, saved_at, reason, autosave_started_at FROM document_versions WHERE kind = ? AND id = ? ORDER BY version").all(
        kind,
        key(kind, id),
      ) as VersionSql[];
      return splitVersionQuarantine(
        (r) => ({
          kind,
          id,
          version: r.version,
          revision: cipher.open("document_versions.revision", r.revision),
          savedAt: r.saved_at,
          reason: r.reason,
          autosaveStartedAt: r.autosave_started_at,
        }),
        sql,
      );
    },

    async summaries(kind) {
      // Driven from `documents` with a LEFT JOIN, not an inner join from `document_summaries`: a live
      // document with no summary row at all (not merely an uncomputed placeholder) must still be
      // returned (spec rule 6, "damage is reported, never dropped" - review finding 2026-09-30), and
      // reads exactly like an uncomputed one (every summary column null). Never selects body_json
      // (the "never opens a body cell" gate).
      // COALESCE, not plain d.updated_at: document_summaries.updated_at is the summary's OWN
      // timestamp (rewriteSummary moves it independently of the row, document-summaries.sqlite.test.ts),
      // which the LEFT JOIN leaves null only for a row with no summary entry at all.
      const SUMMARY_COLUMNS =
        "d.kind, d.id, d.id_cell, d.revision AS document_revision, d.version, d.write_id, ds.summary_cell, ds.revision_cell, ds.derived_version, COALESCE(ds.updated_at, d.updated_at) AS updated_at";
      const { rows, quarantined } = await pagedQuarantined(
        { kind: "", id: "" },
        (after) =>
          (kind === undefined
            ? statement(
                `SELECT ${SUMMARY_COLUMNS} FROM documents d LEFT JOIN document_summaries ds ON ds.kind = d.kind AND ds.id = d.id
                 WHERE (d.kind, d.id) > (?, ?) ORDER BY d.kind, d.id LIMIT ${PAGE}`,
              ).all(after.kind, after.id)
            : statement(
                `SELECT ${SUMMARY_COLUMNS} FROM documents d LEFT JOIN document_summaries ds ON ds.kind = d.kind AND ds.id = d.id
                 WHERE d.kind = ? AND d.id > ? ORDER BY d.id LIMIT ${PAGE}`,
              ).all(kind, after.id)) as SummarySql[],
        (r) => ({ kind: r.kind, id: r.id }),
        toSummary,
      );
      return { rows: rows.sort(compareDocumentOrder), quarantined };
    },

    async summaryGaps() {
      // The documents with NO document_summaries row at all: rewriteSummary (UPDATE-only) cannot
      // create this row, so this names exactly what a repair or re-import must fix. Never opens a
      // body cell (id_cell only, same as summaries()).
      const rows = statement(
        `SELECT d.kind, d.id_cell FROM documents d LEFT JOIN document_summaries ds ON ds.kind = d.kind AND ds.id = d.id
         WHERE ds.kind IS NULL ORDER BY d.kind, d.id`,
      ).all() as { kind: string; id_cell: string }[];
      return rows.map((r) => ({ kind: r.kind, id: cipher.open("documents.id_cell", r.id_cell) }));
    },

    async documentVersions(kind) {
      // `version` sits on `documents` itself, a plain column never sealed: no body cell opened.
      const DOC_VERSION_COLUMNS = "kind, id, id_cell, version, write_id";
      return pagedQuarantined(
        { kind: "", id: "" },
        (after) =>
          (kind === undefined
            ? statement(`SELECT ${DOC_VERSION_COLUMNS} FROM documents WHERE (kind, id) > (?, ?) ORDER BY kind, id LIMIT ${PAGE}`).all(after.kind, after.id)
            : statement(`SELECT ${DOC_VERSION_COLUMNS} FROM documents WHERE kind = ? AND id > ? ORDER BY id LIMIT ${PAGE}`).all(kind, after.id)) as DocumentVersionSql[],
        (r) => ({ kind: r.kind, id: r.id }),
        toDocumentVersion,
      );
    },

    async graveSummaries(kind) {
      const GRAVE_SUMMARY_COLUMNS =
        "gs.grave_id, dg.kind, dg.id, dg.id_cell, gs.summary_cell, gs.revision_cell, gs.derived_version, dg.deleted_at";
      // pagedQuarantined (rule 25), not the unguarded `paged` above: same reason as `graves` - `dg.id_cell`
      // is opened per row here too (`toGraveSummary`), so one damaged grave must not hide the Trash's
      // other summaries.
      return pagedQuarantined(
        "",
        (after) =>
          (kind === undefined
            ? statement(
                `SELECT ${GRAVE_SUMMARY_COLUMNS} FROM grave_summaries gs JOIN document_graves dg ON dg.grave_id = gs.grave_id
                 WHERE gs.grave_id > ? ORDER BY gs.grave_id LIMIT ${PAGE}`,
              ).all(after)
            : statement(
                `SELECT ${GRAVE_SUMMARY_COLUMNS} FROM grave_summaries gs JOIN document_graves dg ON dg.grave_id = gs.grave_id
                 WHERE dg.kind = ? AND gs.grave_id > ? ORDER BY gs.grave_id LIMIT ${PAGE}`,
              ).all(kind, after)) as GraveSummarySql[],
        (r) => r.grave_id,
        toGraveSummary,
      );
    },

    async counts() {
      // Whether a document_summaries ROW exists at all, not whether it is computed yet (a row with a
      // null summary_cell still counts: rebuildSummaries fills that in). A document with NO row here
      // is the one thing the rebuild cannot repair.
      const documents = (statement("SELECT count(*) AS n FROM documents").get() as { n: number }).n;
      const summaries = (statement("SELECT count(*) AS n FROM document_summaries").get() as { n: number }).n;
      return { documents, summaries, ...blobCounts(statement) };
    },

    async rewriteSummary(kind, id, expectedWriteId, summary, updatedAt) {
      const k = key(kind, id);
      return transaction(() => {
        const current = statement("SELECT write_id, revision FROM documents WHERE kind = ? AND id = ?").get(kind, k) as
          | { write_id: number; revision: string }
          | null;
        if (!current || current.write_id !== expectedWriteId) return false;
        const revision = cipher.open("documents.revision", current.revision);
        const changed = statement(
          `UPDATE document_summaries SET summary_cell = ?, revision_cell = ?, derived_version = ?, updated_at = ?
           WHERE kind = ? AND id = ?`,
        ).run(
          cipher.seal("document_summaries.summary_cell", summary.text),
          cipher.seal("document_summaries.revision_cell", revision),
          summary.derivedVersion,
          updatedAt,
          kind,
          k,
        ).changes;
        return changed > 0;
      });
    },

    async pruneVersions(kind, id, keep) {
      const k = key(kind, id);
      return transaction(() => {
        // One statement, so the live version it spares is read in the same step that deletes.
        const dropped = statement(
          `DELETE FROM document_versions WHERE kind = ?1 AND id = ?2
             AND version NOT IN (SELECT version FROM document_versions WHERE kind = ?1 AND id = ?2 ORDER BY version DESC LIMIT ?3)
             AND version IS NOT (SELECT version FROM documents WHERE kind = ?1 AND id = ?2)`,
        ).run(kind, k, keep).changes;
        // Whatever no kept version can see any more is an orphan: it was closed at or before the
        // oldest version left standing. Same transaction, so a crash between the two leaves extra
        // parts, never a version whose parts are gone. Only when a version actually dropped: the
        // oldest-kept-version boundary only ever moves then, so with `dropped === 0` nothing newly
        // orphaned exists since the last time this ran - skipping it saves a scan of every one of
        // this piece's historical part rows (including their sealed cells) on every ordinary save,
        // a cost that was dominating a massive preset's one-block patch (S5 perf review, 2026-09-30).
        if (dropped > 0) pruneOrphanParts(statement, kind, k);
        return dropped;
      });
    },

    async purgeBefore(cutoff) {
      return transaction(() => {
        purgePartsForGraves(statement, cutoff);
        // Versions and summaries next, by the graves they belong to; the graves' own count is the answer.
        statement("DELETE FROM grave_versions WHERE grave_id IN (SELECT grave_id FROM document_graves WHERE deleted_at < ?)").run(cutoff);
        statement("DELETE FROM grave_summaries WHERE grave_id IN (SELECT grave_id FROM document_graves WHERE deleted_at < ?)").run(cutoff);
        return statement("DELETE FROM document_graves WHERE deleted_at < ?").run(cutoff).changes;
      });
    },
  } satisfies DocumentBackend, database.idle);
}
