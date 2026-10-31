/**
 * The ContentStore's write path via parts. Every write decomposes the next whole entity fresh
 * - `decompose` is called with no `reuse` argument, on purpose: `reuse` trusts object identity to
 * skip re-hashing, and a write path has no way to know the caller never mutates what it once handed
 * in; only S5's cache, which owns its inputs, is allowed to pass one (S3/S4a review, 2026-09-30) -
 * and diffs it against the LIVE part hashes fetched fresh from the backend (`parts()`'s stored json
 * text, hashed without decoding its blobs: "no parse needed"). Only the parts whose hash differs are
 * sealed and written; the rest are neither opened nor touched. Extracted from content-store.ts to
 * keep that file under the line cap.
 *
 * `buildPartText` is `PartRecord` -> the wire shape a backend stores: `text` is exactly the part's sentinel-bearing json, and `blobs` is
 * carried alongside it so a backend can seal each one once and link it by `blob_refs`, in the same
 * transaction as the part row, rather than re-encoding it into the cell itself (S4a's own inline
 * scheme, now gone with `piece-part-text.ts`). It lives here, not in a dedicated file, because once
 * blobs no longer travel inside the cell this direction is a one-line reshape with nothing left to
 * frame or validate; `toPartRecord` is the inverse (a backend's `PartText` back into a `PartRecord`),
 * needed by both an ordinary read (content-store.ts's `decode`) and the patch path's cold cache fill
 * (`coldFillParts`, S5), so it lives here rather than being duplicated in each.
 */
import { COLD_READ_LIMIT } from "./cold-read-budget";
import { utf8ByteLength } from "../../shared/utf8";
import { revisionFromParts } from "../../entities/canonical-revision";
import { assemble, decodePart, decodePartHolding, decompose, kindPartsFor, type PartRecord } from "../../entities/piece-parts";
import { parseCanonicalEntity, type ParsedCanonicalEntity } from "../../entities/runtime-schema";
import { hashHex } from "../../core/sha256";
import type { StudioDamageReason } from "../../studio/errors";
import type { ContentSummary, DocumentBackend, DocumentRow, EntityKind, PartChange, PartText, SaveReason, VersionRow } from "../contracts/content-store";
import { breather } from "./breather";
import { summaryContentOf } from "./summary-content";

/** Builds the public summary from the exact row and entity a store operation returns. */
export function contentSummaryOf(row: DocumentRow, entity: ParsedCanonicalEntity, content = summaryContentOf(entity)): ContentSummary {
  return {
    ...content,
    id: row.id,
    kind: row.kind as EntityKind,
    revision: row.revision,
    version: row.version,
    writeId: row.writeId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** `PartRecord` -> the wire shape a backend stores (see the file docblock). */
export function buildPartText(part: Pick<PartRecord, "name" | "json" | "blobs" | "refs">): PartText {
  const carried = new Set(part.blobs.map((blob) => blob.key));
  const bare = part.refs?.filter((sha) => !carried.has(sha)) ?? [];
  return { name: part.name, text: part.json, blobs: part.blobs, ...(bare.length ? { refs: bare } : {}) };
}

/** A backend's `PartText` back into the `PartRecord` shape `assemble` consumes: `text` is already the
 * part's json verbatim (S4b: no wire framing left once blobs moved into their own tables), so this is
 * a hash plus a reshape, never a parse. `value` stays undefined - only `decompose`'s own `reuse` path
 * reads it, and a plain read is not a write (the patch path's cold fill, below, fills it in instead). */
export function toPartRecord(part: PartText): PartRecord {
  return { name: part.name, json: part.text, hash: hashHex(part.text), blobs: [...part.blobs], value: undefined };
}

export type Decoded = { ok: true; entity: ParsedCanonicalEntity } | { ok: false; reason: StudioDamageReason };
export class ColdReadDamageError extends Error {
  constructor(readonly reason: StudioDamageReason) { super("stored piece is damaged"); this.name = "ColdReadDamageError"; }
}
class ColdReadLimitError extends Error {}

/** The JSON values in a part's text, counted only until `stopAt`: past that the part is refused anyway, so a hostile part is not scanned to its end. */
function jsonTokenCount(text: string, stopAt: number): number {
  let count = 0;
  for (let i = 0; i < text.length; i++) {
    const char = text[i]!;
    if (char === '"') {
      count++;
      for (i++; i < text.length; i++) {
        if (text[i] === "\\") i++;
        else if (text[i] === '"') break;
      }
    } else if (char === "{" || char === "[") count++;
    else if (/[0-9tfn-]/.test(char)) {
      count++;
      while (i + 1 < text.length && !/[\s,}\]]/.test(text[i + 1]!)) i++;
    }
    if (count > stopAt) return count;
  }
  return count;
}

function graphBytes(value: unknown): number {
  const seen = new Set<object>();
  const stack: Array<{ value: unknown } | { object: object; iterator: Iterator<string> }> = [{ value }];
  let bytes = 0, nodes = 0;
  while (stack.length) {
    const frame = stack.pop()!;
    if ("object" in frame) {
      const next = frame.iterator.next();
      if (!next.done) {
        stack.push(frame);
        bytes += utf8ByteLength(next.value);
        if (Object.prototype.hasOwnProperty.call(frame.object, next.value)) stack.push({ value: (frame.object as Record<string, unknown>)[next.value] });
      }
      continue;
    }
    const item = frame.value;
    nodes++;
    bytes += 128;
    if (typeof item === "string") bytes += utf8ByteLength(item);
    else if (item && typeof item === "object") {
      if (seen.has(item)) continue;
      seen.add(item);
      if (item instanceof Uint8Array) bytes += item.byteLength;
      else stack.push({ object: item, iterator: (function* () { for (const key in item) if (Object.prototype.hasOwnProperty.call(item, key)) yield key; })() });
    }
    if (bytes > COLD_READ_LIMIT) return bytes;
  }
  return bytes;
}

/**
 * Reassembles a piece's part rows back into its stored body, reporting damage instead of throwing it
 * away (spec behavior 6). `assemble` fails closed on a shape it does not recognise (a missing head, a
 * part never consumed, a dangling blob sentinel): every one of those is "the stored parts do not
 * reconstruct into valid JSON", the same family `unreadable-json` already named for a truncated whole
 * body - including plain `JSON.parse` failure on a part's own `text`, which `assemble`'s `decodePart`
 * runs and this `try` still catches.
 */
export function decode(kind: string, id: string, parts: readonly PartText[]): Decoded {
  let assembled: unknown;
  try {
    assembled = assemble(parts.map(toPartRecord));
  } catch {
    return { ok: false, reason: "unreadable-json" };
  }
  let entity: ParsedCanonicalEntity;
  try {
    entity = parseCanonicalEntity(assembled);
  } catch {
    return { ok: false, reason: "schema-mismatch" };
  }
  if (entity.kind !== kind) return { ok: false, reason: "kind-mismatch" };
  if (entity.id !== id) return { ok: false, reason: "id-mismatch" };
  return { ok: true, entity };
}

/** Reads a live row's own parts at its own version, so a save landing between the two backend calls
 * never pairs one version's revision with another version's entity (S3/S4a review, 2026-09-30). Null
 * when the row is gone by the time the parts are fetched - a narrow race, treated as "not found"
 * rather than damage. */
export async function decodeLive(backend: DocumentBackend, row: DocumentRow): Promise<Decoded | null> {
  const snapshot = await backend.liveParts(row.kind, row.id);
  if (!snapshot || snapshot.parts.length === 0 || snapshot.writeId !== row.writeId) return null;
  return decodeParts(row.kind, row.id, snapshot.parts);
}

export function decodeParts(kind: string, id: string, parts: readonly PartText[]): Decoded {
  return decode(kind, id, parts);
}

/**
 * The patch path's cache-miss fill: rebuilds the live
 * entity from the backend's own stored part text, breathing between parts so hashing a 30 MB piece's
 * ~3,000 cells never blocks the main thread for more than one `breather` slice. Unlike `toPartRecord`
 * alone, each returned record's `value` is the REAL decoded value its part text held - `decodePart`,
 * not a fresh `decompose` - so the very next patch's `decompose(next, reuse)` can recognise an
 * untouched item by reference instead of re-stringifying it. `assemble` still runs its own internal
 * decode to build the returned entity; that one redundant pass is the accepted cost of reusing
 * `assemble`'s own ordering and validation rather than re-implementing it here, and only ever happens
 * once per piece per process (the plan's own "one slow first save per massive piece after a restart").
 * Null parts (nothing live) mirrors `decodeLive`'s own "not found, not damage" reading of that case.
 *
 * `hold` (the patch path): every canonical media slot keeps its picture sentinel and the part records
 * its plain hash in `refs`, so a piece of pictures is cached as a few kilobytes of references. The
 * caller then passes only the blobs it needs opened (text blobs), never the pictures' payloads.
 */
export async function coldFillParts(
  parts: readonly PartText[] | null,
  limits: { charge: number } = { charge: COLD_READ_LIMIT },
  expected?: { kind: string; id: string },
  hold = false,
  keepValues = false,
): Promise<{ entity: ParsedCanonicalEntity; parts: PartRecord[]; usedCharge: number } | null> {
  if (!parts || parts.length === 0) return null;
  if (hold && !expected) throw new Error("coldFillParts: holding pictures needs the piece's kind");
  const holdKind = expected?.kind as ParsedCanonicalEntity["kind"];
  const itemPaths = new Map<string, readonly (string | number)[]>();
  if (hold) {
    const split = kindPartsFor(holdKind);
    const order = split ? parts.find((p) => p.name === "o") : undefined;
    if (split && order) {
      try { (JSON.parse(order.text) as unknown[]).forEach((name, index) => { if (typeof name === "string") itemPaths.set(name, ["body", split.itemsField, index]); }); }
      catch { throw new ColdReadDamageError("unreadable-json"); }
    }
  }
  let inputBytes = 0;
  let references = 0;
  let nodes = 0;
  for (const part of parts) {
    inputBytes += utf8ByteLength(part.text);
    nodes += jsonTokenCount(part.text, Math.ceil(limits.charge / 128) - nodes);
    references += part.blobs.length + (part.refs?.length ?? 0);
    for (const blob of part.blobs) {
      inputBytes += blob.payload.kind === "bytes" ? blob.payload.bytes.byteLength : utf8ByteLength(blob.payload.text);
    }
    if (inputBytes * 2 + (parts.length + references) * 2048 + nodes * 128 > limits.charge) {
      throw new Error("this piece exceeds the bounded cold-read memory limit");
    }
  }
  const usedCharge = inputBytes * 2 + (parts.length + references) * 2048 + nodes * 128;
  let expandedCharge = usedCharge;
  const admit = (bytes: number): void => {
    if (expandedCharge + bytes > limits.charge) throw new ColdReadLimitError("this piece exceeds the bounded cold-read memory limit");
    expandedCharge += bytes;
  };
  const breathe = breather();
  const records: PartRecord[] = [];
  for (const p of parts) {
    let value: unknown;
    let refs: string[] = [];
    // A whole-piece read needs only the entity: `assemble` below decodes every part, so decoding each one here
    // too (what the patch cache wants, to reuse values by reference) would double the expansion of a big pack.
    if (!hold && !keepValues) { records.push({ name: p.name, json: p.text, hash: hashHex(p.text), blobs: [...p.blobs], value: undefined }); await breathe(); continue; }
    try {
      if (hold) ({ value, refs } = decodePartHolding({ json: p.text, blobs: [...p.blobs] }, holdKind, itemPaths.get(p.name) ?? [], admit));
      else value = decodePart({ json: p.text, blobs: [...p.blobs] }, admit);
    }
    catch (error) { if (error instanceof ColdReadLimitError) throw error; throw new ColdReadDamageError("unreadable-json"); }
    records.push({ name: p.name, json: p.text, hash: hashHex(p.text), blobs: [...p.blobs], ...(refs.length ? { refs } : {}), value });
    await breathe();
  }
  let assembled: unknown;
  try { assembled = assemble(records, admit, hold ? { kind: holdKind } : undefined); }
  catch (error) { if (error instanceof ColdReadLimitError) throw error; throw new ColdReadDamageError("unreadable-json"); }
  let entity: ParsedCanonicalEntity;
  try { entity = parseCanonicalEntity(assembled); } catch { throw new ColdReadDamageError("schema-mismatch"); }
  if (expected && entity.kind !== expected.kind) throw new ColdReadDamageError("kind-mismatch");
  if (expected && entity.id !== expected.id) throw new ColdReadDamageError("id-mismatch");
  const graphCharge = graphBytes({ entity, parts: records });
  if (expandedCharge + graphCharge > limits.charge) throw new Error("the opened piece exceeds the bounded cold-read memory limit");
  return { entity, parts: hold || keepValues ? records : [], usedCharge: expandedCharge + graphCharge };
}

export interface PartWrite {
  row: DocumentRow;
  version: VersionRow;
  /** The exact entity this write stores (id already assigned), for `buildSummary` and `summaryOf`:
   * built once here, never reconstructed by the caller. */
  entity: ParsedCanonicalEntity;
  /** The whole next decompose, kept only so `entityRevision`-equivalent checks elsewhere never have
   * to decompose `entity` a second time. */
  parts: readonly PartRecord[];
  change: PartChange;
}

/** The live part hashes to diff a decompose result against. Null when there is no live row to read
 * (buried, or a race between the caller's own `get` and this call): the caller's write is already
 * conditioned on the version it read, so a stale diff here only ever costs a wasted attempt, never a
 * wrong write - the backend's own condition refuses it. */
async function liveHashes(backend: DocumentBackend, kind: string, id: string, atVersion: number): Promise<Map<string, string> | null> {
  const parts = await backend.parts(kind, id, atVersion);
  if (!parts) return null;
  // `p.text` IS the part's json verbatim (no wire framing left once blobs moved out, S4b), so hashing
  // it is a reshape, never a parse - "no parse needed" is about the json, not the call this builds
  // on: `backend.parts()` itself still opens every blob the live parts reference (S4b's `toPartTexts` in SQLite, `withBlobs` in memory),
  // the same cost S4a's inline cells already paid on every whole-entity save. Avoiding that open for a
  // plain hash diff is S6's job (body-only reads), not this path's.
  return new Map(parts.map((p) => [p.name, hashHex(p.text)] as const));
}

/** The `PartChange` a decompose result implies against a set of live hashes. Null `live` (nothing to
 * diff against - a brand-new entity) means every part is new. Exported so the patch path
 * (`content-store-patch.ts`, S5) can diff against the CACHED hashes directly, never a fresh
 * `backend.parts()` fetch - the whole point of the cache. */
export function diffAgainst(parts: readonly PartRecord[], live: ReadonlyMap<string, string> | null): PartChange {
  const nextNames = new Set(parts.map((p) => p.name));
  const put = parts.filter((p) => live?.get(p.name) !== p.hash).map(buildPartText);
  const drop = live ? [...live.keys()].filter((name) => !nextNames.has(name)) : [];
  return { put, drop };
}

/** A brand-new entity at exactly this id: no live row to diff against, so every part is `put`. */
export function freshWrite(entity: ParsedCanonicalEntity, kind: EntityKind, id: string, t: number, reason: SaveReason): PartWrite {
  const stored = { ...entity, id };
  const parts = decompose(stored);
  const revision = revisionFromParts(parts);
  return {
    row: { kind, id, revision, version: 1, writeId: 1, autosaveStartedAt: null, createdAt: t, updatedAt: t },
    version: { kind, id, version: 1, revision, savedAt: t, reason, autosaveStartedAt: null },
    entity: stored,
    parts,
    change: { put: parts.map(buildPartText), drop: [] },
  };
}

/**
 * Decomposes `entity` once. Exported so a caller (content-store.ts's `writeNext`) can check the
 * revision against the row it already read - and return early, reporting an unchanged save, without
 * ever calling the backend - before `diffWrite` below pays for a live `parts()` fetch that a no-op
 * save would waste.
 */
export function decomposeEntity(entity: ParsedCanonicalEntity): { parts: readonly PartRecord[]; revision: string } {
  const parts = decompose(entity);
  return { parts, revision: revisionFromParts(parts) };
}

/** The next write for an existing live row, given its own fresh decompose, diffed against the
 * row's current live parts (the one backend round trip this whole module makes). */
export async function diffWrite(
  backend: DocumentBackend,
  current: DocumentRow,
  entity: ParsedCanonicalEntity,
  parts: readonly PartRecord[],
  revision: string,
  reason: SaveReason,
  t: number,
): Promise<PartWrite> {
  const live = await liveHashes(backend, current.kind, current.id, current.version);
  return {
    row: { ...current, revision, version: current.version + 1, writeId: current.writeId + 1, autosaveStartedAt: null, updatedAt: t },
    version: { kind: current.kind, id: current.id, version: current.version + 1, revision, savedAt: t, reason, autosaveStartedAt: null },
    entity,
    parts,
    change: diffAgainst(parts, live),
  };
}

/** `restoreVersion`'s own write shape: the part rows are copied in SQL by the backend (`change:
 * { restore }`), never opened or re-sealed, so `old` is decomposed only to get its revision and to
 * hand `buildSummary` the exact entity being restored. */
export function restoreWrite(current: DocumentRow, old: ParsedCanonicalEntity, atVersion: number, t: number, knownRevision?: string): PartWrite {
  const { parts, revision } = knownRevision === undefined ? decomposeEntity(old) : { parts: [] as readonly PartRecord[], revision: knownRevision };
  return {
    row: { ...current, revision, version: current.version + 1, writeId: current.writeId + 1, autosaveStartedAt: null, updatedAt: t },
    version: { kind: current.kind, id: current.id, version: current.version + 1, revision, savedAt: t, reason: "restore", autosaveStartedAt: null },
    entity: old,
    parts,
    change: { restore: atVersion },
  };
}
