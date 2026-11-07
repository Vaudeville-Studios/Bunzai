/**
 * Rolling snapshots of the library file and whole-library restore. A snapshot is a clean copy the background lane writes while the app runs
 * (`VACUUM INTO`, never a raw file copy): sealed cells byte for byte, this computer's key copy taken
 * out, never needing the key. Restore shows what differs first, keeps the current library as its own
 * snapshot, then swaps the content in one transaction, so a restore can be undone by restoring that
 * snapshot. A full disk is a plain error and changes nothing (D24).
 */
import { closeSync, existsSync, mkdirSync, openSync, readdirSync, renameSync, rmSync, statSync, writeSync } from "node:fs";
import { join } from "node:path";
import { toErrorMessage } from "../../../error-message";
import type { CellCipher } from "../../crypto/cell-cipher";
import { runInBackground } from "./background";
import { diskFreeSpace, StageDatabaseError, type StageDatabase } from "./database";
import type { Inspection } from "./snapshot-jobs";
import { KEEP_MANUAL, snapshotsToKeep } from "./snapshot-retention";

export type SnapshotKind = "auto" | "manual" | "before-restore";
export interface SnapshotInfo { id: string; kind: SnapshotKind; /** Epoch ms. */ takenAt: number; bytes: number }
export interface RestorePreview extends Omit<Inspection, "probes"> { snapshot: SnapshotInfo }
export interface RestoreResult {
  restored: SnapshotInfo;
  /** Restore this one to undo. */
  undo: SnapshotInfo;
  /** Why signing the restored rows failed (they stay queued and the next commit retries), or null. The restore itself is done. */
  sealOwed: string | null;
}
export interface SnapshotStatus {
  /** No recovery words yet: a backup restores into this library here, but cannot be opened on a new computer. */
  needsWords: boolean;
  lastError: string | null;
  last: SnapshotInfo | null;
  totalBytes: number;
  /** Copies made with Back up now, and how many are allowed before one must be removed. */
  manual: { count: number; cap: number };
}

/** The message is the user's. */
export class SnapshotError extends StageDatabaseError {
  constructor(message: string, readonly code: "no-room" | "busy" | "missing" | "foreign" | "failed" = "failed") {
    super(message);
  }
}

export interface SnapshotStoreOptions {
  database: StageDatabase;
  /** The live library file. */
  path: string;
  /** Where snapshots live, beside the library (`library.db.snapshots`). */
  dir: string;
  /** Opens sealed cells under the current key: it is what proves a snapshot belongs to this library. */
  cipher: CellCipher;
  now?: () => number;
  freeSpace?: (directory: string) => number;
  /** The library file's and WAL's size and time; only a test passes its own. */
  fileStamp?: () => string;
  /** Runs once a restore has committed: every cache of the old content must be dropped. */
  afterRestore?: () => void;
}

const LEFTOVER = /[.](partial|restoring[.]partial)(-wal|-shm|-journal)?$/;
const NAME = /^(auto|manual|before-restore)-(\d{13})\.db$/;
/** An hourly snapshot is due once the newest is this old (a little under an hour, so a late tick still counts). */
const DUE_MS = 55 * 60_000;
const MARGIN = 16 * 1024 * 1024;
const fileSize = (p: string): number => (existsSync(p) ? statSync(p).size : 0);

export function createSnapshotStore(opts: SnapshotStoreOptions) {
  const { database, path, dir, cipher } = opts;
  if (path === ":memory:") throw new SnapshotError("an in-memory library has no file to snapshot");
  const now = opts.now ?? Date.now;
  const freeSpace = opts.freeSpace ?? diskFreeSpace;
  let lastError: string | null = null;
  let lastTs = 0;
  let queue: Promise<unknown> = Promise.resolve();
  /** Snapshots, previews, and restores run one at a time; a failure never poisons the next. */
  const serial = <T>(work: () => Promise<T>): Promise<T> => {
    const run = queue.then(work, work);
    queue = run.catch(() => undefined);
    return run;
  };

  const hasWords = (): boolean => database.statement("SELECT 1 FROM keyring WHERE kind = 'recovery'").get() !== null;
  const fileOf = (id: string) => join(dir, `${id}.db`);
  const infoOf = (name: string): SnapshotInfo | null => {
    const m = NAME.exec(name);
    return m ? { id: name.slice(0, -3), kind: m[1] as SnapshotKind, takenAt: Number(m[2]), bytes: fileSize(join(dir, name)) } : null;
  };
  const list = (): SnapshotInfo[] =>
    (existsSync(dir) ? readdirSync(dir) : []).map(infoOf).filter((s): s is SnapshotInfo => s !== null).sort((a, b) => b.takenAt - a.takenAt);
  const totalBytes = () => list().reduce((sum, s) => sum + s.bytes, 0);
  const find = (id: string): SnapshotInfo => {
    const found = typeof id === "string" ? list().find((s) => s.id === id) : undefined;
    if (!found) throw new SnapshotError("that snapshot no longer exists", "missing");
    return found;
  };
  /**
   * Size and modified time of the library file and its WAL. Any write moves them, so the same stamp as
   * at the last snapshot means nothing was written since (a checkpoint can move them without a change,
   * which only costs one spare snapshot). Cheap: two stat calls, no database read.
   */
  const fileStamp = opts.fileStamp ?? ((): string => [path, `${path}-wal`].map((f) => { try { const t = statSync(f); return `${t.size}:${t.mtimeMs}`; } catch { return "-"; } }).join("|"));
  /** The store's own counters beat a coarse file time: rows this connection changed, and commits another connection made. */
  const stamp = (): string => {
    const changes = (database.statement("SELECT total_changes() AS n").get() as { n: number }).n;
    const others = (database.statement("PRAGMA data_version").get() as { data_version: number }).data_version;
    return `${changes}|${others}|${fileStamp()}`;
  };
  /** Taken before a snapshot starts, so a write during it counts as a change. In memory only: after a restart the first due check always takes one. */
  let stampAtLast: string | null = null;
  const liveBytes = () => fileSize(path) + fileSize(`${path}-wal`);
  const needRoom = (bytes: number) => {
    if (freeSpace(dir) < bytes + MARGIN) throw new SnapshotError("not enough free disk space; nothing was changed", "no-room");
  };
  /** A sealed marker in the library, so every snapshot carries a cell that proves whose key it needs, even with no rows. Written only while unlocked. */
  const ensureMarker = (): void => {
    try {
      cipher.ready();
    } catch {
      return;
    }
    if (!database.statement("SELECT 1 FROM library_meta WHERE key = 'key_check'").get()) {
      database.statement("INSERT OR IGNORE INTO library_meta (key, value) VALUES ('key_check', ?)").run(cipher.seal("library_meta.key_check", "ok"));
    }
  };
  /** A lane failure in the person's words: raw SQL never reaches the screen. */
  const plain = (reason: string): string => (/SQLITE|SQL logic|no such (table|column)|syntax error|constraint|malformed|not a database|disk I[/]O/i.test(reason) ? "it does not match this library's layout, or is damaged" : reason);
  /**
   * What a run that died leaves: a partial snapshot (written before this computer's key copies were taken out of it) or a
   * restore's scratch copy, with their -wal and -shm. Best-effort zero-fill and removal do not
   * guarantee secure erasure on journaled filesystems, snapshots, or flash storage.
   */
  const sweepLeftovers = (): void => {
    if (!existsSync(dir)) return;
    for (const f of readdirSync(dir)) {
      if (!LEFTOVER.test(f)) continue;
      const file = join(dir, f);
      try {
        const fd = openSync(file, "r+");
        try {
          const zeros = Buffer.alloc(1 << 20);
          for (let left = fileSize(file); left > 0; left -= zeros.length) writeSync(fd, zeros, 0, Math.min(zeros.length, left));
        } finally {
          closeSync(fd);
        }
      } catch {
        // Could not overwrite (already gone, or locked): removing it is still right.
      }
      scrap(file);
    }
  };
  const scrap = (...files: string[]) => { for (const f of files) rmSync(f, { force: true }); };

  /** Runs one lane job, registered as a reader so a blocked cleanup can name it and a close can cancel it. */
  const onLane = async (purpose: string, job: Parameters<typeof runInBackground>[0]) => {
    const abort = new AbortController();
    const reader = database.openWorkerReader(purpose, () => abort.abort());
    try {
      return await runInBackground(job, 10 * 60_000, abort.signal);
    } finally {
      reader.close();
    }
  };

  const prune = () => {
    const keep = snapshotsToKeep(list());
    for (const s of list()) if (!keep.has(s.id)) scrap(fileOf(s.id));
  };

  /** One snapshot, written beside its final name and renamed into place, so a listing never shows half of one. */
  const takeNow = async (kind: SnapshotKind): Promise<SnapshotInfo> => {
    try {
      mkdirSync(dir, { recursive: true });
      sweepLeftovers();
    } catch (error) {
      throw new SnapshotError(`the snapshots folder cannot be used: ${toErrorMessage(error)}`);
    }
    if (kind === "manual" && list().filter((s) => s.kind === "manual").length >= KEEP_MANUAL) {
      throw new SnapshotError(`you already have ${KEEP_MANUAL} copies made by you; remove one first`, "failed");
    }
    ensureMarker();
    needRoom(liveBytes());
    lastTs = Math.max(now(), lastTs + 1);
    const id = `${kind}-${String(lastTs).padStart(13, "0")}`;
    const partial = `${fileOf(id)}.partial`;
    const before = stamp();
    const result = await onLane("snapshot", { kind: "snapshot", path, dest: partial });
    if (!result.ok) {
      scrap(partial);
      throw new SnapshotError(`the snapshot could not be made: ${plain(result.reason)}`);
    }
    renameSync(partial, fileOf(id));
    if (kind !== "before-restore") stampAtLast = before;
    return find(id);
  };
  const recorded = async <T>(work: () => Promise<T>): Promise<T> => {
    try {
      const out = await work();
      lastError = null;
      return out;
    } catch (error) {
      lastError = toErrorMessage(error);
      throw error;
    }
  };

  /** Compares a snapshot with the library now, and proves it opens with this library's key. */
  const inspect = async (info: SnapshotInfo): Promise<Inspection> => {
    cipher.ready();
    const result = await onLane("snapshot preview", { kind: "inspect", path, snapshot: fileOf(info.id) });
    if (!result.ok) throw new SnapshotError(`the snapshot could not be read: ${plain(result.reason)}`);
    const inspection = result.data as Inspection;
    if (inspection.schema === "different") throw new SnapshotError("this snapshot was made by a different version of Bunzai and cannot be restored here", "foreign");
    if (inspection.probes.length === 0) throw new SnapshotError("this snapshot has no sealed cell to prove it belongs to this library, so it cannot be checked and was not restored", "foreign");
    for (const p of inspection.probes) {
      try {
        cipher.open(p.where, p.cell);
      } catch {
        throw new SnapshotError("this snapshot does not open with this library's key: it is from another library, or damaged", "foreign");
      }
    }
    return inspection;
  };

  return {
    /** Newest first. Readable while locked: names, kinds, times, and sizes only. */
    list,
    totalBytes,

    status(): SnapshotStatus {
      const all = list().filter((s) => s.kind !== "before-restore");
      return { needsWords: !hasWords(), lastError, last: all[0] ?? null, totalBytes: totalBytes(), manual: { count: list().filter((s) => s.kind === "manual").length, cap: KEEP_MANUAL } };
    },

    /** Writes a snapshot now on the background lane. Never needs the key. */
    take: (kind: "manual" | "auto" = "manual") => serial(() => recorded(async () => { await database.idle(); return takeNow(kind); })),

    /** The hourly path: a snapshot when the newest is old enough and the library was written since; nothing before recovery words exist. */
    takeIfDue: () => serial(() => recorded(async () => {
      await database.idle();
      const newest = list().find((s) => s.kind !== "before-restore");
      if (newest && now() - newest.takenAt < DUE_MS) return null;
      if (newest && stampAtLast === stamp()) return null; // nothing was written since the last one
      const taken = await takeNow("auto");
      prune();
      return taken;
    })),

    /**
     * Moves a copy into the folder's `trash` (never a delete): it leaves the list and the retention
     * rules, and its disk space stays until the person empties the trash folder by hand. Needs no key.
     */
    remove: (id: string) => serial(async () => {
      const info = find(id);
      const trash = join(dir, "trash");
      mkdirSync(trash, { recursive: true });
      renameSync(fileOf(info.id), join(trash, `${info.id}.db`));
      return info;
    }),

    /** Removes what a crashed run left (see sweepLeftovers); the schedule calls it once at start. */
    sweep: () => serial(async () => sweepLeftovers()),

    /** Thins the folder to the 24 hourly, 7 daily, and 4 weekly snapshots (and the last three safety copies). */
    prune: () => serial(async () => prune()),

    /** What would change if this snapshot were restored; changes nothing. Needs the library unlocked. */
    preview: (id: string): Promise<RestorePreview> => serial(async () => {
      const info = find(id);
      const { probes: _probes, ...rest } = await inspect(info);
      return { snapshot: info, ...rest };
    }),

    /**
     * Restores the whole library to a snapshot. The current library is kept as a "before-restore"
     * snapshot first (if that fails nothing is restored), then one transaction replaces the content;
     * keys, password, words, and remembered computers stay exactly as they are. Needs the library unlocked.
     */
    restore: (id: string): Promise<RestoreResult> => serial(async () => {
      const { info, undo } = await database.exclusive(async () => {
      const info = find(id);
      // A reply being written (or left unfinished) lives in turn_checkpoints; swapping the library under it would lose it.
      if (database.statement("SELECT 1 FROM turn_checkpoints LIMIT 1").get()) {
        throw new SnapshotError("a reply is still being written, or was left unfinished; let it finish or discard it first, then restore", "busy");
      }
      await inspect(info);
      // The before-restore copy, the migrated working copy of an older snapshot, and the transaction's own growth.
      needRoom(liveBytes() + info.bytes * 2);
      const undo = await takeNow("before-restore");
      const work = `${fileOf(info.id)}.restoring.partial`;
      try {
        const result = await onLane("snapshot restore", { kind: "restore", path, snapshot: fileOf(info.id), work });
        if (!result.ok) throw new SnapshotError(`nothing was restored: ${plain(result.reason)}`);
      } finally {
        scrap(work, `${work}-wal`, `${work}-shm`);
      }
      // Committed already: a reader holding the WAL open must not turn a finished restore into an error.
      await database.foldInBackground();
      await database.scrub().catch(() => undefined);
      return { info, undo };
      });
      // After the exclusive job, which every writer waits for (a write inside it would wait for itself).
      // The snapshot's queue of rows with a stale fingerprint is signed by an ordinary commit (its seal),
      // so a scan right after a restore finds the library clean. A failure is recorded (database.sealOwed),
      // the rows stay queued for the next commit, and the finished restore is still reported.
      await database.sealNow().catch(() => undefined);
      opts.afterRestore?.();
      prune();
      return { restored: info, undo, sealOwed: database.sealOwed() };
    }),
  };
}

export type SnapshotStore = ReturnType<typeof createSnapshotStore>;
