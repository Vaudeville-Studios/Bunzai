/**
 * The database's migrations, in order. They live in code, not .sql files, so they are inside the
 * compiled binary. Never edit one that has shipped: add the next.
 *
 * Migrations 1, 2, and 3 were edited in place for encryption at rest (2026-09-23). That was safe only
 * because no build that creates a database had been released or run against real data; from the
 * first release on, the rule above holds without exception.
 */
import type { Migration } from "./database";
import { MIGRATION_18_PARTS } from "./migration-18-parts";
import { MIGRATION_19_BLOBS } from "./migration-19-blobs";
import { MIGRATION_20_DERIVED } from "./migration-20-derived";
import { MIGRATION_21_AUTOSAVE_HISTORY } from "./migration-21-autosave-history";
import { MIGRATION_22_CHAT_SNAPSHOTS } from "./migration-22-chat-snapshot-parts";
import { MIGRATION_23_PIECE_CHANGES } from "./migration-23-piece-changes";
import { MIGRATION_24_HEALTH_CHECK } from "./migration-24-health-check";
import { MIGRATION_25_MESSAGE_PERSONA } from "./migration-25-message-persona";
import { MIGRATION_26_PERSONA_STATS } from "./migration-26-persona-stats";
import { MIGRATION_27_MESSAGE_HIDDEN } from "./migration-27-message-hidden";
import { MIGRATION_28_TURN_CONTINUE } from "./migration-28-turn-continue";
import { MIGRATION_29_SWIPE_CUT } from "./migration-29-swipe-cut";
import { MIGRATION_31_OPENING } from "./migration-31-opening";
import { MIGRATION_30_CHAT_SOURCE } from "./migration-30-chat-source";
import { MIGRATION_32_PROMPTING } from "./migration-32-prompting";
import { MIGRATION_33_BACKDROP } from "./migration-33-backdrop";
import { MIGRATION_34_COMPENDIUM } from "./migration-34-compendium";
import { MIGRATION_35_RECEIPTS } from "./migration-35-receipts";
import { MIGRATION_36_TREES } from "./migration-36-trees";
import { MIGRATION_37_PARTICIPANTS } from "./migration-37-participants";
import { MIGRATION_38_SCENE_REGEX } from "./migration-38-scene-regex";
import { MIGRATION_39_TRACKERS } from "./migration-39-trackers";
import { MIGRATION_40_FINAL_CUT } from "./migration-40-final-cut";
import { MIGRATION_41_SCENE_SUMMARY } from "./migration-41-scene-summary";
import { MIGRATION_42_DIRECTOR } from "./migration-42-director";
import { MIGRATION_43_SCENE_STATE } from "./migration-43-scene-state";
import { MIGRATION_44_VERSION_WRITES } from "./migration-44-version-writes";
import { MIGRATION_45_GLOBAL_OPS } from "./migration-45-global-ops";
import { MIGRATION_46_DRAMATURG } from "./migration-46-dramaturg";
import { MIGRATION_48_EXTENSIONS } from "./migration-48-extensions";
import { MIGRATION_49_STATE_REVISIONS } from "./migration-49-state-revisions";
import { MIGRATION_50_EXTENSION_LOGS } from "./migration-50-extension-logs";
import { MIGRATION_51_CHECKPOINT_EXTENSION_OWNER } from "./migration-51-checkpoint-extension-owner";

export const MIGRATIONS: readonly Migration[] = [
  {
    id: 1,
    name: "library documents",
    // The shape of the DocumentBackend contract (src/stage/contracts/content-store.ts): one row per
    // entity keyed by kind and id, and its versions keyed by version number. `id` is a keyed hash
    // of the real id, which is sealed in `id_cell`; bodies and revisions are sealed cells.
    sql: `
      CREATE TABLE documents (
        kind TEXT NOT NULL,
        id TEXT NOT NULL,
        id_cell TEXT NOT NULL,
        body_json TEXT NOT NULL,
        revision TEXT NOT NULL,
        version INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        deleted_at INTEGER,
        PRIMARY KEY (kind, id)
      );
      CREATE INDEX documents_buried ON documents (deleted_at) WHERE deleted_at IS NOT NULL;
      CREATE TABLE document_versions (
        kind TEXT NOT NULL,
        id TEXT NOT NULL,
        version INTEGER NOT NULL,
        body_json TEXT NOT NULL,
        revision TEXT NOT NULL,
        saved_at INTEGER NOT NULL,
        reason TEXT NOT NULL,
        PRIMARY KEY (kind, id, version),
        FOREIGN KEY (kind, id) REFERENCES documents (kind, id) ON DELETE CASCADE
      );
    `,
  },
  {
    id: 2,
    name: "chats",
    // The ChatStore contract (src/stage/contracts/chat-store.ts). A fork copies messages and keeps
    // their swipe ids, so a swipe is keyed by its message too: keyed by swipe id alone, two branches
    // would share one swipe row and its edit history (spec rule 6).
    sql: `
      CREATE TABLE chats (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        character_id TEXT NOT NULL,
        cast_json TEXT NOT NULL,
        cast_snapshot_json TEXT NOT NULL,
        active_branch_id TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        deleted_at INTEGER
      );
      CREATE INDEX chats_character ON chats (character_id);
      CREATE TABLE branches (
        id TEXT PRIMARY KEY,
        chat_id TEXT NOT NULL REFERENCES chats (id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        parent_branch_id TEXT,
        fork_message_id TEXT,
        fork_swipe_id TEXT,
        created_at INTEGER NOT NULL,
        version INTEGER NOT NULL
      );
      CREATE INDEX branches_chat ON branches (chat_id);
      CREATE TABLE messages (
        id TEXT PRIMARY KEY,
        branch_id TEXT NOT NULL REFERENCES branches (id) ON DELETE CASCADE,
        seq INTEGER NOT NULL,
        role TEXT NOT NULL,
        current_swipe INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        UNIQUE (branch_id, seq)
      );
      CREATE TABLE swipes (
        message_id TEXT NOT NULL REFERENCES messages (id) ON DELETE CASCADE,
        position INTEGER NOT NULL,
        swipe_id TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        pinned INTEGER NOT NULL,
        generation_json TEXT,
        PRIMARY KEY (message_id, position),
        UNIQUE (message_id, swipe_id)
      );
      CREATE TABLE swipe_history (
        message_id TEXT NOT NULL,
        swipe_id TEXT NOT NULL,
        n INTEGER NOT NULL,
        content TEXT NOT NULL,
        PRIMARY KEY (message_id, swipe_id, n),
        FOREIGN KEY (message_id, swipe_id) REFERENCES swipes (message_id, swipe_id) ON DELETE CASCADE
      );
    `,
  },
  {
    id: 3,
    name: "keyring",
    // The wrapped data key: the password and recovery copies, one
    // copy per remembered computer (its label sealed), the lock policy, and a cleanup still owed
    // after a key change. Nothing here is a key in the clear.
    sql: `
      CREATE TABLE keyring (
        kind TEXT PRIMARY KEY CHECK (kind IN ('password', 'recovery')),
        wrap_json TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE devices (
        computer_id TEXT PRIMARY KEY,
        label TEXT NOT NULL,
        wrap_json TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE lock_settings (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        mode TEXT NOT NULL CHECK (mode IN ('each-open', 'idle')),
        idle_minutes INTEGER
      );
      CREATE TABLE maintenance (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        cleanup_pending TEXT NOT NULL,
        since INTEGER NOT NULL,
        mark TEXT NOT NULL
      );
    `,
  },
  {
    id: 4,
    name: "studio files",
    // The Studio's library behind its file seam: one row per file
    // or folder. Keys are keyed hashes of the folded path and of its parent folder; the name and the
    // text are sealed cells, so nothing about a path or its content is readable. A folder has no body.
    sql: `
      CREATE TABLE studio_files (
        path_key TEXT PRIMARY KEY,
        dir_key TEXT NOT NULL,
        name TEXT NOT NULL,
        body TEXT,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX studio_files_by_dir ON studio_files (dir_key, path_key);
    `,
  },
  {
    id: 5,
    name: "kit sessions",
    // Kit's transcripts (the disk-write list): they quote card
    // content, so they live sealed in the library. `library_meta` records one-time steps, such as
    // copying the old transcript files in, so a step is never repeated.
    sql: `
      CREATE TABLE kit_sessions (
        id_key TEXT PRIMARY KEY,
        body TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE library_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `,
  },
  {
    id: 6,
    name: "live documents and graves",
    // behaviors 9 to 12a: a deleted entity moves, with its versions,
    // into a grave of its own, so its id is free at once and one id can have several graves. Keys
    // hash the folded id. Nothing is carried over from migration 1's tables: no library built on them
    // holds anything to keep (the app is unreleased). Grave cells keep the labels they were sealed
    // under as live rows, so burying and restoring are plain SQL moves.
    sql: `
      DROP TABLE document_versions;
      DROP TABLE documents;
      CREATE TABLE documents (
        kind TEXT NOT NULL,
        id TEXT NOT NULL,
        id_cell TEXT NOT NULL,
        body_json TEXT NOT NULL,
        revision TEXT NOT NULL,
        version INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (kind, id)
      );
      CREATE TABLE document_versions (
        kind TEXT NOT NULL,
        id TEXT NOT NULL,
        version INTEGER NOT NULL,
        body_json TEXT NOT NULL,
        revision TEXT NOT NULL,
        saved_at INTEGER NOT NULL,
        reason TEXT NOT NULL,
        PRIMARY KEY (kind, id, version),
        FOREIGN KEY (kind, id) REFERENCES documents (kind, id) ON DELETE CASCADE
      );
      CREATE TABLE document_graves (
        grave_id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        id TEXT NOT NULL,
        id_cell TEXT NOT NULL,
        body_json TEXT NOT NULL,
        revision TEXT NOT NULL,
        version INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        deleted_at INTEGER NOT NULL
      );
      CREATE INDEX document_graves_by_age ON document_graves (deleted_at);
      CREATE TABLE grave_versions (
        grave_id TEXT NOT NULL,
        version INTEGER NOT NULL,
        body_json TEXT NOT NULL,
        revision TEXT NOT NULL,
        saved_at INTEGER NOT NULL,
        reason TEXT NOT NULL,
        PRIMARY KEY (grave_id, version),
        FOREIGN KEY (grave_id) REFERENCES document_graves (grave_id) ON DELETE CASCADE
      );
    `,
  },
  {
    id: 7,
    name: "studio state; the file seam retired",
    // Plan D5: the library never runs on files. The Studio's own documents (settings, collections,
    // engine roots, Kit's block graveyard) move to one sealed row per fixed key (the StateStore), and
    // migration 4's table of files goes. Nothing in it is carried over: the app is unreleased.
    sql: `
      CREATE TABLE studio_state (
        key TEXT PRIMARY KEY,
        body TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
      DROP TABLE studio_files;
    `,
  },
  {
    id: 8,
    name: "retired ids",
    // Spec behavior 10: an id is never reused. Deleting records the keyed hash of its kind and folded
    // id (the same key `documents` uses, so no name is readable on disk); the purge keeps it.
    sql: `
      CREATE TABLE retired_ids (
        kind TEXT NOT NULL,
        id TEXT NOT NULL,
        PRIMARY KEY (kind, id)
      ) WITHOUT ROWID;
    `,
  },
  {
    id: 9,
    name: "cuts, deleted takes, and recasting",
    // ChatStore rules 11 to 13. A cut message stays in place with its cut
    // (restorable until the purge) and the branch's last sequence when it was cut; a deleted branch
    // keeps its rows until the purge; a recast chat keeps the one cast and snapshot it replaced, sealed
    // under their own column names.
    sql: `
      ALTER TABLE messages ADD COLUMN cut_id TEXT;
      ALTER TABLE messages ADD COLUMN cut_at INTEGER;
      ALTER TABLE messages ADD COLUMN cut_scope TEXT;
      ALTER TABLE messages ADD COLUMN cut_tail INTEGER;
      ALTER TABLE branches ADD COLUMN deleted_at INTEGER;
      ALTER TABLE chats ADD COLUMN previous_cast_json TEXT;
      ALTER TABLE chats ADD COLUMN previous_snapshot_json TEXT;
    `,
  },
  {
    id: 10,
    name: "checkpoints, traces, and variables",
    // ChatStore rules 15 to 17. A trace is keyed by its swipe's message and position, never by swipe
    // id (a fork keeps swipe ids). A branch has at most one open checkpoint; its message id is not a
    // foreign key, because a swipe checkpoint outlives a purged message and then commits as null.
    // Text, traces, the request id, and variables are sealed cells.
    sql: `
      CREATE TABLE swipe_traces (
        message_id TEXT NOT NULL,
        position INTEGER NOT NULL,
        trace_json TEXT NOT NULL,
        PRIMARY KEY (message_id, position),
        FOREIGN KEY (message_id, position) REFERENCES swipes (message_id, position) ON DELETE CASCADE
      ) WITHOUT ROWID;
      CREATE TABLE turn_checkpoints (
        id TEXT PRIMARY KEY,
        branch_id TEXT NOT NULL UNIQUE REFERENCES branches (id) ON DELETE CASCADE,
        kind TEXT NOT NULL CHECK (kind IN ('reply', 'swipe')),
        message_id TEXT,
        content TEXT NOT NULL,
        trace_json TEXT,
        provider_request_id TEXT,
        base_version INTEGER NOT NULL,
        started_at INTEGER NOT NULL,
        saved_at INTEGER NOT NULL
      );
      CREATE TABLE branch_variables (
        branch_id TEXT PRIMARY KEY REFERENCES branches (id) ON DELETE CASCADE,
        variables_json TEXT NOT NULL
      ) WITHOUT ROWID;
    `,
  },
  {
    id: 11,
    name: "a scene's connection",
    // ChatStore rule 18: the Kit connection and model a scene last used, one sealed cell on the chat.
    sql: `
      ALTER TABLE chats ADD COLUMN connection_json TEXT;
    `,
  },
  {
    id: 12,
    name: "a scene's preset",
    // ChatStore rule 19: the library preset a scene follows, its toggles, and its sampler overrides,
    // one sealed cell on the chat.
    sql: `
      ALTER TABLE chats ADD COLUMN preset_json TEXT;
    `,
  },
  {
    id: 13,
    name: "a scene's lorebook choices",
    // ChatStore rule 20: the library books a scene added, and the books switched off for it, one
    // sealed cell on the chat.
    sql: `
      ALTER TABLE chats ADD COLUMN lore_json TEXT;
    `,
  },
  {
    id: 14,
    name: "a scene's switched-on Props",
    // ChatStore rule 21: which registered Props (src/ui/apps/scenes/props) a scene has switched on,
    // one sealed cell on the chat.
    sql: `
      ALTER TABLE chats ADD COLUMN props_json TEXT;
    `,
  },
  {
    id: 15,
    name: "a take's latest request text",
    // ChatStore rule 22: the messageId, swipeId, and per-block texts of a branch's latest committed
    // reply, one sealed cell on the branch (not the chat: it is per take).
    sql: `
      ALTER TABLE branches ADD COLUMN last_request_json TEXT;
    `,
  },
  {
    id: 16,
    name: "Fan Favorites and story folders",
    // ChatStore rules 23 and 24: a scene can be starred (favored_at, a plain time, never sealed), and
    // scenes can live in at most one user-made story folder. Folder names are user text, sealed like a
    // chat's title.
    sql: `
      ALTER TABLE chats ADD COLUMN favored_at INTEGER;
      ALTER TABLE chats ADD COLUMN folder_id TEXT;
      CREATE TABLE IF NOT EXISTS scene_folders (id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at INTEGER NOT NULL);
      CREATE INDEX chats_folder ON chats (folder_id);
    `,
  },
  {
    id: 17,
    name: "sealed piece summaries",
    // One row per live document and
    // one per grave, holding its derived summary so the Library can list without decrypting a body.
    // `kind, id` is the same keyed hash `documents`/`document_graves` key by, so a summary always
    // lines up with the row it describes. `summary_cell` and `revision_cell` are sealed exactly like
    // other cells; `derived_version` is a plain code-version tag,
    // left readable like the other version numbers rule 9 already leaves readable. All three are
    // nullable: null means "not computed yet", never a
    // reason to skip the row itself. Cascades so a purge or a foreign-key repair can never strand one.
    // IF NOT EXISTS, house style (migration 16). The backfill gives every document and grave that
    // already existed a placeholder "not computed" row of its own: without it, a library migrated
    // from before this landed would have no document_summaries row at all for its existing pieces,
    // which `summaries()`'s join would then skip in silence instead of reporting as owed a rebuild.
    sql: `
      CREATE TABLE IF NOT EXISTS document_summaries (
        kind TEXT NOT NULL,
        id TEXT NOT NULL,
        summary_cell TEXT,
        revision_cell TEXT,
        derived_version TEXT,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (kind, id),
        FOREIGN KEY (kind, id) REFERENCES documents (kind, id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS grave_summaries (
        grave_id TEXT PRIMARY KEY,
        summary_cell TEXT,
        revision_cell TEXT,
        derived_version TEXT,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY (grave_id) REFERENCES document_graves (grave_id) ON DELETE CASCADE
      );
      INSERT OR IGNORE INTO document_summaries (kind, id, updated_at) SELECT kind, id, updated_at FROM documents;
      INSERT OR IGNORE INTO grave_summaries (grave_id, updated_at) SELECT grave_id, updated_at FROM document_graves;
    `,
  },
  MIGRATION_18_PARTS,
  MIGRATION_19_BLOBS,
  MIGRATION_20_DERIVED,
  MIGRATION_21_AUTOSAVE_HISTORY,
  MIGRATION_22_CHAT_SNAPSHOTS,
  MIGRATION_23_PIECE_CHANGES,
  MIGRATION_24_HEALTH_CHECK,
  MIGRATION_25_MESSAGE_PERSONA,
  MIGRATION_26_PERSONA_STATS,
  MIGRATION_27_MESSAGE_HIDDEN,
  MIGRATION_28_TURN_CONTINUE,
  MIGRATION_29_SWIPE_CUT,
  MIGRATION_30_CHAT_SOURCE,
  MIGRATION_31_OPENING,
  MIGRATION_32_PROMPTING,
  MIGRATION_33_BACKDROP,
  MIGRATION_34_COMPENDIUM,
  MIGRATION_35_RECEIPTS,
  MIGRATION_36_TREES,
  MIGRATION_37_PARTICIPANTS,
  MIGRATION_38_SCENE_REGEX,
  MIGRATION_39_TRACKERS,
  MIGRATION_40_FINAL_CUT,
  MIGRATION_41_SCENE_SUMMARY,
  MIGRATION_42_DIRECTOR,
  MIGRATION_43_SCENE_STATE,
  MIGRATION_44_VERSION_WRITES,
  MIGRATION_45_GLOBAL_OPS,
  MIGRATION_46_DRAMATURG,
  {
    id: 47,
    name: "rp-core journals",
    sql: `
      CREATE TABLE IF NOT EXISTS core_sessions (
        id TEXT PRIMARY KEY,
        header_cell TEXT NOT NULL,
        title_cell TEXT,
        updated_at TEXT NOT NULL,
        lease_owner TEXT,
        lease_until INTEGER
      );
      CREATE TABLE IF NOT EXISTS core_entries (
        session_id TEXT NOT NULL REFERENCES core_sessions(id) ON DELETE CASCADE,
        seq INTEGER NOT NULL,
        entry_cell TEXT NOT NULL,
        PRIMARY KEY (session_id, seq)
      );
      CREATE TABLE IF NOT EXISTS core_scene_links (
        chat_id TEXT PRIMARY KEY REFERENCES chats(id) ON DELETE CASCADE,
        session_id TEXT NOT NULL UNIQUE REFERENCES core_sessions(id) ON DELETE CASCADE,
        branch_id TEXT NOT NULL REFERENCES branches(id) ON DELETE CASCADE
      );
    `,
  },

  MIGRATION_48_EXTENSIONS,
  MIGRATION_49_STATE_REVISIONS,
  MIGRATION_50_EXTENSION_LOGS,
  MIGRATION_51_CHECKPOINT_EXTENSION_OWNER,
];
