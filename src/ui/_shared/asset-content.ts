/** One bounded validator shared by staged uploads and the hash-addressed asset response. */
import { IMAGE_MAX_BYTES } from "../../core/media/image-limit";
import { ASSET_BATCH_COUNT, ASSET_MAX_BYTES, PROMPT_TEXT_ATTACHMENT_MAX_BYTES } from "../../core/media/limits";
import { isInertPromptText, MIME_BY_EXT, promptTextFromBytes } from "../../core/media/mime";
import { isInertSvg } from "./svg-safety";
import { isPngBytes, startsWith } from "../../core/bytes";

export const ASSET_UPLOAD_TTL = 10 * 60 * 1000;
/** Grants over pictures the library already holds (a pack copied whole): counted and weighed apart from uploads. */
export const ASSET_ADOPT_COUNT = 512;
export const ASSET_ADOPT_BYTES = 512 * 1024 * 1024;

/** Opaque per-session grants are bounded independently of their authored media sentinels. */
export function validAssetGrantRefs(value: unknown): value is string[] {
  return Array.isArray(value) && value.length <= ASSET_BATCH_COUNT + ASSET_ADOPT_COUNT &&
    value.every((ref) => typeof ref === "string" && /^[A-Za-z0-9_-]{32,48}$/.test(ref)) && new Set(value).size === value.length;
}

/** The most one upload of this extension may weigh: a picture has the one image limit, video and audio the media cap. */
export const assetCapFor = (ext: string): number => (["txt", "md", "csv", "json"].includes(ext) ? PROMPT_TEXT_ATTACHMENT_MAX_BYTES : MIME_BY_EXT[ext]?.startsWith("image/") ? IMAGE_MAX_BYTES : ASSET_MAX_BYTES);

const ascii = (bytes: Uint8Array, start: number, end: number): string => new TextDecoder().decode(bytes.subarray(start, end));

function ftypBrands(bytes: Uint8Array): Set<string> | null {
  const size = bytes[0]! * 0x1000000 + bytes[1]! * 0x10000 + bytes[2]! * 0x100 + bytes[3]!;
  if (ascii(bytes, 4, 8) !== "ftyp" || size < 16 || size > bytes.length || size % 4 !== 0) return null;
  const brands = new Set<string>([ascii(bytes, 8, 12)]);
  for (let at = 16; at + 4 <= size; at += 4) brands.add(ascii(bytes, at, at + 4));
  return brands;
}

function ebmlDocType(bytes: Uint8Array): string | undefined {
  const vint = (at: number, id: boolean): { value: number; width: number } | undefined => {
    const first = bytes[at];
    if (first === undefined || first === 0) return undefined;
    let marker = 0x80, width = 1;
    while ((first & marker) === 0 && width <= 8) { marker >>= 1; width++; }
    if (width > (id ? 4 : 8) || at + width > bytes.length) return undefined;
    let value = id ? first : first & (marker - 1);
    for (let i = 1; i < width; i++) value = value * 256 + bytes[at + i]!;
    return { value, width };
  };
  const header = vint(0, true), size = header && vint(header.width, false);
  if (header?.value !== 0x1a45dfa3 || !size) return undefined;
  const limit = Math.min(bytes.length, header.width + size.width + size.value);
  let at = header.width + size.width;
  while (at < limit) {
    const id = vint(at, true), child = id && vint(at + id.width, false);
    if (!id || !child || at + id.width + child.width + child.value > limit) return undefined;
    const payload = at + id.width + child.width;
    if (id.value === 0x4282) return ascii(bytes, payload, payload + child.value);
    at = payload + child.width + child.value;
  }
  return undefined;
}

function promptText(bytes: Uint8Array, text: string): boolean {
  return isInertPromptText(bytes, text);
}

/** Validates a known extension against its bytes; callers never use a client-supplied MIME as truth. */
export function mimeFromBytes(bytes: Uint8Array, ext: string, text: string): string | undefined {
  let valid = false;
  switch (ext) {
    case "png": valid = isPngBytes(bytes); break;
    case "jpg": case "jpeg": valid = startsWith(bytes, [255, 216, 255]); break;
    case "gif": valid = /^GIF8[79]a$/.test(ascii(bytes, 0, 6)); break;
    case "webp": valid = ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 12) === "WEBP"; break;
    case "avif": valid = ascii(bytes, 4, 8) === "ftyp" && /^(avif|avis)$/.test(ascii(bytes, 8, 12)); break;
    case "bmp": valid = ascii(bytes, 0, 2) === "BM"; break;
    case "svg": valid = bytes.length <= 4 * 1024 * 1024 && isInertSvg(text); break;
    case "mp3": valid = ascii(bytes, 0, 3) === "ID3" || (bytes.length > 1 && bytes[0] === 255 && (bytes[1]! & 224) === 224); break;
    case "wav": valid = ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 12) === "WAVE"; break;
    case "ogg": valid = ascii(bytes, 0, 4) === "OggS"; break;
    case "m4a": valid = [...(ftypBrands(bytes) ?? [])].some((brand) => ["M4A ", "M4B ", "M4P "].includes(brand)); break;
    case "aac": valid = bytes.length > 2 && bytes[0] === 255 && (bytes[1]! & 246) === 240; break;
    case "flac": valid = ascii(bytes, 0, 4) === "fLaC"; break;
    case "mp4": {
      const brands = [...(ftypBrands(bytes) ?? [])];
      valid = brands.some((brand) => ["mp41", "mp42", "avc1", "dash", "M4V "].includes(brand)) && !brands.some((brand) => ["M4A ", "M4B ", "M4P "].includes(brand));
      break;
    }
    case "mov": valid = ftypBrands(bytes)?.has("qt  ") ?? false; break;
    case "webm": case "mkv": valid = startsWith(bytes, [26, 69, 223, 163]) && ebmlDocType(bytes) === (ext === "webm" ? "webm" : "matroska"); break;
    case "ttf": valid = startsWith(bytes, [0, 1, 0, 0]); break;
    case "otf": valid = ascii(bytes, 0, 4) === "OTTO"; break;
    case "woff": valid = ascii(bytes, 0, 4) === "wOFF"; break;
    case "woff2": valid = ascii(bytes, 0, 4) === "wOF2"; break;
    case "css": valid = text.length > 0 && !text.includes("\u0000"); break;
    case "pdf": valid = ascii(bytes, 0, 5) === "%PDF-"; break;
    case "txt": case "md": case "csv": case "json": valid = promptText(bytes, text); break;
  }
  return valid ? MIME_BY_EXT[ext] : undefined;
}

/** Infers only the supported binary formats. Text formats stay data and are never served as active content. */
export function sniffAssetMime(bytes: Uint8Array): string | undefined {
  let text = "";
  if (bytes.length <= 4 * 1024 * 1024) {
    try { text = new TextDecoder("utf-8", { fatal: true }).decode(bytes); } catch { /* binary formats do not require UTF-8 */ }
  }
  const binary = ["png", "jpg", "gif", "webp", "avif", "bmp", "svg", "mp3", "wav", "ogg", "m4a", "aac", "flac", "mp4", "webm", "mov", "mkv", "ttf", "otf", "woff", "woff2", "pdf"];
  for (const ext of binary) {
    try {
      const mime = mimeFromBytes(bytes, ext, text);
      if (mime) return mime;
    } catch { /* invalid UTF-8 is not a supported textual asset */ }
  }
  if (bytes.length > 0 && bytes.length <= PROMPT_TEXT_ATTACHMENT_MAX_BYTES) {
    try {
      const decoded = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      for (const ext of ["txt", "md", "csv", "json"]) {
        try {
          const mime = mimeFromBytes(bytes, ext, decoded);
          if (mime) return mime;
        } catch { /* invalid UTF-8 is not a supported textual asset */ }
      }
    } catch { /* text files must be valid UTF-8 */ }
  }
  return undefined;
}

/** Response for already hash-verified bytes, shared by installed and temporary browser stores. */
export function assetBytesResponse(bytes: Uint8Array, sha: string, head = false, size = "full", range?: { start: number; end: number }): Response | null {
  const mime = sniffAssetMime(bytes);
  if (!mime) return null;
  const headers: Record<string, string> = {
    "content-type": mime, "content-length": String(bytes.byteLength), "cache-control": "no-store",
    "content-disposition": mime === "application/pdf" || (["text/plain", "text/markdown", "text/csv", "application/json"] as string[]).includes(mime) ? "attachment; filename=asset" : "inline; filename=asset", "x-asset-sha256": sha,
    "x-asset-size": size, "x-content-type-options": "nosniff",
  };
  if (mime === "image/svg+xml") headers["content-security-policy"] = "default-src 'none'; sandbox";
  if (size === "full") headers["accept-ranges"] = "bytes";
  if (range && !head) {
    const part = bytes.subarray(range.start, range.end + 1);
    return new Response(part as unknown as BodyInit, { status: 206, headers: { ...headers, "content-length": String(part.byteLength), "content-range": `bytes ${String(range.start)}-${String(range.end)}/${String(bytes.byteLength)}` } });
  }
  return new Response(head ? null : bytes as unknown as BodyInit, { headers });
}
