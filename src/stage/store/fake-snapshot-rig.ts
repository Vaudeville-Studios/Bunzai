/**
 * Test support for the snapshot suites: a real encrypted library on a real file (fake key vault and
 * fast password lock, as the keyring tests use), with a snapshot store beside it. Imported only by tests.
 */
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CANONICAL_SCHEMA_VERSION } from "../../core/canonical";
import { cellCipher } from "../crypto/cell-cipher";
import { fakeComputer } from "../crypto/fake-device-vault";
import { fastPasswords } from "../crypto/fake-password-lock";
import { createKeyring, type DeviceVault } from "../crypto/keyring";
import { createContentStore } from "./content-store";
import { sqliteChatStore } from "./sqlite-chat-store";
import { openStageDatabase } from "./sqlite/database";
import { sqliteDocumentBackend } from "./sqlite/document-backend";
import { MIGRATIONS } from "./sqlite/migrations";
import { createSnapshotStore, type SnapshotStoreOptions } from "./sqlite/snapshots";

export interface Rig {
  dir: string;
  path: string;
  snapDir: string;
  vault: DeviceVault;
  d: ReturnType<typeof openStageDatabase>;
  ring: ReturnType<typeof createKeyring>;
  cipher: ReturnType<typeof cellCipher>;
  chats: ReturnType<typeof sqliteChatStore>;
  documents: ReturnType<typeof sqliteDocumentBackend>;
  library: ReturnType<typeof createContentStore>;
  snapshots: ReturnType<typeof createSnapshotStore>;
  /** The recovery words, when the rig made them. */
  words: string;
  close(): void;
}

export const card = (id: string, name: string) => ({
  schemaVersion: CANONICAL_SCHEMA_VERSION,
  kind: "character",
  id,
  body: { identity: { name }, persona: {}, prompts: {}, greetings: {}, examples: {}, media: {}, attribution: {}, discovery: {} },
});

export async function addChat(rig: Rig, title: string, messages = 2): Promise<string> {
  const chat = await rig.chats.createChat({ title, cast: { character: { id: "c1", version: 1 } }, snapshot: { character: card("c1", "Snap") } });
  for (let i = 0; i < messages; i++) await rig.chats.appendMessage(chat.activeBranchId, { role: i % 2 ? "assistant" : "user", content: `${title} line ${i}` });
  return chat.id;
}

export async function makeRig(opts: { words?: boolean; password?: string; vault?: DeviceVault; snapshots?: Partial<SnapshotStoreOptions>; dir?: string } = {}): Promise<Rig> {
  const dir = opts.dir ?? mkdtempSync(join(tmpdir(), "bunzai-snap-"));
  const path = join(dir, "library.db");
  const vault = opts.vault ?? fakeComputer();
  const d = openStageDatabase(path, MIGRATIONS);
  const ring = createKeyring(d, vault, { passwords: fastPasswords() });
  await ring.setup();
  const cipher = cellCipher(() => ring.keys());
  const documents = sqliteDocumentBackend(d, cipher);
  let words = "";
  if (opts.words !== false) {
    words = ring.beginWords();
    await ring.confirmWords(words);
  }
  if (opts.password) await ring.setPassword(opts.password, { mode: "each-open" });
  const snapDir = join(dir, "library.db.snapshots");
  const rig: Rig = {
    dir, path, snapDir, vault, d, ring, cipher, words, documents,
    chats: sqliteChatStore(d, cipher),
    library: createContentStore(documents),
    snapshots: createSnapshotStore({ database: d, path, dir: snapDir, cipher, ...opts.snapshots }),
    close() {
      d.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
  return rig;
}

/** Makes a structurally pre-migration-24 snapshot: later tables, triggers and columns are removed with their migration records. */
export function asBeforeHealthCheck(file: string): void {
  const db = new Database(file);
  try {
    for (const t of db.query("SELECT name FROM sqlite_master WHERE type = 'trigger' AND name LIKE 'fp_%'").all() as { name: string }[]) db.run(`DROP TRIGGER ${t.name}`);
    for (const table of ["core_pending_extension_state", "core_message_links", "core_operation_projections", "core_scene_creation_bindings"]) db.run(`DROP TABLE ${table}`);
    for (const table of ["row_fingerprints", "fp_dirty", "set_aside", "extension_logs"]) db.run(`DROP TABLE ${table}`);
    db.run("DROP TABLE compendium_receipts");
    db.run("DROP TABLE compendium_trees");
    db.run("DROP TABLE director_states");
    for (const table of ["swipe_deltas", "message_deltas", "state_keyframes", "branch_state", "branch_base"]) db.run(`DROP TABLE ${table}`);
    db.run("ALTER TABLE turn_checkpoints DROP COLUMN deltas_json");
    db.run("ALTER TABLE turn_checkpoints DROP COLUMN extension_owner_json");
    db.run("DROP TABLE dramaturg_threads");
    for (const table of ["extension_packages", "extension_controls", "extension_data", "extension_receipts", "extension_budget_usage", "extension_budget_reservations", "extension_runtime_lease"]) db.run(`DROP TABLE ${table}`);
    db.run("DROP TABLE persona_stats");
    db.run("ALTER TABLE studio_state DROP COLUMN revision");
    db.run("ALTER TABLE swipes DROP COLUMN cut_at");
    db.run("ALTER TABLE messages DROP COLUMN hidden");
    db.run("ALTER TABLE messages DROP COLUMN persona_json");
    db.run("DROP INDEX chats_import_key");
    db.run("ALTER TABLE chats DROP COLUMN import_key");
    db.run("ALTER TABLE chats DROP COLUMN prompting_json");
    db.run("ALTER TABLE chats DROP COLUMN backdrop_json");
    db.run("ALTER TABLE chats DROP COLUMN participants_json");
    db.run("ALTER TABLE chats DROP COLUMN final_cut_json");
    db.run("ALTER TABLE chats DROP COLUMN summary_json");
    db.run("ALTER TABLE chats DROP COLUMN director_json");
    db.run("ALTER TABLE chats DROP COLUMN regex_json");
    db.run("ALTER TABLE chats DROP COLUMN trackers_json");
    db.run("ALTER TABLE chats DROP COLUMN compendium_json");
    db.run("ALTER TABLE chats DROP COLUMN opening_json");
    db.run("ALTER TABLE chats DROP COLUMN variant_id");
    db.run("ALTER TABLE chats DROP COLUMN stats_state");
    db.run("DELETE FROM _migrations WHERE id >= 24");
  } finally {
    db.close(true);
  }
}
