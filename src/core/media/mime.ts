/**
 * The one table of file-extension <-> MIME mappings for media refs (portraits, sprites, archive
 * assets, prompt files and data URIs). Every format and UI reader that needs to guess a MIME type from a ref string
 * reaches for these instead of carrying its own copy of the table (AGENTS.md rule 12).
 */

/**
 * Lowercase extension of a file name or path, without the dot; "" when the last path segment has no
 * dot, ends in one, or starts with its only one. THE ONE EXTENSION RULE, node's `extname`: only the
 * last segment (split on / and \) can carry an extension, so "pack.d/cover" has none, and a hidden
 * name (".png", ".ssh") is a name, not an extension. `"name".split(".").pop()` is NOT equivalent: for
 * a dotless string it returns the whole string, and for "pack.d/cover" it returns "d/cover".
 */
export function extensionOf(name: string): string {
  const base = name.slice(Math.max(name.lastIndexOf("/"), name.lastIndexOf("\\")) + 1);
  const dot = base.lastIndexOf(".");
  return dot <= 0 ? "" : base.slice(dot + 1).toLowerCase();
}

/** extensionOf for a ref (a URL or path): a query string is stripped first so "?v=2" is never the
 *  extension, and `fallback` is returned when the ref has none (the bug behind a Risu asset's own
 *  bare name becoming its own "extension" - and, for a URL, a host's ".com/avatar"). */
export function extOf(ref: string, fallback = ""): string {
  return extensionOf(ref.split("?")[0] ?? ref) || fallback;
}

/** Every file type the library stores or serves as media: pictures, sound, video, fonts and a theme's stylesheet. */
export const MIME_BY_EXT: Readonly<Record<string, string>> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  avif: "image/avif",
  bmp: "image/bmp",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  ogg: "audio/ogg",
  m4a: "audio/mp4",
  aac: "audio/aac",
  flac: "audio/flac",
  mp4: "video/mp4",
  webm: "video/webm",
  mov: "video/quicktime",
  mkv: "video/x-matroska",
  ttf: "font/ttf",
  otf: "font/otf",
  woff: "font/woff",
  woff2: "font/woff2",
  css: "text/css",
  pdf: "application/pdf",
  txt: "text/plain",
  md: "text/markdown",
  csv: "text/csv",
  json: "application/json",
};

/** Preferred extension for each known MIME type; aliases such as JPEG resolve to `jpg`. */
const EXT_BY_MIME: Readonly<Record<string, string>> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/svg+xml": "svg",
  "image/avif": "avif",
  "image/bmp": "bmp",
  "audio/mpeg": "mp3",
  "audio/wav": "wav",
  "audio/ogg": "ogg",
  "audio/mp4": "m4a",
  "audio/aac": "aac",
  "audio/flac": "flac",
  "video/mp4": "mp4",
  "video/webm": "webm",
  "video/quicktime": "mov",
  "video/x-matroska": "mkv",
  "font/ttf": "ttf",
  "font/otf": "otf",
  "font/woff": "woff",
  "font/woff2": "woff2",
  "text/css": "css",
  "application/pdf": "pdf",
  "text/plain": "txt",
  "text/markdown": "md",
  "text/csv": "csv",
  "application/json": "json",
};

/** Exact prompt attachment MIME set; providers do not share an `image/*` capability. */
export const PROMPT_ATTACHMENT_MIMES = ["image/png", "image/jpeg", "image/gif", "image/webp", "application/pdf", "text/plain", "text/markdown", "text/csv", "application/json"] as const;
export type PromptAttachmentMime = typeof PROMPT_ATTACHMENT_MIMES[number];
export type PromptImageMime = Extract<PromptAttachmentMime, `image/${string}`>;
export type PromptTextMime = Extract<PromptAttachmentMime, `text/${string}` | "application/json">;
export const isPromptImageMime = (mime: string): mime is PromptImageMime => PROMPT_ATTACHMENT_MIMES.includes(mime as PromptAttachmentMime) && mime.startsWith("image/");
export const isPromptTextMime = (mime: string): mime is PromptTextMime => PROMPT_ATTACHMENT_MIMES.includes(mime as PromptAttachmentMime) && (mime.startsWith("text/") || mime === "application/json");

/** Fatal, bounded UTF-8 text validation shared by upload sniffing and model-boundary reads. */
export function promptTextFromBytes(bytes: Uint8Array, maxBytes: number): string | undefined {
  if (bytes.byteLength > maxBytes) return undefined;
  let text: string;
  try { text = new TextDecoder("utf-8", { fatal: true }).decode(bytes); } catch { return undefined; }
  if (!isInertPromptText(bytes, text)) return undefined;
  return text;
}

/** Shared control-byte and binary-signature policy for streaming prefix validation and full reads. */
export function isInertPromptText(prefix: Uint8Array, text: string): boolean {
  return !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(text)
    && !(prefix[0] === 0x89 && String.fromCharCode(...prefix.subarray(1, 4)) === "PNG")
    && !(prefix[0] === 0xff && prefix[1] === 0xd8 && prefix[2] === 0xff)
    && !/^GIF8[79]a$/u.test(String.fromCharCode(...prefix.subarray(0, 6)))
    && !(prefix.byteLength >= 4 && String.fromCharCode(...prefix.subarray(0, 4)) === "RIFF")
    && String.fromCharCode(...prefix.subarray(0, 4)) !== "OggS"
    && String.fromCharCode(...prefix.subarray(0, 4)) !== "fLaC"
    && String.fromCharCode(...prefix.subarray(0, 5)) !== "%PDF-";
}

/** Image extensions with a MIME mapping, shared by media classification and import policies. */
export const IMAGE_EXTENSIONS: ReadonlySet<string> = new Set(
  Object.entries(MIME_BY_EXT).filter(([, mime]) => mime.startsWith("image/")).map(([ext]) => ext),
);

/** The MIME type for a bare extension ("png", no dot), or undefined when it is not a known media
 *  type. Case-insensitive; non-string input is never a known extension. */
export const mimeFromExt = (ext: unknown): string | undefined =>
  typeof ext === "string" ? MIME_BY_EXT[ext.toLowerCase()] : undefined;

/** The preferred extension for a known MIME type, or undefined when no safe mapping exists. */
export const extFromMime = (mime: unknown): string | undefined =>
  typeof mime === "string" ? EXT_BY_MIME[mime.toLowerCase()] : undefined;

/** The MIME type stated on a `data:...` URI, or undefined for anything else. */
export function mimeFromDataUri(dataUri: string): string | undefined {
  const m = /^data:([^;,]+)/.exec(dataUri);
  return m?.[1];
}

/** Guess a MIME type from any ref: a data URI's own stated type, else its file extension. Undefined
 *  when neither resolves (an opaque id, an extensionless path, an unrecognized extension). */
export function mimeFromRef(ref: string): string | undefined {
  if (ref.startsWith("data:")) return mimeFromDataUri(ref);
  return mimeFromExt(extOf(ref));
}

/** `mimeFromRef`, falling back to the generic binary type instead of undefined - the right default
 *  when a `mime` value is required (embedding a path's bytes as a `data:` URI, say) and "no idea"
 *  is not an option the caller can act on. */
export function mimeFromPath(path: string): string {
  return mimeFromRef(path) ?? "application/octet-stream";
}

/** Detect the raster formats accepted by value-only extension media imports. */
export function rasterImageMimeFromBytes(bytes: Uint8Array): "image/png" | "image/jpeg" | "image/gif" | "image/webp" | undefined {
  if (bytes.length >= 8 && bytes[0] === 0x89 && String.fromCharCode(...bytes.subarray(1, 4)) === "PNG"
    && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) return "image/png";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 6 && ["GIF87a", "GIF89a"].includes(String.fromCharCode(...bytes.subarray(0, 6)))) return "image/gif";
  if (bytes.length >= 12 && String.fromCharCode(...bytes.subarray(0, 4)) === "RIFF" && String.fromCharCode(...bytes.subarray(8, 12)) === "WEBP") return "image/webp";
  return undefined;
}
