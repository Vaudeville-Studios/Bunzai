/** Migration 48: encrypted executable extension packages, controls, private data, receipts and fenced ownership. */
import type { Migration } from "./database";

export const MIGRATION_48_EXTENSIONS: Migration = {
  id: 48,
  name: "executable extensions",
  sql: `
    CREATE TABLE extension_packages (
      digest TEXT PRIMARY KEY,
      bytes INTEGER NOT NULL,
      body_cell TEXT NOT NULL
    ) WITHOUT ROWID;
    CREATE TABLE extension_controls (
      id_hash TEXT PRIMARY KEY,
      revision INTEGER NOT NULL,
      body_cell TEXT NOT NULL
    ) WITHOUT ROWID;
    CREATE TABLE extension_data (
      package_hash TEXT NOT NULL,
      key_hash TEXT NOT NULL,
      revision INTEGER NOT NULL,
      bytes INTEGER NOT NULL,
      body_cell TEXT NOT NULL,
      PRIMARY KEY (package_hash, key_hash)
    ) WITHOUT ROWID;
    CREATE TABLE extension_receipts (
      seq INTEGER PRIMARY KEY AUTOINCREMENT,
      package_hash TEXT NOT NULL,
      receipt_hash TEXT NOT NULL UNIQUE,
      body_cell TEXT NOT NULL
    );
    CREATE INDEX extension_receipts_owner ON extension_receipts (package_hash, seq);
    CREATE TABLE extension_budget_usage (
      package_hash TEXT NOT NULL,
      operation_hash TEXT NOT NULL,
      grant_revision INTEGER NOT NULL,
      body_cell TEXT NOT NULL,
      PRIMARY KEY (package_hash, operation_hash, grant_revision)
    ) WITHOUT ROWID;
    CREATE TABLE extension_budget_reservations (
      reservation_hash TEXT PRIMARY KEY,
      package_hash TEXT NOT NULL,
      body_cell TEXT NOT NULL
    ) WITHOUT ROWID;
    CREATE TABLE extension_runtime_lease (
      singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
      epoch INTEGER NOT NULL,
      owner_cell TEXT,
      expires_at INTEGER NOT NULL,
      last_now INTEGER NOT NULL
    );
    CREATE TRIGGER fp_extension_packages_i AFTER INSERT ON extension_packages BEGIN INSERT OR IGNORE INTO fp_dirty (tbl, row_key) VALUES ('extension_packages', json_array(NEW.digest)); END;
    CREATE TRIGGER fp_extension_packages_u AFTER UPDATE ON extension_packages BEGIN INSERT OR IGNORE INTO fp_dirty (tbl, row_key) VALUES ('extension_packages', json_array(NEW.digest)); END;
    CREATE TRIGGER fp_extension_packages_d AFTER DELETE ON extension_packages BEGIN DELETE FROM row_fingerprints WHERE tbl = 'extension_packages' AND row_key = json_array(OLD.digest); DELETE FROM fp_dirty WHERE tbl = 'extension_packages' AND row_key = json_array(OLD.digest); END;
    CREATE TRIGGER fp_extension_controls_i AFTER INSERT ON extension_controls BEGIN INSERT OR IGNORE INTO fp_dirty (tbl, row_key) VALUES ('extension_controls', json_array(NEW.id_hash)); END;
    CREATE TRIGGER fp_extension_controls_u AFTER UPDATE ON extension_controls BEGIN INSERT OR IGNORE INTO fp_dirty (tbl, row_key) VALUES ('extension_controls', json_array(NEW.id_hash)); END;
    CREATE TRIGGER fp_extension_controls_d AFTER DELETE ON extension_controls BEGIN DELETE FROM row_fingerprints WHERE tbl = 'extension_controls' AND row_key = json_array(OLD.id_hash); DELETE FROM fp_dirty WHERE tbl = 'extension_controls' AND row_key = json_array(OLD.id_hash); END;
    CREATE TRIGGER fp_extension_data_i AFTER INSERT ON extension_data BEGIN INSERT OR IGNORE INTO fp_dirty (tbl, row_key) VALUES ('extension_data', json_array(NEW.package_hash, NEW.key_hash)); END;
    CREATE TRIGGER fp_extension_data_u AFTER UPDATE ON extension_data BEGIN INSERT OR IGNORE INTO fp_dirty (tbl, row_key) VALUES ('extension_data', json_array(NEW.package_hash, NEW.key_hash)); END;
    CREATE TRIGGER fp_extension_data_d AFTER DELETE ON extension_data BEGIN DELETE FROM row_fingerprints WHERE tbl = 'extension_data' AND row_key = json_array(OLD.package_hash, OLD.key_hash); DELETE FROM fp_dirty WHERE tbl = 'extension_data' AND row_key = json_array(OLD.package_hash, OLD.key_hash); END;
    CREATE TRIGGER fp_extension_receipts_i AFTER INSERT ON extension_receipts BEGIN INSERT OR IGNORE INTO fp_dirty (tbl, row_key) VALUES ('extension_receipts', json_array(NEW.seq)); END;
    CREATE TRIGGER fp_extension_receipts_u AFTER UPDATE ON extension_receipts BEGIN INSERT OR IGNORE INTO fp_dirty (tbl, row_key) VALUES ('extension_receipts', json_array(NEW.seq)); END;
    CREATE TRIGGER fp_extension_receipts_d AFTER DELETE ON extension_receipts BEGIN DELETE FROM row_fingerprints WHERE tbl = 'extension_receipts' AND row_key = json_array(OLD.seq); DELETE FROM fp_dirty WHERE tbl = 'extension_receipts' AND row_key = json_array(OLD.seq); END;
    CREATE TRIGGER fp_extension_budget_usage_i AFTER INSERT ON extension_budget_usage BEGIN INSERT OR IGNORE INTO fp_dirty (tbl, row_key) VALUES ('extension_budget_usage', json_array(NEW.package_hash, NEW.operation_hash, NEW.grant_revision)); END;
    CREATE TRIGGER fp_extension_budget_usage_u AFTER UPDATE ON extension_budget_usage BEGIN INSERT OR IGNORE INTO fp_dirty (tbl, row_key) VALUES ('extension_budget_usage', json_array(NEW.package_hash, NEW.operation_hash, NEW.grant_revision)); END;
    CREATE TRIGGER fp_extension_budget_usage_d AFTER DELETE ON extension_budget_usage BEGIN DELETE FROM row_fingerprints WHERE tbl = 'extension_budget_usage' AND row_key = json_array(OLD.package_hash, OLD.operation_hash, OLD.grant_revision); DELETE FROM fp_dirty WHERE tbl = 'extension_budget_usage' AND row_key = json_array(OLD.package_hash, OLD.operation_hash, OLD.grant_revision); END;
    CREATE TRIGGER fp_extension_budget_reservations_i AFTER INSERT ON extension_budget_reservations BEGIN INSERT OR IGNORE INTO fp_dirty (tbl, row_key) VALUES ('extension_budget_reservations', json_array(NEW.reservation_hash)); END;
    CREATE TRIGGER fp_extension_budget_reservations_u AFTER UPDATE ON extension_budget_reservations BEGIN INSERT OR IGNORE INTO fp_dirty (tbl, row_key) VALUES ('extension_budget_reservations', json_array(NEW.reservation_hash)); END;
    CREATE TRIGGER fp_extension_budget_reservations_d AFTER DELETE ON extension_budget_reservations BEGIN DELETE FROM row_fingerprints WHERE tbl = 'extension_budget_reservations' AND row_key = json_array(OLD.reservation_hash); DELETE FROM fp_dirty WHERE tbl = 'extension_budget_reservations' AND row_key = json_array(OLD.reservation_hash); END;
    CREATE TRIGGER fp_extension_runtime_lease_i AFTER INSERT ON extension_runtime_lease BEGIN INSERT OR IGNORE INTO fp_dirty (tbl, row_key) VALUES ('extension_runtime_lease', json_array(NEW.singleton)); END;
    CREATE TRIGGER fp_extension_runtime_lease_u AFTER UPDATE ON extension_runtime_lease BEGIN INSERT OR IGNORE INTO fp_dirty (tbl, row_key) VALUES ('extension_runtime_lease', json_array(NEW.singleton)); END;
    CREATE TRIGGER fp_extension_runtime_lease_d AFTER DELETE ON extension_runtime_lease BEGIN DELETE FROM row_fingerprints WHERE tbl = 'extension_runtime_lease' AND row_key = json_array(OLD.singleton); DELETE FROM fp_dirty WHERE tbl = 'extension_runtime_lease' AND row_key = json_array(OLD.singleton); END;
  `,
};
