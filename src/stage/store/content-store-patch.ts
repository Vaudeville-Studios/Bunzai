/**
 * `ContentStore.patch`: the send-only-what-changed save. Builds the next whole entity from a cached base
 * plus a `PiecePatch`, decomposes it with `reuse` so only the changed parts are re-hashed, diffs
 * against the CACHED hashes (never the backend's `parts()` - that is the whole-entity cost this path
 * exists to avoid), and writes one conditional transaction. Split from content-store.ts for the
 * line-cap.
 */
import { COLD_READ_LIMIT } from "./cold-read-budget";
import { revisionFromParts } from "../../entities/canonical-revision";
import { decompose, encodeNamePart, kindPartsFor, partNames, type PartRecord } from "../../entities/piece-parts";
import { decodeAuthorizedBlobs, decodeAuthorizedBlobsHolding, isActiveMediaBlobReference, type KnownBlobs } from "../../entities/piece-parts-blob";
import { assertMediaRefsAuthorized } from "./content-store-media-refs";
import { parseCanonicalEntity, type ParsedCanonicalEntity } from "../../entities/runtime-schema";
import { hasValidFolderParents } from "../../entities/lorebook/folder-edges";
import type { Original } from "../../core/canonical";
import { deepEq, isRecord as record, isRecord } from "../../core/guards";
import { StudioReadError, StudioValidationError } from "../../studio/errors";
import type { DocumentBackend, EntityKind, PartBlob, PartChange, PiecePatch, SaveIfUnchangedResult, SaveIntent } from "../contracts/content-store";
import type { ExtensionCommitContext } from "../contracts/extension-store";
import { ColdReadDamageError, contentSummaryOf, diffAgainst } from "./content-store-write";
import { holdFill } from "./content-store-hold";
import { hashHex } from "../../core/sha256";
import { assertStudioEntityKind } from "../../studio/path-policy";
import { getCachedPiece, setCachedPiece, dropCachedPiece, type CachedPiece } from "./piece-cache";
import { buildSummary } from "./summary-content";

const AUTOSAVE_WINDOW_MS = 5 * 60_000;

/** The next `original`, built ONLY from the STORED (cached) escrow plus `patch.original` - never from
 * `patch.head.original`. `head` is validated separately (below) to match the stored placeholder shape
 * exactly, but it is never a data source: this is what closes the two escrow bypasses an independent
 * review found (2026-10-01) - a head that forgot to carry `original` silently wiping the whole escrow,
 * and a head that edited `original["vaud-studio"]` directly, which the `patch.original`-only stamp
 * refusal below never saw. A `patchOriginal` key naming a format the cached escrow does not have is
 * refused, never silently dropped (it has no `entry` to merge `raw` into).
 *
 * IDENTITY, not `cachedOriginal`'s own value. For a format with a live `r/<fmt>` part, `cachedOriginal
 * [fmt].raw` (from `cached.entity`, built by `assemble`'s OWN separate `decodePart` call - see
 * `content-store-write.ts`'s `coldFillParts`) is NEVER the same object reference as `cachedParts`'s own
 * "r/<fmt>" part's `.value` (coldFillParts's decode of the SAME bytes, a second, independent decode).
 * An untouched format therefore has to be taken from `cachedParts` directly, not from `cachedOriginal`,
 * or `decompose`'s `reuse` (`splitEscrow`'s `priorRawPart.value === entry.raw`) misses on every single
 * patch after a cold fill, paying the full stringify-and-hash cost the cache exists to avoid (measured
 * regression, 2026-10-01: a DEBUG_REUSE probe on `presetWithEscrow`, one head-only patch right after a
 * cold fill, showed `REUSE-MISS r/testfmt` with this function passing `cachedOriginal[fmt]` instead).
 * An unsplit format (no `r/<fmt>` part) has no separate identity to preserve - the head carrying it is
 * always rebuilt fresh regardless (`decompose`'s own `buildPart("h", head, false, undefined)`), so
 * `cachedOriginal[fmt]` is fine there. */
function buildNextOriginal(cachedOriginal: Original | undefined, cachedParts: readonly PartRecord[], patchOriginal: Record<string, unknown> | undefined): Original | undefined {
  if (patchOriginal) {
    for (const fmt of Object.keys(patchOriginal)) {
      if (!cachedOriginal || !Object.prototype.hasOwnProperty.call(cachedOriginal, fmt)) {
        throw new StudioValidationError(`patch original names an unknown format "${fmt}"`);
      }
    }
  }
  if (!cachedOriginal) return cachedOriginal;
  const rawPartByName = new Map(cachedParts.filter((p) => p.name.startsWith("r/")).map((p) => [p.name, p] as const));
  return Object.fromEntries(
    Object.keys(cachedOriginal).map((fmt) => {
      const entry = cachedOriginal[fmt]!;
      if (patchOriginal && Object.prototype.hasOwnProperty.call(patchOriginal, fmt)) return [fmt, { ...entry, raw: patchOriginal[fmt] }];
      const rawPart = rawPartByName.get(`r/${encodeNamePart(fmt)}`);
      if (!rawPart) return [fmt, entry]; // unsplit: no separate part identity to preserve
      return [fmt, { ...entry, raw: rawPart.value }]; // split: the SAME reference coldFillParts decoded
    }),
  ) as Original;
}

/** The head's own `original`, exactly as `piece-parts.ts`'s `decompose` would build the "h" part for
 * the CACHED entity: real values inline for formats under the 16 KB split threshold, `raw: null`
 * placeholders for formats already split into their own "r/<fmt>" part. A patch head may omit
 * `original` entirely (every format then keeps its cached value, below); when it carries one, it must
 * equal this exactly, or it is refused - the head is never a channel for an escrow change, split or
 * not, so there is nothing to merge, only to check. */
function expectedHeadOriginal(cachedParts: readonly PartRecord[]): Original | undefined {
  const h = cachedParts.find((p) => p.name === "h");
  return (h?.value as { original?: Original } | undefined)?.original;
}

function ownedPath(value: unknown, path: readonly string[]): [boolean, unknown] {
  let cursor = value;
  for (const key of path) {
    if (!record(cursor) || !Object.prototype.hasOwnProperty.call(cursor, key)) return [false, undefined];
    cursor = cursor[key];
  }
  return [true, cursor];
}

function nativeOwnedProjection(format: string, entry: unknown): unknown {
  if (format === "marinara-lorebook") {
    const [present, folders] = ownedPath(entry, ["raw", "data", "folders"]);
    if (!present || !Array.isArray(folders)) return [present, folders];
    const parents = folders.map((folder) => record(folder)
      ? [Object.prototype.hasOwnProperty.call(folder, "id"), folder.id, Object.prototype.hasOwnProperty.call(folder, "parentFolderId"), folder.parentFolderId]
      : [false, folder]);
    parents.sort((a, b) => (JSON.stringify(a[1]) ?? "").localeCompare(JSON.stringify(b[1]) ?? ""));
    return [true, parents];
  }
  if (format === "risu") return ownedPath(entry, ["raw", "data", "extensions", "risuai", "additionalAssets"]);
  return undefined;
}

function sameProjection(left: unknown, right: unknown): boolean {
  try { return deepEq(left, right); }
  catch { return false; }
}

function rejectGenericNativePathEdits(stored: Original | undefined, proposed: Record<string, unknown> | undefined): void {
  if (!stored || !proposed) return;
  for (const format of ["marinara-lorebook", "risu"]) {
    if (!Object.prototype.hasOwnProperty.call(proposed, format)) continue;
    if (!sameProjection(nativeOwnedProjection(format, stored[format]), nativeOwnedProjection(format, { raw: proposed[format] }))) {
      throw new StudioValidationError(`${format} authored fields require their native patch operation`);
    }
  }
}

function authoredOriginal(kind: EntityKind, base: Original | undefined, body: Record<string, unknown>, patch: PiecePatch["native"], blobs: ReadonlyMap<string, PartBlob>): Original | undefined {
  if (!patch) return base;
  const keys = Object.keys(patch);
  if (keys.some((key) => key !== "marinaraFolderParents" && key !== "risuAdditionalAssets")) throw new StudioValidationError("unknown native patch operation");
  if (patch.marinaraFolderParents !== undefined) {
    if (kind !== "lorebook" || !Array.isArray(body.categories)) throw new StudioValidationError("Marinara folder parents apply only to lorebooks");
    const categories = body.categories.filter(record);
    const ids = categories.map((category) => category.id);
    if (categories.length !== body.categories.length || ids.some((id) => typeof id !== "string")) throw new StudioValidationError("invalid lorebook categories");
    const pairs = patch.marinaraFolderParents;
    if (pairs.some((edge) => !record(edge) || Object.keys(edge).some((key) => key !== "id" && key !== "parentFolderId") ||
      typeof edge.id !== "string" || !(edge.parentFolderId === null || typeof edge.parentFolderId === "string"))) {
      throw new StudioValidationError("invalid Marinara folder edges");
    }
    if (new Set(pairs.map((edge) => edge.id)).size !== pairs.length) throw new StudioValidationError("Marinara folder edges contain duplicate ids");
    const parents = new Map(pairs.map((edge) => [edge.id, edge.parentFolderId] as const));
    if (!hasValidFolderParents(ids as string[], parents)) throw new StudioValidationError("Marinara folder edges are duplicate, unknown, or cyclic");
    const original = Object.fromEntries(Object.entries(base ?? {}));
    const prior = original["marinara-lorebook"];
    const entry = prior === undefined ? { raw: { type: "marinara_lorebook", version: 1, exportedAt: "", data: { folders: [] } } } : structuredClone(prior);
    if (!record(entry) || !Object.prototype.hasOwnProperty.call(entry, "raw") || !record(entry.raw)) throw new StudioValidationError("Marinara original entry cannot be safely updated");
    const raw = entry.raw;
    const data = raw.data === undefined ? {} : raw.data;
    if (!record(data) || (data.folders !== undefined && !Array.isArray(data.folders))) throw new StudioValidationError("Marinara folder escrow is malformed");
    const existing = data.folders ?? [];
    if (existing.some((row) => !record(row) || typeof row.id !== "string")) throw new StudioValidationError("Marinara folder escrow is malformed");
    const byId = new Map(existing.map((row) => [row.id as string, row as Record<string, unknown>] as const));
    if (byId.size !== existing.length) throw new StudioValidationError("Marinara folder escrow has duplicate ids");
    const folders = categories.map((category) => {
      const id = category.id as string;
      const priorRow = byId.get(id);
      return priorRow
        ? { ...priorRow, parentFolderId: parents.get(id) }
        : { id, name: category.name, enabled: category.enabled ?? true, order: category.sortOrder, parentFolderId: parents.get(id) };
    });
    const nextEntry = { ...entry, raw: { ...raw, data: { ...data, folders } } };
    original["marinara-lorebook"] = nextEntry;
    base = original as Original;
  }
  if (patch.risuAdditionalAssets !== undefined) {
    if (kind !== "character" || !Array.isArray(patch.risuAdditionalAssets) || patch.risuAdditionalAssets.length > 1000) {
      throw new StudioValidationError("Risu named assets apply only to characters and are bounded");
    }
    const original = Object.fromEntries(Object.entries(base ?? {}));
    const prior = original.risu;
    const entry = prior === undefined
      ? { raw: { spec: "chara_card_v3", spec_version: "3.0", data: { name: "", description: "", personality: "", scenario: "", first_mes: "", mes_example: "", creator_notes: "", system_prompt: "", post_history_instructions: "", alternate_greetings: [], group_only_greetings: [], tags: [], creator: "", character_version: "1.0", extensions: {} } } }
      : structuredClone(prior);
    if (!record(entry) || Object.keys(entry).some((key) => !["raw", "unmapped", "sourceMedia"].includes(key)) || !Object.prototype.hasOwnProperty.call(entry, "raw") || !record(entry.raw)) {
      throw new StudioValidationError("Risu original entry cannot be safely updated");
    }
    if (entry.unmapped !== undefined && !record(entry.unmapped)) throw new StudioValidationError("Risu original entry is malformed");
    if (entry.sourceMedia !== undefined && (!record(entry.sourceMedia) || typeof entry.sourceMedia.b64 !== "string" || typeof entry.sourceMedia.mime !== "string")) {
      throw new StudioValidationError("Risu original entry is malformed");
    }
    const raw = structuredClone(entry.raw);
    if (!record(raw) || !record(raw.data)) throw new StudioValidationError("Risu card data is malformed");
    const data = raw.data as Record<string, unknown>;
    if (data.extensions !== undefined && !record(data.extensions)) throw new StudioValidationError("Risu extensions are malformed");
    const extensions = { ...(data.extensions as Record<string, unknown> | undefined) };
    if (extensions.risuai !== undefined && !record(extensions.risuai)) throw new StudioValidationError("Risu extensions are malformed");
    const risuai = { ...(extensions.risuai as Record<string, unknown> | undefined) };
    const oldRows = Array.isArray(risuai.additionalAssets) ? risuai.additionalAssets : [];
    const xRows = Array.isArray(data.assets) ? data.assets.filter(record).filter((row) => row.type === "x-risu-asset") : [];
    const oldRefs = new Set([
      ...oldRows.filter(Array.isArray).map((row) => row[1]).filter((ref): ref is string => typeof ref === "string"),
      ...xRows.map((row) => row.uri).filter((ref): ref is string => typeof ref === "string"),
    ]);
    const names = new Set<string>();
    const rows = patch.risuAdditionalAssets.map((row) => {
      if (!Array.isArray(row) || row.length !== 3 || row.some((part) => typeof part !== "string")) throw new StudioValidationError("invalid Risu named asset row");
      const [wireName, inputRef, ext] = row;
      if (wireName.startsWith("\u0000b:") && !wireName.startsWith("\u0000b:\u0000b:")) throw new StudioValidationError("Risu named asset names must use the escaped text wire form");
      let name: string;
      try { name = decodeAuthorizedBlobs(wireName, new Map()) as string; }
      catch { throw new StudioValidationError("invalid Risu named asset name"); }
      if (!name.trim() || name !== name.trim() || name.length > 255 || names.has(name.toLowerCase()) || !/^[a-z0-9]{1,8}$/i.test(ext)) throw new StudioValidationError("invalid Risu named asset name or extension");
      names.add(name.toLowerCase());
      let ref = inputRef;
      if (oldRefs.has(ref)) {
        // An unchanged ref is already authorized by this exact source entry, including a literal
        // marker-looking value; do not reinterpret it as a newly submitted blob handle.
      } else if (ref.startsWith("\u0000b:")) {
        if (!isActiveMediaBlobReference(ref)) throw new StudioValidationError("Risu named asset ref is not a media blob");
        try { ref = decodeAuthorizedBlobs(ref, blobs) as string; }
        catch { throw new StudioValidationError("Risu named asset references an asset not held by this piece or uploaded in this session"); }
      } else throw new StudioValidationError("new Risu named asset must use an authorized asset reference");
      return [name, ref, ext] as [string, string, string];
    });
    risuai.additionalAssets = rows;
    extensions.risuai = risuai;
    data.extensions = extensions;
    original.risu = { ...entry, raw };
    base = original as Original;
  }
  return base;
}

/**
 * Builds the next whole entity from `cached` plus `patch`, or throws `StudioValidationError` - always
 * before any backend call, so every refusal writes nothing. `patch.head`/`items`/`original` are
 * `structuredClone`d before they are parsed: Zod passes escrow `raw` and `extras` fields through by
 * reference (`z.unknown()`), so without the clone the cache would end up deep-frozen around the
 * CALLER's own objects instead of ones this module owns.
 */
function buildNextEntity(kind: EntityKind, cached: CachedPiece, patch: PiecePatch, uploads: readonly PartBlob[], known: KnownBlobs): ParsedCanonicalEntity {
  const blobs = known.blobs;
  const held = known.held;
  let clonedHead = structuredClone(patch.head);
  // Validated and normalized BEFORE parsing, not after: a head MAY omit `original` (it then behaves as though it carried the stored placeholder
  // exactly) or must carry EXACTLY the stored placeholder - either way the EFFECTIVE value is the
  // SAME, so it is substituted into the clone's `original` key before `parseCanonicalEntity` runs.
  // This keeps `original` in its canonical schema position in zod's own OUTPUT (schemaVersion, id,
  // original, notes?, kind, body, profiles?) instead of a later `{...head, ...}` spread appending it
  // at the very END whenever the head omitted it - which would change `JSON.stringify`, and therefore
  // the "h" part's hash, for byte-identical content (caught by the lorebook differential leg,
  // 2026-10-01: the preset leg's own fixture always sends a head `original`, so it never hit this).
  // Every OTHER optional top-level field (`notes`, `profiles`) passes through `clonedHead` untouched,
  // in whatever position the head itself gave it - no re-parse of the whole entity afterward, which
  // would reconstruct every item as a brand-new object (zod's own `z.object` rebuilds every nested
  // value) and break `decompose`'s reuse-by-reference for every UNCHANGED item on every single patch,
  // exactly the whole-entity cost this path exists to avoid paying.
  if (isRecord(clonedHead)) {
    const headRecord = clonedHead;
    const allowedHeadKeys = new Set(["schemaVersion", "id", "original", "notes", "kind", "body", "profiles"]);
    if (Object.keys(headRecord).some((key) => !allowedHeadKeys.has(key))) {
      throw new StudioValidationError("patch head contains an unsupported top-level field");
    }
    const expected = expectedHeadOriginal(cached.parts);
    if (Object.prototype.hasOwnProperty.call(headRecord, "original")) {
      if (!sameProjection(headRecord.original, expected)) {
        throw new StudioValidationError("patch head original must match the stored escrow exactly; escrow changes go through patch.original");
      }
    }
    const callerHead = Object.fromEntries(Object.entries(headRecord).filter(([key]) => key !== "original"));
    assertMediaRefsAuthorized(kind, callerHead, cached.entity);
    try {
      const decoded = decodeAuthorizedBlobsHolding(callerHead, kind, blobs, held) as Record<string, unknown>;
      const hasOriginal = Object.prototype.hasOwnProperty.call(headRecord, "original");
      const entries: [string, unknown][] = [];
      for (const key of Object.keys(headRecord)) {
        if (key === "original") {
          if (expected !== undefined) entries.push([key, expected]);
        } else entries.push([key, decoded[key]]);
        if (key === "id" && expected !== undefined && !hasOriginal) entries.push(["original", expected]);
      }
      const safeHead = Object.fromEntries(entries);
      clonedHead = safeHead;
    } catch {
      throw new StudioValidationError("patch head references an asset not held by this piece or uploaded in this session");
    }
  }

  let head: ParsedCanonicalEntity;
  try {
    head = parseCanonicalEntity(clonedHead);
  } catch {
    throw new StudioValidationError("patch head does not parse as a canonical entity");
  }
  if (head.kind !== kind) throw new StudioValidationError("patch head kind does not match the address");
  if (head.id !== cached.entity.id) throw new StudioValidationError("patch head id does not match the address");

  const kindParts = kindPartsFor(kind);
  if (!kindParts && (patch.items || patch.order)) throw new StudioValidationError(`"${kind}" has no item parts to patch`);

  const cachedItemParts = cached.parts.filter((p) => p.name.startsWith("i/"));
  // `partNames(cached.entity)`, never `cachedItemParts.map(p => p.name)`: a backend's `parts()` row
  // order is not guaranteed to match the item array's own order (no ORDER BY - SQLite's own plan over
  // the live-rows partial index is free to return them in any order), while `cached.entity`'s items
  // are already correctly ordered by `assemble`, which reads the "o" part's own list rather than
  // trusting its input array's order either. Using the raw array here silently scrambled every
  // default-order patch on SQLite (caught by the differential test, 2026-09-30). Computed once, used
  // both to build `next`'s items below and to check what `next` itself implies, afterward.
  const order = patch.order ?? partNames(cached.entity);
  let body = head.body as unknown as Record<string, unknown>;
  if (kindParts) {
    const headItems = body[kindParts.itemsField];
    if (!Array.isArray(headItems) || headItems.length !== 0) {
      throw new StudioValidationError("patch head must carry an empty item array for a split kind");
    }
    if (new Set(order).size !== order.length) throw new StudioValidationError("patch order has a duplicate name");

    let patchItems = patch.items ? (structuredClone(patch.items) as Record<string, unknown>) : undefined;
    if (patchItems) {
      try {
        patchItems = decodeAuthorizedBlobs(patchItems, blobs) as Record<string, unknown>;
      } catch {
        throw new StudioValidationError("patch item references an asset not held by this piece or uploaded in this session");
      }
    }
    const cachedByName = new Map(cachedItemParts.map((p) => [p.name, p.value] as const));
    const orderSet = new Set(order);
    if (patchItems) {
      for (const name of Object.keys(patchItems)) {
        if (!orderSet.has(name)) throw new StudioValidationError(`patch item "${name}" is not named in order`);
      }
    }
    const items = order.map((name) => {
      if (patchItems && Object.prototype.hasOwnProperty.call(patchItems, name)) {
        try {
          return kindParts.itemSchema.parse(patchItems[name]);
        } catch {
          throw new StudioValidationError(`patch item "${name}" failed its schema`);
        }
      }
      if (!cachedByName.has(name)) throw new StudioValidationError(`patch order names an unknown item "${name}"`);
      return cachedByName.get(name);
    });
    body = { ...body, [kindParts.itemsField]: items };
  }

  if (patch.original && Object.prototype.hasOwnProperty.call(patch.original, "vaud-studio")) {
    throw new StudioValidationError("a patch cannot change the vaud-studio stamp");
  }
  let patchOriginal = patch.original ? (structuredClone(patch.original) as Record<string, unknown>) : undefined;
  if (patchOriginal) {
    try {
      patchOriginal = decodeAuthorizedBlobs(patchOriginal, blobs) as Record<string, unknown>;
    } catch {
      throw new StudioValidationError("patch original references an asset not held by this piece or uploaded in this session");
    }
  }
  rejectGenericNativePathEdits(cached.entity.original, patchOriginal);
  const original = authoredOriginal(kind, buildNextOriginal(cached.entity.original, cached.parts, patchOriginal), body, patch.native, blobs);

  // `head` already carries an `original` key in its canonical position whenever one is expected (set
  // on `clonedHead` above, before parsing), so this plain merge reassigns that SAME position rather
  // than appending a new one - every other field (`notes`, `profiles`, `schemaVersion`, `kind`, `id`)
  // passes through in whatever order `head`'s own parse already gave it.
  const entries: [string, unknown][] = [];
  const hasOriginal = Object.prototype.hasOwnProperty.call(head, "original");
  for (const [key, value] of Object.entries(head)) {
    entries.push([key, key === "body" ? body : key === "original" ? original : value]);
    if (key === "id" && original !== undefined && !hasOriginal) entries.push(["original", original]);
  }
  const nextEntity = Object.fromEntries(entries) as unknown as ParsedCanonicalEntity;

  if (kindParts) {
    const recomputed = partNames(nextEntity);
    const matches = recomputed.length === order.length && recomputed.every((n, i) => n === order[i]);
    if (!matches) throw new StudioValidationError("patch order does not match the item names it implies");
  }
  return nextEntity;
}

/**
 * The orchestration `ContentStore.patch` delegates to: revalidate (or reload) the cache against the
 * live row, build and validate the next entity, decompose it with `reuse`, diff against the cached
 * hashes alone, and write. `token` namespaces this store's own entries in the shared piece cache
 * (`piece-cache.ts`'s own docblock on why it is shared).
 */
export async function patchPiece(
  backend: DocumentBackend,
  token: string,
  kindRaw: EntityKind,
  id: string,
  expectedRevision: string,
  patch: PiecePatch,
  uploads: readonly PartBlob[],
  clock: () => number,
  keepVersions: number,
  intent: SaveIntent = "manual",
  coldFill?: (kind: EntityKind, id: string, writeId: number, mode?: "hold") => Promise<{ writeId: number; filled: { entity: ParsedCanonicalEntity; parts: PartRecord[] }; valid(): boolean; release(): void } | { status: "missing" | "stale" }>,
  extensionCommit?: ExtensionCommitContext,
  onCommitted?: (revision: string, change: PartChange) => void,
): Promise<SaveIfUnchangedResult> {
  const kind = kindRaw;
  let coldValid: (() => boolean) | undefined;
  // Asked of the backend FIRST, before the cache is touched at all: a locked library refuses here
  // (every backend method is lock-guarded). That alone does not cover a lock landing mid cold-fill,
  // between `backend.parts()` resolving below and `setCachedPiece` running on its result - `piece-
  // cache.ts`'s own gate (`setPieceCacheGate`, wired by `src/stage/caches.ts`'s `setGate`) is what
  // closes that window, checked at the moment of insert rather than here.
  const row = await backend.get(kind, id);
  if (!row) {
    dropCachedPiece(token, kind, id);
    return { status: "missing" };
  }

  let cached = getCachedPiece(token, kind, id);
  // The monotonic write id changes even when an autosave replaces the active history version.
    if (!cached || cached.writeId !== row.writeId || cached.version !== row.version || cached.revision !== row.revision) {
      // Pictures stay references in the cache ("hold"): a save costs the piece's head, never its pictures.
      const loaded = coldFill ? await coldFill(assertStudioEntityKind(row.kind), row.id, row.writeId, "hold") : await (async () => {
        try { return await holdFill(backend, kind, row, COLD_READ_LIMIT); }
        catch (error) {
          if (error instanceof ColdReadDamageError) throw new StudioReadError(`${kind} ${id} is damaged`, error.reason);
          throw error;
        }
      })();
    try {
      if (loaded && "status" in loaded) {
        dropCachedPiece(token, kind, id);
        const current = await backend.get(kind, id);
        return current ? { status: "stale" } : { status: "missing" };
      }
      if (!loaded || loaded.writeId !== row.writeId || ("valid" in loaded && !loaded.valid())) {
        dropCachedPiece(token, kind, id);
        return (await backend.get(kind, id)) ? { status: "stale" } : { status: "missing" };
      }
      const latest = await backend.get(kind, id);
      if (latest?.writeId !== row.writeId || ("valid" in loaded && !loaded.valid())) {
        dropCachedPiece(token, kind, id);
        return latest ? { status: "stale" } : { status: "missing" };
      }
      const filled = loaded.filled;
      if ("valid" in loaded) coldValid = loaded.valid;
      cached = { writeId: loaded.writeId, version: row.version, revision: row.revision, entity: filled.entity, parts: filled.parts };
      setCachedPiece(token, kind, id, cached);
    } finally {
      if (loaded && "release" in loaded) loaded.release();
    }
  }

  if (cached.revision !== expectedRevision) return { status: "stale" };

  // What this patch may point at without carrying bytes: the piece's own held pictures plus this session's
  // uploads. Each upload is hashed here, so a mislabelled one can never be linked under another picture's name.
  for (const upload of uploads) {
    if (upload.payload.kind === "bytes" && hashHex(upload.payload.bytes) !== upload.key) throw new StudioValidationError("an uploaded asset does not match its hash");
  }
  const known: KnownBlobs = {
    blobs: new Map(cached.parts.flatMap((part) => part.blobs).concat(uploads).map((blob) => [blob.key, blob] as const)),
    held: new Set(cached.parts.flatMap((part) => part.refs ?? [])),
  };
  const next = buildNextEntity(kind, cached, patch, uploads, known); // throws StudioValidationError; nothing written yet

  const parts = decompose(next, cached.parts, known);
  const revision = revisionFromParts(parts);
  const liveHashes = new Map(cached.parts.map((p) => [p.name, p.hash] as const));
  const change = diffAgainst(parts, liveHashes);
  const t = clock();
  if (revision === row.revision) {
    if (coldValid && !coldValid()) return { status: "stale" };
    const current = await backend.get(kind, id);
    if (current?.writeId !== row.writeId || (coldValid && !coldValid())) {
      dropCachedPiece(token, kind, id);
      return current ? { status: "stale" } : { status: "missing" };
    }
    return { status: "saved", summary: contentSummaryOf(row, next, buildSummary(next, (sha) => known.blobs.has(sha) || known.held.has(sha)).content) };
  }
  const coalesce = intent === "autosave" && row.autosaveStartedAt !== null && t >= row.autosaveStartedAt && t - row.autosaveStartedAt < AUTOSAVE_WINDOW_MS;
  const nextVersion = coalesce ? row.version : row.version + 1;
  const autosaveStartedAt = intent === "autosave" ? (coalesce ? row.autosaveStartedAt : t) : null;
  const nextRow = { ...row, revision, version: nextVersion, writeId: row.writeId + 1, autosaveStartedAt, updatedAt: t };

  const summary = buildSummary(next, (sha) => known.blobs.has(sha) || known.held.has(sha));
  const wrote = await backend.write(
    nextRow,
    { kind, id, version: nextVersion, revision, savedAt: t, reason: intent === "autosave" ? "autosave" : "save", autosaveStartedAt },
    { when: "writeId", expected: row.writeId, ...(coldValid ? { valid: coldValid } : {}), ...(extensionCommit ? { extensionCommit } : {}) },
    summary,
    change,
  );
  if (!wrote) {
    // Lost a race (another writer advanced writeId first): the cached base is now stale either
    // way, so it is dropped rather than left to mislead the next attempt.
    dropCachedPiece(token, kind, id);
    return (await backend.get(kind, id)) ? { status: "stale" } : { status: "missing" };
  }
  onCommitted?.(revision, change);
  await backend.pruneVersions(kind, id, keepVersions);
  if (coldValid && !coldValid()) {
    dropCachedPiece(token, kind, id);
    return { status: "saved", summary: contentSummaryOf(nextRow, next, summary.content) };
  }
  setCachedPiece(token, kind, id, { writeId: nextRow.writeId, version: nextVersion, revision, entity: next, parts });
  return { status: "saved", summary: contentSummaryOf(nextRow, next, summary.content) };
}
