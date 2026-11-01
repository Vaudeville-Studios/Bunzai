/** Tests the pure single-source detectors against duplicate, shared, and comment-only code. */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  compiledBuildOutsideHome,
  chatGraveyardQuarantineCopyOutsideHome,
  desktopWindowWiringOutsideHome,
  escapeListenerOutsideHome,
  errorMessageCopyOutsideHome,
  errorNameRecognitionOutsideHome,
  invalidProviderFactoryOutsideHome,
  kitUniqueIdOutsideHome,
  jsonStringifyEqualityOutsideHome,
  numberFallbackCopyOutsideHome,
  positiveCountCopyOutsideHome,
  providerFetchHarnessCopyOutsideHome,
  textResponseCopyOutsideHome,
  focusableSelectorOutsideHome,
  isRecordOutsideHome,
  isLuaResourceLimitErrorOutsideHome,
  openInBrowserOutsideHome,
  regexEscapeCopyOutsideHome,
  sharedHomeDeclarationOutsideHome,
  serverTestRequestBuilderOutsideHome,
  newJSDOMOutsideHome,
  readJsonCappedOutsideHome,
  testCipherOutsideHome,
  transportHelperOutsideHome,
  wordSamplerCopyOutsideHome,
} from "./single-source-core";
import { copyFlashOutsideHome, debounceFlushPatternOutsideHome, hrefAllowlistOutsideHome, popoutOutsideHome, sceneDateFormatOutsideHome, typingTargetOutsideHome } from "./single-source-ui";
import {
  boolOrCopyOutsideHome,
  cardArchiveBoundsOutsideHome,
  magicBytesOutsideHome,
  platformOwnsBodyOutsideHome,
  pluralCopyOutsideHome,
  recOrCopyOutsideHome,
  roleTableOutsideHome,
  slugCopyOutsideHome,
  strArrayCopyOutsideHome,
} from "./single-source-copies";
import {
  byteLimitLiteralOutsideHome,
  charsOverFourOutsideHome,
  imageLimitAliasOutsideHome,
  sceneSearchLimitsOutsideHome,
  mimeTableOutsideHome,
  sha256PatternOutsideHome,
  uploadedRefPatternOutsideHome,
} from "./single-source-limits";
import {
  hiddenFlagCheckOutsideHome,
  packPictureRuleOutsideHome,
  swipeSqlOutsideHome,
  wholeNumberCheckInStoreRulesOutsideHome,
  windowsDeviceNameCopyOutsideHome,
} from "./single-source-packs-stores";
import { walk } from "./walk";
import { appDataWriteOutsideHome } from "./single-source-storage-rules";

describe("readJsonCappedOutsideHome", () => {
  test("allows server-security.ts itself", () => {
    expect(readJsonCappedOutsideHome("src/ui/server-security.ts", "readJsonCapped(req)")).toBeNull();
  });

  test("flags any other caller", () => {
    const hit = readJsonCappedOutsideHome("src/ui/server-chats.ts", "await readJsonCapped(req)");
    expect(hit).toContain("src/ui/server-chats.ts");
    expect(hit).toContain("readJsonObject");
  });

  test("ignores a mention inside a comment", () => {
    expect(readJsonCappedOutsideHome("src/ui/server-chats.ts", "// use readJsonCapped( never")).toBeNull();
  });
});

describe("newJSDOMOutsideHome", () => {
  test("requires the shared setup, except the helper and intentional secondary DOM", () => {
    expect(newJSDOMOutsideHome("src/ui/_shared/test-dom.ts", "new JSDOM(\"\")")).toBeNull();
    expect(newJSDOMOutsideHome("src/ui/_shared/virtual-list/core.test.tsx", "new JSDOM(\"\")")).toBeNull();
    expect(newJSDOMOutsideHome("src/ui/apps/example.test.tsx", "new JSDOM(\"\")")).toContain("test-dom.ts");
  });
  test("ignores comments", () => {
    expect(newJSDOMOutsideHome("src/ui/apps/example.test.tsx", "// new JSDOM(\"\")")).toBeNull();
  });
});

describe("escapeListenerOutsideHome", () => {
  test("flags document Escape listeners but allows shared hook and scoped JSX predicate", () => {
    expect(escapeListenerOutsideHome("src/ui/_shared/use-escape-key.ts", 'document.addEventListener("keydown", onKey)')).toBeNull();
    expect(escapeListenerOutsideHome("src/ui/dialog.tsx", 'document.addEventListener("keydown", e => e.key === "Escape")')).toContain("useEscapeKey");
    expect(escapeListenerOutsideHome("src/ui/dialog.tsx", "onKeyDown={e => isEscapeClose(e) && close()}")).toBeNull();
  });

  test("also flags a window listener, a negated test and a hand-written key test in a JSX handler", () => {
    expect(escapeListenerOutsideHome("src/ui/agent/panel.tsx", 'window.addEventListener("keydown", (e) => { if (e.key !== "Escape") return; close(); })')).toContain("useEscapeKey");
    expect(escapeListenerOutsideHome("src/ui/apps/x/box.tsx", 'onKeyDown={(e) => { if (e.key === "Escape") cancel(); }}')).toContain("isEscapeClose");
    expect(escapeListenerOutsideHome("src/ui/apps/x/box.tsx", 'switch (event.key) { case "Escape": return close(); }')).toContain("isEscapeClose");
    expect(escapeListenerOutsideHome("src/ui/apps/x/box.test.tsx", 'e.key === "Escape"')).toBeNull();
    expect(escapeListenerOutsideHome("src/ui/apps/x/box.tsx", 'window.addEventListener("keydown", (e) => { if (e.key === "z") undo(); })')).toBeNull();
  });
});

describe("focusableSelectorOutsideHome", () => {
  test("allows the shared selector and flags a second declaration", () => {
    expect(focusableSelectorOutsideHome("src/ui/_shared/focus-trap.ts", "const FOCUSABLE = 'button';")).toBeNull();
    expect(focusableSelectorOutsideHome("src/ui/dialog.tsx", "const FOCUSABLE = 'button';")).toContain("focus-trap.ts");
    expect(focusableSelectorOutsideHome("src/ui/other.tsx", 'const stops = ["button:not([disabled])", "input:not([disabled])", "textarea", "[tabindex]:not([-1])"]; root.querySelectorAll(stops);'))
      .toContain("focus-trap.ts");
    expect(focusableSelectorOutsideHome("src/ui/other.test.tsx", 'const buttons = host.querySelectorAll("button");')).toBeNull();
    expect(focusableSelectorOutsideHome("src/ui/dialog.tsx", "// const FOCUSABLE = 'button';")).toBeNull();
  });
});

const isSource = (path: string): boolean =>
  (path.endsWith(".ts") || path.endsWith(".tsx")) && !path.endsWith(".test.ts") && !path.endsWith(".test.tsx");

const APP_DATA_ALLOWLIST: ReadonlySet<string> = new Set([
  // Lock-aside: moves a damaged/unopenable vault file OUT of the way on recovery, never publishes
  // app data. Deliberately best-effort (its own comment: a failed rename must not re-block recovery).
  "src/kit/providers/vault.ts",
  // Different shape, reviewed: builds a whole folder tree of exclusive-create files in a sibling
  // "building" dir, then renames the WHOLE TREE into place in one move - writeAtomicReplace only
  // publishes a single file. Already collision-safe (wx) and already cleans up the building dir on
  // any error; not the B13 bug class (no reported Windows rename-retry failure on this path).
  "src/studio/folder-export.ts",
  // Distinct shape: creates a complete library tree in a sibling directory and publishes that
  // directory as one unit; writeAtomicReplace is a single-file protocol and does not replace it.
  "src/ui/library-open.ts",
  // Publishes a finished snapshot: the lane writes it under a .partial name, checks it, and renames it into the
  // folder as one unit, so a listing never shows half of one. A single-file atomic replace is not that shape.
  "src/stage/store/sqlite/snapshots.ts",
  // Lock-aside: moves a stale lock file out of the way and deliberately tolerates failure; this is
  // recovery cleanup, not publication of app data.
  "src/kit/keystore/backends/keychain-key.ts",
  // Exclusive-create ("wx", 0o600) of the one key-vault identity file with cleanup of a partial write;
  // never replaces an existing file, so there is no rename-over-existing to retry. Listed in src/disk-writes.test.ts.
  "src/kit/keystore/backends/identity-write.ts",
  // Streams one big entity into a new file the person chose to export to ("wx": never overwrites), like
  // folder-export.ts; plain files on purpose, outside the library. Listed in src/disk-writes.test.ts.
  "src/studio/folder-export-held.ts",
  // The path lock file ("wx"): it holds a pid and a timestamp, no content, and is unlinked when the task ends.
  "src/studio/fs-backend.ts",
  // Appends one failed-start report (kind, message, stack; never a file's text) to a log; append, not
  // replace, and losing it must not block the dialog. Listed in src/disk-writes.test.ts.
  "src/desktop-boot-report.ts",
]);

describe("openInBrowserOutsideHome", () => {
  test("allows server-security.ts itself", () => {
    expect(openInBrowserOutsideHome("src/ui/server-security.ts", "export const openInBrowser = (href) => {};")).toBeNull();
  });

  test("flags a second declaration", () => {
    const hit = openInBrowserOutsideHome("src/desktop-dev.ts", "function openInBrowser(url) {}");
    expect(hit).toContain("server-security.ts");
  });

  test("ignores a call site, not a declaration", () => {
    expect(openInBrowserOutsideHome("src/desktop-dev.ts", "openInBrowser(uiUrl);")).toBeNull();
  });
});

describe("isLuaResourceLimitErrorOutsideHome", () => {
  test("allows limits.ts itself", () => {
    expect(isLuaResourceLimitErrorOutsideHome("src/sandbox/lua/limits.ts", "isLuaResourceLimitError(err)")).toBeNull();
  });

  test("flags a second caller", () => {
    const hit = isLuaResourceLimitErrorOutsideHome("src/sandbox/lua/worker.ts", "if (isLuaResourceLimitError(err)) {}");
    expect(hit).toContain("classifyLuaError");
  });
});

describe("compiledBuildOutsideHome", () => {
  test("allows the worker lane's own branch", () => {
    expect(compiledBuildOutsideHome("src/stage/worker-lane.ts", "compiledBuild()" )).toBeNull();
  });

  test("flags copied callers and ignores comments", () => {
    expect(compiledBuildOutsideHome("src/stage/crypto/crypto.ts", "compiledBuild()" )).toContain("startLaneWorker");
    expect(compiledBuildOutsideHome("src/other.ts", "// compiledBuild()" )).toBeNull();
  });
});

describe("transportHelperOutsideHome", () => {
  test("allows the shared transport module and flags declarations elsewhere", () => {
    expect(transportHelperOutsideHome("src/stage/provider/transport-core.ts", "function createLineSplitter() {}" )).toBeNull();
    expect(transportHelperOutsideHome("src/stage/provider/anthropic-reply.ts", "const classifyHttpFailure = () => {};" )).toContain("transport-core.ts");
  });
});

describe("shared-home declarations", () => {
  test("rejects a second exported helper declaration at representative platform fold homes", () => {
    const declarations = [
      ["src/stage/store/content-store.ts", "export function contentSummaryOf() {}"],
      ["src/stage/store/memory/chat-store.ts", "export function variableAfterSet() {}"],
      ["src/stage/store/memory/chat-store.ts", "export function requireVersion() {}"],
      ["src/stage/store/sqlite/chat-store.ts", "export function isQuarantinableDecodeError() {}"],
      ["src/stage/contracts/content-store.ts", "export function mulberry32() {}"],
      ["src/stage/store/content-store.ts", "export function compareDocumentOrder() {}"],
      ["src/studio/collections.ts", "export const WHOLE_BRANCH = 1;"],
      ["src/studio/foreign.ts", "export function uniqueBy() {}"],
      ["src/studio/half-block.ts", "export const rgbHex = () => {};"],
      ["src/ui/apps/scenes/prose-core.ts", "export const escapeHtml = (s: string) => s;"],
      ["src/kit/render/colors.ts", "export const hexToRgb = () => {};"],
      ["src/studio/signature-color.ts", "function rgbToHsv() {}"],
      ["src/cli.ts", "export function toErrorMessage() {}"],
      ["scripts/macro-oracle/engines/rolecall.ts", "export function loadSourceModule() {}"],
      ["src/stage/provider/anthropic-request.ts", "export const invalidRequest = () => {};"],
      ["src/stage/provider/anthropic-request.ts", "export interface WireRequest {}"],
      ["src/stage/store/sqlite/chat-store.ts", "export function splitQuarantine() {}"],
      ["src/sandbox/lua/worker.ts", "export function stateToWire() {}"],
      ["src/desktop-dev.ts", "export function startDesktopWindow() {}"],
      ["scripts/hooks/doctrines.ts", "export const SOURCE_EXTS = new Set();"],
      ["scripts/hooks/stage-boundary.ts", "export const SKIP_DIRS = new Set();"],
      ["src/stage/provider/anthropic-request.ts", "export function parseRequestOverrides() {}"],
      ["src/sandbox/lua/worker.ts", "function appendLog() {}"],
    ] as const;
    for (const [path, source] of declarations) {
      expect(sharedHomeDeclarationOutsideHome(path, source)).toContain("shared home");
    }
    expect(sharedHomeDeclarationOutsideHome("src/stage/store/memory/extension-store.ts", "async appendLog(packageId: string) {}" )).toBeNull();
    expect(sharedHomeDeclarationOutsideHome("src/color.ts", "export const hexToRgb = () => {}; export function rgbToHsv() {}")).toBeNull();
    expect(sharedHomeDeclarationOutsideHome("src/stage/store/other.ts", "async function contentSummaryOf() {}"))
      .toContain("shared home");
    expect(sharedHomeDeclarationOutsideHome("src/stage/store/other.ts", "private async contentSummaryOf() {}"))
      .toContain("shared home");
    expect(sharedHomeDeclarationOutsideHome("src/stage/store/other.ts", "function contentSummaryOf(\n value: string,\n): string { return value; }"))
      .toContain("shared home");
  });

  test("flags folded error, graveyard, and desktop behavior copies", () => {
    expect(errorMessageCopyOutsideHome("src/studio/bundle.ts", "error instanceof Error ? error.message : String(error)"))
      .toContain("toErrorMessage");
    expect(chatGraveyardQuarantineCopyOutsideHome("src/stage/store/sqlite/chat-store.ts", "safeToChat(row); quarantined.push(id);"))
      .toContain("splitQuarantine");
    expect(desktopWindowWiringOutsideHome("src/desktop-dev.ts", 'worker.addEventListener("error", onError); worker.postMessage({ url, title });'))
      .toContain("startDesktopWindow");
    expect(invalidProviderFactoryOutsideHome("src/stage/provider/anthropic-request.ts", 'new ProviderError(message, { category: "invalid_request_error", code: "invalid_options", status: 400 })'))
      .toContain("invalidRequest");
    expect(serverTestRequestBuilderOutsideHome("src/ui/server-docs.test.ts", 'const apiReq = () => new Request("http://x");'))
      .toContain("server-test-rig.ts");
    expect(serverTestRequestBuilderOutsideHome("src/ui/server-studio-trash.test.ts", 'const post = () => apiReq("/api", { body: JSON.stringify(body) });'))
      .toBeNull();
    expect(textResponseCopyOutsideHome("src/ui/server-docs.ts", 'new Response(body, { headers: { "content-type": type } })'))
      .toContain("server-security.ts");
    expect(providerFetchHarnessCopyOutsideHome("src/stage/provider/anthropic.test.ts", "function controlledStream() {}"))
      .toContain("test-fetch-harness.ts");
    expect(kitUniqueIdOutsideHome("src/kit/session.ts", "export function uniqueId() {}"))
      .toContain("src/core/list-ops.ts");
  });
});

test("shared equality, regex escaping, and finite-number defaults have one primitive", () => {
  expect(jsonStringifyEqualityOutsideHome("src/entities/a.ts", "JSON.stringify(left) === JSON.stringify(right)"))
    .toContain("deepEq");
  expect(regexEscapeCopyOutsideHome("src/formats/a.ts", 'value.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&")'))
    .toContain("escapeRegex");
  expect(numberFallbackCopyOutsideHome("src/formats/a.ts", "Number.isFinite(value) ? value : 0"))
    .toContain("numOr");
  expect(numberFallbackCopyOutsideHome("src/formats/a.ts", "Number.isFinite(value) ? value * 1000 : 0"))
    .toBeNull();
  expect(numberFallbackCopyOutsideHome("src/ui/apps/settings/field.tsx", "Number.isFinite(row.value) ? row.value : 0"))
    .toContain("numOr");
  expect(numberFallbackCopyOutsideHome("src/ui/apps/settings/field.tsx", "Number.isFinite(\n row.value\n) ?\n row.value\n : 0"))
    .toContain("numOr");
  expect(numberFallbackCopyOutsideHome("src/studio/piece-facts.ts", 'typeof v === "number" && Number.isFinite(v) ? v : undefined'))
    .toContain("presentNum");
});

test("positive finite usage counts have a narrow shared home", () => {
  expect(positiveCountCopyOutsideHome("src/kit/providers/usage.ts", 'typeof n === "number" && Number.isFinite(n) && n > 0 ? n : 0'))
    .toBeNull();
  expect(positiveCountCopyOutsideHome("src/kit/providers/egress-ledger.ts", 'typeof n === "number" && Number.isFinite(n) && n > 0 ? n : 0'))
    .toContain("cleanCount");
  expect(positiveCountCopyOutsideHome("src/kit/providers/usage.ts", 'Number.isFinite(n) ? n : 0'))
    .toBeNull();
});

test("scale and performance prose share one vocabulary sampler", () => {
  expect(wordSamplerCopyOutsideHome("scripts/scale/word-sampler.ts", "Math.floor(rng() * vocabulary.length)"))
    .toBeNull();
  expect(wordSamplerCopyOutsideHome("scripts/perf-gate-assembly.ts", "WORDS[Math.floor(rand() * WORDS.length)]"))
    .toContain("word-sampler.ts");
  expect(wordSamplerCopyOutsideHome("scripts/scale/fixtures/other.ts", "VOCAB[Math.floor(rng() * VOCAB.length)]"))
    .toContain("word-sampler.ts");
  expect(wordSamplerCopyOutsideHome("src/core/something.ts", "Math.floor(rng() * choices.length)"))
    .toBeNull();
});

test("error-name recognition is shared without removing caller-owned class checks", () => {
  expect(errorNameRecognitionOutsideHome("src/studio/errors.ts", 'e instanceof Error || (typeof e === "object" && e !== null && (e as { name?: string }).name === "StudioReadError")'))
    .toContain("hasErrorName");
  expect(errorNameRecognitionOutsideHome("src/ui/server-security.ts", 'e instanceof Error && e.name === "StageDatabaseError"'))
    .toContain("hasErrorName");
  expect(errorNameRecognitionOutsideHome("src/core/guards.ts", 'typeof e === "object" && e !== null && (e as { name?: unknown }).name === name'))
    .toBeNull();
  expect(errorNameRecognitionOutsideHome("src/studio/errors.ts", 'if (e instanceof Error) return e.message'))
    .toBeNull();
});

describe("testCipherOutsideHome", () => {
  test("allows only the shared SQLite test support module", () => {
    expect(testCipherOutsideHome("src/stage/store/sqlite/test-support.ts", "const testCipher = () => {};" )).toBeNull();
    expect(testCipherOutsideHome("src/stage/store/chat-store.test.ts", "const testCipher = () => {};" )).toContain("test-support.ts");
  });
});

describe("isRecordOutsideHome", () => {
  test("allows the canonical guard and catches a local declaration", () => {
    expect(isRecordOutsideHome("src/core/guards.ts", "export const isRecord = () => true;" )).toBeNull();
    expect(isRecordOutsideHome("src/stage/provider/reply.ts", 'const isObject = (v) => typeof v === "object" && v !== null && !Array.isArray(v);' )).toContain("core/guards.ts");
  });

  test("does not flag uses, comments, or longer names", () => {
    expect(isRecordOutsideHome("src/stage/provider/reply.ts", "isRecord(value); // isRecord()" )).toBeNull();
    expect(isRecordOutsideHome("src/stage/provider/reply.ts", "const isRecordLike = () => true;" )).toBeNull();
    expect(isRecordOutsideHome("src/docs/corpus.ts", 'if (!value || typeof value !== "object") return false;' )).toBeNull();
    expect(isRecordOutsideHome("src/core/media/pack.ts", 'if (!value || typeof value !== "object" || Array.isArray(value)) return null;'))
      .toContain("core/guards.ts");
    expect(isRecordOutsideHome("src/studio/settings-shape.ts", 'if (raw !== null && typeof raw === "object" && !Array.isArray(raw)) return raw;'))
      .toContain("core/guards.ts");
    expect(isRecordOutsideHome("src/studio/engine-roots.ts", 'if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return {};'))
      .toContain("core/guards.ts");
    expect(isRecordOutsideHome("src/mcp/protocol.ts", 'if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return null;'))
      .toContain("core/guards.ts");
    expect(isRecordOutsideHome("src/studio/shape.ts", 'if (raw === null || typeof raw !== "object") return {};'))
      .toBeNull();
  });
});

const isTypeScript = (path: string): boolean => path.endsWith(".ts") || path.endsWith(".tsx");
test("single-source folds have one home in the live repository", () => {
  const files = [
    ...walk("src", isTypeScript, new Set(["node_modules", "dist"])),
    ...walk("scripts", isTypeScript, new Set(["node_modules", "dist"])),
  ];
  expect(files.length).toBeGreaterThan(1000);
  const sources = files.map((path) => [path, readFileSync(path, "utf8")] as const);
  const live = sources.filter(([path]) => isSource(path));
  const hits = [
    ...live.flatMap(([path, source]) => [
      appDataWriteOutsideHome(path, source, APP_DATA_ALLOWLIST),
      openInBrowserOutsideHome(path, source),
      isLuaResourceLimitErrorOutsideHome(path, source),
      compiledBuildOutsideHome(path, source),
      transportHelperOutsideHome(path, source),
    ].filter((hit): hit is string => hit !== null)),
    ...live.flatMap(([path, source]) => [
      isRecordOutsideHome(path, source),
      strArrayCopyOutsideHome(path, source),
      recOrCopyOutsideHome(path, source),
      boolOrCopyOutsideHome(path, source),
      magicBytesOutsideHome(path, source),
      sha256PatternOutsideHome(path, source),
      uploadedRefPatternOutsideHome(path, source),
      byteLimitLiteralOutsideHome(path, source),
      imageLimitAliasOutsideHome(path, source),
      sceneSearchLimitsOutsideHome(path, source),
      charsOverFourOutsideHome(path, source),
      mimeTableOutsideHome(path, source),
      cardArchiveBoundsOutsideHome(path, source),
      platformOwnsBodyOutsideHome(path, source),
      roleTableOutsideHome(path, source),
      pluralCopyOutsideHome(path, source),
      slugCopyOutsideHome(path, source),
      packPictureRuleOutsideHome(path, source),
      windowsDeviceNameCopyOutsideHome(path, source),
      hiddenFlagCheckOutsideHome(path, source),
      wholeNumberCheckInStoreRulesOutsideHome(path, source),
      swipeSqlOutsideHome(path, source),
      readJsonCappedOutsideHome(path, source),
      sharedHomeDeclarationOutsideHome(path, source),
      errorMessageCopyOutsideHome(path, source),
      jsonStringifyEqualityOutsideHome(path, source),
      errorNameRecognitionOutsideHome(path, source),
      regexEscapeCopyOutsideHome(path, source),
      numberFallbackCopyOutsideHome(path, source),
      positiveCountCopyOutsideHome(path, source),
      wordSamplerCopyOutsideHome(path, source),
      chatGraveyardQuarantineCopyOutsideHome(path, source),
      desktopWindowWiringOutsideHome(path, source),
      invalidProviderFactoryOutsideHome(path, source),
      kitUniqueIdOutsideHome(path, source),
      typingTargetOutsideHome(path, source),
      debounceFlushPatternOutsideHome(path, source),
      sceneDateFormatOutsideHome(path, source),
      copyFlashOutsideHome(path, source),
      hrefAllowlistOutsideHome(path, source),
      popoutOutsideHome(path, source),
    ].filter((hit): hit is string => hit !== null)),
    ...sources.flatMap(([path, source]) => [
      newJSDOMOutsideHome(path, source),
      escapeListenerOutsideHome(path, source),
      focusableSelectorOutsideHome(path, source),
      textResponseCopyOutsideHome(path, source),
      testCipherOutsideHome(path, source),
      serverTestRequestBuilderOutsideHome(path, source),
      providerFetchHarnessCopyOutsideHome(path, source),
    ].filter((hit): hit is string => hit !== null)),
  ];
  expect(hits).toEqual([]);
});
