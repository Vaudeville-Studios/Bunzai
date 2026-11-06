/**
 * Opens and initializes the encrypted library, importing a plain Studio folder before exposing stores.
 * Locked or failed libraries never fall back to plain files; shutdown awaits owned scene work.
 */
import { selectedGuides } from "../studio/guides";
import { coreSceneLibrary } from "../studio/core-library";
import { coreSceneParts } from "../studio/core-turn-plan";
import { presetReader } from "../studio/scene-turn-load";
import { lorebookReader } from "../studio/scene-lore";
import { closeSceneRuntime } from "./server-scene-runtime";
import { existsSync, mkdirSync, readdirSync, renameSync, rmSync } from "node:fs";
import { attachDerivedPersistence } from "../core/derive/derive";
import { toErrorMessage } from "./_shared/error-message";
import { join, resolve } from "node:path";
import { cellCipher } from "../stage/crypto/cell-cipher";
import { keystoreDeviceVault } from "../stage/crypto/device-vault";
import { createKeyring, type DeviceVault } from "../stage/crypto/keyring";
import { openStageDatabase, type StageDatabase } from "../stage/store/sqlite/database";
import { MIGRATIONS } from "../stage/store/sqlite/migrations";
import { sqliteSessionStore } from "../stage/store/sqlite/kit-sessions";
import { createContentStore, computeSummaryFor } from "../stage/store/content-store";
import { DERIVED_VERSION } from "../stage/store/summary-content";
import { checkSummaryCounts } from "../stage/store/summary-count-check";
import { createRebuildScheduler, type RebuildScheduler } from "../stage/store/summary-rebuild-schedule";
import { sqliteDocumentBackend } from "../stage/store/sqlite/document-backend";
import { sqliteDerivedBackend } from "../stage/store/sqlite/derived-backend";
import { createLibraryAssets } from "./library-assets";
import { createLibrarySearch, type LibrarySearch } from "./library-search";
import { StudioStore } from "../studio/store";
import { createColdReadService } from "../stage/store/cold-read-service";
import { sqliteStateStore } from "../stage/store/sqlite/state-store";
import { sqliteExtensionStore } from "../stage/store/sqlite/extension-store";
import { sqliteCoreRecordStore } from "../stage/store/sqlite/core-record-store";
import { createCoreTurnOwner } from "../studio/core-turn-owner";
import { assertNoCorePromptAttachments } from "../studio/core-prompt-attachments";
import { assertStudioEntityKind } from "../studio/path-policy";
import { sqliteChatStore } from "../stage/store/sqlite-chat-store";
import type { ContentStore, DocumentBackend } from "../stage/contracts/content-store";
import type { StateStore } from "../stage/contracts/state-store";
import type { ExtensionStore } from "../stage/contracts/extension-store";
import type { CellCipher } from "../stage/crypto/cell-cipher";
import { addLibrary, type LibraryStores } from "../studio/library-content";
import { addLibrarySessions, fileSessionStore } from "../kit/sessions/store";
import { copySessionsIn } from "./library-sessions-copy";
import { attachSnapshots, restoreNotifier, startSnapshotSchedule } from "./library-snapshots";
import type { SnapshotStore } from "../stage/store/sqlite/snapshots";
import { createHealthCheck, type HealthCheck } from "../stage/store/sqlite/health-check";
import { importFolderIntoLibrary, ImportStoppedError, type ImportResult } from "../studio/folder-import";
import { COPYING_FILE, LIBRARY_FILE } from "../studio/fs-backend";
import { readForeignFile } from "../foreign-reader";
import { sweepStaleTemp } from "./temp-sweep";
import type { ChatStore } from "../stage/contracts/chat-store";
import type { PieceChangeBatch } from "../stage/contracts/piece-change-contract";
import { emptyTrash } from "./library-root-trash";
export type LibraryState = "unlocked" | "locked";
export interface OpenedLibrary {
  state: LibraryState;
  stateStore?: StateStore;
  content: ContentStore;
  extensionStore: ExtensionStore;
  keyring: ReturnType<typeof createKeyring>;
  database: StageDatabase;
  /** Rolling snapshots of the library file, and restore. */
  snapshots: SnapshotStore;
  /** The health check: scan, adopt fingerprints, repair. Restore repairs use `snapshots`. */
  health: HealthCheck;
  chats: ChatStore;
  search: LibrarySearch;
  pieceChanges(after: number, limit?: number): Promise<PieceChangeBatch>;
  /** What this start imported from a plain folder, when it did. The load-in screen shows it. */
  imported?: ImportResult;
  /**
   * D2's one-time summary rebuild for this open: `createLibrary`'s `hold()`
   * fires its first `attempt()` on the first request served; absent while locked (nothing to rebuild
   * until there is a key).
   */
  rebuildScheduler?: RebuildScheduler;
  /** Stops handing out the library and closes the database. */
  close(): Promise<void>;
}
/** One spelling per folder: Windows and macOS paths are not case-sensitive. */
export const samePath = (a: string, b: string): boolean => {
  const x = resolve(a);
  const y = resolve(b);
  return process.platform === "linux" ? x === y : x.toLowerCase() === y.toLowerCase();
};
/** True when the folder holds a plain Studio library to import (anything but the library's own files). */
export function holdsPlainLibrary(studioDir: string): boolean {
  if (!existsSync(studioDir)) return false;
  return readdirSync(studioDir).some((name) => !name.startsWith(LIBRARY_FILE) && !name.startsWith("."));
}

const removeDatabaseFiles = (file: string): void => {
  for (const f of [file, `${file}-wal`, `${file}-shm`]) rmSync(f, { force: true });
};
/**
 * The library's two stores over one open database, plus the raw document backend: D2's one-time
 * summary rebuild runs against that same backend, but on its OWN schedule
 * (below), never inline with `createContentStore` here, so building the stores never itself competes
 * with boot.
 */
const storesOf = (database: StageDatabase, cipher: CellCipher, file: string, studioDir: string, keyring: ReturnType<typeof createKeyring>, coreSceneIntegration = true): LibraryStores & { backend: DocumentBackend; extensionStore: ExtensionStore; closeColdReads(): void } => {
  const backend = sqliteDocumentBackend(database, cipher);
  const coldReads = createColdReadService({ database, path: file, cipher, keyring });
  const chats = sqliteChatStore(database, cipher);
  const content = createContentStore(backend, Date.now, { coldFill: coldReads.fill });
  const core = coreSceneIntegration ? sqliteCoreRecordStore(database, cipher) : undefined;
  // The scene readers take a body store: the content store answers bodies by kind.
  const bodies = { read: async () => null, readBody: (kind: string, id: string) => content.readBody(assertStudioEntityKind(kind), id), readBodyVersioned: (kind: string, id: string) => content.readBodyVersioned(assertStudioEntityKind(kind), id) };
  const state = sqliteStateStore(database, cipher);
  const coreTurns = core ? createCoreTurnOwner(chats, core, studioDir, async (sceneId) => {
    const chat = await chats.getChat(sceneId);
    if (!chat?.preset) return;
    const entity = await content.readLight(assertStudioEntityKind(chat.preset.kind), chat.preset.id);
    if (entity) assertNoCorePromptAttachments(entity.entity, chat.preset.toggles);
  }, (sceneId, choiceDefaults, kind) => coreSceneLibrary(chats, sceneId, { readPreset: presetReader(bodies), readLorebook: lorebookReader(bodies), readGuides: (ids) => selectedGuides(state, ids), ...(choiceDefaults ? { choiceDefaults } : {}),
    parts: (id) => coreSceneParts({ chats, state, readPreset: presetReader(bodies), readLorebook: lorebookReader(bodies), readLibrary: async (pieceKind, pieceId) => (await content.readLight(assertStudioEntityKind(pieceKind), pieceId))?.entity ?? null, ...(choiceDefaults ? { choiceDefaults } : {}) }, id, kind ?? "draft"),
    coreMessages: async (id, messageId) => { const linked = await core!.sceneFor(id); return linked ? (await core!.coreMessagesFor(linked.sessionId, linked.branchId, messageId)).map((row) => row.coreMessageId) : []; } })) : undefined;
  return {
    content, state, chats, ...(core ? { core, coreTurns: coreTurns! } : {}),
    importCompleted: async (pieceCount) => { if (pieceCount > 1000) await database.optimize(); },
    backend, extensionStore: sqliteExtensionStore(database, cipher), closeColdReads: coldReads.close,
  };
};

/** Progress reported the way this file already reports background maintenance (import, Trash-purge). */
const rebuildProgress = (p: { done: number; total: number }): void => {
  if (p.total === 0) return;
  if (p.done === 0) console.log(`library: rebuilding ${p.total} piece summaries in the background`);
  else if (p.done === p.total) console.log(`library: rebuilt ${p.total} piece summaries`);
};

/**
 * The background integrity check (step 3.3), fired once a rebuild cycle finishes - whether or not it
 * found anything stale, since a document missing its `document_summaries` row entirely never shows up
 * as "stale" (the rebuild's own filter never sees a row that is not there). Never runs on the list
 * path: `onProgress` is the rebuild scheduler's own callback, on the background lane already.
 */
const withCountCheck = (backend: DocumentBackend, onProgress: (p: { done: number; total: number }) => void) => (p: { done: number; total: number }) => {
  onProgress(p);
  if (p.done === p.total) void checkSummaryCounts(backend);
};

/**
 * Never competes with boot: the rebuild's first attempt
 * waits this long after open before it even starts, giving the app room to paint and serve its first
 * requests. `createLibrary`'s `hold()` can fire it sooner, the moment a real request is being served;
 * this timer is only the floor for callers with no request concept (Kit, the MCP server).
 */
const REBUILD_DEFER_MS = 3_000;

type Keyring = ReturnType<typeof createKeyring>;

/**
 * After every successful unlock, also retry an owed rebuild (never left stale by a lock mid-run,
 * matching the keyring's own pending-cleanup retry). `attempt()`
 * itself is always safe to call: it no-ops while a run is in flight, finished, or still backing off.
 *
 * The same three methods are the keyring's only unlock wrappers, so `onUnlock` (optional; absent for
 * every caller but `createLibrary`) rides along here rather than getting its own wrapper. It is how
 * the idle-lock's "first readable" signal and its deadline timer learn of a LATER unlock - one
 * reached from the lock screen, not through `openLibrary`'s own initial open - without polling for
 * it.
 */
function withRebuildRetry(keyring: Keyring, scheduler: RebuildScheduler, onUnlock?: () => void): Keyring {
  return {
    ...keyring,
    async unlock() {
      const ok = await keyring.unlock();
      if (ok) {
        scheduler.attempt();
        onUnlock?.();
      }
      return ok;
    },
    async unlockWithPassword(password: string) {
      await keyring.unlockWithPassword(password);
      scheduler.attempt();
      onUnlock?.();
    },
    async unlockWithWords(words: string, choice: { rememberComputer: boolean }) {
      const result = await keyring.unlockWithWords(words, choice);
      scheduler.attempt();
      onUnlock?.();
      return result;
    },
  };
}

/**
 * The first-start import: builds the library beside the folder under a temporary name, imports every
 * piece and the Studio's own documents, rebuilds it, and only then renames it into place, so an
 * interrupted import can never look like a finished library. The folder is only read.
 */
async function importIn(studioDir: string, vault: DeviceVault, options: OpenOptions): Promise<ImportResult> {
  const building = join(studioDir, COPYING_FILE);
  removeDatabaseFiles(building); // left by an import that was interrupted: start again
  const database = openStageDatabase(building, MIGRATIONS);
  let coldStores: ReturnType<typeof storesOf> | null = null;
  let importKeyring: ReturnType<typeof createKeyring> | null = null;
  let result: ImportResult;
  try {
    importKeyring = createKeyring(database, vault);
    await importKeyring.setup();
    coldStores = storesOf(database, cellCipher(() => importKeyring!.keys()), building, studioDir, importKeyring, false);
    result = await importFolderIntoLibrary(studioDir, coldStores, {
      foreign: readForeignFile,
      ...(options.onProgress ? { onProgress: options.onProgress } : {}),
      ...(options.freeSpace ? { freeSpace: options.freeSpace } : {}),
    });
    if (result.pieces > 1000) await database.optimize();
    await database.rebuild();
    coldStores.closeColdReads();
    importKeyring.forget();
  } catch (error) {
    coldStores?.closeColdReads();
    importKeyring?.forget();
    database.close();
    removeDatabaseFiles(building);
    throw error;
  }
  database.close();
  // A WAL left after a clean close would hold writes the renamed file does not: never go live then.
  if (existsSync(`${building}-wal`)) {
    removeDatabaseFiles(building);
    throw new ImportStoppedError("the new library did not close cleanly; your folder is unchanged", "not-clean");
  }
  renameSync(building, join(studioDir, LIBRARY_FILE));
  return result;
}

export interface OpenOptions {
  vault?: DeviceVault;
  /** Progress of a first-start import, piece by piece. */
  onProgress?: (done: number, total: number, file: string) => void;
  /** Free bytes on the studio's disk; tests pass their own. */
  freeSpace?: (dir: string) => number;
  /** Where Kit's old plain transcripts are; tests pass a throwaway folder. */
  sessionsDir?: string;
  /** The keyring's clock and password lock; only tests pass their own. */
  keyring?: Parameters<typeof createKeyring>[2];
  /** CLI inspection skips normal open-time imports, Trash purge, and summary work. */
  skipOpenMaintenance?: boolean;
  /** Test seam for libraries deliberately created before Core scene ownership was enabled. */
  coreSceneIntegration?: boolean;
  /** Fired after every unlock reached through the returned keyring (not the initial auto-unlock
   *  above, which the caller already awaits directly). `createLibrary` is the only caller that
   *  passes one. */
  onUnlock?: () => void;
  onRestored?: () => void;
}

/**
 * Opens the library for a studio folder, importing a plain library in the folder first. When the
 * import cannot run (too little free space), it throws with the reason and the folder is unchanged:
 * the app never falls back to running on the folder.
 */
export async function openLibrary(studioDir: string, options: OpenOptions = {}): Promise<OpenedLibrary> {
  // Every start clears temp files a crashed run stranded (the disk-write list), before anything else.
  sweepStaleTemp();
  const vault = options.vault ?? keystoreDeviceVault;
  const file = join(studioDir, LIBRARY_FILE);
  let imported: ImportResult | undefined;
  if (!existsSync(file) && holdsPlainLibrary(studioDir)) {
    imported = await importIn(studioDir, vault, options);
    console.log(`library: imported ${imported.pieces} pieces into the encrypted library; your folder is unchanged`);
    for (const r of imported.renamed) console.log(`library: kept ${r.kind} "${r.from}" as "${r.to}" (another piece had its id)`);
    for (const d of imported.damaged) console.warn(`library: left out ${d.kind} "${d.id}" (${d.reason})`);
  }
  mkdirSync(studioDir, { recursive: true });
  const database = openStageDatabase(file, MIGRATIONS);
  const keyring = createKeyring(database, vault, options.keyring);
  let state: LibraryState;
  let resourcesClosed = false;
  const releases: (() => void)[] = [() => database.close(), () => keyring.forget()];
  const closeResources = () => {
    if (resourcesClosed) return;
    resourcesClosed = true;
    let failure: unknown;
    for (const release of releases.reverse()) try { release(); } catch (error) { failure ??= error; }
    if (failure !== undefined) throw failure;
  };
  try {
    if ((await keyring.status()).state === "new") {
      await keyring.setup();
      state = "unlocked";
    } else {
      state = (await keyring.unlock()) ? "unlocked" : "locked";
    }
    const cipher = cellCipher(() => keyring.keys());
    const removeDerived = attachDerivedPersistence(sqliteDerivedBackend(database, cipher, file), () => {
      try { cipher.ready(); return true; } catch { return false; }
    });
    releases.push(removeDerived);
    let stores: ReturnType<typeof storesOf> | undefined;
    let assets: ReturnType<typeof createLibraryAssets> | undefined;
    let search: LibrarySearch | undefined;
    let removeStores = () => {};
    let removeSessions = () => {};
    stores = storesOf(database, cipher, file, studioDir, keyring, options.coreSceneIntegration ?? true);
    releases.push(() => stores?.closeColdReads());
    assets = createLibraryAssets(stores.content, cipher, keyring);
    releases.push(() => assets?.close());
    search = createLibrarySearch({ dir: studioDir, store: new StudioStore(studioDir), backend: stores.backend, keyring });
    releases.push(() => search?.close());
    stores.thumbnails = assets.thumbnails;
    const snapshots = attachSnapshots({ database, file, studioDir, cipher, search: () => search, ...(options.onRestored ? { onRestored: options.onRestored } : {}) });
    // Also makes every store transaction sign the rows it changes, so it is attached before any store writes.
    const health = createHealthCheck({ database, cipher, path: file, content: stores.content, keys: keyring, snapshots });
    removeStores = addLibrary((root) => (samePath(root, studioDir) ? stores! : null));
    releases.push(() => removeStores());
    const sessions = sqliteSessionStore(database, cipher, fileSessionStore(options.sessionsDir));
    removeSessions = addLibrarySessions(sessions);
    releases.push(() => removeSessions());
    // D2's one-time summary rebuild is scheduled, never run inline, and remains wired while locked.
    const rebuildScheduler = createRebuildScheduler(
      stores.backend,
      DERIVED_VERSION,
      computeSummaryFor(stores.backend),
      withCountCheck(stores.backend, rebuildProgress),
    );
    const keyringOut = withRebuildRetry(keyring, rebuildScheduler, options.onUnlock);
    if (state === "unlocked" && !options.skipOpenMaintenance) {
      await copySessionsIn(database, sessions, options.sessionsDir);
      await emptyTrash(stores);
      // Kit and MCP callers have no request hook, so arm the deferred floor for them.
      setTimeout(() => rebuildScheduler.attempt(), REBUILD_DEFER_MS).unref?.();
    }
    return {
      state,
      stateStore: stores.state,
      content: stores.content,
      extensionStore: stores.extensionStore,
      keyring: keyringOut,
      database,
      snapshots,
      health,
      chats: stores.chats,
      search: search!,
      pieceChanges: (after, limit) => stores.backend.pieceChanges(after, limit),
      ...(imported ? { imported } : {}),
      rebuildScheduler,
      async close() { await stores.coreTurns?.close(); await closeSceneRuntime(stores.chats); closeResources(); },
    };
  } catch (error) {
    try { closeResources(); } catch { /* Preserve the open failure after releasing every resource. */ }
    throw error;
  }
}
