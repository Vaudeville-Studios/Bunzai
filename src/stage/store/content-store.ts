/**
 * createContentStore: the one ContentStore implementation. It owns
 * every rule - validation, safe ids, keep-both, versions, the graveyard - over any DocumentBackend,
 * which only stores opaque rows and parts. This is the interface module D18 allows to import entity
 * code. Since migration 18 a piece's
 * body lives in named part rows, not one `body_json` cell: every read assembles it from
 * `backend.parts()`, and every write's part diff is `content-store-write.ts`'s job, kept there to
 * hold this file under the line cap.
 */
import type { ParsedCanonicalEntity } from "../../entities/runtime-schema";
import { normalizeAuthoredSentinelLiterals } from "../../entities/piece-parts-blob";
import { StudioConflictError, StudioReadError, StudioValidationError, StudioNotFoundError } from "../../studio/errors";

import { assertSafeStudioId, assertStudioEntityKind } from "../../studio/path-policy";
import { entityName } from "../../studio/summary";
import { compareDocumentOrder } from "../contracts/document-order";
import { toErrorMessage } from "../../error-message";
import type {
  ContentStore,
  ContentSummary,
  DamagedDocument,
  DocumentBackend,
  DocumentRow,
  EntityKind,
  GraveSummary,
  PieceSummary,
  SaveReason,
} from "../contracts/content-store";
import { DamagedDataError } from "../damaged-data-error";
import { breather } from "./breather";
import { contentSummaryOf, decode, decomposeEntity, diffWrite, freshWrite } from "./content-store-write";
import { readStoredVersion, restoreStoredVersion } from "./content-store-history";
import { readStoredVersionHeld } from "./content-store-history-held";
import { patchPiece } from "./content-store-patch";
import { duplicateHeld, readHeldPiece } from "./content-store-copy";
import { readLight, readOriginalEntry, readOriginalEntryVersioned, readRisuNamedAssets } from "./content-store-light";
import { newPieceCacheToken } from "./piece-cache";
import { assetReaders } from "./content-store-assets";
import { buildSummary, DERIVED_VERSION, summaryContentOf } from "./summary-content";
import { rebuildSummaries, type RebuildProgress } from "./summary-rebuild";
import { computeSummaryFor, decodeStableLive } from "./content-store-stable-read";
export { computeSummaryFor } from "./content-store-stable-read";
import { readContentEntity, type ColdFillResult } from "./content-store-read";
import { contentAddress as addr, parseContentInput as parseInput } from "./content-store-address";
import { contentInvalidationRoots, createContentChangePublisher } from "./content-store-events";
import { parseSummaryContent } from "./content-store-summary";

/** A buried piece's display name, or undefined when its body cannot be opened: a damaged part cell
 * lists the grave by its id instead of throwing the whole Trash away (rule 25). Other errors still throw. */
async function graveName(backend: DocumentBackend, kind: EntityKind, id: string, version: number): Promise<string | undefined> {
  try {
    const parts = await backend.parts(kind, id, version);
    const decoded = parts ? decode(kind, id, parts) : null;
    return decoded?.ok ? entityName(decoded.entity) : undefined;
  } catch (error) {
    if (error instanceof DamagedDataError) return undefined;
    throw error;
  }
}

/** Spec edge case 2: keep-both probes `<id>-2` through `<id>-999`, then gives up. */
const LAST_KEEP_BOTH_SUFFIX = 999;
/** An overwrite that keeps losing races to other writers stops instead of spinning. */
const MAX_WRITE_ATTEMPTS = 5;

/** How many versions of each entity are kept when nothing says otherwise (spec edge case 9). */
export const DEFAULT_KEEP_VERSIONS = 25;

export function createContentStore(
  backend: DocumentBackend,
  clock: () => number = Date.now,
  options: {
    keepVersions?: number;
    /** Told when a save changes nothing: the caller skipped its dirty check (isDirty). */
    onUnchangedSave?: (kind: string, id: string) => void;
    /**
     * D2's one-time rebuild, doubling as the repair tool: fired once here, fire-and-forget, over the
     * same backend this store writes through. It only touches rows whose summary is missing or
     * stamped with an older DERIVED_VERSION (rebuildSummaries' own filter), so opening a store whose
     * summaries are already current costs one query and nothing more. Never awaited by any store
     * method and never blocks the caller that built this store: it yields every row (breather) and
     * reports through `onProgress`, the same shape the app already polls elsewhere for background
     * work ('s keyring cleanup, ui/library-root.ts's LibraryPhase).
     */
    rebuildOnStart?: { onProgress?: (progress: RebuildProgress) => void };
    coldFill?: (kind: EntityKind, id: string, writeId: number, mode?: "hold") => Promise<ColdFillResult>;
  } = {},
): ContentStore {
  const changes = createContentChangePublisher();
  const publishChange = changes.publish;
  const keepVersions = options.keepVersions ?? DEFAULT_KEEP_VERSIONS;
  // One private namespace in the shared piece cache (piece-cache.ts's own docblock on why it is
  // shared, not an instance per store): this store's own patches never collide with another store's,
  // even over the same database.
  const pieceCacheToken = newPieceCacheToken();
  const unchangedSave =
    options.onUnchangedSave ??
    ((kind: string, id: string) => console.warn(`library: a save of ${kind} "${id}" changed nothing; its caller should have checked first`));
  if (typeof keepVersions !== "number" || !Number.isSafeInteger(keepVersions) || keepVersions < 1) {
    throw new StudioValidationError("keepVersions must be a whole number of at least 1");
  }

  if (options.rebuildOnStart) {
    void rebuildSummaries(backend, DERIVED_VERSION, computeSummaryFor(backend), options.rebuildOnStart.onProgress).catch((error: unknown) => {
      console.error("library: the summary rebuild failed:", toErrorMessage(error));
    });
  }

  /** A brand-new entity at exactly this id, only if no live entity holds it (graves never do). */
  async function writeFresh(entity: ParsedCanonicalEntity, kind: EntityKind, id: string, extensionCommit?: import("../contracts/extension-store").ExtensionCommitContext): Promise<ContentSummary | null> {
    const built = freshWrite(entity, kind, id, clock(), "create");
    const summary = buildSummary(built.entity);
    const wrote = await backend.write(built.row, built.version, { when: "absent", ...(extensionCommit ? { extensionCommit } : {}) }, summary, built.change);
    if (wrote) publishChange({ kind, id, revision: built.row.revision, action: "upsert", invalidations: contentInvalidationRoots(built.change), ...(extensionCommit ? { originPackageId: extensionCommit.packageId } : {}) });
    return wrote ? contentSummaryOf(built.row, built.entity, summary.content) : null;
  }

  /**
   * The next version of a live row. An unchanged body appends nothing, returns the current summary
   * (spec behavior 8), and is reported: writers check isDirty first, so reaching this is a bug. The
   * revision compare runs on a bare decompose, before any backend call, so a no-op save never fetches
   * the live parts it has nothing to diff against. The write itself is conditional on the row still
   * having the monotonic write id just read, so a racing delete or writer makes it return null rather
   * than resurrecting a grave or claiming someone else's history version.
   */
  async function writeNext(current: DocumentRow, entity: ParsedCanonicalEntity, reason: SaveReason, extensionCommit?: import("../contracts/extension-store").ExtensionCommitContext): Promise<ContentSummary | null> {
    const { parts, revision } = decomposeEntity(entity);
    if (revision === current.revision) {
      if ((await backend.get(current.kind, current.id))?.writeId !== current.writeId) return null;
      unchangedSave(current.kind, current.id);
      return contentSummaryOf(current, entity);
    }
    const t = clock();
    const built = await diffWrite(backend, current, entity, parts, revision, reason, t);
    const summary = buildSummary(built.entity);
    const wrote = await backend.write(
      built.row,
      built.version,
      { when: "writeId", expected: current.writeId, ...(extensionCommit ? { extensionCommit } : {}) },
      summary,
      built.change,
    );
    if (!wrote) return null;
    publishChange({ kind: current.kind as EntityKind, id: current.id, revision: built.row.revision, action: "upsert", invalidations: contentInvalidationRoots(built.change), ...(extensionCommit ? { originPackageId: extensionCommit.packageId } : {}) });
    // After the write, not inside it: a crash in between only leaves extra versions, never fewer.
    await backend.pruneVersions(current.kind, current.id, keepVersions);
    return contentSummaryOf(built.row, built.entity, summary.content);
  }

  const liveRow = (kind: string, id: string): Promise<DocumentRow | null> => backend.get(kind, id);

  async function keepBoth(entity: ParsedCanonicalEntity, kind: EntityKind, id: string): Promise<ContentSummary> {
    const exact = await writeFresh(entity, kind, id);
    if (exact) return exact;
    for (let n = 2; n <= LAST_KEEP_BOTH_SUFFIX; n++) {
      const candidate = assertSafeStudioId(`${id}-${n}`);
      const saved = await writeFresh(entity, kind, candidate);
      if (saved) return saved;
    }
    throw new StudioValidationError("no free id left for keep-both");
  }

  async function overwrite(entity: ParsedCanonicalEntity, kind: EntityKind, id: string): Promise<ContentSummary> {
    for (let attempt = 0; attempt < MAX_WRITE_ATTEMPTS; attempt++) {
      const current = await backend.get(kind, id);
      if (current === null) {
        const fresh = await writeFresh(entity, kind, id);
        if (fresh) return fresh;
        // A retired id's piece was deleted. Overwriting it is saving onto something that is gone:
        // refused, never turned into a silent copy the caller would not find under this id.
        if (await backend.isRetired(kind, id)) throw new StudioNotFoundError(`${kind} "${id}" was deleted`);
        continue; // created by someone else between our read and write; read again
      }
      const next = await writeNext(current, entity, "save");
      if (next) return next;
    }
    throw new StudioConflictError();
  }

  const store: ContentStore = {
    subscribeChanges(listener) {
      return changes.subscribe(listener);
    },
    ...assetReaders(backend, liveRow, addr),
    async summary(kindRaw, idRaw) {
      const { kind, id } = addr(kindRaw, idRaw);
      for (let attempt = 0; attempt < 3; attempt++) {
        const found = await backend.summary(kind, id);
        if (!found) return null;
        const content = found.row.derivedVersion === DERIVED_VERSION && found.row.revision === found.row.liveRevision
          ? parseSummaryContent(found.row.summary)
          : null;
        if (content) return { id, kind, revision: found.row.liveRevision, version: found.row.version, writeId: found.row.writeId, updatedAt: found.row.updatedAt, ...content };
        const doc = await backend.get(kind, id);
        if (!doc) return null;
        const stable = await decodeStableLive(backend, doc);
        if (!stable) continue;
        if (!stable.decoded.ok) throw new StudioReadError(`${kind} ${id} is damaged`, stable.decoded.reason);
        return {
          id,
          kind,
          revision: stable.row.revision,
          version: stable.row.version,
          writeId: stable.row.writeId,
          updatedAt: stable.row.updatedAt,
          ...summaryContentOf(stable.decoded.entity),
        };
      }
      throw new StudioConflictError(`${kind} ${id} changed repeatedly while opening its summary`);
    },

    async list(kind) {
      return (await store.inventory(kind)).entities;
    },

    async inventory(kind) {
      const only = kind === undefined ? undefined : assertStudioEntityKind(kind);
      const { rows, quarantined } = await backend.list(only);
      const entities: ContentSummary[] = [];
      // Quarantined rows first (ChatStore rule 25): their own identity cell never opened, so there is
      // no real id to report them under - only the opaque key the row itself is stored at.
      const damaged: DamagedDocument[] = quarantined.map((q) => ({ kind: q.kind, id: q.key, reason: "id-unreadable" }));
      const breathe = breather();
      for (const row of rows) {
        await breathe();
        const stable = await decodeStableLive(backend, row);
        if (stable?.decoded.ok) entities.push(contentSummaryOf(stable.row, stable.decoded.entity));
        else if (stable && !stable.decoded.ok) damaged.push({ kind: stable.row.kind, id: stable.row.id, reason: stable.decoded.reason });
        // decoded === null (a race that buried the row mid-listing): left out silently, the same as
        // list()/inventory() already treat a row that vanished between the initial read and now.
      }
      return { entities: entities.sort(compareDocumentOrder), damaged: damaged.sort(compareDocumentOrder) };
    },

    /**
     * Plan R5 step 3.3: `StudioStore.inventory`/`list` read this, never `inventory` above, so a
     * row whose summary is current costs no body open. Live version and write identity are joined
     * into the same paged listing, so a concurrent save cannot pair a summary with another row.
     */
    async summaries(kind) {
      const only = kind === undefined ? undefined : assertStudioEntityKind(kind);
      const summaries = await backend.summaries(only);
      const entities: PieceSummary[] = [];
      // Quarantined identity rows (rule 25) are reported by their opaque key.
      const quarantinedKeys = new Set(summaries.quarantined.map((q) => `${q.kind}\u0000${q.key}`));
      const damaged: DamagedDocument[] = [...quarantinedKeys].map((k) => {
        const [qKind, key] = k.split("\u0000") as [string, string];
        return { kind: qKind, id: key, reason: "id-unreadable" as const };
      });
      const breathe = breather();
      for (const row of summaries.rows) {
        await breathe();
        const current = row.derivedVersion === DERIVED_VERSION ? parseSummaryContent(row.summary) : null;
        if (current && row.revision === row.liveRevision) {
          entities.push({ id: row.id, kind: row.kind as EntityKind, revision: row.liveRevision, version: row.version, writeId: row.writeId, updatedAt: row.updatedAt, ...current });
          continue;
        }
        // Missing, stale, or unparsable: computed fresh for this one row alone (the D2 rebuild owes
        // it a stamp, but correctness here never waits on that finishing).
        const doc = await backend.get(row.kind, row.id);
        if (!doc) continue;
        const stable = await decodeStableLive(backend, doc);
        if (!stable) continue;
        if (!stable.decoded.ok) {
          damaged.push({ kind: stable.row.kind, id: stable.row.id, reason: stable.decoded.reason });
          continue;
        }
        entities.push({
          id: stable.row.id,
          kind: stable.row.kind as EntityKind,
          revision: stable.row.revision,
          version: stable.row.version,
          writeId: stable.row.writeId,
          updatedAt: stable.row.updatedAt,
          ...summaryContentOf(stable.decoded.entity),
        });
      }
      return { entities: entities.sort(compareDocumentOrder), damaged: damaged.sort(compareDocumentOrder) };
    },

    /**
     * The Trash, summary-derived: same fallback rule as `summaries`, reading only a name from a grave.
     * A quarantined grave (rule 25: its own identity cell failed to open) is left out, never thrown
     * out of the whole listing - the same "one bad row never hides the healthy ones" promise `list`
     * and `summaries` already keep, though unlike those two this has no `damaged` channel of its own
     * yet to report it through (names this as the remaining gap).
     */
    async graveSummaries(kind) {
      const only = kind === undefined ? undefined : assertStudioEntityKind(kind);
      const graves: GraveSummary[] = [];
      const breathe = breather();
      const { rows } = await backend.graveSummaries(only);
      for (const row of rows) {
        await breathe();
        const current = row.derivedVersion === DERIVED_VERSION ? parseSummaryContent(row.summary) : null;
        let name = current?.name;
        if (name === undefined) {
          const grave = await backend.grave(row.graveId);
          if (grave) name = await graveName(backend, grave.kind as EntityKind, grave.id, grave.version);
        }
        graves.push({ graveId: row.graveId, id: row.id, kind: row.kind as EntityKind, name: name ?? row.id, deletedAt: row.deletedAt });
      }
      return graves.sort((a, b) => b.deletedAt - a.deletedAt || compareDocumentOrder(a, b));
    },

    async read(kindRaw, idRaw) {
      const { kind, id } = addr(kindRaw, idRaw);
      return readContentEntity(backend, liveRow, kind, id, options.coldFill);
    },

    async readLight(kindRaw, idRaw) {
      const { kind, id } = addr(kindRaw, idRaw);
      return readLight(backend, liveRow, kind, id);
    },

    async readBody(kindRaw, idRaw) {
      return (await this.readBodyVersioned(kindRaw, idRaw))?.body ?? null;
    },

    async readBodyVersioned(kindRaw, idRaw) {
      const light = await this.readLight(kindRaw, idRaw);
      if (!light) return null;
      return { body: normalizeAuthoredSentinelLiterals((light.entity as ParsedCanonicalEntity).body), revision: light.revision, version: light.version };
    },

    async readOriginalEntry(kindRaw, idRaw, format) {
      const { kind, id } = addr(kindRaw, idRaw);
      return readOriginalEntry(backend, liveRow, kind, id, format);
    },

    async readOriginalEntryVersioned(kindRaw, idRaw, format) {
      const { kind, id } = addr(kindRaw, idRaw);
      return readOriginalEntryVersioned(backend, liveRow, kind, id, format);
    },

    async readRisuNamedAssets(kindRaw, idRaw) {
      const { kind, id } = addr(kindRaw, idRaw);
      return readRisuNamedAssets(backend, liveRow, kind, id);
    },

    async create(raw, extensionCommit) {
      const { entity, kind, id } = parseInput(raw);
      const summary = await writeFresh(entity, kind, id, extensionCommit);
      return summary ? { status: "saved", summary } : { status: "exists" };
    },

    async save(raw, opts) {
      const { entity, kind, id } = parseInput(raw);
      return opts?.overwrite ? overwrite(entity, kind, id) : keepBoth(entity, kind, id);
    },

    async readHeld(kindRaw, idRaw) {
      const { kind, id } = addr(kindRaw, idRaw);
      return readHeldPiece(backend, kind, id, options.coldFill);
    },

    async duplicate(kindRaw, idRaw, transform = (entity) => entity, extensionCommit) {
      const { kind, id } = addr(kindRaw, idRaw);
      const result = await duplicateHeld(backend, kind, id, transform, clock, options.coldFill, extensionCommit);
      if (result) publishChange({ kind, id: result.id, revision: result.revision, action: "upsert", invalidations: ["body"], ...(extensionCommit ? { originPackageId: extensionCommit.packageId } : {}) });
      return result;
    },

    async saveIfUnchanged(raw, expectedRevision, extensionCommit) {
      const { entity, kind, id } = parseInput(raw);
      const current = await liveRow(kind, id);
      if (!current) return { status: "missing" };
      if (current.revision !== expectedRevision) return { status: "stale" };
      const summary = await writeNext(current, entity, "save", extensionCommit);
      if (summary) return { status: "saved", summary };
      // Lost a race. Never retried: report what the caller now needs to know.
      return (await liveRow(kind, id)) ? { status: "stale" } : { status: "missing" };
    },

    async patch(kindRaw, idRaw, expectedRevision, patch, uploads = [], intent = "manual") {
      const { kind, id } = addr(kindRaw, idRaw);
      return patchPiece(backend, pieceCacheToken, kind, id, expectedRevision, patch, uploads, clock, keepVersions, intent, options.coldFill, undefined,
        (revision, change) => publishChange({ kind, id, revision, action: "upsert", invalidations: contentInvalidationRoots(change) }));
    },

    async patchWithCommit(kindRaw, idRaw, expectedRevision, patch, uploads, intent, extensionCommit) {
      const { kind, id } = addr(kindRaw, idRaw);
      return patchPiece(backend, pieceCacheToken, kind, id, expectedRevision, patch, uploads, clock, keepVersions, intent, options.coldFill, extensionCommit,
        (revision, change) => publishChange({ kind, id, revision, action: "upsert", invalidations: contentInvalidationRoots(change), originPackageId: extensionCommit.packageId }));
    },

    async delete(kindRaw, idRaw, expectedRevision) {
      return Boolean(await store.deleteWithReceipt(kindRaw, idRaw, expectedRevision));
    },

    async deleteWithReceipt(kindRaw, idRaw, expectedRevision, extensionCommit) {
      const { kind, id } = addr(kindRaw, idRaw);
      const receipts: Omit<import("../contracts/content-store").PieceChangeEvent, "sequence">[] = [];
      const deleted = await backend.bury(kind, id, crypto.randomUUID(), clock(), (committed) => { receipts.push(committed); }, expectedRevision, extensionCommit);
      const receipt = receipts[0] ?? null;
      if (deleted && receipt) publishChange({ kind, id, revision: receipt.revision ?? "", action: "delete", invalidations: ["*"], ...(extensionCommit ? { originPackageId: extensionCommit.packageId } : {}) });
      return deleted ? receipt : null;
    },

    /** A quarantined grave (rule 25) is left out, same as `graveSummaries` above: one damaged row must
     * never hide the rest of the Trash. */
    async graveyard(kind) {
      const only = kind === undefined ? undefined : assertStudioEntityKind(kind);
      const graves: GraveSummary[] = [];
      const breathe = breather();
      const { rows } = await backend.graves(only);
      for (const row of rows) {
        await breathe();
        const name = await graveName(backend, row.kind as EntityKind, row.id, row.version);
        graves.push({
          graveId: row.graveId,
          id: row.id,
          kind: row.kind as EntityKind,
          name: name ?? row.id,
          deletedAt: row.deletedAt,
        });
      }
      return graves.sort((a, b) => b.deletedAt - a.deletedAt || compareDocumentOrder(a, b));
    },

    async restore(graveId, extensionCommit) {
      if (typeof graveId !== "string" || graveId === "") throw new StudioValidationError("restore needs a grave id");
      const grave = await backend.grave(graveId);
      if (!grave) return null;
      const parts = await backend.parts(grave.kind, grave.id, grave.version);
      // A race (a purge landing between the two reads above) can empty this rather than return null:
      // purgeBefore deletes a grave's parts and the grave row in one transaction, so "no parts at
      // all" here means "gone", exactly like `!grave` above - never damage.
      if (!parts || parts.length === 0) return null;
      const decoded = decode(grave.kind, grave.id, parts);
      if (!decoded.ok) throw new StudioReadError(`grave ${graveId} is damaged`, decoded.reason);
      const { graveId: _g, deletedAt: _d, ...own } = grave;
      // Always home, with its whole history: its id is retired, so nothing else can hold it. False
      // only when a purge removed the grave since the read.
      if (!(await backend.unbury(graveId, extensionCommit))) return null;
      const restored = contentSummaryOf({ ...own, writeId: own.writeId + 1 }, decoded.entity);
      publishChange({ kind: own.kind as EntityKind, id: own.id, revision: restored.revision, action: "upsert", invalidations: ["body"], ...(extensionCommit ? { originPackageId: extensionCommit.packageId } : {}) });
      return restored;
    },

    async freeId(kindRaw, idRaw) {
      const { kind, id } = addr(kindRaw, idRaw);
      const free = async (candidate: string) => !(await backend.get(kind, candidate)) && !(await backend.isRetired(kind, candidate));
      if (await free(id)) return id;
      for (let n = 2; n <= LAST_KEEP_BOTH_SUFFIX; n++) {
        const candidate = assertSafeStudioId(`${id}-${n}`);
        if (await free(candidate)) return candidate;
      }
      throw new StudioValidationError("no free id left");
    },

    async purge(before) {
      // Purge cannot be undone, and a backend compares loosely (NaN matches nothing, a string
      // coerces), so only a real time reaches it.
      if (typeof before !== "number" || !Number.isFinite(before)) {
        throw new StudioValidationError("purge cutoff must be a finite time");
      }
      return backend.purgeBefore(before);
    },

    async versions(kindRaw, idRaw) {
      const { kind, id } = addr(kindRaw, idRaw);
      // A version whose own revision cell is quarantined (ChatStore rule 25) is reported, not
      // silently dropped: malformed input turning into empty success is exactly the failure rule 25
      // exists to rule out for a LIST read (a single version, by contrast, still throws out of
      // `readVersion` below - there is nothing to quarantine it beside).
      for (let attempt = 0; attempt < 3; attempt++) {
        const row = await liveRow(kind, id);
        if (!row) return { versions: [], quarantined: [] };
        const result = await backend.versions(kind, id);
        if ((await liveRow(kind, id))?.writeId !== row.writeId) continue;
        return { versions: result.rows.map(({ version, revision, savedAt, reason }) => ({ version, revision, savedAt, reason })), quarantined: result.quarantined };
      }
      throw new StudioConflictError(`${kind} ${id} changed repeatedly while listing history`);
    },

    async readVersion(kindRaw, idRaw, version) {
      const { kind, id } = addr(kindRaw, idRaw);
      return readStoredVersion(backend, kind, id, version);
    },

    async readVersionHeld(kindRaw, idRaw, version) {
      const { kind, id } = addr(kindRaw, idRaw);
      return readStoredVersionHeld(backend, kind, id, version);
    },

    async restoreVersion(kindRaw, idRaw, version) {
      const { kind, id } = addr(kindRaw, idRaw);
      const prior = await backend.get(kind, id);
      const result = await restoreStoredVersion(backend, kind, id, version, keepVersions, clock);
      if (result && prior?.revision !== result.revision) publishChange({ kind, id, revision: result.revision, action: "upsert", invalidations: ["body"] });
      return result;
    },
  };

  return store;
}
