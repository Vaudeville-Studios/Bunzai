/** Durable accepted Core operations and exact UI message identities for recovery. */
import type { Migration } from "./database";

export const MIGRATION_52_CORE_PROJECTIONS: Migration = {
  id: 52,
  name: "committed Core operation projections",
  sql: `
    CREATE TABLE core_scene_creation_bindings (
      chat_id TEXT PRIMARY KEY REFERENCES chats(id) ON DELETE CASCADE,
      branch_id TEXT NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
      operation_hash TEXT NOT NULL UNIQUE,
      origin TEXT NOT NULL CHECK (origin IN ('extension', 'host')),
      package_hash TEXT,
      body_cell TEXT NOT NULL
    );
    CREATE TABLE core_operation_projections (
      operation_hash TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES core_sessions(id) ON DELETE CASCADE,
      chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
      branch_id TEXT NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
      first_seq INTEGER NOT NULL CHECK (first_seq >= 0),
      last_seq INTEGER NOT NULL CHECK (last_seq >= first_seq),
      projected_seq INTEGER NOT NULL DEFAULT 0 CHECK (projected_seq >= 0 AND projected_seq <= last_seq),
      body_cell TEXT NOT NULL
    );
    CREATE INDEX core_projection_session ON core_operation_projections (session_id, first_seq);
    CREATE TABLE core_pending_extension_state (
      state_hash TEXT PRIMARY KEY,
      turn_operation_hash TEXT NOT NULL REFERENCES core_operation_projections(operation_hash) ON DELETE CASCADE,
      turn_id TEXT NOT NULL,
      session_id TEXT NOT NULL REFERENCES core_sessions(id) ON DELETE CASCADE,
      branch_id TEXT NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
      phase TEXT NOT NULL CHECK (phase IN ('staged', 'accepted', 'applied')),
      ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
      accepted_seq INTEGER,
      core_message_id TEXT,
      bytes INTEGER NOT NULL,
      body_cell TEXT NOT NULL,
      CHECK ((phase = 'staged' AND accepted_seq IS NULL AND core_message_id IS NULL)
        OR (phase IN ('accepted', 'applied') AND accepted_seq IS NOT NULL AND core_message_id IS NOT NULL)),
      UNIQUE (turn_operation_hash, turn_id, ordinal),
      FOREIGN KEY (session_id, accepted_seq) REFERENCES core_entries(session_id, seq) ON DELETE CASCADE
    );
    CREATE INDEX core_pending_state_turn ON core_pending_extension_state (turn_operation_hash, turn_id, phase);
    CREATE INDEX core_pending_state_message ON core_pending_extension_state (session_id, core_message_id, phase);
    CREATE TABLE core_message_links (
      session_id TEXT NOT NULL REFERENCES core_sessions(id) ON DELETE CASCADE,
      core_message_id TEXT NOT NULL,
      branch_id TEXT NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
      message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
      swipe_id TEXT NOT NULL,
      swipe_position INTEGER NOT NULL,
      PRIMARY KEY (session_id, core_message_id, branch_id),
      FOREIGN KEY (message_id, swipe_position) REFERENCES swipes(message_id, position) ON DELETE CASCADE
    );
    CREATE TRIGGER fp_core_projection_i AFTER INSERT ON core_operation_projections BEGIN INSERT OR IGNORE INTO fp_dirty (tbl, row_key) VALUES ('core_operation_projections', json_array(NEW.operation_hash)); END;
    CREATE TRIGGER fp_core_projection_u AFTER UPDATE ON core_operation_projections BEGIN INSERT OR IGNORE INTO fp_dirty (tbl, row_key) VALUES ('core_operation_projections', json_array(NEW.operation_hash)); END;
    CREATE TRIGGER fp_core_projection_d AFTER DELETE ON core_operation_projections BEGIN DELETE FROM row_fingerprints WHERE tbl = 'core_operation_projections' AND row_key = json_array(OLD.operation_hash); DELETE FROM fp_dirty WHERE tbl = 'core_operation_projections' AND row_key = json_array(OLD.operation_hash); END;
    CREATE TRIGGER fp_core_message_i AFTER INSERT ON core_message_links BEGIN INSERT OR IGNORE INTO fp_dirty (tbl, row_key) VALUES ('core_message_links', json_array(NEW.session_id, NEW.core_message_id, NEW.branch_id)); END;
    CREATE TRIGGER fp_core_message_u AFTER UPDATE ON core_message_links BEGIN INSERT OR IGNORE INTO fp_dirty (tbl, row_key) VALUES ('core_message_links', json_array(NEW.session_id, NEW.core_message_id, NEW.branch_id)); END;
    CREATE TRIGGER fp_core_message_d AFTER DELETE ON core_message_links BEGIN DELETE FROM row_fingerprints WHERE tbl = 'core_message_links' AND row_key = json_array(OLD.session_id, OLD.core_message_id, OLD.branch_id); DELETE FROM fp_dirty WHERE tbl = 'core_message_links' AND row_key = json_array(OLD.session_id, OLD.core_message_id, OLD.branch_id); END;
    CREATE TRIGGER fp_core_creation_i AFTER INSERT ON core_scene_creation_bindings BEGIN INSERT OR IGNORE INTO fp_dirty (tbl, row_key) VALUES ('core_scene_creation_bindings', json_array(NEW.chat_id)); END;
    CREATE TRIGGER fp_core_creation_u AFTER UPDATE ON core_scene_creation_bindings BEGIN INSERT OR IGNORE INTO fp_dirty (tbl, row_key) VALUES ('core_scene_creation_bindings', json_array(NEW.chat_id)); END;
    CREATE TRIGGER fp_core_creation_d AFTER DELETE ON core_scene_creation_bindings BEGIN DELETE FROM row_fingerprints WHERE tbl = 'core_scene_creation_bindings' AND row_key = json_array(OLD.chat_id); DELETE FROM fp_dirty WHERE tbl = 'core_scene_creation_bindings' AND row_key = json_array(OLD.chat_id); END;
    CREATE TRIGGER fp_core_pending_i AFTER INSERT ON core_pending_extension_state BEGIN INSERT OR IGNORE INTO fp_dirty (tbl, row_key) VALUES ('core_pending_extension_state', json_array(NEW.state_hash)); END;
    CREATE TRIGGER fp_core_pending_u AFTER UPDATE ON core_pending_extension_state BEGIN INSERT OR IGNORE INTO fp_dirty (tbl, row_key) VALUES ('core_pending_extension_state', json_array(NEW.state_hash)); END;
    CREATE TRIGGER fp_core_pending_d AFTER DELETE ON core_pending_extension_state BEGIN DELETE FROM row_fingerprints WHERE tbl = 'core_pending_extension_state' AND row_key = json_array(OLD.state_hash); DELETE FROM fp_dirty WHERE tbl = 'core_pending_extension_state' AND row_key = json_array(OLD.state_hash); END;
  `,
};
