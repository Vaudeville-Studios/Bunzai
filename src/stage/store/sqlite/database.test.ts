/**
 * The database module: migrations apply once and fail closed, WAL on a real file, a clean close, and
 * the transaction helper's rollback and savepoint behavior.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStageDatabase, ScrubIncompleteError, StageDatabaseError, type Migration, type StageDatabase } from "./database";
import { MIGRATIONS } from "./migrations";

const open: StageDatabase[] = [];
const dirs: string[] = [];
afterEach(() => {
  for (const handle of open.splice(0)) {
    try {
      handle.close();
    } catch {
      // Already closed by the test.
    }
  }
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const tempFile = () => {
  const dir = mkdtempSync(join(tmpdir(), "bunzai-db-"));
  dirs.push(dir);
  return join(dir, "bunzai.db");
};
const track = (handle: StageDatabase) => {
  open.push(handle);
  return handle;
};

const one: Migration = { id: 1, name: "t", sql: "CREATE TABLE t (x INTEGER);" };
const two: Migration = { id: 2, name: "u", sql: "CREATE TABLE u (y INTEGER); CREATE TABLE u2 (z INTEGER);" };
const tables = (d: StageDatabase) =>
  (d.db.query("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all() as { name: string }[]).map((r) => r.name);

describe("migrations", () => {
  test("apply in order, once, including every statement in a migration", () => {
    const path = tempFile();
    track(openStageDatabase(path, [one])).close();
    const d = track(openStageDatabase(path, [one, two]));
    expect(tables(d)).toEqual(["_migrations", "sqlite_stat1", "t", "u", "u2"]);
    expect(d.db.query("SELECT id, name FROM _migrations ORDER BY id").all()).toEqual([
      { id: 1, name: "t" },
      { id: 2, name: "u" },
    ]);
  });

  test("a failing migration rolls back whole and is not recorded", () => {
    const path = tempFile();
    const broken: Migration = { id: 2, name: "u", sql: "CREATE TABLE u (y INTEGER); THIS IS NOT SQL;" };
    expect(() => openStageDatabase(path, [one, broken])).toThrow();
    const d = track(openStageDatabase(path, [one]));
    expect(tables(d)).toEqual(["_migrations", "sqlite_stat1", "t"]);
    expect(d.db.query("SELECT count(*) AS n FROM _migrations").get()).toEqual({ n: 1 });
  });

  test("a database with a migration this version does not know is refused, not written", () => {
    const path = tempFile();
    track(openStageDatabase(path, [one, two])).close();
    expect(() => openStageDatabase(path, [one])).toThrow(StageDatabaseError);
    expect(() => openStageDatabase(path, [one, { ...two, name: "renamed" }])).toThrow(StageDatabaseError);
  });

  test("a migration list with a gap or wrong order is refused", () => {
    expect(() => openStageDatabase(":memory:", [two])).toThrow(StageDatabaseError);
    expect(() => openStageDatabase(":memory:", [two, one])).toThrow(StageDatabaseError);
  });

  test("a migration that rebuilds a parent table keeps its child rows", () => {
    const path = tempFile();
    const parent: Migration = {
      id: 1,
      name: "tree",
      sql: "CREATE TABLE p (id TEXT PRIMARY KEY); CREATE TABLE c (pid TEXT REFERENCES p (id) ON DELETE CASCADE);",
    };
    const d = openStageDatabase(path, [parent]);
    d.transaction(() => {
      d.db.run("INSERT INTO p VALUES ('a')");
      d.db.run("INSERT INTO c VALUES ('a')");
    });
    d.close();
    // SQLite's documented way to change a table: make a new one, copy, drop the old, rename.
    const rebuild: Migration = {
      id: 2,
      name: "rebuild p",
      sql: "CREATE TABLE p2 (id TEXT PRIMARY KEY, extra TEXT); INSERT INTO p2 (id) SELECT id FROM p; DROP TABLE p; ALTER TABLE p2 RENAME TO p;",
    };
    const again = track(openStageDatabase(path, [parent, rebuild]));
    expect(again.db.query("SELECT count(*) AS n FROM c").get()).toEqual({ n: 1 });
    expect(again.db.query("PRAGMA foreign_keys").get()).toEqual({ foreign_keys: 1 });
  });

  test("a migration that leaves a broken reference is refused and rolled back", () => {
    const path = tempFile();
    const tree: Migration = { id: 1, name: "tree", sql: "CREATE TABLE p (id TEXT PRIMARY KEY); CREATE TABLE c (pid TEXT REFERENCES p (id));" };
    const orphan: Migration = { id: 2, name: "orphan", sql: "INSERT INTO c VALUES ('nobody');" };
    track(openStageDatabase(path, [tree])).close();
    expect(() => openStageDatabase(path, [tree, orphan])).toThrow(StageDatabaseError);
    const d = track(openStageDatabase(path, [tree]));
    expect(d.db.query("SELECT count(*) AS n FROM c").get()).toEqual({ n: 0 });
  });

  test("a broken reference that was already there does not block an unrelated migration", () => {
    const path = tempFile();
    const tree: Migration = { id: 1, name: "tree", sql: "CREATE TABLE p (id TEXT PRIMARY KEY); CREATE TABLE c (pid TEXT REFERENCES p (id));" };
    const d = openStageDatabase(path, [tree]);
    d.db.run("PRAGMA foreign_keys = OFF");
    d.db.run("INSERT INTO c VALUES ('nobody')");
    d.close();
    const unrelated: Migration = { id: 2, name: "unrelated", sql: "CREATE TABLE q (x INTEGER);" };
    const again = track(openStageDatabase(path, [tree, unrelated]));
    expect(tables(again)).toContain("q");
  });

  test("the app's own migrations apply to a fresh database", () => {
    const d = track(openStageDatabase(":memory:", MIGRATIONS));
    expect(tables(d)).toEqual(expect.arrayContaining(["documents", "document_versions"]));
  });
});

describe("the file", () => {
  test("uses WAL with foreign keys on, keeps data across a reopen, and closes without leftovers", () => {
    const path = tempFile();
    const d = openStageDatabase(path, [one]);
    expect(d.db.query("PRAGMA journal_mode").get()).toEqual({ journal_mode: "wal" });
    expect(d.db.query("PRAGMA foreign_keys").get()).toEqual({ foreign_keys: 1 });
    expect(d.db.query("PRAGMA synchronous").get()).toEqual({ synchronous: 2 });
    d.transaction(() => d.db.query("INSERT INTO t (x) VALUES (?)").run(7));
    d.close();
    expect(readdirSync(join(path, "..")).sort()).toEqual(["bunzai.db"]);
    const again = track(openStageDatabase(path, [one]));
    expect(again.db.query("SELECT x FROM t").all()).toEqual([{ x: 7 }]);
  });

  // Only meaningful on Windows, where an open file cannot be removed; elsewhere it always passes.
  // The contract suites closing after every test are the cross-platform proof.
  test("close really closes, so the file can be removed at once", () => {
    const path = tempFile();
    const d = openStageDatabase(path, [one]);
    d.db.query("SELECT x FROM t").all();
    d.close();
    rmSync(path);
    expect(existsSync(path)).toBe(false);
  });
});

describe("readers and scrubbing", () => {
  test("a registered reader holding a read open makes scrub fail loudly, naming it; once closed, scrub empties the WAL", async () => {
    const path = tempFile();
    const d = track(openStageDatabase(path, [one]));
    d.transaction(() => d.db.query("INSERT INTO t (x) VALUES (1)").run());
    const reader = d.openReader("nightly backup");
    expect(d.readers().map((r) => r.purpose)).toEqual(["nightly backup"]);
    reader.db.run("BEGIN");
    reader.db.query("SELECT * FROM t").all();
    d.transaction(() => d.db.query("INSERT INTO t (x) VALUES (2)").run());
    const error = await d.scrub().then(() => null, (e: unknown) => e);
    expect(error).toBeInstanceOf(ScrubIncompleteError);
    expect((error as Error).message).toContain("nightly backup");
    reader.db.run("COMMIT");
    reader.close();
    expect(d.readers()).toEqual([]);
    await d.scrub();
    expect(statSync(`${path}-wal`).size).toBe(0);
  });

  test("a reader needs a purpose, and closing the database closes its readers", () => {
    const path = tempFile();
    const d = openStageDatabase(path, [one]);
    expect(() => d.openReader("  ")).toThrow(StageDatabaseError);
    const reader = d.openReader("export");
    d.close();
    expect(() => reader.db.query("SELECT 1").get()).toThrow();
  });
});

describe("transactions", () => {
  const rows = (d: StageDatabase) => (d.db.query("SELECT x FROM t ORDER BY x").all() as { x: number }[]).map((r) => r.x);

  test("a throw rolls everything back and rethrows", () => {
    const d = track(openStageDatabase(":memory:", [one]));
    expect(() =>
      d.transaction(() => {
        d.db.query("INSERT INTO t (x) VALUES (1)").run();
        throw new Error("boom");
      }),
    ).toThrow("boom");
    expect(rows(d)).toEqual([]);
    expect(d.db.inTransaction).toBe(false);
  });

  test("a nested failure undoes only its own part, and the outer write commits", () => {
    const d = track(openStageDatabase(":memory:", [one]));
    d.transaction(() => {
      d.db.query("INSERT INTO t (x) VALUES (1)").run();
      expect(() =>
        d.transaction(() => {
          d.db.query("INSERT INTO t (x) VALUES (2)").run();
          throw new Error("inner");
        }),
      ).toThrow("inner");
      d.db.query("INSERT INTO t (x) VALUES (3)").run();
    });
    expect(rows(d)).toEqual([1, 3]);
  });

  test("a nested success commits with the outer, and an outer failure undoes both", () => {
    const d = track(openStageDatabase(":memory:", [one]));
    expect(() =>
      d.transaction(() => {
        d.transaction(() => d.db.query("INSERT INTO t (x) VALUES (1)").run());
        throw new Error("outer");
      }),
    ).toThrow("outer");
    expect(rows(d)).toEqual([]);
  });

  test("when SQLite itself ends the transaction inside nested work, the real error reaches the caller", () => {
    const d = track(openStageDatabase(":memory:", [one]));
    // Stands in for SQLITE_FULL and the like, which roll the whole transaction back on their own.
    const real = new Error("disk full");
    expect(() =>
      d.transaction(() => {
        d.transaction(() => {
          d.db.run("ROLLBACK");
          throw real;
        });
      }),
    ).toThrow("disk full");
    expect(d.db.inTransaction).toBe(false);
    expect(rows(d)).toEqual([]);
  });

  test("async work is refused and rolled back, since it would outlive the commit", () => {
    const d = track(openStageDatabase(":memory:", [one]));
    expect(() =>
      d.transaction(() => {
        d.db.query("INSERT INTO t (x) VALUES (1)").run();
        return Promise.resolve();
      }),
    ).toThrow(StageDatabaseError);
    expect(rows(d)).toEqual([]);
  });
});

describe("writers during an exclusive job (a restore)", () => {
  test("a write that finds the file busy keeps waiting while an exclusive job runs, past its own limit, and then succeeds", async () => {
    const path = tempFile();
    const d = track(openStageDatabase(path, [one]));
    const { Database } = await import("bun:sqlite");
    const other = new Database(path);
    const job = d.exclusive(async () => {
      other.run("BEGIN IMMEDIATE"); // what the restore's connection holds for its whole transaction
      await Bun.sleep(500);
      other.run("COMMIT");
    });
    await Bun.sleep(30);
    await d.patiently(() => d.statement("INSERT INTO t (x) VALUES (1)").run(), 100); // its limit is far shorter than the job
    await job;
    other.close(true);
    expect((d.db.query("SELECT count(*) AS n FROM t").get() as { n: number }).n).toBe(1);
  });

  test("a write already retrying when an exclusive job starts keeps waiting for it, past its limit", async () => {
    const path = tempFile();
    const d = track(openStageDatabase(path, [one]));
    const { Database } = await import("bun:sqlite");
    const other = new Database(path);
    other.run("BEGIN IMMEDIATE"); // the file is busy before any job starts
    const firstAttempt = Promise.withResolvers<unknown>();
    const write = d.patiently(() => {
      try { return d.statement("INSERT INTO t (x) VALUES (1)").run(); }
      catch (error) { firstAttempt.resolve(error); throw error; }
    }, 100);
    expect(await firstAttempt.promise).toMatchObject({ code: "SQLITE_BUSY" });
    const job = d.exclusive(async () => {
      await Bun.sleep(400);
      other.run("COMMIT");
    });
    await write; // outlasts its 100 ms limit by waiting for the job
    await job;
    other.close(true);
    expect((d.db.query("SELECT count(*) AS n FROM t").get() as { n: number }).n).toBe(1);
  });

  test("without an exclusive job a busy file still fails after the limit, as before", async () => {
    const path = tempFile();
    const d = track(openStageDatabase(path, [one]));
    const { Database } = await import("bun:sqlite");
    const other = new Database(path);
    other.run("BEGIN IMMEDIATE");
    const error = await d.patiently(() => d.statement("INSERT INTO t (x) VALUES (1)").run(), 100).then(() => null, (e) => e as Error);
    expect(error?.message).toContain("busy");
    other.run("ROLLBACK");
    other.close(true);
  });
});
