/**
 * Open Bunzai in the default browser (hot-reloading). Ensures a dev server is up on PORT - starting a
 * detached headless one if none is running - then opens the browser to it. UI edits (tsx/css)
 * hot-reload live via the dev server's reload stream; server-code changes still need the server
 * restarted. The native-window app (desktop-dev.ts) is the other way in; this is the browser way,
 * launched by the "Bunzai (Browser)" Start Menu shortcut.
 *
 * Runs production React: BUNZAI_UI_PROD_REACT=1 tells
 * src/ui/server-static.ts to bundle minified with NODE_ENV=production, same as the packaged exe.
 * Dev React's checks cost real keystroke latency; `bun run dev`
 * does not set this, so it keeps development React for everyone building the UI.
 */
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import { findRunningStudio } from "../src/ui/port-owner";

const PORT = 8321;
const readySignal = AbortSignal.timeout(12000);
let url = await findRunningStudio(PORT, 10, readySignal);
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

if (!url) {
  // start a detached headless dev server that outlives this launcher; process.execPath is the same
  // bun running this script, so no PATH assumption
  const studioDir = join(homedir(), "Documents", "Bunzai Studio");
  spawn(process.execPath, ["run", "src/cli.ts", "ui", String(PORT), studioDir], {
    cwd: repoRoot,
    detached: true,
    stdio: "ignore",
    env: { ...process.env, BUNZAI_UI_PROD_REACT: "1" },
  }).unref();
  for (let i = 0; i < 40 && !url; i++) {
    await Bun.sleep(250);
    url = await findRunningStudio(PORT, 10, readySignal);
  }
}

if (!url) throw new Error("Bunzai did not become ready on ports 8321-8330; no browser was opened.");

// open the default browser (Windows `start`); detached so this launcher can exit immediately
spawn("cmd", ["/c", "start", "", url], { detached: true, stdio: "ignore" }).unref();
