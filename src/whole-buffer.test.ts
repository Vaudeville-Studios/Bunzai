/**
 * The whole-buffer list: every source file that reads user data
 * into one buffer or string is named here with the exact number of such calls, the ceiling that bounds
 * it, and the reason it is allowed. A new call in a new file fails until it is listed with a reason; a
 * new call in a listed file fails until its count is raised on purpose; a file that stops calling must
 * be lowered or removed, so the list cannot rot. Seeded with today's exact counts (S0).
 *
 * A ceiling is a number of MiB, or one of: "codec" (pure encoder, the caller carries the bound),
 * "unbounded" and "unverified" (debt: the plan's streaming slices exist to remove these).
 *
 * Banned unless listed: .arrayBuffer(), Buffer.concat(, readFile(Sync)(, .text(), new Uint8Array(await,
 * bytesToBase64(, base64ToBytes(, zipSync(, unzipSync(, unzipBounded(, readAsDataURL(. Test code, test
 * stand-ins and fixtures are not scanned. This is a static check of those spellings; it cannot see a
 * whole-buffer read made through some other API (the plan's rows 10, 11 and 14 are such reads).
 */
import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { stripComments } from "../scripts/hooks/lib";

type Ceiling = number | "codec" | "unbounded" | "unverified";
interface Entry { count: number; ceiling: Ceiling; reason: string }

const ALLOWED: Record<string, Entry> = {
  // Cards and zips: the bounded whole-zip door and the container codecs (plan M3, row 4).
  "src/core/archive.ts": { count: 3, ceiling: 96, reason: "unzipBounded, the bounded whole-zip door: cards 96 MiB, and unzipCard, the card-bounds door every card container calls" },
  "src/formats/backyard/byaf-container.ts": { count: 3, ceiling: 96, reason: "byaf card container: zipSync on export, base64 of each archive file in the twin" },
  "src/formats/backyard/byaf.ts": { count: 3, ceiling: 96, reason: "byaf adapter: base64 of the portrait, the background and a data-URI picture" },
  "src/formats/lumiverse/index.ts": { count: 3, ceiling: 96, reason: "charx card container: zipSync on export, base64 of each archive file in the twin" },
  "src/formats/lumiverse/modules.ts": { count: 2, ceiling: 96, reason: "module picture to a data URI and back, inside the charx card bound" },
  "src/formats/risu/index.ts": { count: 5, ceiling: 96, reason: "risu charx container: zipSync on export, base64 of the module and each asset in the twin" },
  "src/formats/lumiverse-archive/characters.ts": { count: 1, ceiling: 96, reason: "zipSync of one character's export inside the backup importer" },
  "src/formats/image-pack/index.ts": { count: 3, ceiling: 48, reason: "picture-zip codec: unzipBounded listing, base64 decode per picture, zipSync export (rows 4, 5)" },
  "src/core/media/zip-import.ts": { count: 2, ceiling: 48, reason: "picture zip to pack entity: unzipBounded then base64 per picture (rows 4, 5)" },
  "src/core/media/resolve-ref.ts": { count: 3, ceiling: 48, reason: "one picture to a data URI at a time" },
  // Pictures as base64 (rows 5, 9).
  "src/core/base64.ts": { count: 4, ceiling: "codec", reason: "the base64 codec itself; callers carry the bound" },
  "src/entities/piece-parts-blob.ts": { count: 4, ceiling: 64, reason: "one picture decoded or encoded per call, 64 MiB per blob (row 9)" },
  "src/formats/_shared/png.ts": { count: 3, ceiling: 64, reason: "PNG card chunks and their base64, bounded by the 64 MiB adapter input" },
  "src/formats/lumiverse-archive/binaries.ts": { count: 1, ceiling: 64, reason: "one backup binary to a data URI, cached for the whole archive (row 1)" },
  "src/studio/portrait.ts": { count: 1, ceiling: 64, reason: "one portrait data URI decoded to bytes" },
  "src/ui/_shared/pack-export.ts": { count: 1, ceiling: 10, reason: "one inline picture decoded while a stored pack is printed, 10 MiB per picture (the image limit)" },
  "src/ui/agent/image-data.ts": { count: 1, ceiling: 10, reason: "one shown image to a data URI, IMAGE_MAX_BYTES 10 MiB (the image limit)" },
  "src/ui/engine-actions.ts": { count: 1, ceiling: 32, reason: "export output as base64 inside the JSON answer (row 17)" },
  // Server import path (rows 7, 8, 13).
  "src/ui/server-staging.ts": { count: 1, ceiling: 90, reason: "staged entity read whole, then parsed (row 8)" },
  "src/ui/server-asset-staging.ts": { count: 3, ceiling: 32, reason: "staged upload prefix sniff, ciphertext read whole, Buffer.concat on open (rows 10, 11)" },
  "src/ui/server-static.ts": { count: 5, ceiling: 8, reason: "bundled app and style output read as text; build artifacts, not user data" },
  "src/ui/server-handler.ts": { count: 1, ceiling: 1, reason: "the unbundled index page" },
  "src/ui/server-docs.ts": { count: 1, ceiling: 1, reason: "one shipped docs page" },
  "src/ui/sandbox-host.ts": { count: 2, ceiling: 8, reason: "compiled worker output and trusted frame HTML are capped at 8 MiB before conversion to response text" },
  // Whole-file reads from disk.
  "src/cli.ts": { count: 2, ceiling: "unbounded", reason: "bunzai convert reads the whole input with no size check (row 28)" },
  "src/kit/tools/folder-import.ts": { count: 2, ceiling: 64, reason: "Kit folder import, size checked against 64 MiB first (row 28)" },
  "src/kit/tools/folder-search.ts": { count: 1, ceiling: "unbounded", reason: "folder_search read: whole file as text before clipping (row 27)" },
  "src/studio/fs-backend.ts": { count: 1, ceiling: "unverified", reason: "a folder piece file read whole as one string (row 16)" },
  "src/docs/discover.ts": { count: 1, ceiling: 1, reason: "shipped markdown docs" },
  "src/kit/docs/repository.ts": { count: 2, ceiling: 1, reason: "shipped docs files for Kit search" },
  "src/kit/sessions/store.ts": { count: 1, ceiling: "unverified", reason: "one Kit transcript file read whole" },
  "src/kit/render/clipboard-read.ts": { count: 2, ceiling: 10, reason: "pasted text and image, MAX_IMAGE_BYTES 10 MiB (the image limit)" },
  "src/extensions/theme-inventory.ts": { count: 2, ceiling: 1, reason: "theme files, each checked against its own cap before use" },
  "src/ui/shell/theme-asset-urls.ts": { count: 1, ceiling: 0.125, reason: "theme asset response is checked against the 128 KB cap before decoding" },
  // Small config, keys and secrets: bounded by what they are.
  "src/kit/mcp/config.ts": { count: 1, ceiling: 1, reason: "MCP settings file" },
  "src/kit/providers/vault.ts": { count: 1, ceiling: 1, reason: "provider secret vault file" },
  "src/kit/keystore/aes.ts": { count: 2, ceiling: 1, reason: "AES of a key or a secret, a few hundred bytes" },
  "src/kit/keystore/backends/identity-file.ts": { count: 2, ceiling: 1, reason: "key identity file" },
  "src/kit/keystore/backends/keychain-key.ts": { count: 3, ceiling: 1, reason: "keychain lock file: a random token" },
  "src/kit/tools/safety/gate-store.ts": { count: 1, ceiling: 1, reason: "Kit safety mode setting" },
  "src/stage/crypto/crypto.ts": { count: 1, ceiling: "codec", reason: "cell seal: iv, tag and ciphertext joined once per cell" },
  "src/stage/crypto/device-vault.ts": { count: 2, ceiling: 1, reason: "this computer's id and its sealed check" },
  "src/ui/remote/aux-install.ts": { count: 1, ceiling: 1, reason: "a marker file for the remote-access helper" },
  "src/ui/remote/lan-server.ts": { count: 3, ceiling: 1, reason: "certificate, key and a process output" },
  "src/ui/switch/git-runner.ts": { count: 2, ceiling: 1, reason: "stdout and stderr of a git child process" },
  "src/stage/provider/provider-send.ts": { count: 2, ceiling: "unverified", reason: "a provider's non-stream answer or error body read whole" },
  // Browser side.
  "src/ui/api.ts": { count: 2, ceiling: 64, reason: "one streamed error body and one inspected import bounded by the endpoint cap; backup uploads stream from File" },
  "src/ui/_shared/api-fetch.ts": { count: 1, ceiling: "unverified", reason: "the answer text of every API call" },
  "src/ui/apps/press/index.tsx": { count: 2, ceiling: "unbounded", reason: "the multi-output zip reads one output Blob at its turn (a stored pack output is one whole nested archive); outputs are Blobs, never one array" },
  "src/ui/apps/workbench/Editor.tsx": { count: 2, ceiling: "unverified", reason: "a portrait blob read to pick a signature color" },
  "src/ui/components/sprite-pack/dialog.tsx": { count: 3, ceiling: "unverified", reason: "a pasted picture to base64 (rows 22, 23)" },
  "src/ui/components/sprite-pack/zip-import.ts": { count: 2, ceiling: 48, reason: "sprite zip read whole in the browser (row 21)" },
  "src/ui/_shared/picture-folder.ts": { count: 3, ceiling: 48, reason: "dropped pictures read whole and zipped (row 22)" },
  "src/ui/apps/scenes/stage-gallery-apply.ts": { count: 1, ceiling: 1, reason: "one inline card picture (under the 16 KiB blob threshold, larger ones are uploaded refs) decoded to a file for Use as background" },
  "src/ui/_shared/user-fonts.ts": { count: 1, ceiling: 32, reason: "one font face" },
  "src/ui/apps/docs/room.tsx": { count: 1, ceiling: 1, reason: "one docs page answer" },
  "src/ui/extensions/file-handles.ts": { count: 2, ceiling: 8, reason: "selected file bytes are checked against the 8 MB cap before reading; native handles remain page-local" },
  "src/extensions/operations/network/_vetted.ts": { count: 1, ceiling: 64, reason: "response.text() follows the vetted fetch transform that cancels once the operation byte budget is exceeded" },
  "src/ui/apps/settings/sections/extensions.tsx": { count: 1, ceiling: 8, reason: "package file size is checked against the 8 MB cap before parsing the manifest envelope" },
  "src/kit/extensions/owner.ts": { count: 2, ceiling: 1, reason: "packaged QuickJS WASM is checked against the 1 MB cap before transfer to the compiled worker" },
  "src/extensions/operations/assets/operations.ts": { count: 1, ceiling: 0.18, reason: "selected asset reads use the shared 180 KB operation cap before base64 encoding" },
  "src/extensions/operations/assets/mutation-operations.ts": { count: 1, ceiling: 0.18, reason: "import bytes pass the shared 180 KB decoder and attachment reads use the same operation cap before base64 encoding" },
  "src/ui/apps/workbench/lore/playback-tab.tsx": { count: 1, ceiling: "unverified", reason: "a chosen log file read as text" },
  "src/ui/components/css-workshop/import-css.ts": { count: 1, ceiling: 1, reason: "an imported css file" },
  "src/ui/apps/agent/room.tsx": { count: 1, ceiling: "unverified", reason: "FileReader data URL, size not capped here (row 23)" },
  "src/ui/apps/workbench/controls/field-control-composites.tsx": { count: 1, ceiling: "unverified", reason: "FileReader data URL, size not capped here (row 23)" },
  "src/ui/components/asset-manager/index.tsx": { count: 1, ceiling: "unverified", reason: "FileReader data URL, size not capped here (row 23)" },
  "src/ui/components/sprite-pack/sheet-slice.ts": { count: 1, ceiling: "unverified", reason: "FileReader data URL, size not capped here (row 23)" },
  "src/ui/components/sprite-pack/upload-image.ts": { count: 1, ceiling: "unverified", reason: "FileReader data URL, size not capped here (row 23)" },
  "src/ui/components/ticket-window/index.tsx": { count: 1, ceiling: "unverified", reason: "FileReader data URL, size not capped here (row 23)" },
};

const WHOLE_BUFFER =
  /\.arrayBuffer\(\)|\bBuffer\.concat\(|\b(?:readFileSync|readFile)\(|\.text\(\)|new Uint8Array\(await|\b(?:bytesToBase64|base64ToBytes)\(|\b(?:zipSync|unzipSync|unzipBounded)\(|readAsDataURL\(/g;
/** Authored runtime sources: no tests, contract suites, test stand-ins or fixtures. */
const scanned = (path: string): boolean =>
  /\.tsx?$/.test(path) && !/\.test\.tsx?$/.test(path) && !/\.contract(-fixtures)?\.tsx?$/.test(path) &&
  !/(^|\/)(fake-[^/]*|[^/]*-rig|[^/]*-test-support|test-[^/]*)\.tsx?$/.test(path) && !/(^|\/)(node_modules|_fixtures|generated)\//.test(path);

const counts = (): Map<string, number> => {
  const found = new Map<string, number>();
  for (const file of readdirSync("src", { recursive: true }).map((p) => `src/${String(p).replace(/\\/g, "/")}`).filter(scanned)) {
    const n = stripComments(readFileSync(file, "utf8")).match(WHOLE_BUFFER)?.length ?? 0;
    if (n > 0) found.set(file, n);
  }
  return found;
};

test("no source file reads user data whole unless it is on the list", () => {
  const found = counts();
  expect([...found].filter(([file]) => !(file in ALLOWED)).map(([file, n]) => `${file} (${n})`)).toEqual([]);
});

test("a listed file makes exactly the calls it is listed for", () => {
  const found = counts();
  expect(Object.entries(ALLOWED).filter(([file, entry]) => (found.get(file) ?? 0) !== entry.count).map(([file, entry]) => `${file}: listed ${entry.count}, found ${found.get(file) ?? 0}`)).toEqual([]);
});

test("every entry states a reason and a real ceiling", () => {
  const bad = Object.entries(ALLOWED).filter(([, e]) => !e.reason.trim() || e.count < 1 ||
    !(typeof e.ceiling === "number" ? e.ceiling > 0 : ["codec", "unbounded", "unverified"].includes(e.ceiling)));
  expect(bad.map(([file]) => file)).toEqual([]);
});
