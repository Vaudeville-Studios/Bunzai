/**
 * The one SQLite database: opening it, its pragmas, numbered migrations, the transaction
 * helper every store uses, and closing it cleanly. Lessons from the runtime spike
 * (scripts/probe-sqlite-runtime.ts) are rules here: transactions are explicit BEGIN and COMMIT,
 * never Bun's `db.transaction()`, and close finalizes cached statements and throws if it cannot.
 */
import { Database, type Statement } from "bun:sqlite";
import { statSync, statfsSync } from "node:fs";
import { dirname } from "node:path";
import { toErrorMessage } from "../../../error-message";
import { runInBackground } from "./background";

export interface Migration {
  /** 1, 2, 3, ... with no gaps; the order they apply in. */
  id: number;
  name: string;
  sql: string;
}

export interface StageDatabase {
  /** The raw handle, for pragmas and tests. Stores run SQL through `statement`, never `db.query`. */
  readonly db: Database;
  /**
   * A prepared statement for this SQL, made once and reused, and finalized by `close`. Bun's own
   * `db.query` cache does not release every statement it made, which leaves `close` failing with
   * "database is locked" (found by the ChatStore suite, 2026-09-23).
   */
  statement(sql: string): Statement;
  /**
   * Runs `work` atomically: a transaction, or a savepoint when one is already open, so two stores
   * can share one atomic write. `work` must be synchronous; anything awaited inside it would run
   * after the commit.
   */
  transaction<T>(work: () => T): T;
  /**
   * Registers the one step that runs inside every outermost transaction, right before COMMIT, so a
   * row's fingerprint is committed with the row. If it throws,
   * the transaction rolls back. The step must do nothing when there is nothing to do.
   */
  setCommitSeal(seal: (() => void) | null): void;
  /**
   * Runs the commit seal now, in an empty transaction, so rows queued for a fingerprint (a restore's)
   * are signed. A failure is recorded in `library_meta` (`seal_owed`, like an owed key cleanup),
   * stays queued, is retried by the next commit that seals, and is thrown to the caller.
   */
  sealNow(): Promise<void>;
  /** Why a seal is still owed, or null. Cleared by the first outermost commit whose seal succeeds. */
  sealOwed(): string | null;
  /**
   * Moves everything in the WAL into the main file and empties the WAL, so deleted rows (a removed
   * key copy, replaced recovery words) leave no readable copy behind.
   * With secure_delete on, the freed pages in the main file are already zeroed. Verifies the WAL
   * really is empty, retrying briefly; an open reader can block it, and then this rejects with
   * ScrubIncompleteError naming every registered reader. It never fails silently, and it never holds
   * the main thread for more than a few tens of milliseconds at a time.
   */
  scrub(): Promise<void>;
  /**
   * A second, read-only connection to the same file, registered under a purpose ("backup", "export")
   * so anything that blocks a scrub can be named. The only sanctioned way to open another reader.
   */
  openReader(purpose: string): StageReader;
  /** Tracks a worker-owned SQLite reader and cancels its job if library close closes the lease. */
  openWorkerReader(purpose: string, cancel: () => void): { close(): void };
  /** The readers open right now, oldest first. */
  readers(): readonly ReaderInfo[];
  /**
   * Rewrites the whole file so nothing deleted survives anywhere in it. SQLite's VACUUM builds a complete new copy and swaps it in, and a crash at
   * any point leaves the original whole. Refuses to start without room for that copy, and checks
   * the result's integrity before returning. On a file it runs in the background lane, on its own
   * thread and connection, so the app never freezes behind it; meanwhile `idle()` is pending.
   */
  rebuild(): Promise<void>;
  /**
   * Resolves when no background job is working on the file. Stores wait on it before each method, so
   * a write never blocks the main thread on a lock the background lane holds.
   */
  idle(): Promise<void>;
  /**
   * Runs one background job that must be alone on the file (a rebuild, a restore): waits for any other,
   * and holds `idle()` pending until `job` settles, so no store write meets the lock it takes.
   */
  exclusive<T>(job: () => Promise<T>): Promise<T>;
  /** Throws, changing nothing, when there is no room to rebuild; checked before a change that needs one. */
  assertRoomToRebuild(): void;
  /**
   * Runs synchronous `work` without freezing the app while another process holds the file (Kit, the
   * MCP server, a second window): each try takes the lock or fails at once, and the app runs between
   * tries. After `limitMs` it gives up with StageBusyError. Stores in live use run their SQL through it.
   */
  patiently<T>(work: () => T, limitMs?: number): Promise<T>;
  /** Refresh bounded planner statistics after a large import, yielding around competing writers. */
  optimize(): Promise<void>;
  close(): void;
}

export interface ReaderInfo {
  readonly id: number;
  readonly purpose: string;
  /** Epoch ms. */
  readonly openedAt: number;
}

export interface StageReader extends ReaderInfo {
  readonly db: Database;
  close(): void;
}

type RegisteredReader = ReaderInfo & { close(): void; worker?: boolean };

export class StageDatabaseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StageDatabaseError";
  }
}

/**
 * Another connection held the write lock past a write's limit (`patiently`). The message is the
 * user's. Its name stays StageDatabaseError: the server maps storage errors by name, since the UI
 * does not reach into the storage backend (D18), and a busy library is answered 503 like the rest.
 */
export class StageBusyError extends StageDatabaseError {
  constructor() {
    super("the library is busy in another window; try again in a moment");
  }
}

const BUSY_TIMEOUT_MS = 5000;
const SEAL_OWED = "seal_owed";
const DML = /^\s*(?:insert|update|delete|replace)\b/i;
const isBusy = (error: unknown): boolean =>
  typeof error === "object" && error !== null && /SQLITE_BUSY/.test(String((error as { code?: unknown }).code ?? ""));

/** The WAL could not be emptied, so removed data may still be in it. Names what was holding it. */
export class ScrubIncompleteError extends StageDatabaseError {
  constructor(readers: readonly ReaderInfo[]) {
    const held = readers.length
      ? readers.map((r) => `${r.purpose} (open since ${new Date(r.openedAt).toISOString()})`).join(", ")
      : "a connection outside this process";
    super(`the write-ahead log could not be emptied while another reader was open: ${held}`);
    this.name = "ScrubIncompleteError";
  }
}

function checkMigrationList(migrations: readonly Migration[]): void {
  migrations.forEach((m, index) => {
    if (m.id !== index + 1) throw new StageDatabaseError(`migration ${m.name} has id ${m.id}; expected ${index + 1}`);
  });
}

/** Opens (creating if needed) the database at `path` and brings it up to date. `:memory:` for tests. */
export interface StageDatabaseOptions {
  /** Free bytes on the disk holding the file; replaceable so tests can simulate a full disk. */
  freeSpace?: (directory: string) => number;
}

export const diskFreeSpace = (directory: string): number => {
  const s = statfsSync(directory);
  return Number(s.bavail) * Number(s.bsize);
};

export function openStageDatabase(path: string, migrations: readonly Migration[], options: StageDatabaseOptions = {}): StageDatabase {
  checkMigrationList(migrations);
  const db = new Database(path, { create: true, strict: true });
  let savepoints = 0;
  const statements = new Map<string, Statement>();
  const openReaders = new Map<number, RegisteredReader>();
  let nextReader = 1;
  let opened = false;
  let commitSeal: (() => void) | null = null;
  let owedSeal: string | null = null;
  let lastChanges: Statement | null = null;
  const statement = (sql: string): Statement => {
    let prepared = statements.get(sql);
    if (!prepared) {
      prepared = db.prepare(sql);
      // Bun's `changes` counts every row a trigger writes (the row fingerprints' triggers, the derived
      // cache's), so a store reading it as "rows this statement changed" would be wrong. SQLite's own
      // changes() leaves trigger and foreign-key writes out, which is the number the stores mean.
      if (DML.test(sql)) {
        const raw = prepared;
        // A Proxy, because Bun's Statement keeps `run` as a property that cannot be reassigned.
        prepared = new Proxy(raw, {
          get(target, key) {
            if (key === "run") {
              return (...params: Parameters<Statement["run"]>) => {
                const result = target.run(...params);
                lastChanges ??= db.prepare("SELECT changes() AS n");
                return { ...result, changes: (lastChanges.get() as { n: number }).n };
              };
            }
            const value = Reflect.get(target, key, target);
            return typeof value === "function" ? value.bind(target) : value;
          },
        });
      }
      statements.set(sql, prepared);
    }
    return prepared;
  };

  const transaction = <T>(work: () => T): T => {
    const nested = db.inTransaction;
    const name = `sp${++savepoints}`;
    db.run(nested ? `SAVEPOINT ${name}` : "BEGIN IMMEDIATE");
    try {
      const result = work();
      if (result instanceof Promise) {
        void result.catch(() => undefined);
        throw new StageDatabaseError("a transaction's work must be synchronous");
      }
      const settles = !nested && commitSeal !== null && owedSeal !== null;
      if (!nested) commitSeal?.();
      if (settles) statement("DELETE FROM library_meta WHERE key = ?").run(SEAL_OWED);
      db.run(nested ? `RELEASE ${name}` : "COMMIT");
      if (settles) owedSeal = null;
      return result;
    } catch (error) {
      // SQLite can end the whole transaction on its own (a full disk, for one). Then there is no
      // savepoint left to roll back to, and trying would replace the real error with a wrong one.
      if (nested && db.inTransaction) {
        db.run(`ROLLBACK TO ${name}`);
        db.run(`RELEASE ${name}`);
      } else if (!nested && db.inTransaction) {
        db.run("ROLLBACK");
      }
      throw error;
    }
  };

  const optimizeNow = (initial: boolean): void => {
    db.run("PRAGMA busy_timeout = 0");
    try {
      statement(initial ? "PRAGMA optimize=0x10002" : "PRAGMA optimize").all();
    } catch (error) {
      if (!isBusy(error)) throw error;
    } finally {
      db.run(`PRAGMA busy_timeout = ${BUSY_TIMEOUT_MS}`);
    }
  };
  const close = () => {
    for (const reader of [...openReaders.values()]) if (reader.worker) reader.close();
    try {
      if (opened) optimizeNow(false);
    } finally {
      opened = false;
      for (const reader of [...openReaders.values()]) reader.close();
      for (const prepared of statements.values()) prepared.finalize();
      lastChanges?.finalize();
      statements.clear();
      // Bun has this at runtime but its type definitions leave it out; it covers any db.query use.
      (db as Database & { clearQueryCache?: () => void }).clearQueryCache?.();
      db.close(true);
    }
  };

  try {
    if (path !== ":memory:") {
      const mode = statement("PRAGMA journal_mode = WAL").get() as { journal_mode: string };
      if (mode.journal_mode !== "wal") throw new StageDatabaseError(`journal_mode is ${mode.journal_mode}, not wal`);
      // FULL, not NORMAL: in WAL mode NORMAL can lose the last commits on power loss. A chat app's
      // writes are small, and a reply the user saw saved should still be there after a crash.
      db.run("PRAGMA synchronous = FULL");
    }
    db.run("PRAGMA foreign_keys = ON");
    db.run(`PRAGMA busy_timeout = ${BUSY_TIMEOUT_MS}`);
    // Deleted content is overwritten with zeros instead of left in free pages, where anyone with the
    // file could read it back (the encryption review found a removed key copy that way).
    db.run("PRAGMA secure_delete = ON");
    db.run("CREATE TABLE IF NOT EXISTS _migrations (id INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at INTEGER NOT NULL)");

    const applied = statement("SELECT id, name FROM _migrations ORDER BY id").all() as { id: number; name: string }[];
    for (const row of applied) {
      const known = migrations[row.id - 1];
      // A newer build wrote this file. Writing to a schema this build does not know could corrupt it.
      if (!known || known.name !== row.name) {
        throw new StageDatabaseError(`this database has migration ${row.id} (${row.name}), which this version does not know`);
      }
    }
    const done = new Set(applied.map((row) => row.id));
    for (const migration of migrations.filter((m) => !done.has(m.id))) {
      // Foreign keys go off around a migration, because SQLite's way to change a table (copy it,
      // drop the old one, rename) would otherwise cascade-delete every child row. The pragma is a
      // no-op inside a transaction, so it is set outside, and every reference is checked before
      // the migration commits instead.
      db.run("PRAGMA foreign_keys = OFF");
      try {
        transaction(() => {
          // Only references this migration breaks count: one that was already broken must not
          // leave the file unopenable by every later version.
          const key = (r: unknown) => JSON.stringify(r);
          const before = new Set(statement("PRAGMA foreign_key_check").all().map(key));
          db.run(migration.sql);
          const broken = statement("PRAGMA foreign_key_check").all().filter((r) => !before.has(key(r)));
          if (broken.length > 0) {
            throw new StageDatabaseError(`migration ${migration.name} leaves ${broken.length} broken reference(s)`);
          }
          statement("INSERT INTO _migrations (id, name, applied_at) VALUES (?, ?, ?)").run(migration.id, migration.name, Date.now());
        });
      } finally {
        db.run("PRAGMA foreign_keys = ON");
      }
    }
    optimizeNow(true);
    opened = true;
    // A database with its own test migrations may have no library_meta; then no seal is owed.
    if (statement("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'library_meta'").get()) {
      owedSeal = (statement("SELECT value FROM library_meta WHERE key = ?").get(SEAL_OWED) as { value: string } | null)?.value ?? null;
    }
  } catch (error) {
    close();
    throw error;
  }

  const openReader = (purpose: string): StageReader => {
    if (path === ":memory:") throw new StageDatabaseError("an in-memory database has no second reader");
    if (typeof purpose !== "string" || !purpose.trim()) throw new StageDatabaseError("a reader needs a purpose");
    const handle = new Database(path, { readonly: true, strict: true });
    const id = nextReader++;
    const reader: StageReader = {
      id,
      purpose: purpose.trim(),
      openedAt: Date.now(),
      db: handle,
      close: () => {
        if (!openReaders.delete(id)) return;
        (handle as Database & { clearQueryCache?: () => void }).clearQueryCache?.();
        handle.close(true);
      },
    };
    openReaders.set(id, reader);
    return reader;
  };
  const openWorkerReader = (purpose: string, cancel: () => void): { close(): void } => {
    if (path === ":memory:") throw new StageDatabaseError("an in-memory database has no worker reader");
    if (typeof purpose !== "string" || !purpose.trim()) throw new StageDatabaseError("a reader needs a purpose");
    const id = nextReader++;
    let closed = false;
    const reader: RegisteredReader = {
      id, purpose: purpose.trim(), openedAt: Date.now(), worker: true,
      close: () => {
        if (closed) return;
        closed = true;
        try { cancel(); } finally { openReaders.delete(id); }
      },
    };
    openReaders.set(id, reader);
    return { close: reader.close };
  };
  const readers = (): readonly ReaderInfo[] =>
    [...openReaders.values()].map(({ id, purpose, openedAt }) => ({ id, purpose, openedAt }));

  const scrub = async () => {
    if (path === ":memory:") return;
    // Success is exactly busy 0 and log 0. Never synchronously wait on a reader; bounded retries
    // below yield to the app while a registered reader holds its snapshot.
    for (let attempt = 0; attempt < 8; attempt++) {
      db.run("PRAGMA busy_timeout = 0");
      let r: { busy: number; log: number; checkpointed: number };
      try {
        r = statement("PRAGMA wal_checkpoint(TRUNCATE)").get() as { busy: number; log: number; checkpointed: number };
      } finally {
        db.run(`PRAGMA busy_timeout = ${BUSY_TIMEOUT_MS}`);
      }
      if (r.busy === 0 && r.log === 0) return;
      await Bun.sleep(40 * (attempt + 1));
    }
    throw new ScrubIncompleteError(readers());
  };

  const assertRoomToRebuild = () => {
    if (path === ":memory:") return;
    // VACUUM needs room for a full second copy, plus the WAL it writes on the way.
    const size = statSync(path).size;
    const free = (options.freeSpace ?? diskFreeSpace)(dirname(path));
    if (free < size * 2 + 16 * 1024 * 1024) {
      throw new StageDatabaseError("not enough free disk space to rebuild the database safely; nothing was changed");
    }
  };

  let working: Promise<unknown> | null = null;
  const idle = async () => {
    while (working) await working.catch(() => undefined);
  };
  const exclusive = async <T>(job: () => Promise<T>): Promise<T> => {
    // Checked again after every wait, with nothing awaited between the last check and the claim,
    // so two callers waking together cannot both take the slot.
    while (working) await working.catch(() => undefined);
    const run = job();
    working = run;
    try {
      return await run;
    } finally {
      working = null;
    }
  };

  const rebuild = () => exclusive(async () => {
    if (db.inTransaction) throw new StageDatabaseError("cannot rebuild the database inside a transaction");
    assertRoomToRebuild();
    if (path === ":memory:") {
      // Tests only: an in-memory database cannot be opened by a second thread, and is tiny.
      db.run("VACUUM");
      return;
    }
    // Folded in first, so the background connection rebuilds everything this one has written.
    await scrub();
    const result = await runInBackground({ kind: "rebuild", path });
    if (!result.ok) throw new StageDatabaseError(`the database could not be rebuilt: ${result.reason}`);
    await scrub();
  });

  const patiently = async <T>(work: () => T, limitMs = 10_000): Promise<T> => {
    // An exclusive job (a restore) holds the file for as long as it takes: a writer waits for it, however long, instead of failing at its limit.
    await idle();
    let deadline = performance.now() + limitMs;
    for (let attempt = 0; ; attempt++) {
      // No wait inside a try: SQLite's own busy wait sleeps on the main thread, in 15.6 ms steps on
      // Windows, so even a 20 ms timeout froze the app for about 90 ms a try (chat-store-busy test).
      db.run("PRAGMA busy_timeout = 0");
      try {
        return work();
      } catch (error) {
        if (isBusy(error) && working) {
          await idle();
          deadline = performance.now() + limitMs;
          continue;
        }
        if (!isBusy(error) || performance.now() > deadline) {
          if (isBusy(error)) throw new StageBusyError();
          throw error;
        }
      } finally {
        db.run(`PRAGMA busy_timeout = ${BUSY_TIMEOUT_MS}`);
      }
      await Bun.sleep(Math.min(10 * (attempt + 1), 100));
    }
  };

  const optimize = async (): Promise<void> => {
    await idle();
    await patiently(() => { statement("PRAGMA optimize").all(); });
  };
  const setCommitSeal = (seal: (() => void) | null): void => { commitSeal = seal; };
  const sealNow = async (): Promise<void> => {
    try {
      await patiently(() => transaction(() => undefined));
    } catch (error) {
      owedSeal = toErrorMessage(error, "the seal failed");
      try {
        statement("INSERT INTO library_meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value").run(SEAL_OWED, owedSeal);
      } catch {
        // The record could not be written either (the same fault); the in-memory note and the queue remain.
      }
      throw error;
    }
  };
  const sealOwed = (): string | null => owedSeal;
  return { db, statement, transaction, setCommitSeal, sealNow, sealOwed, scrub, openReader, openWorkerReader, readers, rebuild, idle, exclusive, assertRoomToRebuild, patiently, optimize, close };
}
