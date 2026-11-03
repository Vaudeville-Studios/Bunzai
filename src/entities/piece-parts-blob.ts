/**
 * Blob sentinel encoding for piece-parts.ts. A string of 16
 * KB or more becomes a blob only when it is a canonical media reference or escrow: (a) a
 * `data:<mime>;base64,<payload>` URI in a media slot, (b) bare canonical base64 in a media slot, or
 * (c) inside an escrow payload, any string at all (the escrow scope passed as
 * `allowTextFallback`). A payload whose base64 does not round-trip byte-for-byte (line breaks, odd
 * padding) falls back to the text form: correct, just not shared. Every inline string that already
 * starts with the sentinel prefix is escaped by doubling the prefix, at any length, so authored text
 * can never impersonate a reference. Pure and synchronous, with no knowledge of storage: a
 * decompose/assemble round trip always carries the extracted bytes itself, in `PartRecord.blobs`
 * (`decodeBlobs`'s `blobsByKey` lookup). Since S4b the storage
 * layer seals those bytes into a global `blobs` table and reconstitutes `blobsByKey` on read
 * (`stage/store/sqlite/piece-parts-sql.ts`'s `toPartTexts`; the memory backend's `withBlobs`) instead
 * of a decompose/assemble pair carrying them end to end in one process, but this module itself never
 * The canonical-media classifier is shared with light reads so new writes keep authored text inline
 * and light reads can selectively resolve legacy text blobs without opening media payloads.
 */
import { base64ToBytes, bytesToBase64 } from "../core/base64";
import { hashHex, isSha256Hex } from "../core/sha256";
import { isCanonicalMediaReference } from "./_shared/media-reference";

/** A string of this length (JS UTF-16 code units) or more is a blob candidate. */
export const BLOB_THRESHOLD = 16 * 1024;

/** NUL is never authored in canonical JSON text; every sentinel and every escape starts with it, so
 * a part's JSON that lacks the escaped form `\u0000` cannot contain either and needs no walk. */
export const SENTINEL_PREFIX = "\u0000b:";
const ESCAPED_MARKER_IN_JSON = "\\u0000";

/**
 * What a blob actually holds, keyed only by content. There is no "u" (data URI) payload variant:
 * a data URI and a bare-base64 string of the SAME decoded bytes must dedupe to one blob record, and
 * the sentinel that referenced it (encoded separately per occurrence, mime included for "u") is what
 * knows how to re-stringify it - never the payload. Two shapes only: decoded bytes (serves sentinel
 * kinds "u" and "b" alike) or literal text (serves sentinel kind "t").
 */
export type BlobPayload = { kind: "bytes"; bytes: Uint8Array } | { kind: "text"; text: string };

export interface PartBlob {
  key: string; // sha256 hex of the decoded bytes (u, b) or the UTF-8 text (t)
  payload: BlobPayload;
}

/** A part's JSON text as written by `JSON.stringify` never contains a literal NUL byte; a NUL-bearing
 * string is always escaped as the six characters `\u0000`. Cheap gate before the recursive walk. */
export function mayNeedBlobWalk(json: string): boolean {
  return json.includes(ESCAPED_MARKER_IN_JSON);
}

function escapeLiteral(s: string): string {
  return s.startsWith(SENTINEL_PREFIX) ? SENTINEL_PREFIX + s : s;
}

function unescapeLiteral(s: string): string {
  const doubled = SENTINEL_PREFIX + SENTINEL_PREFIX;
  return s.startsWith(doubled) ? s.slice(SENTINEL_PREFIX.length) : s;
}

/** Canonical body projection; the explicit editor wire keeps this escape until its adapter boundary. */
export function normalizeAuthoredSentinelLiterals(value: unknown): unknown {
  if (typeof value === "string") return unescapeLiteral(value);
  if (Array.isArray(value)) return value.map(normalizeAuthoredSentinelLiterals);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, child]) => [key, normalizeAuthoredSentinelLiterals(child)]));
  }
  return value;
}

const DATA_URI_PREFIX_RE = /^data:([^;,]*);base64,/;

function matchDataUri(s: string): { mime: string; payload: string } | undefined {
  const m = DATA_URI_PREFIX_RE.exec(s);
  if (!m) return undefined;
  return { mime: m[1] ?? "", payload: s.slice(m[0].length) };
}

/** Decodes only if the string is valid base64 AND canonical: re-encoding the decoded bytes
 * reproduces the exact same string. A shape like "QR==" passes a bare regex but is not canonical
 * (the low bits of "R" are discarded on decode), so the round trip is the only trustworthy check. */
function canonicalBase64Bytes(s: string): Uint8Array | undefined {
  let bytes: Uint8Array;
  try {
    bytes = base64ToBytes(s);
  } catch {
    return undefined;
  }
  return bytesToBase64(bytes) === s ? bytes : undefined;
}

/** Canonical embedded bytes, when the exact data-URI media slot contains valid base64. */
export function embeddedMediaBytes(value: string): { mime: string; bytes: Uint8Array } | undefined {
  const uri = matchDataUri(value);
  if (!uri) return undefined;
  const bytes = canonicalBase64Bytes(uri.payload);
  return bytes ? { mime: uri.mime, bytes } : undefined;
}

/**
 * What a patch may already point at without carrying the bytes: payload-carrying blobs (this session's
 * uploads, text blobs a part needs) and plain content hashes of blobs the piece already holds. A media
 * slot naming one of these stays the exact sentinel it is, so a rename or a reorder never expands a
 * picture into base64, re-hashes it, or reseals it.
 */
export interface KnownBlobs {
  blobs: ReadonlyMap<string, PartBlob>;
  held: ReadonlySet<string>;
}

function encodeStringValue(s: string, allowTextFallback: boolean, media: boolean, collected: Map<string, PartBlob>, known?: KnownBlobs, refs?: Set<string>): string {
  if (media && known) {
    const sentinel = parseSentinel(s);
    if (sentinel && (sentinel.kind === "u" || sentinel.kind === "b")) {
      const blob = known.blobs.get(sentinel.sha);
      if (blob) { collected.set(sentinel.sha, blob); return s; }
      if (known.held.has(sentinel.sha)) { refs?.add(sentinel.sha); return s; }
    }
  }
  if (s.length < BLOB_THRESHOLD) return escapeLiteral(s);

  const dataUri = matchDataUri(s);
  if (dataUri && (allowTextFallback || media)) {
    const bytes = canonicalBase64Bytes(dataUri.payload);
    if (bytes) {
      const key = hashHex(bytes);
      collected.set(key, { key, payload: { kind: "bytes", bytes } });
      return `${SENTINEL_PREFIX}u:${dataUri.mime}:${key}`;
    }
  } else if (!dataUri && (allowTextFallback || media)) {
    const bytes = canonicalBase64Bytes(s);
    if (bytes) {
      const key = hashHex(bytes);
      collected.set(key, { key, payload: { kind: "bytes", bytes } });
      return `${SENTINEL_PREFIX}b:${key}`;
    }
  }

  // Rule (c): inside escrow only, any remaining large string becomes a text blob. Lone surrogates
  // cannot round-trip through a UTF-8 byte hash, so they stay inline regardless of size (S4b note).
  if (allowTextFallback && s.isWellFormed()) {
    const key = hashHex(s);
    collected.set(key, { key, payload: { kind: "text", text: s } });
    return `${SENTINEL_PREFIX}t:${key}`;
  }
  return escapeLiteral(s);
}

/** Walks any JSON-shaped value, replacing blob-eligible strings with sentinels and collecting their
 * payloads into `collected`. Never mutates `value`; returns a fresh structure. */
export function encodeBlobs(value: unknown, allowTextFallback: boolean, collected: Map<string, PartBlob>, kind = "", path: readonly (string | number)[] = [], known?: KnownBlobs, refs?: Set<string>): unknown {
  if (typeof value === "string") return encodeStringValue(value, allowTextFallback, !kind || isCanonicalMediaReference(kind, path), collected, known, refs);
  if (Array.isArray(value)) return value.map((v, index) => encodeBlobs(v, allowTextFallback, collected, kind, [...path, index], known, refs));
  if (value !== null && typeof value === "object") {
    // Object.fromEntries, not `out[k] = v`: escrow `raw` is arbitrary third-party JSON, and a key
    // literally named "__proto__" set by bracket assignment writes the prototype instead of an own
    // property, silently dropping it from the clone. fromEntries always creates an own property.
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, encodeBlobs(v, allowTextFallback, collected, kind, [...path, k], known, refs)]),
    );
  }
  return value;
}

type ParsedSentinel = { kind: "u"; mime: string; sha: string } | { kind: "b" | "t"; sha: string };

function parseSentinel(s: string): ParsedSentinel | undefined {
  if (!s.startsWith(SENTINEL_PREFIX)) return undefined;
  const rest = s.slice(SENTINEL_PREFIX.length);
  if (rest.startsWith(SENTINEL_PREFIX)) return undefined; // an escaped literal, not a reference
  const kindChar = rest[0];
  if (rest[1] !== ":") return undefined;
  const body = rest.slice(2);
  if (kindChar === "b" || kindChar === "t") {
    return isSha256Hex(body) ? { kind: kindChar, sha: body } : undefined;
  }
  if (kindChar === "u") {
    // A mime type may itself contain ":", so the sha is read from the end, not the first split.
    const idx = body.lastIndexOf(":");
    if (idx < 0) return undefined;
    const sha = body.slice(idx + 1);
    return isSha256Hex(sha) ? { kind: "u", mime: body.slice(0, idx), sha } : undefined;
  }
  return undefined;
}

/** An uploaded-media reference (`\0b:u:<media type>:<sha>`) read into its parts, or undefined for anything else.
 *  THE ONE reader of that shape: the picture, backdrop and asset UIs call this rather than carry a pattern. */
export function parseUploadedRef(value: string): { mime: string; sha: string } | undefined {
  const parsed = parseSentinel(value);
  return parsed?.kind === "u" ? { mime: parsed.mime, sha: parsed.sha } : undefined;
}

/** Returns only valid byte/media identity; escaped authored text stays opaque. */
export function mediaBlobReference(value: string): { sha: string; mime?: string } | undefined {
  const parsed = parseSentinel(value);
  return parsed?.kind === "u" ? { sha: parsed.sha, mime: parsed.mime } : parsed?.kind === "b" ? { sha: parsed.sha } : undefined;
}

/** True for a well-formed embedded media data URI: a typed, canonical base64 payload with at least one byte. */
export function isEmbeddedMediaDataUri(value: string): boolean {
  const uri = matchDataUri(value);
  return uri !== undefined && /^[a-z0-9][a-z0-9.+-]*\/[a-z0-9][a-z0-9.+-]*$/i.test(uri.mime) && (canonicalBase64Bytes(uri.payload)?.length ?? 0) > 0;
}

/** True only for a syntactically valid byte/media ref, never for authored escaped literals. */
export function isActiveMediaBlobReference(value: string): boolean {
  const parsed = parseSentinel(value);
  return parsed?.kind === "u" || parsed?.kind === "b";
}

/** Reads only true asset sentinels from the light shape, preserving escaped literals exactly. */
export function lightBlobRefs(value: unknown, kind: string, path: readonly (string | number)[] = []): { value: unknown; assets: string[]; textBlobs: string[]; authoredTextBlobs: string[] } {
  const assets = new Set<string>();
  const textBlobs = new Set<string>();
  const authoredTextBlobs = new Set<string>();
  const walk = (item: unknown, path: readonly (string | number)[]): unknown => {
    if (typeof item === "string") {
      const sentinel = parseSentinel(item);
      if (sentinel) {
        const media = isCanonicalMediaReference(kind, path);
        if (sentinel.kind === "u" || sentinel.kind === "b") {
          if (media) assets.add(sentinel.sha);
          else textBlobs.add(sentinel.sha);
        } else textBlobs.add(sentinel.sha);
        if (!media) authoredTextBlobs.add(sentinel.sha);
        return item;
      }
      return item;
    }
    if (Array.isArray(item)) return item.map((child, index) => walk(child, [...path, index]));
    if (item !== null && typeof item === "object") {
      return Object.fromEntries(Object.entries(item as Record<string, unknown>).map(([key, child]) => [key, walk(child, [...path, key])]));
    }
    return item;
  };
  return { value: walk(value, path), assets: [...assets], textBlobs: [...textBlobs], authoredTextBlobs: [...authoredTextBlobs] };
}

/** Every real blob key in one selected value, including text blobs used by escrow. */
export function sentinelBlobRefs(value: unknown): string[] {
  const refs = new Set<string>();
  const walk = (item: unknown): void => {
    if (typeof item === "string") {
      const sentinel = parseSentinel(item);
      if (sentinel) refs.add(sentinel.sha);
    } else if (Array.isArray(item)) item.forEach(walk);
    else if (item !== null && typeof item === "object") Object.values(item as Record<string, unknown>).forEach(walk);
  };
  walk(value);
  return [...refs];
}

/** Opens only text sentinels selected by the canonical media-slot classifier. */
export function decodeLightTextBlobs(value: unknown, kind: string, blobs: ReadonlyMap<string, PartBlob>, path: readonly (string | number)[] = [], omitMedia = false, allowTextBlobs = false): unknown {
  if (omitMedia && isCanonicalMediaReference(kind, path)) return null;
  if (typeof value === "string") {
    const sentinel = parseSentinel(value);
    if (sentinel?.kind === "t" && !allowTextBlobs) throw new UnresolvedBlobError(sentinel.sha);
    if (sentinel?.kind === "t") return decodeStringValue(value, blobs);
    return sentinel && (sentinel.kind === "b" || sentinel.kind === "u") && !isCanonicalMediaReference(kind, path)
      ? decodeStringValue(value, blobs)
      : value;
  }
  if (Array.isArray(value)) return value.map((child, index) => decodeLightTextBlobs(child, kind, blobs, [...path, index], omitMedia, allowTextBlobs));
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, child]) => [key, decodeLightTextBlobs(child, kind, blobs, [...path, key], omitMedia, allowTextBlobs)]));
  }
  return value;
}

/** Resolves editor wire refs only against a caller's explicitly authorized set. */
export function decodeAuthorizedBlobs(value: unknown, blobs: ReadonlyMap<string, PartBlob>): unknown {
  if (typeof value === "string") {
    if (value.startsWith(SENTINEL_PREFIX) && !value.startsWith(SENTINEL_PREFIX + SENTINEL_PREFIX) && !parseSentinel(value)) {
      throw new UnresolvedBlobError("invalid");
    }
    return decodeStringValue(value, blobs);
  }
  if (Array.isArray(value)) return value.map((item) => decodeAuthorizedBlobs(item, blobs));
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, decodeAuthorizedBlobs(item, blobs)]));
  }
  return value;
}

/**
 * `decodeAuthorizedBlobs` for a patch head that may keep pictures by reference: a media slot naming a
 * blob this piece holds (`held`) or one carried alongside (`blobs`) stays the exact sentinel; every
 * other string resolves as before, and a sentinel nothing authorizes still throws, so a patch can
 * never point at an arbitrary row of the global blob table.
 */
export function decodeAuthorizedBlobsHolding(value: unknown, kind: string, blobs: ReadonlyMap<string, PartBlob>, held: ReadonlySet<string>, path: readonly (string | number)[] = []): unknown {
  if (typeof value === "string") {
    const sentinel = parseSentinel(value);
    if (sentinel && (sentinel.kind === "u" || sentinel.kind === "b") && isCanonicalMediaReference(kind, path)) {
      if (blobs.has(sentinel.sha) || held.has(sentinel.sha)) return value;
      throw new UnresolvedBlobError(sentinel.sha);
    }
    return decodeAuthorizedBlobs(value, blobs);
  }
  if (Array.isArray(value)) return value.map((item, index) => decodeAuthorizedBlobsHolding(item, kind, blobs, held, [...path, index]));
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, decodeAuthorizedBlobsHolding(item, kind, blobs, held, [...path, key])]));
  }
  return value;
}

/** A part's sentinel could not be resolved against the blobs handed to `decodeBlobs`: the blob is
 * missing, or the sentinel names a kind this module does not know. A stored payload of the other shape
 * (bytes vs text) is converted, not refused. Thrown, never swallowed into the sentinel's literal text,
 * so a caller cannot mistake a corrupt reference for authored content. A pure-module error: the
 * storage layer (S4a/S4b) decides whether to re-wrap this as its own damaged-data signal. */
export class UnresolvedBlobError extends Error {
  constructor(sha: string) {
    super(`piece-parts: unresolved blob reference "${sha}"`);
    this.name = "UnresolvedBlobError";
  }
}

/** Bytes and text are the same identity when they round-trip (the write side only ever hashes a
 * text payload after `isWellFormed()`, so its UTF-8 bytes decode back to it exactly): one key can be
 * written once as "bytes" by whichever sentinel extracted it first and read back as either shape, so
 * two parts extracting the SAME content under different sentinel letters (an escrow text and
 * another field's base64 of the identical bytes) still share one blob instead of one throwing
 * UnresolvedBlobError because the stored shape does not match its own letter. */
function decodeStringValue(s: string, blobsByKey: ReadonlyMap<string, PartBlob>, admit?: (bytes: number) => void): string {
  const sentinel = parseSentinel(s);
  if (!sentinel) return unescapeLiteral(s);
  const blob = blobsByKey.get(sentinel.sha);
  if (!blob) throw new UnresolvedBlobError(sentinel.sha);
  const payload = blob.payload;
  if (admit) {
    const bytes = payload.kind === "bytes" ? payload.bytes.byteLength : payload.text.length * 3;
    const units = sentinel.kind === "t"
      ? (payload.kind === "text" ? payload.text.length : bytes)
      : Math.ceil(bytes / 3) * 4 + (sentinel.kind === "u" ? sentinel.mime.length + 13 : 0);
    admit(units * 2 + (sentinel.kind === "t" && payload.kind === "text" ? 0 : bytes));
  }
  const bytesOf = (): Uint8Array => (payload.kind === "bytes" ? payload.bytes : new TextEncoder().encode(payload.text));
  const textOf = (): string => (payload.kind === "text" ? payload.text : new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(payload.bytes));
  if (sentinel.kind === "u") return `data:${sentinel.mime};base64,${bytesToBase64(bytesOf())}`;
  if (sentinel.kind === "b") return bytesToBase64(bytesOf());
  if (sentinel.kind === "t") return textOf();
  throw new UnresolvedBlobError(sentinel.sha);
}

/** Inverse of `encodeBlobs`: dereferences sentinels using the blobs available and un-escapes
 * doubled-prefix literals. `blobs` only needs to hold what this one value's own sentinels
 * reference, since every blob is recorded on the same part that extracted it. */
export function decodeBlobs(value: unknown, blobsByKey: ReadonlyMap<string, PartBlob>, admit?: (bytes: number) => void): unknown {
  if (typeof value === "string") return decodeStringValue(value, blobsByKey, admit);
  if (Array.isArray(value)) return value.map((v) => decodeBlobs(v, blobsByKey, admit));
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, decodeBlobs(v, blobsByKey, admit)]),
    );
  }
  return value;
}

/**
 * `decodeBlobs` that leaves every canonical media slot's picture sentinel in place and reports the
 * plain hashes it left (`refs`). The write-side cache holds a piece this way, so opening a pack to
 * rename it never expands its pictures. Text blobs and everything outside a media slot decode as usual.
 */
export function decodeBlobsHolding(value: unknown, kind: string, blobsByKey: ReadonlyMap<string, PartBlob>, refs: Set<string>, admit?: (bytes: number) => void, path: readonly (string | number)[] = []): unknown {
  if (typeof value === "string") {
    const sentinel = parseSentinel(value);
    if (sentinel && (sentinel.kind === "u" || sentinel.kind === "b") && isCanonicalMediaReference(kind, path)) {
      refs.add(sentinel.sha);
      return value;
    }
    return decodeStringValue(value, blobsByKey, admit);
  }
  if (Array.isArray(value)) return value.map((v, index) => decodeBlobsHolding(v, kind, blobsByKey, refs, admit, [...path, index]));
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, decodeBlobsHolding(v, kind, blobsByKey, refs, admit, [...path, k])]),
    );
  }
  return value;
}
