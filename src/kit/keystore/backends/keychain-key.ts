/**
 * The shape both OS-keychain backends share (macOS Keychain, Linux Secret Service): one random
 * 256-bit key lives in the operating system's secret store, and every seal is AES-256-GCM under it
 * (the shared aes.ts). The key never touches Bunzai's own files, which is what makes these stronger
 * than identity-file, and it is passed to the OS tool over stdin, never as an argument, so it never
 * shows in a process listing (the DPAPI backend's rule).
 *
 * Making the key is the dangerous moment: a second key replacing the first would strand everything
 * sealed under the first (the encryption reviews' blockers). So:
 * - creation happens once per process at a time, and across processes under a lock file whose
 *   holder writes its own token, keeps it fresh with a heartbeat, and only ever removes its own lock;
 *   a stale lock is moved aside by one atomic rename and checked after the move, so a fresh lock that
 *   replaced it meanwhile is put back, never taken; the holder re-checks the lock just before it
 *   writes the key;
 * - a "key made" marker lives in the OS store next to the key, not in a Bunzai folder, so every
 *   Bunzai home on the machine sees it, and wiping the keyring clears both;
 * - before making a key, the marker is written and read back, which proves the store is unlocked
 *   and writable; a store that answers "no key" while the marker exists is refused, never replaced;
 * - after the marker is written the key is looked up again, because a locked Linux keyring can
 *   answer "no key" until that write unlocks it.
 *
 * Only reading and creating items differ per platform, so each platform file supplies just that.
 */
import { randomBytes, randomUUID } from "node:crypto";
import { closeSync, linkSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, statSync, utimesSync, writeSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { KeystoreBackend, Unlock } from "../types";
import { aesOpen, aesSeal, type AesParts } from "../aes";
import { spawnCollect } from "./spawn-collect";

export interface CommandResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** Runs a tool with optional stdin. Rejects with code ENOENT when the tool is not installed. */
export type Runner = (command: string, args: readonly string[], stdin?: string) => Promise<CommandResult>;

export const spawnRunner: Runner = (command, args, stdin) =>
  spawnCollect(command, args, { stdin }).then(({ code, stdout, stderr }) => ({
    code: code ?? -1,
    stdout,
    stderr,
  }));

/** The two items a backend keeps in the OS store: the key, and the marker that one was made. */
export type Item = "key" | "marker";

/**
 * How one platform reads and creates items. `read` returns null when the item is not stored.
 * `create` must never replace a stored item: it reports "exists" where the tool can tell, and the
 * lock file covers the tools that cannot.
 */
export interface KeyStoreTool {
  platform: NodeJS.Platform;
  read(run: Runner, item: Item): Promise<string | null>;
  create(run: Runner, item: Item, value: string): Promise<"created" | "exists">;
}

export interface KeychainDeps {
  run?: Runner;
  platform?: NodeJS.Platform;
  /** Where the lock file lives; BUNZAI_HOME, like the identity file. */
  home?: string;
  /** How long a lock may go without a heartbeat before it counts as left by a crashed process. */
  staleLockMs?: number;
  /** How often a holder refreshes its lock. */
  heartbeatMs?: number;
  /** Clock used for lock age, deadline, and heartbeat timestamps; defaults to Date.now. */
  now?: () => number;
  /** Owns the heartbeat timer and returns its cancellation; defaults to setInterval/clearInterval. */
  heartbeat?: (tick: () => void, intervalMs: number) => () => void;
}

/** One creation in flight per backend in this process; a second caller waits for the first. */
const creating = new Map<string, Promise<Buffer>>();

export function keychainKeyBackend(id: string, label: string, tool: KeyStoreTool, deps: KeychainDeps = {}): KeystoreBackend {
  const run = deps.run ?? spawnRunner;
  const platform = deps.platform ?? process.platform;
  const dir = () => join(deps.home ?? process.env["BUNZAI_HOME"] ?? homedir(), ".bunzai");
  const lockPath = () => join(dir(), `${id}.lock`);
  const staleMs = deps.staleLockMs ?? 30_000;
  const beatMs = deps.heartbeatMs ?? Math.max(10, Math.floor(staleMs / 5));
  const now = deps.now ?? Date.now;
  const scheduleHeartbeat = deps.heartbeat ?? ((tick, intervalMs) => {
    const timer = setInterval(tick, intervalMs);
    return () => clearInterval(timer);
  });

  const readKey = async (): Promise<Buffer | null> => {
    const b64 = await tool.read(run, "key");
    if (b64 === null) return null;
    const key = Buffer.from(b64.trim(), "base64");
    if (key.length !== 32) throw new Error(`keystore: the ${id} key is damaged`);
    return key;
  };

  /**
   * Moves the lock aside by one atomic rename, then keeps it gone only if the moved file is the one
   * expected: `token` matches and, for a takeover, it is still stale. Anything else was a live lock
   * that replaced the expected one meanwhile, so it is put back (a hard link never clobbers a newer
   * lock) and false is returned. This closes the gap between judging a lock and removing it.
   */
  const removeIf = (token: string, mustBeStale: boolean): boolean => {
    const aside = `${lockPath()}.${randomUUID()}.aside`;
    try {
      renameSync(lockPath(), aside);
    } catch {
      return false; // Already gone, or another waiter moved it first.
    }
    let expected = false;
    try {
      expected = readFileSync(aside, "utf8") === token && (!mustBeStale || now() - statSync(aside).mtimeMs > staleMs);
    } catch {
      expected = false;
    }
    if (!expected) {
      try {
        linkSync(aside, lockPath());
      } catch {
        // A newer lock is already in place; its holder is unaffected.
      }
    }
    rmSync(aside, { force: true });
    return expected;
  };

  /** Takes the cross-process lock, runs `work`, and gives the lock back only if it is still ours. */
  const withLock = async <T>(work: (stillHeld: () => boolean) => Promise<T>): Promise<T> => {
    mkdirSync(dir(), { recursive: true });
    const token = randomUUID();
    const deadline = now() + staleMs * 4;
    for (;;) {
      try {
        const fd = openSync(lockPath(), "wx");
        writeSync(fd, token);
        closeSync(fd);
        break;
      } catch (error) {
        if ((error as { code?: string }).code !== "EEXIST") throw error;
        let held: { token: string; age: number } | null = null;
        try {
          held = { token: readFileSync(lockPath(), "utf8"), age: now() - statSync(lockPath()).mtimeMs };
        } catch {
          continue; // Released between our attempt and the check: try again at once.
        }
        if (held.age > staleMs) {
          removeIf(held.token, true);
          continue;
        }
        if (now() > deadline) throw new Error(`keystore: the ${id} key is being created by another process`);
        await new Promise((r) => setTimeout(r, 50));
      }
    }
    const stillHeld = () => {
      try {
        return readFileSync(lockPath(), "utf8") === token;
      } catch {
        return false;
      }
    };
    const cancelHeartbeat = scheduleHeartbeat(() => {
      try {
        if (stillHeld()) {
          const timestamp = new Date(now());
          utimesSync(lockPath(), timestamp, timestamp);
        }
      } catch {
        // The lock is gone; the finally block below will not touch whatever replaced it.
      }
    }, beatMs);
    try {
      return await work(stillHeld);
    } finally {
      cancelHeartbeat();
      removeIf(token, false);
    }
  };

  const create = async (): Promise<Buffer> =>
    withLock(async (stillHeld) => {
      // Another process may have made it while this one waited for the lock.
      const already = await readKey();
      if (already) return already;
      if ((await tool.read(run, "marker")) !== null) {
        throw new Error(
          `keystore: ${label} says it holds no Bunzai key, but one was made before. Unlock it and try again; if the key was deleted, open the library with its recovery words instead`,
        );
      }
      // Writing the marker and reading it back proves the store is unlocked and keeps what it is given.
      await tool.create(run, "marker", new Date().toISOString());
      if ((await tool.read(run, "marker")) === null) {
        throw new Error(`keystore: ${label} is locked or is not keeping new items; unlock it and try again`);
      }
      // A locked Linux keyring answers "no key" even when it holds one, and writing the marker may
      // have unlocked it: look again, so the real key is never replaced (the fourth review's blocker).
      const unlockedNow = await readKey();
      if (unlockedNow) return unlockedNow;
      if (!stillHeld()) throw new Error(`keystore: another process took over making the ${id} key; try again`);
      await tool.create(run, "key", randomBytes(32).toString("base64"));
      const stored = await readKey();
      if (!stored) throw new Error(`keystore: ${label} did not keep the key`);
      return stored;
    });

  const keyForSealing = async (): Promise<Buffer> => {
    const existing = await readKey();
    if (existing) return existing;
    let pending = creating.get(id);
    if (!pending) {
      pending = create().finally(() => creating.delete(id));
      creating.set(id, pending);
    }
    return pending;
  };

  return {
    id,
    label,
    async available(): Promise<boolean> {
      if (platform !== tool.platform) return false;
      try {
        await tool.read(run, "key");
        return true;
      } catch {
        // Not installed (ENOENT), or installed with no running secret service (a headless Linux
        // box): the registry falls through to the next backend instead of failing every save.
        return false;
      }
    },
    async seal(plaintext: string, _unlock: Unlock): Promise<string> {
      return JSON.stringify(aesSeal(await keyForSealing(), plaintext));
    },
    async open(payload: string, _unlock: Unlock): Promise<string> {
      const key = await readKey();
      if (!key) throw new Error(`keystore: the ${id} key is missing, so this vault cannot be opened here`);
      return aesOpen(key, JSON.parse(payload) as AesParts);
    },
  };
}
