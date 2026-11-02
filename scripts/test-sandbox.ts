/**
 * The test sandbox, preloaded before every `bun test` run (bunfig.toml): per-user paths point at
 * throwaway folders, and the run audits the original Bunzai, app-data, and Studio locations for leaks.
 */
import { afterAll } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { appDataDir } from "../src/app-data";

// Read the real locations before pointing anything elsewhere.
const realBunzai = join(process.env["BUNZAI_HOME"] ?? homedir(), ".bunzai");
const realAppData = appDataDir();
const realStudio = join(homedir(), "Documents", "Bunzai Studio");
const entries = (dir: string) => (existsSync(dir) ? new Set(readdirSync(dir)) : new Set<string>());
const before = { bunzai: entries(realBunzai), appData: entries(realAppData), studio: existsSync(realStudio) };

const sandbox = mkdtempSync(join(tmpdir(), "bunzai-test-home-"));
const inSandbox = (name: string) => {
  const dir = join(sandbox, name);
  mkdirSync(dir, { recursive: true });
  return dir;
};
const profile = inSandbox("profile");
const localAppData = inSandbox(join("profile", "AppData", "Local"));
const roamingAppData = inSandbox(join("profile", "AppData", "Roaming"));
process.env["HOME"] = profile;
process.env["USERPROFILE"] = profile;
process.env["APPDATA"] = roamingAppData;
const canonicalBunzaiHome = inSandbox("home");
process.env["BUNZAI_HOME"] = canonicalBunzaiHome;
process.env["CODEX_HOME"] = inSandbox("codex");
process.env["CLAUDE_CONFIG_DIR"] = inSandbox("claude");
process.env["LOCALAPPDATA"] = localAppData;
process.env["XDG_CONFIG_HOME"] = inSandbox("xdg-config");
process.env["XDG_DATA_HOME"] = inSandbox("xdg-data");
process.env["XDG_STATE_HOME"] = inSandbox("xdg-state");
process.env["XDG_CACHE_HOME"] = inSandbox("xdg-cache");
process.env["XDG_RUNTIME_DIR"] = inSandbox("xdg-runtime");

/**
 * Every Studio test runs on the encrypted database, as the app does (plan phase 1 exit bar): each
 * studio folder a test uses gets its own throwaway SQLite library under the sandbox, with a fresh
 * key, holding its pieces and the Studio's own documents. Tests that open a library themselves
 * register theirs on top, and the newest wins.
 */
{
  const { createHash } = await import("node:crypto");
  const { resolve } = await import("node:path");
  const { cellCipher } = await import("../src/stage/crypto/cell-cipher");
  const { newDataKey, subkeys } = await import("../src/stage/crypto/crypto");
  const { openStageDatabase } = await import("../src/stage/store/sqlite/database");
  const { MIGRATIONS } = await import("../src/stage/store/sqlite/migrations");
  const { createContentStore } = await import("../src/stage/store/content-store");
  const { sqliteDocumentBackend } = await import("../src/stage/store/sqlite/document-backend");
  const { sqliteStateStore } = await import("../src/stage/store/sqlite/state-store");
  const { sqliteChatStore } = await import("../src/stage/store/sqlite-chat-store");
  const { addLibrary } = await import("../src/studio/library-content");
  type Stores = import("../src/studio/library-content").LibraryStores;
  const libraries = new Map<string, { stores: Stores; close: () => void }>();
  const folder = inSandbox("libraries");
  // Never removed: tests that add their own libraries remove only theirs, so this stays underneath.
  addLibrary((root) => {
    const at = resolve(root);
    let library = libraries.get(at);
    if (!library) {
      const database = openStageDatabase(join(folder, `${createHash("sha256").update(at).digest("hex").slice(0, 16)}.db`), MIGRATIONS);
      const keys = subkeys(newDataKey());
      const cipher = cellCipher(() => keys);
      library = {
        stores: {
          content: createContentStore(sqliteDocumentBackend(database, cipher)),
          state: sqliteStateStore(database, cipher),
          chats: sqliteChatStore(database, cipher),
        },
        close: () => database.close(),
      };
      libraries.set(at, library);
    }
    return library.stores;
  });
  afterAll(() => {
    for (const library of libraries.values()) library.close();
  });
}

/** What a test run added to the person's real folders; empty when the sandbox held. */
function breaches(): string[] {
  const added = (dir: string, was: Set<string>) => [...entries(dir)].filter((name) => !was.has(name)).map((name) => join(dir, name));
  const found = [...added(realBunzai, before.bunzai), ...added(realAppData, before.appData)];
  if (!before.studio && existsSync(realStudio)) found.push(realStudio);
  return found;
}

afterAll(() => {
  rmSync(sandbox, { recursive: true, force: true });
  const found = breaches();
  if (found.length > 0) {
    throw new Error(
      `test sandbox: the run wrote into the real home folder: ${found.join(", ")}. ` +
        "Point the test at a temporary folder; the preload already sets BUNZAI_HOME, CODEX_HOME, CLAUDE_CONFIG_DIR, LOCALAPPDATA, and XDG_STATE_HOME.",
    );
  }
  if (process.env["BUNZAI_HOME"] !== canonicalBunzaiHome) {
    throw new Error("test sandbox: BUNZAI_HOME was not restored to its isolated test home");
  }
});
