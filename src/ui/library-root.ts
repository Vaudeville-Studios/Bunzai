/** Owns the window library handle, idle lock, and open/restore lifecycle. */
import { toErrorMessage } from "./_shared/error-message";
import { addLibrary, CLAIMED } from "../studio/library-content";
import { addLibrarySessions, lockedSessionStore } from "../kit/sessions/store";
import { createIdleLock } from "./library-idle-lock";
import { restoreNotifier, startSnapshotSchedule } from "./library-snapshots";
import { openLibrary, samePath } from "./library-open";
import { ImportStoppedError } from "../studio/folder-import";
import type { LibraryState, OpenedLibrary, OpenOptions } from "./library-open";
import type { PieceChangeBatch } from "../stage/contracts/piece-change-contract";

export { emptyTrash } from "./library-root-trash";
export { holdsPlainLibrary, openLibrary } from "./library-open";
export type { LibraryState, OpenedLibrary, OpenOptions } from "./library-open";
/** Where the library is, as the window needs it: the stage door and the load-in screen read this. */
export type LibraryPhase =
  | { phase: "opening" }
  | { phase: "loading-in"; done: number; total: number; recent: string[] }
  | { phase: "failed"; reason: string; noRoom?: boolean }
  | { phase: "locked" }
  | { phase: "unlocked" };

export interface LibraryHandle {
  readonly studioDir: string;
  /** Opens the library (importing a plain folder first). Once; only in the process that serves the window. */
  open(): Promise<OpenedLibrary | null>;
  phase(): Promise<LibraryPhase>;
  /** The open library, or null before it opens or when opening failed. */
  opened(): OpenedLibrary | null;
  /** Activity, for the idle lock. */
  touch(): void;
  /** Keeps the idle lock off while a request runs; call the returned function when it ends. */
  hold(): () => void;
  /**
   * Resolves the first time the library's contents are readable: open and unlocked. Never, when
   * opening failed. Things kept in the library (the settings) wait on it.
   */
  unlocked(): Promise<void>;
  /**
   * Pushed lock/unlock transitions, so a client can drop its status
   * poll for the studio-events stream. Fired once per real transition this handle causes or observes
   * - the idle lock's own deadline, and `/api/library/lock`'s explicit lock, which this handle has no
   * other way to learn of. Returns an unsubscribe.
   */
  onLockChange(cb: (state: "locked" | "unlocked") => void): () => void;
  /** Fired after a restore replaced the library's content, so each open page can reload. Returns an unsubscribe. */
  onRestore(cb: () => void): () => void;
  pieceChanges(after: number, limit?: number): Promise<PieceChangeBatch>;
  /** Announces an explicit `/api/library/lock` (server-library.ts): the one lock path this handle
   *  does not itself call, so it cannot otherwise tell the stream apart from a no-op re-lock. */
  noticeLocked(): void;
  close(): Promise<void>;
}

/**
 * The library for a window's server. Until the library is open, every Studio store and Kit's
 * transcripts refuse (423): the folder is claimed with no library behind it, and nothing reads the
 * plain folder. If opening
 * fails (an import refused for want of space included), they keep refusing (fail closed) and the
 * phase says why.
 */
export function createLibrary(
  studioDir: string,
  /** `idleCheckMs`: the LONGEST single wait before the idle-lock timer re-checks (test-only; unset
   *  in production, so the real deadline - `idleMinutes`, which can be much larger - is armed
   *  directly, and the timer fires exactly once). See library-idle-lock.ts. */
  options: OpenOptions & { idleCheckMs?: number } = {},
): LibraryHandle {
  const stopWaiting = addLibrarySessions(lockedSessionStore);
  // Held for the handle's life: the open library registers after it and wins; a failed one leaves it.
  const unclaim = addLibrary((root) => (samePath(root, studioDir) ? CLAIMED : null));
  let state: LibraryPhase = { phase: "opening" };
  let library: OpenedLibrary | null = null;
  let stopSnapshots = () => {};
  let opening: Promise<OpenedLibrary | null> | null = null;
  let closing: Promise<void> | null = null;
  let readable!: () => void;
  const firstReadable = new Promise<void>((resolve) => (readable = resolve));
  let seenReadable = false;
  /** Requests running now: the idle lock never zeroes the key under one. */
  let running = 0;
  /** Fires the deferred summary rebuild (D2) on the first request `hold()` sees, not before. */
  let seenFirstHold = false;
  const restored = restoreNotifier();
  // A library on its way out has no keys left to protect, and its database may already be closed under a late request's release.
  const idleLock = createIdleLock(() => (closing ? null : library?.keyring ?? null), () => running, options.idleCheckMs);

  /** Notices the first unlock; checked after opening and on each activity. Never itself pushes a
   *  lock event - a later unlock's push comes from `onUnlock` below, which fires exactly once per
   *  real transition instead of once per touch(). */
  const noticeUnlock = async (): Promise<void> => {
    if (seenReadable || !library) return;
    if ((await library.keyring.status()).state !== "unlocked") return;
    seenReadable = true;
    readable();
  };

  const open = async (): Promise<OpenedLibrary | null> => {
    try {
      library = await openLibrary(studioDir, {
        ...options,
        onProgress: (done, total, file) => {
          // The last few pieces checked, for the load-in screen's running list.
          const recent = [...(state.phase === "loading-in" ? state.recent : []), file].slice(-4);
          state = { phase: "loading-in", done, total, recent };
          options.onProgress?.(done, total, file);
        },
        onRestored: restored.notify,
        onUnlock: () => {
          // A LATER unlock (from the lock screen), reached through the wrapped keyring: the exact
          // transition the idle-lock deadline and the lock-change stream both need, with no poll.
          idleLock.notify("unlocked");
          idleLock.arm();
          void noticeUnlock();
          options.onUnlock?.();
        },
      });
    } catch (error) {
      state = {
        phase: "failed",
        reason: toErrorMessage(error),
        ...(error instanceof ImportStoppedError && error.code === "no-room" ? { noRoom: true } : {}),
      };
      console.error("library: could not open:", state.reason);
      return null;
    }
    stopWaiting();
    // Only this window's process schedules snapshots (they need no key, so a locked library is covered too).
    if (!options.skipOpenMaintenance) stopSnapshots = startSnapshotSchedule(library.snapshots);
    if (library.state === "unlocked") idleLock.notify("unlocked");
    idleLock.arm();
    await noticeUnlock();
    return library;
  };

  return {
    studioDir, open: () => closing ? Promise.resolve(null) : (opening ??= open()),
    async phase() {
      if (!library) return state;
      return { phase: (await library.keyring.status()).state === "unlocked" ? "unlocked" : "locked" };
    },
    opened: () => library,
    touch() {
      library?.keyring.touch();
      idleLock.arm();
      void noticeUnlock();
    },
    unlocked: () => firstReadable,
    hold() {
      // The first request served ONCE THE LIBRARY IS OPEN: fires the deferred summary rebuild (D2)
      // sooner than its own floor timer. Requests during "opening"/"loading-in" (status polls, the
      // load-in screen) don't count yet, since `library` is still null then; attempt() is safe to
      // call even while locked, so this needs no lock check of its own.
      if (!seenFirstHold && library) {
        seenFirstHold = true;
        library.rebuildScheduler?.attempt();
      }
      running++;
      let released = false;
      return () => {
        if (released) return;
        released = true;
        running--;
        // A poll or a gate-refused request never calls touch(); without this, a check that fired
        // while this one was running (and so bailed) would never be re-armed by anything.
        if (running === 0) idleLock.arm();
      };
    },
    onLockChange: (cb) => idleLock.onLockChange(cb),
    onRestore: restored.subscribe,
    pieceChanges: (after, limit) => {
      if (!library) return Promise.reject(new Error("library is unavailable"));
      return library.pieceChanges(after, limit);
    },
    noticeLocked() {
      idleLock.notify("locked");
    },
    close() {
      return closing ??= (async () => {
        await opening;
        idleLock.clear();
        stopSnapshots();
        stopWaiting();
        try { await library?.close(); } finally { unclaim(); }
      })();
    },
  };
}
