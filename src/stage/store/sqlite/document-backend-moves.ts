/** Atomic document/grave moves: preserve the sealed body identity while advancing its live-write id. */
import type { DocumentBackend } from "../../contracts/content-store";
import type { CellCipher } from "../../crypto/cell-cipher";
import { DamagedDataError } from "../../damaged-data-error";
import type { StageDatabase } from "./database";
import { appendPieceChange } from "./piece-change-journal";
import { requireExtensionCommit } from "./extension-commit-guard";

export function documentMoveMethods(
  database: StageDatabase,
  cipher: CellCipher,
  key: (kind: string, id: string) => string,
  columns: string,
): Pick<DocumentBackend, "bury" | "unbury"> {
  const { statement } = database;
  return {
    async bury(kind, id, graveId, deletedAt, capture, expectedRevision, extensionCommit) {
      const docKey = key(kind, id);
      return database.transaction(() => {
        if (extensionCommit) requireExtensionCommit(database, cipher, extensionCommit);
        const live = statement("SELECT id_cell,revision,version,write_id FROM documents WHERE kind=? AND id=?").get(kind, docKey) as { id_cell: string; revision: string; version: number; write_id: number } | null;
        if (!live) return false;
        if (expectedRevision !== undefined && cipher.open("documents.revision", live.revision) !== expectedRevision) return false;
        const actualId = cipher.open("documents.id_cell", live.id_cell);
        if (key(kind, actualId) !== docKey) throw new DamagedDataError("documents.id_cell", "the id does not belong to this row");
        const moved = statement(
          `INSERT INTO document_graves (grave_id, ${columns}, deleted_at)
           SELECT ?, kind, id, id_cell, revision, version, write_id + 1, NULL, created_at, updated_at, ?
           FROM documents WHERE kind = ? AND id = ? ON CONFLICT (grave_id) DO NOTHING`,
        ).run(graveId, deletedAt, kind, docKey).changes;
        if (moved === 0) return false;
        statement(
          `INSERT INTO grave_versions (grave_id, version, revision, saved_at, reason, autosave_started_at)
           SELECT ?, version, revision, saved_at, reason, autosave_started_at FROM document_versions WHERE kind = ? AND id = ?`,
        ).run(graveId, kind, docKey);
        statement(
          `INSERT INTO grave_summaries (grave_id, summary_cell, revision_cell, derived_version, updated_at)
           SELECT ?, summary_cell, revision_cell, derived_version, updated_at FROM document_summaries WHERE kind = ? AND id = ?`,
        ).run(graveId, kind, docKey);
        statement("DELETE FROM document_versions WHERE kind = ? AND id = ?").run(kind, docKey);
        statement("DELETE FROM document_summaries WHERE kind = ? AND id = ?").run(kind, docKey);
        statement("DELETE FROM documents WHERE kind = ? AND id = ?").run(kind, docKey);
        statement("INSERT INTO retired_ids (kind, id) VALUES (?, ?) ON CONFLICT DO NOTHING").run(kind, docKey);
        const receipt = {
          kind, id: actualId, revision: cipher.open("documents.revision", live.revision), version: live.version, writeId: live.write_id + 1, action: "delete",
        } as const;
        appendPieceChange(database, cipher, key, receipt);
        capture?.(receipt);
        return true;
      });
    },

    async unbury(graveId, extensionCommit) {
      return database.transaction(() => {
        if (extensionCommit) requireExtensionCommit(database, cipher, extensionCommit);
        const grave = statement("SELECT kind,id,id_cell,revision,version,write_id FROM document_graves WHERE grave_id = ?").get(graveId) as
          { kind: string; id: string; id_cell: string; revision: string; version: number; write_id: number } | null;
        if (!grave) return false;
        const back = statement(
          `INSERT INTO documents (${columns})
           SELECT kind, id, id_cell, revision, version, write_id + 1, NULL, created_at, updated_at
           FROM document_graves WHERE grave_id = ? ON CONFLICT (kind, id) DO NOTHING`,
        ).run(graveId).changes;
        if (back === 0) return false;
        statement(
          `INSERT INTO document_versions (kind, id, version, revision, saved_at, reason, autosave_started_at)
           SELECT ?, ?, version, revision, saved_at, reason, autosave_started_at FROM grave_versions WHERE grave_id = ?`,
        ).run(grave.kind, grave.id, graveId);
        statement(
          `INSERT INTO document_summaries (kind, id, summary_cell, revision_cell, derived_version, updated_at)
           SELECT ?, ?, summary_cell, revision_cell, derived_version, updated_at FROM grave_summaries WHERE grave_id = ?`,
        ).run(grave.kind, grave.id, graveId);
        statement("DELETE FROM grave_versions WHERE grave_id = ?").run(graveId);
        statement("DELETE FROM grave_summaries WHERE grave_id = ?").run(graveId);
        statement("DELETE FROM document_graves WHERE grave_id = ?").run(graveId);
        const id = cipher.open("documents.id_cell", grave.id_cell);
        if (key(grave.kind, id) !== grave.id) throw new Error("documents.id_cell does not belong to this row");
        appendPieceChange(database, cipher, key, {
          kind: grave.kind, id, revision: cipher.open("documents.revision", grave.revision), version: grave.version, writeId: grave.write_id + 1, action: "upsert",
        });
        return true;
      });
    },
  };
}
