/**
 * The two ways a library reaches migrations 25 and 26 (the Cast wing's persona stamp, variant and persona
 * counters) on top of Backstage's real migration 24, the health check: a database from before 24, and one
 * already at 24. No database may ever record a placeholder, and a build that has 24 must open one that has it.
 */
import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStageDatabase, type StageDatabase } from "./database";
import { MIGRATIONS } from "./migrations";

const dirs: string[] = [];
const open: StageDatabase[] = [];
afterEach(() => {
  for (const d of open.splice(0)) d.close();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
const file = (): string => {
  const dir = mkdtempSync(join(tmpdir(), "bunzai-mig-"));
  dirs.push(dir);
  return join(dir, "library.db");
};
const reopen = (path: string, upTo: number = MIGRATIONS.length): StageDatabase => {
  const d = openStageDatabase(path, MIGRATIONS.slice(0, upTo));
  open.push(d);
  return d;
};
const names = (d: StageDatabase): { id: number; name: string }[] => d.statement("SELECT id, name FROM _migrations ORDER BY id").all() as { id: number; name: string }[];
const columns = (d: StageDatabase, table: string): string[] => (d.statement(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name);

test("the list is numbered 1 to n and holds the real health check at 24, never a placeholder", () => {
  expect(MIGRATIONS.map((m) => m.id)).toEqual(MIGRATIONS.map((_, i) => i + 1));
  expect(MIGRATIONS[23]!.name).toContain("health check");
  expect(MIGRATIONS.some((m) => /reserved|placeholder/i.test(m.name))).toBe(false);
  expect(MIGRATIONS[24]!.id).toBe(25);
  expect(MIGRATIONS[25]!.id).toBe(26);
  expect(MIGRATIONS.at(-1)!.id).toBe(51);
});

test("a database from before migration 24 upgrades cleanly through 24, 25 and 26", () => {
  const path = file();
  reopen(path, 23).close();
  open.pop();
  const d = reopen(path);
  expect(names(d).map((m) => m.id)).toEqual(MIGRATIONS.map((m) => m.id));
  expect(names(d).some((m) => /reserved|placeholder/i.test(m.name))).toBe(false);
  expect(columns(d, "messages")).toContain("persona_json");
  expect(columns(d, "chats")).toEqual(expect.arrayContaining(["variant_id", "stats_state"]));
  expect(columns(d, "persona_stats")).toEqual(["key", "cell"]);
  expect(d.statement("SELECT name FROM sqlite_master WHERE name = 'row_fingerprints'").get()).not.toBeNull();
});

test("a Backstage database already at migration 24 upgrades cleanly to 26, keeping its health-check tables", () => {
  const path = file();
  reopen(path, 24).close();
  open.pop();
  const d = reopen(path);
  expect(names(d).map((m) => m.id)).toEqual(MIGRATIONS.map((m) => m.id));
  expect(names(d)[23]!.name).toBe(MIGRATIONS[23]!.name);
  expect(names(d).some((m) => /reserved|placeholder/i.test(m.name))).toBe(false);
  expect(columns(d, "chats")).toContain("stats_state");
});

test("a database that recorded a different migration 24 is refused, not opened and not rewritten", () => {
  const path = file();
  reopen(path, 23).close();
  open.pop();
  const raw = openStageDatabase(path, MIGRATIONS.slice(0, 23));
  open.push(raw);
  raw.statement("INSERT INTO _migrations (id, name, applied_at) VALUES (24, 'reserved for the health check', 0)").run();
  raw.close();
  open.pop();
  expect(() => reopen(path)).toThrow("which this version does not know");
});

test("migration 28 widens the checkpoint kind to continue, keeping an open checkpoint and its fingerprint triggers", () => {
  const path = file();
  const before = reopen(path, 27);
  before.statement("PRAGMA foreign_keys = OFF").run();
  before.statement("INSERT INTO turn_checkpoints (id, branch_id, kind, message_id, content, base_version, started_at, saved_at) VALUES ('t1', 'b1', 'swipe', 'm1', 'sealed', 4, 1, 2)").run();
  expect(() => before.statement("INSERT INTO turn_checkpoints (id, branch_id, kind, message_id, content, base_version, started_at, saved_at) VALUES ('t2', 'b2', 'continue', 'm1', 'x', 1, 1, 1)").run()).toThrow();
  before.close();
  open.pop();
  const d = reopen(path);
  d.statement("PRAGMA foreign_keys = OFF").run();
  expect(d.statement("SELECT id, kind, message_id, content, base_version FROM turn_checkpoints").all()).toEqual([{ id: "t1", kind: "swipe", message_id: "m1", content: "sealed", base_version: 4 }]);
  d.statement("INSERT INTO turn_checkpoints (id, branch_id, kind, message_id, content, base_version, started_at, saved_at) VALUES ('t2', 'b2', 'continue', 'm1', 'x', 1, 1, 1)").run();
  expect(() => d.statement("INSERT INTO turn_checkpoints (id, branch_id, kind, message_id, content, base_version, started_at, saved_at) VALUES ('t3', 'b3', 'later', NULL, 'x', 1, 1, 1)").run()).toThrow();
  const triggers = (d.statement("SELECT name FROM sqlite_master WHERE type = 'trigger' AND tbl_name = 'turn_checkpoints' ORDER BY name").all() as { name: string }[]).map((t) => t.name);
  expect(triggers).toEqual(["fp_turn_checkpoints_d", "fp_turn_checkpoints_i", "fp_turn_checkpoints_u"]);
  expect(d.statement("SELECT 1 FROM fp_dirty WHERE tbl = 'turn_checkpoints' AND row_key = json_array('t2')").get()).not.toBeNull();
});

test("migration 29 adds swipes.cut_at: existing versions stay live, and a cut version is fingerprinted", () => {
  const path = file();
  const before = reopen(path, 28);
  before.statement("PRAGMA foreign_keys = OFF").run();
  before.statement("INSERT INTO swipes (message_id, position, swipe_id, content, created_at, pinned) VALUES ('m1', 0, 's1', 'sealed', 1, 0)").run();
  before.close();
  open.pop();
  const d = reopen(path);
  d.statement("PRAGMA foreign_keys = OFF").run();
  expect(columns(d, "swipes")).toContain("cut_at");
  expect(d.statement("SELECT cut_at FROM swipes WHERE swipe_id = 's1'").get()).toEqual({ cut_at: null });
  d.statement("UPDATE swipes SET cut_at = 5 WHERE swipe_id = 's1'").run();
  expect(d.statement("SELECT 1 FROM fp_dirty WHERE tbl = 'swipes' AND row_key = json_array('m1', 0)").get()).not.toBeNull();
});

test("migration 30 adds chats.import_key: existing scenes carry none, and a source is looked up by index", () => {
  const path = file();
  const before = reopen(path, 29);
  before.statement("INSERT INTO chats (id, title, character_id, cast_json, cast_snapshot_json, active_branch_id, created_at, updated_at, snapshot_version) VALUES ('c1', 't', 'k', 'j', '', 'b1', 1, 1, 1)").run();
  before.close();
  open.pop();
  const d = reopen(path);
  expect(columns(d, "chats")).toContain("import_key");
  expect(d.statement("SELECT import_key FROM chats WHERE id = 'c1'").get()).toEqual({ import_key: null });
  expect(d.statement("SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = 'chats_import_key'").get()).not.toBeNull();
});

test("migration 31 adds chats.opening_json: existing scenes carry none", () => {
  const path = file();
  const before = reopen(path, 30);
  before.statement("INSERT INTO chats (id, title, character_id, cast_json, cast_snapshot_json, active_branch_id, created_at, updated_at, snapshot_version) VALUES ('c1', 't', 'k', 'j', '', 'b1', 1, 1, 1)").run();
  before.close();
  open.pop();
  const d = reopen(path);
  expect(columns(d, "chats")).toContain("opening_json");
  expect(d.statement("SELECT opening_json FROM chats WHERE id = 'c1'").get()).toEqual({ opening_json: null });
});

test("migration 32 adds chats.prompting_json: existing scenes carry none", () => {
  const path = file();
  const before = reopen(path, 31);
  before.statement("INSERT INTO chats (id, title, character_id, cast_json, cast_snapshot_json, active_branch_id, created_at, updated_at, snapshot_version) VALUES ('c1', 't', 'k', 'j', '', 'b1', 1, 1, 1)").run();
  before.close();
  open.pop();
  const d = reopen(path);
  expect(columns(d, "chats")).toContain("prompting_json");
  expect(d.statement("SELECT prompting_json FROM chats WHERE id = 'c1'").get()).toEqual({ prompting_json: null });
});

test("migration 33 adds chats.backdrop_json: existing scenes carry none", () => {
  const path = file();
  const before = reopen(path, 32);
  before.statement("INSERT INTO chats (id, title, character_id, cast_json, cast_snapshot_json, active_branch_id, created_at, updated_at, snapshot_version) VALUES ('c1', 't', 'k', 'j', '', 'b1', 1, 1, 1)").run();
  before.close();
  open.pop();
  const d = reopen(path);
  expect(columns(d, "chats")).toContain("backdrop_json");
  expect(d.statement("SELECT backdrop_json FROM chats WHERE id = 'c1'").get()).toEqual({ backdrop_json: null });
});

test("migration 34 adds chats.compendium_json: existing scenes carry none", () => {
  const path = file();
  const before = reopen(path, 33);
  before.statement("INSERT INTO chats (id, title, character_id, cast_json, cast_snapshot_json, active_branch_id, created_at, updated_at, snapshot_version) VALUES ('c1', 't', 'k', 'j', '', 'b1', 1, 1, 1)").run();
  before.close();
  open.pop();
  const d = reopen(path);
  expect(columns(d, "chats")).toContain("compendium_json");
  expect(d.statement("SELECT compendium_json FROM chats WHERE id = 'c1'").get()).toEqual({ compendium_json: null });
});

test("migration 35 adds compendium_receipts: existing scenes have none, and a purged scene takes its receipts with it", () => {
  const path = file();
  const before = reopen(path, 34);
  before.statement("INSERT INTO chats (id, title, character_id, cast_json, cast_snapshot_json, active_branch_id, created_at, updated_at, snapshot_version) VALUES ('c1', 't', 'k', 'j', '', 'b1', 1, 1, 1)").run();
  before.close();
  open.pop();
  const d = reopen(path);
  expect(columns(d, "compendium_receipts")).toEqual(["seq", "id", "chat_id", "branch_id", "message_id", "swipe_id", "kind", "status", "at", "settled_at", "cell"]);
  expect(d.statement("SELECT count(*) AS n FROM compendium_receipts").get()).toEqual({ n: 0 });
  d.statement("INSERT INTO compendium_receipts (id, chat_id, branch_id, kind, status, at, settled_at, cell) VALUES ('r1', 'c1', 'b1', 'filing', 'filed', 1, 1, 'x')").run();
  d.statement("DELETE FROM chats WHERE id = 'c1'").run();
  expect(d.statement("SELECT count(*) AS n FROM compendium_receipts").get()).toEqual({ n: 0 });
});

test("migration 36 adds compendium_trees: existing scenes have none, and a purged scene takes its layouts with it", () => {
  const path = file();
  const before = reopen(path, 35);
  before.statement("INSERT INTO chats (id, title, character_id, cast_json, cast_snapshot_json, active_branch_id, created_at, updated_at, snapshot_version) VALUES ('c1', 't', 'k', 'j', '', 'b1', 1, 1, 1)").run();
  before.close();
  open.pop();
  const d = reopen(path);
  expect(columns(d, "compendium_trees")).toEqual(["seq", "id", "chat_id", "book_id", "status", "at", "cell"]);
  expect(d.statement("SELECT count(*) AS n FROM compendium_trees").get()).toEqual({ n: 0 });
  d.statement("INSERT INTO compendium_trees (id, chat_id, book_id, status, at, cell) VALUES ('t1', 'c1', 'bk', 'live', 1, 'x')").run();
  d.statement("DELETE FROM chats WHERE id = 'c1'").run();
  expect(d.statement("SELECT count(*) AS n FROM compendium_trees").get()).toEqual({ n: 0 });
});

test("migration 37 adds chats.participants_json: existing scenes carry none", () => {
  const path = file();
  const before = reopen(path, 36);
  before.statement("INSERT INTO chats (id, title, character_id, cast_json, cast_snapshot_json, active_branch_id, created_at, updated_at, snapshot_version) VALUES ('c1', 't', 'k', 'j', '', 'b1', 1, 1, 1)").run();
  before.close();
  open.pop();
  const d = reopen(path);
  expect(columns(d, "chats")).toContain("participants_json");
  expect(d.statement("SELECT participants_json FROM chats WHERE id = 'c1'").get()).toEqual({ participants_json: null });
});

test("migration 38 adds chats.regex_json: existing scenes carry none", () => {
  const path = file();
  const before = reopen(path, 37);
  before.statement("INSERT INTO chats (id, title, character_id, cast_json, cast_snapshot_json, active_branch_id, created_at, updated_at, snapshot_version) VALUES ('c1', 't', 'k', 'j', '', 'b1', 1, 1, 1)").run();
  before.close();
  open.pop();
  const d = reopen(path);
  expect(columns(d, "chats")).toContain("regex_json");
  expect(d.statement("SELECT regex_json FROM chats WHERE id = 'c1'").get()).toEqual({ regex_json: null });
});

test("migration 39 adds chats.trackers_json: existing scenes carry none", () => {
  const path = file();
  const before = reopen(path, 38);
  before.statement("INSERT INTO chats (id, title, character_id, cast_json, cast_snapshot_json, active_branch_id, created_at, updated_at, snapshot_version) VALUES ('c1', 't', 'k', 'j', '', 'b1', 1, 1, 1)").run();
  before.close();
  open.pop();
  const d = reopen(path);
  expect(columns(d, "chats")).toContain("trackers_json");
  expect(d.statement("SELECT trackers_json FROM chats WHERE id = 'c1'").get()).toEqual({ trackers_json: null });
});

test("migration 40 adds chats.final_cut_json: existing scenes carry none", () => {
  const path = file();
  const before = reopen(path, 39);
  before.statement("INSERT INTO chats (id, title, character_id, cast_json, cast_snapshot_json, active_branch_id, created_at, updated_at, snapshot_version) VALUES ('c1', 't', 'k', 'j', '', 'b1', 1, 1, 1)").run();
  before.close();
  open.pop();
  const d = reopen(path);
  expect(columns(d, "chats")).toContain("final_cut_json");
  expect(d.statement("SELECT final_cut_json FROM chats WHERE id = 'c1'").get()).toEqual({ final_cut_json: null });
});

test("migration 41 adds chats.summary_json: existing scenes carry none", () => {
  const path = file();
  const before = reopen(path, 40);
  before.statement("INSERT INTO chats (id, title, character_id, cast_json, cast_snapshot_json, active_branch_id, created_at, updated_at, snapshot_version) VALUES ('c1', 't', 'k', 'j', '', 'b1', 1, 1, 1)").run();
  before.close();
  open.pop();
  const d = reopen(path);
  expect(columns(d, "chats")).toContain("summary_json");
  expect(d.statement("SELECT summary_json FROM chats WHERE id = 'c1'").get()).toEqual({ summary_json: null });
});

test("migration 42 adds chats.director_json and director_states: existing scenes carry none, and a purged scene takes its snapshots with it", () => {
  const path = file();
  const before = reopen(path, 41);
  before.statement("INSERT INTO chats (id, title, character_id, cast_json, cast_snapshot_json, active_branch_id, created_at, updated_at, snapshot_version) VALUES ('c1', 't', 'k', 'j', '', 'b1', 1, 1, 1)").run();
  before.statement("INSERT INTO branches (id, chat_id, name, created_at, version) VALUES ('b1', 'c1', 'n', 1, 1)").run();
  before.statement("INSERT INTO messages (id, branch_id, seq, role, current_swipe, created_at) VALUES ('m1', 'b1', 1, 'user', 0, 1)").run();
  before.statement("INSERT INTO swipes (message_id, position, swipe_id, content, created_at, pinned) VALUES ('m1', 0, 's1', 'x', 1, 0)").run();
  before.close();
  open.pop();
  const d = reopen(path);
  expect(columns(d, "chats")).toContain("director_json");
  expect(d.statement("SELECT director_json FROM chats WHERE id = 'c1'").get()).toEqual({ director_json: null });
  expect(columns(d, "director_states")).toEqual(["message_id", "position", "version", "cell"]);
  d.statement("INSERT INTO director_states (message_id, position, version, cell) VALUES ('m1', 0, 1, 'x')").run();
  d.statement("DELETE FROM chats WHERE id = 'c1'").run();
  expect(d.statement("SELECT count(*) AS n FROM director_states").get()).toEqual({ n: 0 });
});

test("migration 43 adds the scene-state tables and turn_checkpoints.deltas_json, moves nothing out of branch_variables, and a purged take takes its cache and keyframes with it", () => {
  const path = file();
  const before = reopen(path, 42);
  before.statement("INSERT INTO chats (id, title, character_id, cast_json, cast_snapshot_json, active_branch_id, created_at, updated_at, snapshot_version) VALUES ('c1', 't', 'k', 'j', '', 'b1', 1, 1, 1)").run();
  before.statement("INSERT INTO branches (id, chat_id, name, created_at, version) VALUES ('b1', 'c1', 'n', 1, 1)").run();
  before.statement("INSERT INTO messages (id, branch_id, seq, role, current_swipe, created_at) VALUES ('m1', 'b1', 1, 'user', 0, 1)").run();
  before.statement("INSERT INTO swipes (message_id, position, swipe_id, content, created_at, pinned) VALUES ('m1', 0, 's1', 'x', 1, 0)").run();
  before.statement("INSERT INTO branch_variables (branch_id, variables_json) VALUES ('b1', 'old')").run();
  before.close();
  open.pop();
  const d = reopen(path);
  expect(columns(d, "swipe_deltas")).toEqual(["swipe_id", "seq", "slot", "path_json", "value_json", "removed", "at"]);
  expect(columns(d, "state_keyframes")).toEqual(["branch_id", "message_id", "state_json"]);
  expect(columns(d, "branch_state")).toEqual(["branch_id", "state_json", "tip_message_id", "tip_swipe_id"]);
  expect(columns(d, "turn_checkpoints")).toContain("deltas_json");
  // Schema only: the old variables stay where they were and nothing was made from them.
  expect(d.statement("SELECT variables_json FROM branch_variables").get()).toEqual({ variables_json: "old" });
  expect(d.statement("SELECT count(*) AS n FROM swipe_deltas").get()).toEqual({ n: 0 });
  d.statement("INSERT INTO branch_state (branch_id, state_json, tip_message_id, tip_swipe_id) VALUES ('b1', 'x', 'm1', 's1')").run();
  d.statement("INSERT INTO state_keyframes (branch_id, message_id, state_json) VALUES ('b1', 'm1', 'x')").run();
  d.statement("DELETE FROM chats WHERE id = 'c1'").run();
  expect([d.statement("SELECT count(*) AS n FROM branch_state").get(), d.statement("SELECT count(*) AS n FROM state_keyframes").get()]).toEqual([{ n: 0 }, { n: 0 }]);
});

test("migration 46 adds dramaturg_threads: existing scenes have none, and a purged scene takes its record with it", () => {
  const path = file();
  const before = reopen(path, 45);
  before.statement("INSERT INTO chats (id, title, character_id, cast_json, cast_snapshot_json, active_branch_id, created_at, updated_at, snapshot_version) VALUES ('c1', 't', 'k', 'j', '', 'b1', 1, 1, 1)").run();
  before.close();
  open.pop();
  const d = reopen(path);
  expect(columns(d, "dramaturg_threads")).toEqual(["chat_id", "revision", "cell"]);
  expect(d.statement("SELECT count(*) AS n FROM dramaturg_threads").get()).toEqual({ n: 0 });
  d.statement("INSERT INTO dramaturg_threads (chat_id, revision, cell) VALUES ('c1', 1, 'x')").run();
  d.statement("DELETE FROM chats WHERE id = 'c1'").run();
  expect(d.statement("SELECT count(*) AS n FROM dramaturg_threads").get()).toEqual({ n: 0 });
});

test("migration 47 adds external core journals without replacing migrations 44 to 46", () => {
  const path = file();
  const old = reopen(path, 47);
  old.statement("INSERT INTO chats (id, title, character_id, cast_json, cast_snapshot_json, active_branch_id, created_at, updated_at) VALUES ('core-chat', 'Core scene', 'char', '{}', '{}', 'core-branch', 1, 1)").run();
  old.statement("INSERT INTO branches (id, chat_id, name, created_at, version) VALUES ('core-branch', 'core-chat', 'Main', 1, 1)").run();
  old.statement("INSERT INTO core_sessions (id, header_cell, title_cell, updated_at) VALUES ('core-session', 'sealed-core-header', 'sealed-title', '2026-10-31T12:00:00Z')").run();
  old.statement("INSERT INTO core_entries (session_id, seq, entry_cell) VALUES ('core-session', 1, 'sealed-core-entry')").run();
  old.statement("INSERT INTO core_scene_links (chat_id, session_id, branch_id) VALUES ('core-chat', 'core-session', 'core-branch')").run();
  old.statement("INSERT INTO studio_state (key, body, updated_at) VALUES ('settings', 'sealed-studio-state', 2)").run();
  const journalBefore = old.statement("SELECT id, header_cell, title_cell, updated_at FROM core_sessions").get();
  const entriesBefore = old.statement("SELECT session_id, seq, entry_cell FROM core_entries").all();
  const linksBefore = old.statement("SELECT chat_id, session_id, branch_id FROM core_scene_links").all();
  const stateBefore = old.statement("SELECT key, body, updated_at FROM studio_state").get();
  const history = names(old);
  old.close(); open.pop();
  const upgraded = reopen(path);
  expect(names(upgraded).slice(0, 47)).toEqual(history);
  expect(columns(upgraded, "core_sessions")).toContain("header_cell");
  expect(columns(upgraded, "core_entries")).toContain("entry_cell");
  expect(columns(upgraded, "core_scene_links")).toContain("branch_id");
  expect(upgraded.statement("SELECT id, header_cell, title_cell, updated_at FROM core_sessions").get()).toEqual(journalBefore);
  expect(upgraded.statement("SELECT session_id, seq, entry_cell FROM core_entries").all()).toEqual(entriesBefore);
  expect(upgraded.statement("SELECT chat_id, session_id, branch_id FROM core_scene_links").all()).toEqual(linksBefore);
  expect(upgraded.statement("SELECT key, body, updated_at FROM studio_state").get()).toEqual(stateBefore);
  expect(upgraded.statement("SELECT revision FROM studio_state WHERE key = 'settings'").get()).toEqual({ revision: 0 });
});

test("migrations 48-51 add extension tables, revisioned state, logs, and checkpoint ownership", () => {
  const path = file();
  const before = reopen(path, 46);
  before.close(); open.pop();
  const d = reopen(path);
  expect(names(d).slice(-4).map(({ id, name }) => ({ id, name }))).toEqual([
    { id: 48, name: "executable extensions" },
    { id: 49, name: "revisioned state documents" },
    { id: 50, name: "extension operational logs" },
    { id: 51, name: "turn checkpoint extension owner" },
  ]);
  expect(columns(d, "extension_packages")).toEqual(["digest", "bytes", "body_cell"]);
  expect(columns(d, "extension_controls")).toEqual(["id_hash", "revision", "body_cell"]);
  expect(columns(d, "extension_data")).toEqual(["package_hash", "key_hash", "revision", "bytes", "body_cell"]);
  expect(columns(d, "extension_runtime_lease")).toEqual(["singleton", "epoch", "owner_cell", "expires_at", "last_now"]);
  expect(columns(d, "extension_logs")).toEqual(["seq", "package_hash", "log_hash", "body_cell"]);
  expect(columns(d, "studio_state")).toEqual(["key", "body", "updated_at", "revision"]);
  expect(columns(d, "turn_checkpoints")).toContain("extension_owner_json");
});
