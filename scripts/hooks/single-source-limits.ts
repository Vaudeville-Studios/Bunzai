/**
 * Single-source guards for media limits, digests, uploaded-media references and the media type table. Same
 * contract as single-source-core.ts: pure (path, source) -> message | null, comments stripped, home exempt. The
 * live-repo scan sits in single-source-core.test.ts so one command covers every single-source rule.
 */
import { norm, stripComments } from "./lib";

const isTest = (p: string): boolean => /\.test\.tsx?$/.test(p);
const inSrc = (p: string): boolean => p.startsWith("src/") && !isTest(p);
const generatedOperationMetadata = (path: string, source: string): boolean =>
  norm(path) === "src/generated/extension-operation-metadata.ts" && source.startsWith("/** Generated host-safe operation metadata. */");

/** A SHA-256 digest is checked by isSha256Hex, not by a pattern of 64 hex characters written out again. */
export function sha256PatternOutsideHome(path: string, source: string): string | null {
  const p = norm(path);
  if (!inSrc(p) || p === "src/core/sha256.ts" || generatedOperationMetadata(p, source)) return null;
  if (!/\[(?:a-f0-9|0-9a-f|A-Fa-f0-9|0-9A-Fa-f)\]\{64\}/.test(stripComments(source))) return null;
  return `${p}: spells out a 64-hex-character pattern. Use isSha256Hex from src/core/sha256.ts (and assetRouteSha for an /api/asset/ path).`;
}

/** An uploaded-media reference (NUL, then b:u:<media type>:<sha>) is read by parseUploadedRef; WRITING one stays free. */
export function uploadedRefPatternOutsideHome(path: string, source: string): string | null {
  const p = norm(path);
  if (!inSrc(p) || p === "src/entities/piece-parts-blob.ts") return null;
  const clean = stripComments(source);
  // A regex literal or a RegExp string that carries the marker; a template literal that formats one is a writer.
  const literal = /\/\^?[^/\n]*(?:\\u0000|\\x00|\\0)b:u:[^/\n]*\//;
  const built = /new RegExp\([^)\n]*b:u:/;
  const asRegexParts = /fromCharCode\(\s*0\s*\)[^\n]*b:u:[^\n]*\[\^:\]/;
  if (!literal.test(clean) && !built.test(clean) && !asRegexParts.test(clean)) return null;
  return `${p}: parses an uploaded-media reference with its own pattern. Use parseUploadedRef from src/entities/piece-parts-blob.ts.`;
}

/**
 * Size limits are named once in core/media/limits.ts (and image-limit.ts for pictures). A 10, 32 or 128 MiB literal
 * written as bytes anywhere else is a copy that will drift. The few below are other things that happen to be that big.
 */
const BYTE_LITERAL_ALLOWED: Readonly<Record<string, string>> = {
  "src/core/media/limits.ts": "the home",
  "src/core/media/image-limit.ts": "the home of the picture limit",
  "src/core/preset/render/runner.ts": "the output a renderer child process may print, not media",
  "src/kit/keystore/backends/passphrase.ts": "scrypt working memory, not a payload",
  "src/studio/signature-color.ts": "the compressed picture data one color probe will inflate, a decoder bound",
  "src/ui/_shared/download-sink.ts": "how much of a download streams to a Blob before it is flushed, not a limit",
  "src/formats/janitor/index.ts": "Janitor's external avatar-upload policy, independent of this app's media buffering limits",
  "src/ui/apps/scenes/props/dramaturg/dramaturg-live.ts": "aggregate retained plaintext conversation-cache budget, independent of media payload limits",
  "src/sandbox/javascript/limits.ts": "QuickJS WASM linear-memory ceiling, distinct from payload and media bounds",
};

export function byteLimitLiteralOutsideHome(path: string, source: string): string | null {
  const p = norm(path);
  if (!inSrc(p) || BYTE_LITERAL_ALLOWED[p] !== undefined || generatedOperationMetadata(p, source)) return null;
  const clean = stripComments(source);
  if (!/\b(?:10|32|128)\s*\*\s*1024\s*\*\s*1024\b|\b(?:10_?485_?760|33_?554_?432|134_?217_?728)\b/.test(clean)) return null;
  return `${p}: writes a 10, 32 or 128 MiB byte limit as a number. Import IMAGE_MAX_BYTES, ASSET_MAX_BYTES, ASSET_BATCH_BYTES or JSON_BODY_MAX_BYTES (core/media), or add this file to BYTE_LITERAL_ALLOWED in scripts/hooks/single-source-limits.ts with its reason.`;
}

/** The picture limit has one name. A second const for the same number is how 6 MB and 8 MB once disagreed with 10. */
export function imageLimitAliasOutsideHome(path: string, source: string): string | null {
  const p = norm(path);
  if (!inSrc(p) || p === "src/core/media/image-limit.ts") return null;
  if (!/\b(?:const|let)\s+(?:MAX_IMAGE_BYTES|IMAGE_BYTES_MAX|MAX_SHOWN_BYTES|MAX_PICTURE_BYTES|PACK_PICTURE_MAX_BYTES|MAX_PORTRAIT_BYTES)\b/.test(stripComments(source))) return null;
  return `${p}: declares its own picture size limit. Use IMAGE_MAX_BYTES from src/core/media/image-limit.ts.`;
}

/** Subsets that are a format's or a package's own list, not another copy of the media table. */
const MIME_TABLE_ALLOWED: Readonly<Record<string, string>> = {
  "src/core/media/mime.ts": "the home",
  "src/formats/_shared/assets.ts": "the asset types the character card spec lists, a narrower set than the library stores",
  "src/extensions/theme-contract.ts": "the three picture types a theme package admits",
};

/** The extension <-> media type table is core/media/mime.ts's (MIME_BY_EXT, mimeFromExt, extFromMime). */
export function mimeTableOutsideHome(path: string, source: string): string | null {
  const p = norm(path);
  if (!inSrc(p) || MIME_TABLE_ALLOWED[p] !== undefined) return null;
  const clean = stripComments(source);
  const extToMime = /\b(?:png|jpe?g|gif|webp)\s*:\s*["']image\/(?:png|jpeg|gif|webp)["']/;
  const mimeToExt = /["']image\/(?:png|jpeg|gif|webp)["']\s*:\s*["'](?:png|jpe?g|gif|webp)["']/;
  if (!extToMime.test(clean) && !mimeToExt.test(clean)) return null;
  return `${p}: declares an extension/media type table. Use MIME_BY_EXT, mimeFromExt and extFromMime from src/core/media/mime.ts.`;
}

/** The in-scene search numbers (word length, word count, hit count) are declared once, in core/search/contracts.ts. */
export function sceneSearchLimitsOutsideHome(path: string, source: string): string | null {
  const p = norm(path);
  if (!inSrc(p) || p === "src/core/search/contracts.ts") return null;
  if (!/\b(?:const|let|var)\s+(?:MIN_WORD|MAX_WORDS?|MAX_SEARCH_(?:WORDS|HITS)|SCENE_SEARCH_LIMIT)\b/.test(stripComments(source))) return null;
  return `${p}: declares a scene-search limit. Import it from src/core/search/contracts.ts.`;
}

/** The rough "~tokens" estimate (chars over four) is roughTokenCount. Macro handlers and budget-parity keep RoleCall's own rounding. */
export function charsOverFourOutsideHome(path: string, source: string): string | null {
  const p = norm(path);
  if (!inSrc(p) || p === "src/core/tokens/estimate.ts" || p.startsWith("src/core/macros/") || p === "src/core/assembly/budget-parity.ts") return null;
  if (!/Math\.(?:ceil|round)\(\s*[\w.]+\.length\s*\/\s*4\s*\)|Math\.round\(\s*\w+\([^)]*\)\s*\/\s*4\s*\)/.test(stripComments(source))) return null;
  return `${p}: estimates tokens as characters over four by hand. Use roughTokenCount from src/core/tokens/estimate.ts.`;
}
