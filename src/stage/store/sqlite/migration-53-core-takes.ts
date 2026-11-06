/**
 * Each take of a Core scene keeps its own rp-core session (a fork of its source take's session);
 * core_scene_links stays the link of the take the scene is on. A take's row is written when it is
 * forked, and its source take's row with it.
 */
import type { Migration } from "./database";

export const MIGRATION_53_CORE_TAKES: Migration = {
  id: 53,
  name: "one rp-core session per Core scene take",
  sql: `
    CREATE TABLE IF NOT EXISTS core_take_links (
      branch_id TEXT PRIMARY KEY REFERENCES branches(id) ON DELETE CASCADE,
      chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
      session_id TEXT NOT NULL UNIQUE REFERENCES core_sessions(id) ON DELETE CASCADE
    );
  `,
};
