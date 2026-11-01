/** Adds revision counters to canonical state documents for compare-and-write mutations. */
import type { Migration } from "./database";

export const MIGRATION_49_STATE_REVISIONS: Migration = {
  id: 49,
  name: "revisioned state documents",
  sql: "ALTER TABLE studio_state ADD COLUMN revision INTEGER NOT NULL DEFAULT 0;",
};
