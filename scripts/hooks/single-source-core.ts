/**
 * Single-source-of-truth guards: shared primitives and selected duplicate algorithms may only be
 * declared outside their owning home when a narrow protocol distinction applies. Pure over
 * (path, source) plus explicit protocol exceptions; the live-repo scan lives in the sibling test so
 * this file stays effect-free.
 */
import { norm, stripComments } from "./lib";
import { callsNamed, declaresShared } from "./single-source-syntax";

const SINGLE_HOME_DECLARATIONS = [
  ["contentSummaryOf", "src/stage/store/content-store-write.ts"],
  ["variableAfterSet", "src/stage/store/chat-rules.ts"],
  ["requireVersion", "src/stage/store/chat-rules.ts"],
  ["isQuarantinableDecodeError", "src/stage/store/sqlite/quarantine.ts"],
  ["mulberry32", "src/core/lore/rng.ts"],
  ["compareDocumentOrder", "src/stage/contracts/document-order.ts"],
  ["appendLog", "src/sandbox/lua/risu-api.ts"],
  ["apiReq", "src/ui/server-test-rig.ts"],
  ["filledSec", "src/ui/server-test-rig.ts"],
  ["WHOLE_BRANCH", "src/studio/scene-branch.ts"],
  ["uniqueBy", "src/studio/unique.ts"],
  ["rgbHex", "src/color.ts"],
  ["hexToRgb", "src/color.ts"],
  ["rgbToHsv", "src/color.ts"],
  ["toErrorMessage", "src/error-message.ts"],
  ["loadSourceModule", "scripts/macro-oracle/load-source.ts"],
  ["invalidRequest", "src/stage/provider/transport-core.ts"],
  ["splitQuarantine", "src/stage/store/sqlite/chat-store-quarantine.ts"],
  ["stateToWire", "src/sandbox/lua/risu-state.ts"],
  ["startDesktopWindow", "src/desktop-window-launch.ts"],
  ["parseRequestOverrides", "src/stage/provider/request-overrides.ts"],
  ["applyRequestHeaders", "src/stage/provider/request-overrides.ts"],
  ["applyRequestBody", "src/stage/provider/request-overrides.ts"],
  ["WireRequest", "src/stage/contracts/provider.ts"],
  ["requireStringField", "src/ui/server-security.ts"],
  ["refuseCrossSiteRead", "src/ui/server-security.ts"],
  ["checkToken", "src/ui/server-security.ts"],
  ["studioErr", "src/ui/server-security.ts"],
  ["stateDocument", "src/studio/state-document-store.ts"],
  ["tempDir", "src/studio/test-temp-dir.ts"],
  ["tempDirSync", "src/studio/test-temp-dir.ts"],
  ["withTempDir", "src/studio/test-temp-dir.ts"],
  ["withTempDirSync", "src/studio/test-temp-dir.ts"],
  ["serializer", "src/studio/serial.ts"],
  ["testCharacter", "src/studio/test-character.ts"],
  ["deepEq", "src/core/guards.ts"],
  ["hasErrorName", "src/core/guards.ts"],
  ["numOr", "src/core/guards.ts"],
  ["strArray", "src/core/guards.ts"],
  ["presentStrArray", "src/core/guards.ts"],
  ["recOr", "src/core/guards.ts"],
  ["boolOr", "src/core/guards.ts"],
  ["isPlainObject", "src/core/guards.ts"],
  ["strArr", "src/core/guards.ts"],
  ["asStringArray", "src/core/guards.ts"],
  ["startsWith", "src/core/bytes.ts"],
  ["isZipBytes", "src/core/bytes.ts"],
  ["isPngBytes", "src/core/bytes.ts"],
  ["extensionOf", "src/core/media/mime.ts"],
  ["extOf", "src/core/media/mime.ts"],
  ["sanitizeDownloadBase", "src/core/download-name.ts"],
  ["isPackPictureName", "src/core/media/pack-picture.ts"],
  ["isPackPictureJunk", "src/core/media/pack-picture.ts"],
  ["PACK_PICTURE_EXTENSIONS", "src/core/media/pack-picture.ts"],
  ["isWhole", "src/stage/store/scalar-rules.ts"],
  ["checkWhole", "src/stage/store/scalar-rules.ts"],
  ["checkHidden", "src/stage/store/scalar-rules.ts"],
  ["personaDaysOf", "src/stage/store/persona-stats-rules.ts"],
  ["appendSwipe", "src/stage/store/sqlite/swipe-sql.ts"],
  ["setCurrentSwipe", "src/stage/store/sqlite/swipe-sql.ts"],
  ["nextPosition", "src/stage/store/sqlite/swipe-sql.ts"],
  ["unzipCard", "src/core/archive.ts"],
  ["safeUnzip", "src/core/archive.ts"],
  ["makePlatformOwns", "src/core/write-for.ts"],
  ["asciiSlug", "src/core/text.ts"],
  ["escapeRegex", "src/core/regex/escape.ts"],
  ["createProviderSend", "src/stage/provider/provider-send.ts"],
  ["freshDatabase", "src/stage/store/sqlite/test-support.ts"],
  ["testCipher", "src/stage/store/sqlite/test-support.ts"],
  ["startLaneWorker", "src/stage/worker-lane.ts"],
  ["classifyLuaError", "src/sandbox/lua/limits.ts"],
  ["writeAtomicReplace", "src/studio/atomic-file.ts"],
  // Scene code reads these in the browser; classification cannot import the filesystem writer.
  ["isStudioWriteError", "src/studio/errors.ts"],
  ["isStudioConflictError", "src/studio/errors.ts"],
  ["appDataDir", "src/app-data.ts"],
  ["appendStreamDelta", "src/stage/provider/stream-core.ts"],
  ["useEscapeKey", "src/ui/_shared/use-escape-key.ts"],
  ["useDialogEscape", "src/ui/_shared/use-escape-key.ts"],
  ["isEscapeClose", "src/ui/_shared/use-escape-key.ts"],
  ["isTypingTarget", "src/ui/_shared/typing-target.ts"],
  ["useFlash", "src/ui/_shared/use-flash.ts"],
  ["Toast", "src/ui/_shared/toast.tsx"],
  ["EditToast", "src/ui/_shared/toast.tsx"],
  ["useAutoDismiss", "src/ui/_shared/use-flash.ts"],
  ["FLASH_MS", "src/ui/_shared/use-flash.ts"],
  ["useCopyFeedback", "src/ui/_shared/use-copy-feedback.ts"],
  ["validMs", "src/ui/apps/scenes/scene-meta-core.ts"],
  ["dayStamp", "src/ui/apps/scenes/scene-meta-core.ts"],
  ["dateTimeStamp", "src/ui/apps/scenes/scene-meta-core.ts"],
  ["formatStamp", "src/ui/apps/scenes/scene-meta-core.ts"],
  ["useFocusTrap", "src/ui/_shared/focus-trap.ts"],
  ["FOCUSABLE", "src/ui/_shared/focus-trap.ts"],
  ["installDom", "src/ui/_shared/test-dom.ts"],
  ["useDebouncedValue", "src/ui/_shared/use-debounced-value.ts"],
  ["useDebouncedSave", "src/ui/_shared/use-debounced-value.ts"],
  ["AsyncState", "src/ui/_shared/async-state.ts"],
  ["exponentialBackoffMs", "src/ui/_shared/backoff.ts"],
  ["DialogHeader", "src/ui/components/ink-dialog/chrome.tsx"],
  ["DialogFooter", "src/ui/components/ink-dialog/chrome.tsx"],
  ["useTick", "src/kit/render/primitives/use-tick.ts"],
  ["loadDropIns", "src/kit/drop-in-loader.ts"],
  ["SelectableRow", "src/kit/render/primitives/selectable-row.tsx"],
  ["parsePathArgument", "src/kit/commands/path-argument.ts"],
  ["ElapsedStamp", "src/kit/render/primitives/elapsed-stamp.tsx"],
  ["compactCount", "src/kit/_shared/compact-count.ts"],
  ["cleanCount", "src/kit/providers/usage.ts"],
  ["spawnCollect", "src/kit/keystore/backends/spawn-collect.ts"],
  ["intentOf", "src/kit/render/primitives/nav/intent.ts"],
  ["FOCUSABLE_SELECTOR", "src/ui/_shared/focus-trap.ts"],
  ["DialogCore", "src/ui/components/dialog-core/index.tsx"],
  ["newUiId", "src/ui/_shared/new-id.ts"],
  ["textResponse", "src/ui/server-security.ts"],
  ["SOURCE_EXTS", "scripts/hooks/file-selection.ts"],
  ["SKIP_DIRS", "scripts/hooks/file-selection.ts"],
  ["fakeFetch", "src/stage/provider/test-fetch-harness.ts"],
  ["controlledStream", "src/stage/provider/test-fetch-harness.ts"],
  ["rejection", "src/stage/provider/test-fetch-harness.ts"],
  ["tick", "src/stage/provider/test-fetch-harness.ts"],
  ["sampleWords", "scripts/scale/word-sampler.ts"],
  ["escapeHtml", "src/ui/_shared/render-policy.ts"],
] as const;

/** Named fold homes stay unique across src and scripts; inline reimplementations have a companion rule. */
export function sharedHomeDeclarationOutsideHome(path: string, source: string): string | null {
  const p = norm(path);
  for (const [name, home] of SINGLE_HOME_DECLARATIONS) {
    if (p === home) continue;
    // Lua's historical API appender is distinct from extension-store appendLog persistence methods.
    if (name === "appendLog" && !p.startsWith("src/sandbox/lua/")) continue;
    if (declaresShared(p, source, name)) {
      return `${p}: declares ${name}; its shared home is ${home}.`;
    }
  }
  return null;
}

/** Kit id allocation is a separate home from core's caller-configurable suffix candidate helper. */
export function kitUniqueIdOutsideHome(path: string, source: string): string | null {
  const p = norm(path);
  const home = "src/core/list-ops.ts";
  if (p === home || !p.startsWith("src/kit/")) return null;
  if (!/\bexport\s+(?:function|const)\s+uniqueId\b/.test(stripComments(source))) return null;
  return `${p}: declares Kit uniqueId; its shared home is ${home}.`;
}

/** Strictly-positive finite token counts have one owner; keep the rule narrower than numOr. */
export function positiveCountCopyOutsideHome(path: string, source: string): string | null {
  const p = norm(path);
  if (p === "src/kit/providers/usage.ts") return null;
  const clean = stripComments(source);
  if (!/typeof\s+(\w+)\s*===?\s*["']number["']\s*&&\s*Number\.isFinite\(\s*\1\s*\)\s*&&\s*\1\s*>\s*0\s*\?\s*\1\s*:\s*0/.test(clean)) return null;
  return `${p}: repeats positive finite token-count normalization. Use cleanCount from src/kit/providers/usage.ts.`;
}

/** Seeded vocabulary selection is one draw per word in scripts/scale and performance gates. */
export function wordSamplerCopyOutsideHome(path: string, source: string): string | null {
  const p = norm(path);
  if (p === "scripts/scale/word-sampler.ts") return null;
  if (!/^scripts\/(?:scale\/.*|perf-gate-[^/]+)\.ts$/.test(p)) return null;
  if (!/Math\.floor\s*\(\s*[A-Za-z_$][\w$]*\s*\(\s*\)\s*\*\s*[A-Za-z_$][\w$]*\.length\s*\)/.test(stripComments(source))) return null;
  return p + ": samples a vocabulary index locally. Use sampleWords from scripts/scale/word-sampler.ts.";
}

/** Error normalization is one shared operation; callers with raw diagnostics keep their own contract. */
export function errorMessageCopyOutsideHome(path: string, source: string): string | null {
  const p = norm(path);
  if (p === "src/error-message.ts" || p === "src/ui/_shared/error-message.ts") return null;
  if (!/\b\w+\s+instanceof\s+Error\s*\?\s*\w+\.message\s*:/.test(stripComments(source))) return null;
  return `${p}: repeats the shared Error-to-message conversion. Import toErrorMessage from src/error-message.ts.`;
}

/** Key-order-safe equality belongs to the recursive core helper, not JSON serialization. */
export function jsonStringifyEqualityOutsideHome(path: string, source: string): string | null {
  const p = norm(path);
  if (p === "src/core/guards.ts") return null;
  if (!/JSON\.stringify\s*\(\s*[^()]+\)\s*===?\s*JSON\.stringify\s*\(\s*[^()]+\)/.test(stripComments(source))) return null;
  return `${p}: compares JSON.stringify output. Use deepEq from src/core/guards.ts for object equality.`;
}

/** Error-name structure is shared in core while each owning caller keeps its class/type policy. */
export function errorNameRecognitionOutsideHome(path: string, source: string): string | null {
  const p = norm(path);
  if (p === "src/core/guards.ts") return null;
  const clean = stripComments(source);
  const objectName = /typeof\s+(\w+)\s*===?\s*["']object["']\s*&&\s*\1\s*!==?\s*null\s*&&\s*\(\s*\1\s+as\s+\{\s*name\??\s*:\s*\w+\s*\}\s*\)\.name\s*===?\s*["'][A-Za-z_$][\w$]*Error["']/;
  const errorName = /\b\w+\s+instanceof\s+Error\s*&&\s*\w+\.name\s*===?\s*["'][A-Za-z_$][\w$]*Error["']/;
  if (!objectName.test(clean) && !errorName.test(clean)) return null;
  return `${p}: repeats error-name recognition. Use hasErrorName from src/core/guards.ts and retain any caller-specific instanceof check.`;
}

/** Regex escaping belongs to the shared literal pattern helper. */
export function regexEscapeCopyOutsideHome(path: string, source: string): string | null {
  const p = norm(path);
  if (p === "src/core/regex/escape.ts") return null;
  const clean = stripComments(source);
  if (!/replace\s*\(\s*\/\[\.\*\+\?\^\$\{\}\(\)\|/.test(clean) || !/\\\$&/.test(clean)) return null;
  return `${p}: reimplements literal regex escaping. Import escapeRegex from src/core/regex/escape.ts.`;
}

/** Plain finite-number fallback ternaries share numOr; semantic conversions retain their own parsers. */
export function numberFallbackCopyOutsideHome(path: string, source: string): string | null {
  const p = norm(path);
  if (p === "src/core/guards.ts") return null;
  const clean = stripComments(source);
  const value = "([A-Za-z_$][\\w$]*(?:\\.[A-Za-z_$][\\w$]*|\\[[^\\]]+\\])*)";
  const passthrough = new RegExp(`Number\\.isFinite\\s*\\(\\s*${value}\\s*\\)\\s*\\?\\s*\\1\\s*:`);
  const optionalNumber = new RegExp(`typeof\\s+${value}\\s*===?\\s*["']number["']\\s*&&\\s*Number\\.isFinite\\s*\\(\\s*\\1\\s*\\)\\s*\\?\\s*\\1\\s*:\\s*undefined`);
  if (!passthrough.test(clean) && !optionalNumber.test(clean)) return null;
  return `${p}: repeats a finite-number passthrough fallback. Use numOr or presentNum from src/core/guards.ts.`;
}

/** Provider preflight errors share one factory; protocol-specific codes stay caller-selected. */
export function invalidProviderFactoryOutsideHome(path: string, source: string): string | null {
  const p = norm(path);
  if (p === "src/stage/provider/transport-core.ts") return null;
  const clean = stripComments(source);
  if (!/new\s+ProviderError\s*\(\s*message\s*,\s*\{/.test(clean)
    || !/category\s*:\s*["']invalid_request_error["']/.test(clean)
    || !/status\s*:\s*400/.test(clean)) return null;
  return `${p}: builds an invalid provider request error locally. Use invalidRequest from transport-core.ts.`;
}

/** The shared textResponse builder owns content-type plus optional cache headers. */
export function textResponseCopyOutsideHome(path: string, source: string): string | null {
  const p = norm(path);
  if (!/^src\/ui\/server[^/]*\.ts$/.test(p)) return null;
  if (p === "src/ui/server-security.ts") return null;
  const clean = stripComments(source);
  if (!/new\s+Response\s*\(\s*body\s*,\s*\{\s*headers\s*:\s*\{\s*["']content-type["']\s*:\s*type/.test(clean)) return null;
  return `${p}: builds a text response locally. Use textResponse from src/ui/server-security.ts.`;
}

/** Provider-test fetch/stream helpers live together so two adapter suites cannot drift. */
export function providerFetchHarnessCopyOutsideHome(path: string, source: string): string | null {
  const p = norm(path);
  if (p === "src/stage/provider/test-fetch-harness.ts") return null;
  const hit = ["fakeFetch", "controlledStream", "rejection"].find((name) =>
    declaresShared(p, source, name));
  return hit ? `${p}: declares provider-test helper ${hit}. Import it from test-fetch-harness.ts.` : null;
}

/** The shared request rig owns default loopback API request construction for server tests. */
export function serverTestRequestBuilderOutsideHome(path: string, source: string): string | null {
  const p = norm(path);
  if (p === "src/ui/server-test-rig.ts" || !/^src\/ui\/server.*\.test\.tsx?$/.test(p)) return null;
  const clean = stripComments(source);
  const declaration = clean.match(/\b(?:function|const|let)\s+(?:apiReq|call|post)\b[\s\S]{0,280}?;/);
  if (!declaration || !/new\s+Request\s*\(/.test(declaration[0])) return null;
  return `${p}: builds a server test request locally. Use apiReq from server-test-rig.ts, keeping only intentionally malformed raw requests inline.`;
}

/** The graveyard conversion must add row metadata inside the shared quarantine split. */
export function chatGraveyardQuarantineCopyOutsideHome(path: string, source: string): string | null {
  const p = norm(path);
  if (p === "src/stage/store/sqlite/chat-store-quarantine.ts") return null;
  const clean = stripComments(source);
  if (!/safeToChat\s*\(/.test(clean) || !/quarantined\.push\(/.test(clean)) return null;
  return `${p}: converts and quarantines chat rows inline. Reuse splitQuarantine from chat-store-quarantine.ts.`;
}

/** Both desktop entries use shared window-worker wiring but keep their own spawn and failure policy. */
export function desktopWindowWiringOutsideHome(path: string, source: string): string | null {
  const p = norm(path);
  if (p === "src/desktop-window-launch.ts") return null;
  const clean = stripComments(source);
  if (!/\.addEventListener\(\s*["']error["']/.test(clean) || !/\.postMessage\(\{\s*url\s*,\s*title\s*\}/.test(clean)) return null;
  return `${p}: wires a desktop window worker directly. Use startDesktopWindow (src/desktop-window-launch.ts).`;
}

/**
 * readJsonCapped is server-security.ts's own low-level, uncapped-shape body reader. Every route
 * must go through readJsonObject instead (fold B14): the one content-type-plus-object-shape gate,
 * so a route cannot skip the check by hand-rolling its own call.
 */
export function readJsonCappedOutsideHome(path: string, source: string): string | null {
  const p = norm(path);
  if (p === "src/ui/server-security.ts") return null;
  if (!callsNamed(p, source, "readJsonCapped") && !declaresShared(p, source, "readJsonCapped")) return null;
  return `${p}: calls readJsonCapped( directly. Use readJsonObject (server-security.ts) instead, so the content-type and object-shape checks are never re-derived by hand.`;
}

/** UI tests install one shared DOM; the virtual-list test alone owns an intentional secondary DOM. */
export function newJSDOMOutsideHome(path: string, source: string): string | null {
  const p = norm(path);
  if (!/^src\/ui\//.test(p) || !/\.test\.tsx?$/.test(p)) return null;
  if (p === "src/ui/_shared/test-dom.ts" || p === "src/ui/_shared/test-dom.test.ts" || p === "src/ui/_shared/virtual-list/core.test.tsx") return null;
  if (!/\bnew\s+JSDOM\s*\(/.test(stripComments(source))) return null;
  return `${p}: constructs JSDOM directly. Install the shared test DOM from src/ui/_shared/test-dom.ts (the virtual-list test owns the one intentional secondary DOM).`;
}

/**
 * Escape is decided by the shared arbiter. A document or window keydown listener that tests Escape, or a
 * hand-written `key === "Escape"` test anywhere in the UI, bypasses it (a dialog on top, an IME composition
 * or a press an inner control already spent would all still count). Local JSX handlers use isEscapeClose.
 */
export function escapeListenerOutsideHome(path: string, source: string): string | null {
  const p = norm(path);
  if (!/^src\/ui\//.test(p) || /\.test\.tsx?$/.test(p)) return null;
  if (p === "src/ui/_shared/use-escape-key.ts") return null;
  const clean = stripComments(source);
  const listens = /\b(?:document|window)\s*\.\s*addEventListener\s*\(\s*["']keydown["']/.test(clean);
  if (listens && /(?:\bkey\s*[!=]==?\s*["']Escape["']|isEscapeClose\s*\()/.test(clean)) {
    return `${p}: owns a document-level Escape listener. Use useEscapeKey from src/ui/_shared/use-escape-key.ts; scoped element key handlers may use isEscapeClose.`;
  }
  if (/\bkey\s*[!=]==?\s*["']Escape["']|\bcase\s+["']Escape["']\s*:/.test(clean)) {
    return `${p}: tests the Escape key by hand. Use isEscapeClose(event) (event.nativeEvent in JSX) or useEscapeKey from src/ui/_shared/use-escape-key.ts.`;
  }
  return null;
}

/** The shared focus trap owns the selector list, so behavior and selector cannot drift separately. */
export function focusableSelectorOutsideHome(path: string, source: string): string | null {
  const p = norm(path);
  if (!/^src\/ui\//.test(p)) return null;
  if (/\.test\.tsx?$/.test(p)) return null;
  if (p === "src/ui/_shared/focus-trap.ts") return null;
  const clean = stripComments(source);
  const named = /\b(?:const|let|var)\s+FOCUSABLE\b/.test(clean);
  const selectorList = clean.match(/\b(?:const|let|var)\s+([\w$]+)\s*=\s*\[[\s\S]*?;/);
  const selectorAlgorithm = Boolean(selectorList)
    && new RegExp(`\\b(?:querySelectorAll|querySelector)\\s*(?:<[^>]+>)?\\s*\\(\\s*${selectorList?.[1]}\\s*\\)`).test(clean)
    && /button/i.test(selectorList![0]) && /input/i.test(selectorList![0])
    && /textarea|select/i.test(selectorList![0]) && /tabindex/i.test(selectorList![0]);
  if (!named && !selectorAlgorithm) return null;
  return `${p}: declares a local focusable selector/trap algorithm. Import focusablesIn/useFocusTrap from src/ui/_shared/focus-trap.ts.`;
}

/**
 * Only server-security.ts's openInBrowser may be named that (fold B31): a second declaration is how
 * a weaker copy (no windowsHide, no try/catch around the spawn) shipped beside the hardened one.
 */
export function openInBrowserOutsideHome(path: string, source: string): string | null {
  const p = norm(path);
  if (p === "src/ui/server-security.ts") return null;
  if (!declaresShared(p, source, "openInBrowser")) return null;
  return `${p}: declares its own openInBrowser. Import the hardened one from src/ui/server-security.ts instead.`;
}

/**
 * Only limits.ts may call isLuaResourceLimitError directly (fold B34): every run path classifies a
 * caught Lua error through classifyLuaError instead, so the resource-vs-generic decision, and each
 * site's fallback category, cannot drift back into 7 hand-rolled copies.
 */
export function isLuaResourceLimitErrorOutsideHome(path: string, source: string): string | null {
  const p = norm(path);
  if (p === "src/sandbox/lua/limits.ts") return null;
  if (!callsNamed(p, source, "isLuaResourceLimitError") && !declaresShared(p, source, "isLuaResourceLimitError")) return null;
  return `${p}: calls isLuaResourceLimitError( directly. Use classifyLuaError (src/sandbox/lua/limits.ts) instead.`;
}

/**
 * Only worker-lane.ts may call compiledBuild() (fold: the worker launch branch); a second caller is
 * exactly how the compiled-vs-dev branch gets hand-copied again instead of going through
 * startLaneWorker. compiledBuild() itself stays exported for worker-lane.ts's own internal use.
 */
export function compiledBuildOutsideHome(path: string, source: string): string | null {
  const p = norm(path);
  if (p === "src/stage/worker-lane.ts") return null;
  if (!callsNamed(p, source, "compiledBuild") && !declaresShared(p, source, "compiledBuild")) return null;
  return `${p}: calls compiledBuild( directly. Use startLaneWorker (src/stage/worker-lane.ts) instead.`;
}

/** Only transport-core.ts may declare classifyHttpFailure or createLineSplitter (fold: these moved
 *  out of openai-compatible-reply.ts so the Anthropic spoke stopped reaching into a vendor-specific
 *  file for vendor-neutral transport rules). */
export function transportHelperOutsideHome(path: string, source: string): string | null {
  const p = norm(path);
  if (p === "src/stage/provider/transport-core.ts") return null;
  const hit = ["classifyHttpFailure", "createLineSplitter"].find((name) => declaresShared(p, source, name));
  if (!hit) return null;
  return `${p}: declares its own ${hit}. Import it from src/stage/provider/transport-core.ts instead.`;
}

/** Only sqlite/test-support.ts may declare testCipher (fold: the 9-copy SQLite test harness). */
export function testCipherOutsideHome(path: string, source: string): string | null {
  const p = norm(path);
  if (p === "src/stage/store/sqlite/test-support.ts") return null;
  if (!declaresShared(p, source, "testCipher")) return null;
  return `${p}: declares its own testCipher. Import it from src/stage/store/sqlite/test-support.ts instead.`;
}

/** Only core/guards.ts may inline the generic plain-object predicate; match behavior, not names. */
export function isRecordOutsideHome(path: string, source: string): string | null {
  const p = norm(path);
  if (p === "src/core/guards.ts") return null;
  const clean = stripComments(source);
  // Exact-key validation includes an object check, but is not a standalone reusable record guard.
  const exactKeyPredicate = /(?:const|let)\s+\w+\s*=\s*\(\s*(\w+)\s*,\s*\w+\s*\)\s*=>\s*\1\s*&&\s*typeof\s+\1\s*===?\s*["']object["']\s*&&\s*!\s*Array\.isArray\(\s*\1\s*\)\s*&&\s*Object\.keys\(\s*\1\s*\)\.sort\(\)\.join\(/;
  const candidate = clean.replace(exactKeyPredicate, "");
  const plainObjectCheck = /\btypeof\s+(\w+)\s*===?\s*["']object["']\s*&&\s*\1\s*!==?\s*null\s*&&\s*!\s*Array\.isArray\(\s*\1\s*\)/;
  const nullFirstPlainObjectCheck = /\b(\w+)\s*!==?\s*null\s*&&\s*typeof\s+\1\s*===?\s*["']object["']\s*&&\s*!\s*Array\.isArray\(\s*\1\s*\)/;
  // `v && typeof v === "object" && !Array.isArray(v)`: the truthiness-first spelling the forms above missed.
  const truthyPlainObjectCheck = /\b(\w+)\s*&&\s*typeof\s+\1\s*===?\s*["']object["']\s*&&\s*!\s*Array\.isArray\(\s*\1\s*\)/;
  const invertedObjectCheck = /(?:!\s*(\w+)\s*\|\|\s*typeof\s+\1\s*!==?\s*["']object["']\s*\|\|\s*Array\.isArray\(\s*\1\s*\)|typeof\s+(\w+)\s*!==?\s*["']object["']\s*\|\|\s*\2\s*===?\s*null\s*\|\|\s*Array\.isArray\(\s*\2\s*\)|\b(\w+)\s*===?\s*null\s*\|\|\s*typeof\s+\3\s*!==?\s*["']object["']\s*\|\|\s*Array\.isArray\(\s*\3\s*\))/;
  if (!plainObjectCheck.test(candidate) && !nullFirstPlainObjectCheck.test(candidate) && !truthyPlainObjectCheck.test(candidate)
    && !invertedObjectCheck.test(candidate)) return null;
  return `${p}: declares its own isRecord. Import it from src/core/guards.ts instead.`;
}
