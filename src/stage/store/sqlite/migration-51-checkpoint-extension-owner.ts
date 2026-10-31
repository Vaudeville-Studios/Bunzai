/** Migration 51 binds pending extension state to the extension authority that opened the turn. */
import type { Migration } from "./database";

export const MIGRATION_51_CHECKPOINT_EXTENSION_OWNER: Migration = {
  id: 51,
  name: "turn checkpoint extension owner",
  sql: "ALTER TABLE turn_checkpoints ADD COLUMN extension_owner_json TEXT;",
};
