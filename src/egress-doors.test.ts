/**
 * The egress-door list: a bare `fetch(` or a node:http(s) import may
 * appear only in the files listed here, each with its exact call count and its reason. A URL a person types never goes to
 * `fetch(` directly: it goes through `guardedFetchVetted` in src/kit/providers/egress.ts, which resolves once, refuses any
 * non-public address, pins the connection to the vetted address, re-vets every redirect hop and caps time and size. Every
 * other listed call has a fixed host, a loopback address, or the studio's own origin. Same shape and rules as
 * src/stream-doors.test.ts and src/disk-writes.test.ts.
 */
import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { stripComments } from "../scripts/hooks/lib";

interface Entry { count: number; reason: string }

const ALLOWED: Record<string, Entry> = {
  "src/kit/providers/egress.ts": { count: 1, reason: "the vetted-URL door's pinned transport (node:https import); the only place a typed link leaves the machine" },
  // Fixed hosts.
  "src/site/client.ts": { count: 1, reason: "the public site's GitHub releases request, fixed host" },
  "src/ui/_shared/update-fetch.ts": { count: 1, reason: "the two fixed-host GitHub release requests" },
  "src/ui/switch/packaged-engine.ts": { count: 2, reason: "GitHub release API and the download, host allowlisted at the URL and at each redirect hop" },
  "src/kit/providers/codex-auth.ts": { count: 1, reason: "the fixed token-refresh URL" },
  "src/kit/providers/spokes/anthropic.ts": { count: 1, reason: "the model list at the fixed Anthropic host" },
  "src/kit/providers/spokes/google.ts": { count: 1, reason: "the model list at the fixed Google host" },
  "src/kit/providers/spokes/codex.ts": { count: 2, reason: "the fixed ChatGPT host, the Codex login's own requests" },
  // The person's configured model endpoint.
  "src/stage/provider/provider-send.ts": { count: 1, reason: "the default transport for the connection's own configured endpoint; the caller's guardedFetch replaces it where the host is locked" },
  // Loopback and the studio's own origin.
  "src/site/docs-search.ts": { count: 1, reason: "browser: the same-origin static docs-index.json URL emitted by the documentation page generator; queries search locally" },
  "src/ui/port-owner.ts": { count: 1, reason: "asks 127.0.0.1 whether the studio already runs on this port" },
  "src/ui/remote/lan-server.ts": { count: 2, reason: "two browser-script requests on the pairing page, both same-origin /lan routes; the listener callback is not an outbound fetch" },
  "src/ui/setup/wizard.tsx": { count: 1, reason: "browser: same-origin /api/setup/steps" },
  "src/ui/shell/theme-asset-urls.ts": { count: 1, reason: "browser: a theme package's own asset URL under the studio's origin (CSP connect-src 'self')" },
  "src/ui/shell/use-boot.ts": { count: 2, reason: "browser: same-origin /api/apps and /api/settings" },
  "src/ui/_shared/api-fetch.ts": { count: 1, reason: "browser: the one same-origin API door" },
  "src/ui/apps/docs/room.tsx": { count: 3, reason: "browser: same-origin /api/docs routes" },
  "src/ui/components/sprite-pack/dialog.tsx": { count: 1, reason: "browser: a blob or studio-origin picture ref (CSP connect-src 'self')" },
  "src/ui/apps/settings/sections/about.tsx": { count: 1, reason: "browser: same-origin /api/version" },
  "src/ui/apps/settings/sections/updates.tsx": { count: 1, reason: "browser: same-origin /api/version" },
};

const DOORS = /(?<![.\w$])fetch\(|from "node:https?"/g;
/** Authored runtime sources: no tests, contract suites, test stand-ins or fixtures. */
const scanned = (path: string): boolean =>
  /\.tsx?$/.test(path) && !/\.test\.tsx?$/.test(path) && !/\.contract(-fixtures)?\.tsx?$/.test(path) &&
  !/(^|\/)(fake-[^/]*|[^/]*-rig|[^/]*-test-support|test-[^/]*)\.tsx?$/.test(path) && !/(^|\/)(node_modules|_fixtures|generated)\//.test(path);

const counts = (): Map<string, number> => {
  const found = new Map<string, number>();
  for (const file of readdirSync("src", { recursive: true }).map((p) => `src/${String(p).replace(/\\/g, "/")}`).filter(scanned)) {
    const n = stripComments(readFileSync(file, "utf8")).match(DOORS)?.length ?? 0;
    if (n > 0) found.set(file, n);
  }
  return found;
};

test("no source file calls fetch( or imports node:http(s) unless it is on the list", () => {
  expect([...counts()].filter(([file]) => !(file in ALLOWED)).map(([file, n]) => `${file} (${n})`)).toEqual([]);
});

test("a listed file makes exactly the calls it is listed for", () => {
  const found = counts();
  expect(Object.entries(ALLOWED).filter(([file, entry]) => (found.get(file) ?? 0) !== entry.count).map(([file, entry]) => `${file}: listed ${entry.count}, found ${found.get(file) ?? 0}`)).toEqual([]);
});

test("every entry states a reason", () => {
  expect(Object.entries(ALLOWED).filter(([, e]) => !e.reason.trim() || e.count < 1).map(([file]) => file)).toEqual([]);
});

test("the asset-link fetcher reaches the network only through the vetted door", () => {
  const source = stripComments(readFileSync("src/ui/server-asset-fetch.ts", "utf8"));
  expect(source).toContain("guardedFetchVetted(");
  expect(source).not.toMatch(DOORS);
});
