/**
 * The SQLite StateStore: the Studio's own documents in `studio_state` (migration 7), one row per key,
 * the text a sealed cell. Keys are a closed list of fixed names, so they
 * say nothing about anybody's content and stay readable. Refuses every call while locked.
 */
import { refuseWhileLocked, type CellCipher } from "../../crypto/cell-cipher";
import { checkStateKey, type StateStore } from "../../contracts/state-store";
import type { StageDatabase } from "./database";
import type { ExtensionCommitContext } from "../../contracts/extension-store";
import { requireExtensionCommit } from "./extension-commit-guard";

export function sqliteStateStore(database: StageDatabase, cipher: CellCipher): StateStore {
  const { statement } = database;
  return refuseWhileLocked(
    cipher,
    {
      async read(key) {
        const row = statement("SELECT body FROM studio_state WHERE key = ?").get(checkStateKey(key)) as { body: string } | null;
        return row ? cipher.open("studio_state.body", row.body) : null;
      },
      async readVersioned(key) {
        const row = statement("SELECT body, revision FROM studio_state WHERE key = ?").get(checkStateKey(key)) as { body: string; revision: number } | null;
        return row ? { text: cipher.open("studio_state.body", row.body), revision: row.revision } : { text: null, revision: -1 };
      },
      async write(key, text) {
        if (typeof text !== "string") throw new Error("state text must be a string");
        statement(
          `INSERT INTO studio_state (key, body, updated_at, revision) VALUES (?, ?, ?, 0)
           ON CONFLICT (key) DO UPDATE SET body = excluded.body, updated_at = excluded.updated_at, revision = studio_state.revision + 1`,
        ).run(checkStateKey(key), cipher.seal("studio_state.body", text), Date.now());
      },
      async compareAndWrite(key, text, expectedRevision, context: ExtensionCommitContext) {
        const checked = checkStateKey(key);
        if (typeof text !== "string" || !Number.isSafeInteger(expectedRevision) || expectedRevision < -1) throw new Error("invalid state compare-and-write");
        return database.transaction(() => {
          requireExtensionCommit(database, cipher, context);
          const cell = cipher.seal("studio_state.body", text);
          if (expectedRevision === -1) {
            const result = statement("INSERT OR IGNORE INTO studio_state (key, body, updated_at, revision) VALUES (?, ?, ?, 0)").run(checked, cell, Date.now());
            return result.changes === 1 ? "saved" : "stale";
          }
          const result = statement("UPDATE studio_state SET body = ?, updated_at = ?, revision = revision + 1 WHERE key = ? AND revision = ?")
            .run(cell, Date.now(), checked, expectedRevision);
          return result.changes === 1 ? "saved" : "stale";
        });
      },
    } satisfies StateStore,
    database.idle,
  );
}
