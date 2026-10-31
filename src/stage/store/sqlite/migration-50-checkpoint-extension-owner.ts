/** Migration 50 binds pending extension state to the extension authority that opened the turn. */
import type { Migration } from "./database";

export const MIGRATION_50_CHECKPOINT_EXTENSION_OWNER: Migration = {
  id: 50,
  name: "turn checkpoint extension owner",
  sql: "ALTER TABLE turn_checkpoints ADD COLUMN extension_owner_json TEXT;",
};
