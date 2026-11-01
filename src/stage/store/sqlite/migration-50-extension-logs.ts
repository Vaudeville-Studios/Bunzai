/** Migration 49 adds sealed package-owned extension operational logs. */
import type { Migration } from "./database";

export const MIGRATION_50_EXTENSION_LOGS: Migration = {
  id: 50,
  name: "extension operational logs",
  sql: `
    CREATE TABLE extension_logs (
      seq INTEGER PRIMARY KEY AUTOINCREMENT,
      package_hash TEXT NOT NULL,
      log_hash TEXT NOT NULL UNIQUE,
      body_cell TEXT NOT NULL
    );
    CREATE INDEX extension_logs_owner ON extension_logs (package_hash, seq);
    CREATE TRIGGER fp_extension_logs_i AFTER INSERT ON extension_logs BEGIN INSERT OR IGNORE INTO fp_dirty (tbl, row_key) VALUES ('extension_logs', json_array(NEW.seq)); END;
    CREATE TRIGGER fp_extension_logs_u AFTER UPDATE ON extension_logs BEGIN INSERT OR IGNORE INTO fp_dirty (tbl, row_key) VALUES ('extension_logs', json_array(NEW.seq)); END;
    CREATE TRIGGER fp_extension_logs_d AFTER DELETE ON extension_logs BEGIN DELETE FROM row_fingerprints WHERE tbl = 'extension_logs' AND row_key = json_array(OLD.seq); DELETE FROM fp_dirty WHERE tbl = 'extension_logs' AND row_key = json_array(OLD.seq); END;
  `,
};
