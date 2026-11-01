/** Light reads omit escrow, retain media refs, and selectively open legacy authored-text blobs. */
import { decodePart, assembleLight, encodeNamePart, lightBlobNeeds } from "../../entities/piece-parts";
import { decodeAuthorizedBlobs, sentinelBlobRefs, type PartBlob } from "../../entities/piece-parts-blob";
import { normalizeAuthoredSentinelLiterals, parseUploadedRef } from "../../entities/piece-parts-blob";
import { extOf, mimeFromDataUri, mimeFromExt } from "../../core/media/mime";
import { parseCanonicalEntity } from "../../entities/runtime-schema";
import { StudioConflictError, StudioValidationError, isLibraryLocked, StudioReadError } from "../../studio/errors";


import { portraitBytesFromCandidate, portraitReference } from "../../studio/portrait";
import { hashHex } from "../../core/sha256";
import { hasErrorName, isRecord as record } from "../../core/guards";
import type { DocumentBackend, DocumentRow, EntityKind, LightStoredEntity, StoredOriginalEntry, StoredRisuNamedAssets } from "../contracts/content-store";
import type { StoredPortraitAsset, StoredPortraitContent } from "../contracts/content-store-asset";
import { ASSET_MAX_BYTES } from "../../core/media/limits";
import { utf8ByteLength } from "../../shared/utf8";

type LiveRow = (kind: string, id: string) => Promise<DocumentRow | null>;

function throwLightFailure(kind: string, id: string, error: unknown): never {
  if (isLibraryLocked(error) || error instanceof StudioReadError || error instanceof StudioValidationError || (error instanceof Error && hasErrorName(error, "StageDatabaseError"))) throw error;
  throw new StudioReadError(`${kind} ${id} is damaged`, "schema-mismatch");
}

/** Selects a portrait identity from only the pinned head, retaining the accepted write receipt. */
export async function readPortraitAsset(backend: DocumentBackend, liveRow: LiveRow, kind: EntityKind, id: string): Promise<StoredPortraitAsset | null> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const row = await liveRow(kind, id);
    if (!row) return null;
    try {
      const head = await backend.lightHead(kind, id, row.version);
      if (!head) throw new Error("missing piece head");
      const value = JSON.parse(head.text) as { kind?: unknown; id?: unknown; original?: unknown; body?: unknown };
      if (value.kind !== row.kind || value.id !== row.id || !record(value.body) || value.original !== undefined && !record(value.original)) throw new Error("invalid portrait head");
      const asset = portraitReference({ kind: row.kind, id: row.id, body: value.body, ...(record(value.original) ? { original: value.original } : {}) });
      const latest = await liveRow(kind, id);
      if (!latest) return null;
      if (latest.writeId !== row.writeId || latest.version !== row.version || latest.revision !== row.revision) continue;
      return asset ? { kind: row.kind, id: row.id, asset, revision: row.revision, version: row.version, writeId: row.writeId } : null;
    } catch (error) {
      if (await retryOrThrow(liveRow, kind, id, row, error) === "gone") return null;
    }
  }
  throw new StudioConflictError(`${kind} ${id} changed repeatedly while opening portrait metadata`);
}

/** Legacy binary reader opens one selected hash or a bounded inline portrait from its captured head. */
export async function readPortraitContent(backend: DocumentBackend, liveRow: LiveRow, kind: EntityKind, id: string): Promise<StoredPortraitContent | null> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const reference = await readPortraitAsset(backend, liveRow, kind, id);
    if (!reference) return null;
    let art: { bytes: Uint8Array; mime: string; sha?: string } | null = null;
    if ("sha" in reference.asset) {
      const opened = await backend.asset(reference.asset.sha, ASSET_MAX_BYTES);
      if (opened.status !== "ok") {
        const latest = await liveRow(kind, id);
        if (latest && (latest.writeId !== reference.writeId || latest.version !== reference.version || latest.revision !== reference.revision)) continue;
        throw new StudioReadError(`${kind} ${id} portrait is damaged or exceeds the bounded read`, "part-unreadable");
      }
      art = { bytes: opened.bytes, mime: reference.asset.mime, sha: reference.asset.sha };
    } else {
      const head = await backend.lightHead(reference.kind, reference.id, reference.version);
      if (!head) throw new StudioReadError(`${kind} ${id} portrait is damaged`, "schema-mismatch");
      let candidate: { kind: string; id: string; original?: Record<string, unknown>; body: unknown };
      try {
        const value = JSON.parse(head.text) as { kind?: unknown; id?: unknown; original?: unknown; body?: unknown };
        if (value.kind !== reference.kind || value.id !== reference.id || !record(value.body) || value.original !== undefined && !record(value.original)) throw new Error("invalid portrait head");
        candidate = { kind: reference.kind, id: reference.id, body: value.body, ...(record(value.original) ? { original: value.original } : {}) };
      } catch (error) { throwLightFailure(kind, id, error); }
      const captured = await liveRow(kind, id);
      if (!captured) return null;
      if (captured.writeId !== reference.writeId || captured.version !== reference.version || captured.revision !== reference.revision) continue;
      art = await portraitBytesBounded(backend, candidate);
    }
    const latest = await liveRow(kind, id);
    if (!latest) return null;
    if (latest.writeId !== reference.writeId || latest.version !== reference.version || latest.revision !== reference.revision) continue;
    return art ? { bytes: art.bytes, mime: art.mime, sha: art.sha ?? hashHex(art.bytes), revision: reference.revision, version: reference.version, writeId: reference.writeId } : null;
  }
  throw new StudioConflictError(`${kind} ${id} changed repeatedly while opening its portrait`);
}

async function portraitBytesBounded(backend: DocumentBackend, candidate: { kind: string; id: string; original?: Record<string, unknown>; body: unknown }): Promise<{ bytes: Uint8Array; mime: string; sha?: string } | null> {
  const reference = portraitReference(candidate);
  if (!reference) return null;
  if ("sha" in reference) {
    const result = await backend.asset(reference.sha, ASSET_MAX_BYTES);
    if (result.status !== "ok") throw new StudioReadError(`${candidate.kind} ${candidate.id} portrait is damaged or exceeds the bounded read`, "part-unreadable");
    return { bytes: result.bytes, mime: reference.mime, sha: reference.sha };
  }
  if (reference.bytes !== undefined && reference.bytes > ASSET_MAX_BYTES) {
    throw new StudioReadError(`${candidate.kind} ${candidate.id} portrait exceeds the bounded read`, "part-unreadable");
  }
  const art = portraitBytesFromCandidate(candidate);
  if (art && art.bytes.byteLength > ASSET_MAX_BYTES) throw new StudioReadError(`${candidate.kind} ${candidate.id} portrait exceeds the bounded read`, "part-unreadable");
  return art;
}

async function retryOrThrow(liveRow: LiveRow, kind: string, id: string, row: DocumentRow, error: unknown): Promise<"retry" | "gone"> {
  const latest = await liveRow(kind, id);
  if (!latest) return "gone";
  if (latest.writeId !== row.writeId || latest.version !== row.version || latest.revision !== row.revision) return "retry";
  throwLightFailure(kind, id, error);
}

function originalEntry(value: unknown): value is Record<string, unknown> {
  if (!record(value)) return false;
  const entry = value;
  if (!Object.prototype.hasOwnProperty.call(entry, "raw") || Object.keys(entry).some((key) => !["raw", "unmapped", "sourceMedia"].includes(key))) return false;
  if (entry.unmapped !== undefined && !record(entry.unmapped)) return false;
  const media = entry.sourceMedia;
  return media === undefined || (record(media) && typeof media.b64 === "string" && typeof media.mime === "string" &&
    Object.keys(media).length === 2 && Object.prototype.hasOwnProperty.call(media, "b64") && Object.prototype.hasOwnProperty.call(media, "mime"));
}

export async function readLight(backend: DocumentBackend, liveRow: LiveRow, kind: EntityKind, id: string): Promise<LightStoredEntity | null> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const row = await liveRow(kind, id);
    if (!row) return null;
    let head: Awaited<ReturnType<DocumentBackend["lightHead"]>>;
    try {
      head = await backend.lightHead(kind, id, row.version);
    } catch (error) {
      if (await retryOrThrow(liveRow, kind, id, row, error) === "gone") return null;
      continue;
    }
    if (!head) {
      const latest = await liveRow(kind, id);
      if (!latest) return null;
      if (latest.writeId !== row.writeId || latest.version !== row.version || latest.revision !== row.revision) continue;
      throw new StudioReadError(`${kind} ${id} is damaged`, "schema-mismatch");
    }
    let excluded: string[];
    try {
      const value = JSON.parse(head.text) as { original?: Record<string, unknown> };
      excluded = Object.keys(value.original ?? {}).map((fmt) => `r/${encodeNamePart(fmt)}`);
    } catch (error) {
      if (await retryOrThrow(liveRow, kind, id, row, error) === "gone") return null;
      continue;
    }
    let parts: Awaited<ReturnType<DocumentBackend["lightParts"]>>;
    try {
      parts = await backend.lightParts(kind, id, row.version, excluded);
    } catch (error) {
      if (await retryOrThrow(liveRow, kind, id, row, error) === "gone") return null;
      continue;
    }
    if (!parts) {
      const latest = await liveRow(kind, id);
      if (!latest) return null;
      if (latest.writeId !== row.writeId || latest.version !== row.version || latest.revision !== row.revision) continue;
      throw new StudioReadError(`${kind} ${id} is damaged`, "schema-mismatch");
    }
    let needs: ReturnType<typeof lightBlobNeeds>;
    try {
      needs = lightBlobNeeds(parts);
    } catch (error) {
      if (await retryOrThrow(liveRow, kind, id, row, error) === "gone") return null;
      continue;
    }
    const blobs = new Map<string, ReadonlyMap<string, PartBlob>>();
    try {
      for (const [name, hashes] of needs) blobs.set(name, new Map((await backend.lightBlobs(kind, id, name, row.version, hashes.expected, hashes.selected)).map((blob) => [blob.key, blob] as const)));
    } catch (error) {
      if (await retryOrThrow(liveRow, kind, id, row, error) === "gone") return null;
      continue;
    }
    const latest = await liveRow(kind, id);
    if (!latest) return null;
    if (latest.writeId !== row.writeId || latest.version !== row.version || latest.revision !== row.revision) continue;
    try {
      const light = assembleLight(parts, blobs);
      return { entity: parseCanonicalEntity(light.entity), revision: row.revision, version: row.version, writeId: row.writeId, assets: light.assets };
    } catch (error) {
      if (await retryOrThrow(liveRow, kind, id, row, error) === "gone") return null;
      continue;
    }
  }
  throw new StudioConflictError(`${kind} ${id} changed repeatedly while opening`);
}

export async function readOriginalEntry(backend: DocumentBackend, liveRow: LiveRow, kind: EntityKind, id: string, format: string): Promise<unknown | null> {
  return (await readOriginalEntryVersioned(backend, liveRow, kind, id, format))?.entry ?? null;
}

export async function readOriginalEntryVersioned(backend: DocumentBackend, liveRow: LiveRow, kind: EntityKind, id: string, format: string): Promise<StoredOriginalEntry | null> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const row = await liveRow(kind, id);
    if (!row) return null;
    let head: Awaited<ReturnType<DocumentBackend["lightHead"]>>;
    try {
      head = await backend.lightHead(kind, id, row.version);
    } catch (error) {
      if (await retryOrThrow(liveRow, kind, id, row, error) === "gone") return null;
      continue;
    }
    if (!head) {
      const latest = await liveRow(kind, id);
      if (!latest) return null;
      if (latest.writeId !== row.writeId || latest.version !== row.version || latest.revision !== row.revision) continue;
      throw new StudioReadError(`${kind} ${id} is damaged`, "schema-mismatch");
    }
    let entry: Record<string, unknown> | undefined;
    let headRecord: { original?: Record<string, Record<string, unknown>> };
    let headBlobRefs: string[];
    try {
      headRecord = JSON.parse(head.text) as { original?: Record<string, Record<string, unknown>> };
      headBlobRefs = sentinelBlobRefs(headRecord);
      const original = headRecord.original;
      if (original !== undefined && !record(original)) throw new Error("invalid original map");
      entry = original && Object.prototype.hasOwnProperty.call(original, format) ? original[format] : undefined;
      if (entry !== undefined && !originalEntry(entry)) throw new Error("invalid original entry");
    } catch (error) {
      if (await retryOrThrow(liveRow, kind, id, row, error) === "gone") return null;
      continue;
    }
    if (!entry) {
      const latest = await liveRow(kind, id);
      if (!latest) return null;
      if (latest.writeId === row.writeId && latest.version === row.version && latest.revision === row.revision) return { entry: null, revision: row.revision, version: row.version };
      continue;
    }
    let hashes: string[];
    try {
      hashes = sentinelBlobRefs(entry);
    } catch (error) {
      if (await retryOrThrow(liveRow, kind, id, row, error) === "gone") return null;
      continue;
    }
    let headBlobs: Map<string, PartBlob>;
    try {
      headBlobs = new Map<string, PartBlob>((await backend.lightBlobs(kind, id, "h", row.version, headBlobRefs, hashes)).map((blob) => [blob.key, blob]));
    } catch (error) {
      if (await retryOrThrow(liveRow, kind, id, row, error) === "gone") return null;
      continue;
    }
    let decodedEntry: Record<string, unknown>;
    try {
      decodedEntry = decodeAuthorizedBlobs(entry, headBlobs) as Record<string, unknown>;
    } catch (error) {
      if (await retryOrThrow(liveRow, kind, id, row, error) === "gone") return null;
      continue;
    }
    let rawPart: Awaited<ReturnType<DocumentBackend["part"]>>;
    try {
      rawPart = await backend.part(kind, id, `r/${encodeNamePart(format)}`, row.version);
    } catch (error) {
      if (await retryOrThrow(liveRow, kind, id, row, error) === "gone") return null;
      continue;
    }
    // A null raw value may be a real, inline source value. Without a storage-owned split marker,
    // absence of r/<format> cannot distinguish that legal value from a missing placeholder part.
    let result = decodedEntry;
    if (rawPart) {
      try {
        result = { ...decodedEntry, raw: decodePart({ json: rawPart.text, blobs: [...rawPart.blobs] }) };
      } catch (error) {
        if (await retryOrThrow(liveRow, kind, id, row, error) === "gone") return null;
        continue;
      }
    }
    const latest = await liveRow(kind, id);
    if (!latest) return null;
    if (latest.writeId === row.writeId && latest.version === row.version && latest.revision === row.revision) return { entry: result, revision: row.revision, version: row.version };
  }
  throw new StudioConflictError(`${kind} ${id} changed repeatedly while opening`);
}

function risuRows(raw: unknown): unknown[] {
  if (!record(raw) || !record(raw.data)) return [];
  const data = raw.data;
  const extensions = record(data.extensions) ? data.extensions : null;
  const risuai = extensions && record(extensions.risuai) ? extensions.risuai : null;
  if (risuai && Array.isArray(risuai.additionalAssets)) return risuai.additionalAssets;
  return Array.isArray(data.assets) ? data.assets.filter((asset) => record(asset) && asset.type === "x-risu-asset") : [];
}

const MAX_RISU_RAW_BYTES = 2 * 1024 * 1024;
const MAX_NAMED_ASSETS = 1_000;
const MAX_NAMED_ASSET_RESPONSE_BYTES = 256 * 1024;

function namedAssetRows(rows: unknown[]): StoredRisuNamedAssets["items"] {
  const items: StoredRisuNamedAssets["items"] = [];
  let responseBytes = 0;
  for (const row of rows) {
    let name: unknown;
    let ref: unknown;
    let ext: unknown;
    const tuple = Array.isArray(row);
    if (tuple) [name, ref, ext] = row;
    else if (record(row) && row.type === "x-risu-asset") { name = row.name; ref = row.uri; ext = row.ext; }
    else throw new StudioValidationError("native Risu asset list contains an unsupported row; repair the imported list before editing assets");
    if (typeof name !== "string" || typeof ref !== "string" || !name.trim() || !ref.trim()) {
      throw new StudioValidationError("native Risu asset list contains an invalid row; repair the imported list before editing assets");
    }
    const shownName = normalizeAuthoredSentinelLiterals(name.trim()) as string;
    const shownRef = normalizeAuthoredSentinelLiterals(ref.trim()) as string;
    const shownExt = typeof ext === "string" && ext.trim()
      ? normalizeAuthoredSentinelLiterals(ext.trim()) as string
      : tuple ? extOf(shownName) : "";
    const mime = parseUploadedRef(shownRef)?.mime ?? mimeFromDataUri(shownRef) ?? mimeFromExt(shownExt);
    const item = { name: shownName, ref: shownRef, ext: shownExt, ...(mime ? { mime } : {}) };
    responseBytes += utf8ByteLength(JSON.stringify(item)) + 1;
    if (items.length >= MAX_NAMED_ASSETS || responseBytes > MAX_NAMED_ASSET_RESPONSE_BYTES) {
      throw new StudioValidationError("native NamedAsset metadata exceeds the bounded projection; narrow or repair the imported asset list");
    }
    items.push(item);
  }
  return items;
}

/** Project only the native Risu asset tuples; no escrow blob payload is ever opened. */
export async function readRisuNamedAssets(
  backend: DocumentBackend,
  liveRow: LiveRow,
  kind: EntityKind,
  id: string,
): Promise<StoredRisuNamedAssets | null> {
  if (kind !== "character") return null;
  for (let attempt = 0; attempt < 3; attempt++) {
    const row = await liveRow(kind, id);
    if (!row) return null;
    try {
      const head = await backend.lightHead(kind, id, row.version);
      if (!head) throw new Error("missing character head");
      const parsed = JSON.parse(head.text) as { original?: unknown };
      if (parsed.original !== undefined && !record(parsed.original)) throw new Error("invalid original map");
      const original = record(parsed.original) ? parsed.original : {};
      const entry = Object.prototype.hasOwnProperty.call(original, "risu") ? original.risu : undefined;
      if (entry !== undefined && !originalEntry(entry)) throw new Error("invalid Risu original entry");
      let raw = record(entry) ? entry.raw : null;
      if (raw === null) {
        const rawPart = await backend.lightPartBounded(kind, id, `r/${encodeNamePart("risu")}`, row.version, MAX_RISU_RAW_BYTES);
        if (rawPart.status === "too-large") throw new StudioValidationError("native Risu data exceeds the bounded NamedAsset projection limit");
        if (rawPart.status === "ok") raw = JSON.parse(rawPart.text);
      }
      if (raw !== null && utf8ByteLength(JSON.stringify(raw)) > MAX_RISU_RAW_BYTES) {
        throw new StudioValidationError("native Risu data exceeds the bounded NamedAsset projection limit");
      }
      const items = namedAssetRows(risuRows(raw));
      const latest = await liveRow(kind, id);
      if (!latest) return null;
      if (latest.writeId !== row.writeId || latest.version !== row.version || latest.revision !== row.revision) continue;
      return { items, revision: row.revision, version: row.version };
    } catch (error) {
      if (await retryOrThrow(liveRow, kind, id, row, error) === "gone") return null;
    }
  }
  throw new StudioConflictError(`${kind} ${id} changed repeatedly while opening`);
}
