/**
 * Bunzai (dev) - the native desktop window over the LIVE source. Same WebView2 window as Bunzai.exe,
 * but it never bakes a snapshot: it discovers formats from src/formats and serves the UI straight
 * from src/ui, hot-reloading every open page on edit. So it is ALWAYS current - no compile, no
 * re-snapshot, ever. Run on your own dev machine (Bun + this source tree present):
 *   bun run src/desktop-dev.ts
 * A Start Menu shortcut launches exactly this, so the search-bar "Bunzai" opens today's code.
 *
 * The shipped Bunzai.exe (scripts/build-desktop.ts) stays the baked build - a frozen release a user
 * can run without Bun or the source. This dev entry is its live-source twin, for us only.
 */
import { join } from "node:path";
import { homedir } from "node:os";
import { loadFormats } from "./core";
import { createLibrary } from "./ui/library-root";
import { startUi } from "./ui/server";
import { openInBrowser } from "./ui/server-security";
import { startDesktopWindow } from "./desktop-window-launch";
import { focusExisting } from "./desktop-focus";
import { detachEnvironFromGtk } from "./desktop-env";

detachEnvironFromGtk(); // Linux: keeps libgtk-4's unsetenv from crashing Bun's Workers (desktop-env.ts)

const PORT = 8321;
const DEV_URL = `http://127.0.0.1:${PORT}`;

/** True if something is already listening on the dev port (another Bunzai (dev)). */
async function portBusy(port: number): Promise<boolean> {
  try {
    const s = Bun.listen({
      hostname: "127.0.0.1",
      port,
      socket: {
        data() {},
        open() {},
        close() {},
        error() {},
      },
    });
    s.stop(true);
    return false;
  } catch {
    return true;
  }
}

if (await portBusy(PORT)) {
  // Second click of the Start Menu tile: bring the running window forward (decision 9); failing that,
  // do not crash on EADDRINUSE - send them to the live UI.
  if (await focusExisting(false, "Bunzai (Dev)", PORT)) process.exit(0);
  console.log(`Bunzai (dev) is already running at ${DEV_URL}`);
  console.log(
    "Opening in your browser. If the native window is stuck, end bun desktop-dev in Task Manager and launch again.",
  );
  openInBrowser(DEV_URL);
  process.exit(0);
}

await loadFormats(); // discover adapters from src/formats (the CLI's proven dev path)
const studioDir = join(homedir(), "Documents", "Bunzai Studio");
// As the packaged app does: the window comes up first and
// the encrypted library opens behind it; an unopened library.db would answer 423 forever.
const library = createLibrary(studioDir);
const { url: uiUrl, stop, close } = startUi(PORT, studioDir, undefined, library); // no packaged assets -> live source + dev watch
void library.open();
console.log(`Bunzai (dev) is up at ${uiUrl} - live source, no rebuild needed`);

// Use import.meta.dir (string path). Avoid `new URL(..., import.meta.url)` after binding a `url`
// variable - Bun has mis-resolved that as a constructor error on Windows ("http://... is not a constructor").
startDesktopWindow(() => new Worker(join(import.meta.dir, "desktop-window.ts")), uiUrl, "Bunzai (Dev)", (e) => {
  // a silent worker crash is why "nothing pops up": surface it instead of dying quietly
  console.error("desktop-dev: window worker error:", (e as ErrorEvent).message ?? e);
  openInBrowser(uiUrl);
}, async () => {
  stop();
  await close();
  await library.close();
  process.exit(0);
});
