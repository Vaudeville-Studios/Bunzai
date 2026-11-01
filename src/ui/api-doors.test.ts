/**
 * The API door list: `apiFetch` and `apiFetchJson` (the session-token fetch to the local server) may be imported only by src/ui/api.ts,
 * the shell, the shared plumbing, and the files listed here, each with its reason. A scene or app file reaches the server through
 * `ctx.api` (src/ui/app-contract.ts), so the contract names every call, a fake can stand in for it in a test, and a call cannot
 * slip in beside it (Spotify and the gallery's adopt did, until they moved onto the contract). Same shape and rules as
 * src/stream-doors.test.ts.
 */
import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { stripComments } from "../../scripts/hooks/lib";

/** A directory prefix is allowed whole; a file entry carries the reason it is not on the contract. */
const ALLOWED_DIRS = ["src/ui/shell/", "src/ui/_shared/"];
const ALLOWED_FILES: Record<string, string> = {
  "src/ui/api.ts": "the app contract's implementation: the one door",
  "src/ui/agent/use-kit-commands.ts": "the agent window's command list, outside the app contract",
  "src/ui/apps/agent/room.tsx": "the agent room streams its own session routes",
  "src/ui/components/leaving-gate/index.tsx": "the unsaved-work gate asks the server whether anything is open",
  "src/ui/apps/settings/sections/backups-core.ts": "Settings section: backup routes are host-only and not part of any app's contract",
  "src/ui/apps/settings/sections/connections.tsx": "Settings section: MCP routes are host-only",
  "src/ui/apps/settings/sections/engines.tsx": "Settings section: engine install routes are host-only",
  "src/ui/apps/settings/sections/health-core.ts": "Settings section: the health report is host-only",
  "src/ui/apps/settings/sections/models.tsx": "Settings section: provider keys and models are host-only",
  "src/ui/apps/settings/sections/security-api.ts": "Settings section: lock and recovery routes are host-only",
  "src/ui/apps/settings/sections/library-export.ts": "Settings section: whole-library export is host-only",
  "src/ui/apps/settings/sections/models-api.ts": "Settings section: provider list and test are host-only (shared by models.tsx and the Messenger You scope)",
};

const IMPORT = /import\s*(?:type\s*)?\{([^}]*)\}\s*from\s*"[^"]*api-fetch"/g;
/** True when the source imports the fetch itself (not just its error type or its status helper). */
export const importsApiFetch = (source: string): boolean =>
  [...stripComments(source).matchAll(IMPORT)].some((m) => /(^|[\s,])(apiFetch|apiFetchJson)(\s|,|$)/.test(m[1]!));

const scanned = (path: string): boolean => /\.tsx?$/.test(path) && !/\.test\.tsx?$/.test(path) && !/(^|\/)(fake-[^/]*|[^/]*-rig)\.tsx?$/.test(path);
const importers = (): string[] =>
  readdirSync("src/ui", { recursive: true }).map((p) => `src/ui/${String(p).replace(/\\/g, "/")}`).filter(scanned).filter((f) => importsApiFetch(readFileSync(f, "utf8")));

test("the detector sees a plain, a multi-line and a mixed import, and ignores the error type and status helper", () => {
  expect(importsApiFetch('import { apiFetch } from "../../_shared/api-fetch";')).toBe(true);
  expect(importsApiFetch('import {\n  apiFetchJson,\n  apiStatusIs,\n} from "../_shared/api-fetch";')).toBe(true);
  expect(importsApiFetch('import { ApiHttpError, apiFetch as get } from "./api-fetch";')).toBe(true);
  expect(importsApiFetch('import { ApiHttpError, apiStatusIs, LIBRARY_LOCKED_EVENT } from "../_shared/api-fetch";')).toBe(false);
  expect(importsApiFetch('// import { apiFetch } from "../_shared/api-fetch";')).toBe(false);
});

test("only the listed files and directories import the session-token fetch", () => {
  const stray = importers().filter((f) => !(f in ALLOWED_FILES) && !ALLOWED_DIRS.some((d) => f.startsWith(d)));
  expect(stray).toEqual([]);
});

test("every listed file still imports it, and states a reason", () => {
  const found = new Set(importers());
  expect(Object.keys(ALLOWED_FILES).filter((f) => !found.has(f))).toEqual([]);
  expect(Object.entries(ALLOWED_FILES).filter(([, why]) => !why.trim()).map(([f]) => f)).toEqual([]);
});
