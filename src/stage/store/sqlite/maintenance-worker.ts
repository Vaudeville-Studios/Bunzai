/**
 * The background lane's worker (src/stage/store/sqlite/background.ts): heavy database work on its own
 * thread and its own connection, so the app's main thread never freezes behind it (the
 * speed budget: nothing blocks the main thread for more than 100 ms). One job per message; the
 * worker answers with what happened and never throws past the message boundary.
 */
import { toErrorMessage } from "../../../error-message";
import { Database } from "bun:sqlite";
import { cellCipher } from "../../crypto/cell-cipher";
import { checkTable, type TableJob } from "./health-page";
import { moveRowsSql, replaceCellsSql, type CellsPlan, type MovePlan } from "./health-move";
import { trimDerivedRows } from "./derived-maintenance";
import { inspectSnapshot, restoreSnapshot, writeSnapshot } from "./snapshot-jobs";

declare const self: Worker;

export type MaintenanceJob = { kind: "rebuild"; path: string }
  /** Folds the write-ahead log into the file here, so the copy and its disk flush never freeze the main thread. A reader in the way is the caller's scrub to report. */
  | { kind: "checkpoint"; path: string }
  | { kind: "derived-trim"; path: string; budgetBytes: number }
  | { kind: "snapshot"; path: string; dest: string }
  | { kind: "inspect"; path: string; snapshot: string }
  | { kind: "restore"; path: string; snapshot: string; work: string }
  | { kind: "quick-check"; path: string }
  /** The health scan's cell checks of one table under a key lease (health-page.ts); the keys are wiped here when it ends. */
  | { kind: "check-table"; path: string; table: TableJob; content: Uint8Array; index: Uint8Array }
  /** A health repair's writes (health-move.ts), under a key lease for the placeholder cell; the keys are wiped here too. */
  | { kind: "repair"; path: string; move?: MovePlan; cells?: CellsPlan; content: Uint8Array; index: Uint8Array };

export type MaintenanceResult = { ok: true; data?: unknown } | { ok: false; reason: string };

self.onmessage = async (event: MessageEvent<MaintenanceJob>) => {
  // The job arrived: a lane that hears this and then no answer knows the work stalled, not the worker's start (background.ts).
  self.postMessage({ laneStarted: true });
  const job = event.data;
  let db: Database | null = null;
  const keys = job.kind === "check-table" || job.kind === "repair"
    ? { content: Buffer.from(job.content.buffer, job.content.byteOffset, job.content.byteLength), index: Buffer.from(job.index.buffer, job.index.byteOffset, job.index.byteLength) }
    : null;
  let result: MaintenanceResult;
  try {
    if (job.kind === "snapshot") {
      writeSnapshot(job.path, job.dest);
      result = { ok: true };
    } else if (job.kind === "inspect") {
      result = { ok: true, data: inspectSnapshot(job.path, job.snapshot) };
    } else if (job.kind === "restore") {
      restoreSnapshot(job.path, job.snapshot, job.work);
      result = { ok: true };
    } else {
      db = new Database(job.path, { strict: true });
      db.run("PRAGMA busy_timeout = 30000");
      db.run("PRAGMA secure_delete = ON");
      if (job.kind === "checkpoint") {
        db.run("PRAGMA busy_timeout = 0");
        db.query("PRAGMA wal_checkpoint(TRUNCATE)").get();
        result = { ok: true };
      } else if (job.kind === "derived-trim") {
        trimDerivedRows(db, job.budgetBytes);
        result = { ok: true };
      } else if (job.kind === "check-table") {
        const open = db;
        const read = <T>(work: () => T): T => {
          open.run("BEGIN");
          try {
            return work();
          } finally {
            open.run("COMMIT"); // a page is in memory once read; opening its cells needs no read lock
          }
        };
        result = { ok: true, data: await checkTable(read, (sql) => open.query(sql), cellCipher(() => keys!), job.table) };
      } else if (job.kind === "repair") {
        if (job.move) result = { ok: true, data: { moved: moveRowsSql(db, job.move) } };
        else if (job.cells) {
          const cipher = cellCipher(() => keys!);
          replaceCellsSql(db, job.cells, cipher.seal);
          result = { ok: true, data: { moved: 1 } };
        } else throw new Error("nothing to repair");
      } else if (job.kind === "quick-check") {
        // The health check's page-level pass: reads every page,
        // opens no cell, needs no key, and runs here so a large file never freezes the app.
        const rows = db.query("PRAGMA quick_check").all() as { quick_check: string }[];
        result = rows.length === 1 && rows[0]!.quick_check === "ok"
          ? { ok: true } : { ok: false, reason: rows.slice(0, 3).map((r) => r.quick_check).join("; ") };
      } else if (job.kind === "rebuild") {
        // VACUUM writes a complete new copy and swaps it in; a crash leaves the original whole.
        db.run("VACUUM");
        const check = db.query("PRAGMA integrity_check").all() as { integrity_check: string }[];
        // VACUUM wrote the whole file into the log; folding it here is what keeps the caller's scrub from doing that on the main thread.
        if (check.length === 1 && check[0]!.integrity_check === "ok") db.query("PRAGMA wal_checkpoint(TRUNCATE)").get();
        result = check.length === 1 && check[0]!.integrity_check === "ok"
          ? { ok: true } : { ok: false, reason: "the rebuilt database failed its integrity check" };
      } else {
        throw new Error("unknown maintenance job");
      }
    }
  } catch (error) {
    result = { ok: false, reason: toErrorMessage(error) };
  } finally {
    keys?.content.fill(0);
    keys?.index.fill(0);
    try {
      // Statements a job left prepared (a failed one among them) would keep the connection, and the file, open.
      (db as (Database & { clearQueryCache?: () => void }) | null)?.clearQueryCache?.();
      db?.close(true);
    } catch {
      // Closing a connection that failed to open; nothing more to release.
    }
  }
  self.postMessage(result);
};
