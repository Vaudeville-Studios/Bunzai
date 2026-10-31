/**
 * The studio store: the Studio's view of the library's pieces. Every piece lives in the open library's
 * ContentStore, versioned, with deleting recoverable; this adds what the Studio shows and stamps: the
 * listing details (portrait, accent, source, tags) and the `vaud-studio` escrow stamp. A folder is
 * never read here: folders come in through the import (folder-import.ts) and go out through the
 * export (folder-export.ts). With no library open for the folder, every call refuses as locked.
 */
import { parseCanonicalEntity, type ParsedCanonicalEntity } from "../entities/runtime-schema";
import type { ContentStore, EntityKind, GraveSummary, PartBlob, PiecePatch } from "../stage/contracts/content-store";
import { StudioLockedError, StudioValidationError } from "./errors";
import { libraryContentFor, libraryFor } from "./library-content";
import { assertSafeStudioId, assertStudioEntityKind, STUDIO_ENTITY_KINDS, type StudioEntityKind } from "./path-policy";
import {
  summaryOfListing,
  type CompareCreateResult,
  type CompareSaveResult,
  type DamagedEntry,
  type EntitySummary,
  type StudioInventory,
} from "./store-listing";
import { stampForStudio, studioStampOf } from "./studio-stamp";
import type { ThumbnailSize } from "../stage/store/asset-thumbnails";
export { entityName } from "./summary";
export type { CompareCreateResult, CompareSaveResult, DamagedEntry, EntitySummary, PieceFacts, StudioInventory } from "./store-listing";

type AnyEntity = ParsedCanonicalEntity;

const parseInput = (raw: unknown): { entity: AnyEntity; kind: EntityKind; id: string } => {
  let entity: AnyEntity;
  try {
    entity = parseCanonicalEntity(raw);
  } catch {
    throw new StudioValidationError("invalid canonical entity");
  }
  return { entity, kind: assertStudioEntityKind(entity.kind), id: assertSafeStudioId(entity.id) };
};

const now = (): string => new Date().toISOString();

export class StudioStore {
  constructor(
    private readonly dir: string,
    /** The library holding this folder's pieces, asked on every call; the app's composition root registers it. */
    private readonly contentFor: () => ContentStore | null = () => libraryContentFor(dir),
  ) {}

  /** The open library's pieces, or a refusal: a locked or opening library never shows anything else. */
  private content(): ContentStore {
    const content = this.contentFor();
    if (!content) throw new StudioLockedError();
    return content;
  }

  /** Where this studio lives on disk (About shows it; never used for writes). */
  studioPath(): string {
    return this.dir;
  }

  /** Notify the opened library after committed imports; standalone memory stores have no planner. */
  async importCompleted(pieceCount: number): Promise<void> {
    await libraryFor(this.dir)?.importCompleted?.(pieceCount);
  }

  /**
   * Healthy summaries and fail-closed damage records. Damage is REPORTED rather than skipped: a real
   * studio of 147 presets once listed three and said nothing about the rest.
   */
  /**
   * Reads `content.summaries`, never
   * `content.inventory`, so a piece whose summary is current costs no body open at all. Looped per
   * kind, in `STUDIO_ENTITY_KINDS` order (not `summaries()`'s own alphabetical-by-kind order), so
   * a caller that lists every kind sees the same order it always has.
   */
  async inventory(kind?: string): Promise<StudioInventory> {
    const content = this.content();
    const kinds: StudioEntityKind[] = kind ? [assertStudioEntityKind(kind)] : [...STUDIO_ENTITY_KINDS];
    const entities: EntitySummary[] = [];
    const damaged: DamagedEntry[] = [];
    for (const k of kinds) {
      const held = await content.summaries(k);
      entities.push(...held.entities.map(summaryOfListing));
      damaged.push(...held.damaged);
    }
    return { entities, damaged };
  }

  async list(kind?: string): Promise<EntitySummary[]> {
    return (await this.inventory(kind)).entities;
  }

  /** One current summary for committed journal consumers; never opens the entity body. */
  async summary(kind: string, id: string): Promise<EntitySummary | null> {
    const row = await this.content().summary(assertStudioEntityKind(kind), assertSafeStudioId(id));
    return row ? summaryOfListing(row) : null;
  }

  async read(kind: string, id: string): Promise<AnyEntity | null> {
    return (await this.readVersioned(kind, id))?.entity ?? null;
  }

  /** Light editor read: escrow stays sealed and asset sentinels are paired with stable URLs. */
  async readLight(kind: string, id: string) {
    return this.content().readLight(assertStudioEntityKind(kind), assertSafeStudioId(id));
  }

  /** Scene-turn projection: omits escrow and media bytes, opening only legacy authored-text blobs. */
  async readBody(kind: string, id: string): Promise<unknown | null> {
    return this.content().readBody(assertStudioEntityKind(kind), assertSafeStudioId(id));
  }

  /** Trusted body revision for internal derivations, captured without a complete-entity read. */
  async readBodyVersioned(kind: string, id: string) {
    return this.content().readBodyVersioned(assertStudioEntityKind(kind), assertSafeStudioId(id));
  }

  async readOriginalEntry(kind: string, id: string, format: string): Promise<unknown | null> {
    return this.content().readOriginalEntry(assertStudioEntityKind(kind), assertSafeStudioId(id), format);
  }

  async readOriginalEntryVersioned(kind: string, id: string, format: string) {
    return this.content().readOriginalEntryVersioned(assertStudioEntityKind(kind), assertSafeStudioId(id), format);
  }

  /** Risu asset-list projection with opaque refs; does not rehydrate selected escrow media. */
  async readRisuNamedAssets(kind: string, id: string) {
    return this.content().readRisuNamedAssets(assertStudioEntityKind(kind), assertSafeStudioId(id));
  }

  async readAsset(sha: string, maxBytes: number) {
    return this.content().readAsset(sha, maxBytes);
  }

  async assetSize(sha: string) {
    return this.content().assetSize(sha);
  }

  async readThumbnail(sha: string, size: ThumbnailSize): Promise<Uint8Array> {
    const thumbnails = libraryFor(this.dir)?.thumbnails;
    if (!thumbnails) throw new StudioLockedError();
    return thumbnails.read(sha, size);
  }

  async readPortraitAsset(kind: string, id: string) {
    return this.content().readPortraitAsset(assertStudioEntityKind(kind), assertSafeStudioId(id));
  }

  async readPortraitContent(kind: string, id: string) {
    return this.content().readPortraitContent(assertStudioEntityKind(kind), assertSafeStudioId(id));
  }

  /** A hydrated piece with the stored revision and version from the same read. */
  async readVersioned(kind: string, id: string): Promise<{ entity: AnyEntity; revision: string; version: number } | null> {
    return this.content().read(assertStudioEntityKind(kind), assertSafeStudioId(id));
  }

  /** Moves one piece to the library's Trash; its name is free at once. True when something was live. */
  async delete(kindRaw: string, idRaw: string, expectedRevision?: string): Promise<boolean> {
    return this.content().delete(assertStudioEntityKind(kindRaw), assertSafeStudioId(idRaw), expectedRevision);
  }

  async deleteWithReceipt(kindRaw: string, idRaw: string) {
    return this.content().deleteWithReceipt(assertStudioEntityKind(kindRaw), assertSafeStudioId(idRaw));
  }

  /** The Trash, newest first: summary-derived (step 3.3), never opening a buried body. */
  async graveyard(kind?: string): Promise<GraveSummary[]> {
    return this.content().graveSummaries(kind === undefined ? undefined : assertStudioEntityKind(kind));
  }

  /** The id a new piece asking for this one would get: never a live id, never a deleted one. */
  async freeId(kind: string, id: string): Promise<string> {
    return this.content().freeId(assertStudioEntityKind(kind), assertSafeStudioId(id));
  }

  /** Brings a piece back from the Trash, always under its own id: deleted ids are never reused. */
  async restore(graveId: string): Promise<EntitySummary | null> {
    const back = await this.content().restore(graveId);
    return back ? summaryOfListing(back) : null;
  }

  /** Keep-both unless `overwrite`: a taken id saves beside it as `<id>-2`, `<id>-3`, and so on. */
  async save(raw: unknown, opts?: { overwrite?: boolean }): Promise<EntitySummary> {
    const content = this.content();
    const { entity, kind, id } = parseInput(raw);
    const prior = opts?.overwrite ? studioStampOf((await content.read(kind, id).catch(() => null))?.entity) : {};
    const stamped = stampForStudio({ ...entity, id }, prior, now());
    const saved = await content.save(stamped.entity, opts);
    return summaryOfListing(saved);
  }

  /**
   * A keep-both copy made by reference (`ContentStore.duplicate`), so a pack of any picture weight is never
   * opened whole. The copy is stamped as a fresh arrival that keeps the source's accent. Null when absent.
   */
  async duplicate(kindRaw: string, idRaw: string): Promise<EntitySummary | null> {
    const kind = assertStudioEntityKind(kindRaw);
    const id = assertSafeStudioId(idRaw);
    const saved = await this.content().duplicate(kind, id, (entity) => {
      const accent = studioStampOf(entity)["accent"];
      const made = stampForStudio(entity, typeof accent === "string" ? { accent } : {}, now());
      return made.entity;
    });
    return saved ? summaryOfListing(saved) : null;
  }

  /** Create one entity at its exact requested id only when no live piece holds it. */
  async compareAndCreate(raw: unknown): Promise<CompareCreateResult> {
    const { entity } = parseInput(raw);
    const stamped = stampForStudio(entity, {}, now());
    const made = await this.content().create(stamped.entity);
    if (made.status === "exists") return { status: "exists" };
    return {
      status: "saved",
      summary: summaryOfListing(made.summary),
    };
  }

  /** Replace one existing entity only when its complete canonical revision still matches. */
  async compareAndSave(raw: unknown, expectedRevision: string): Promise<CompareSaveResult> {
    const content = this.content();
    const { entity, kind, id } = parseInput(raw);
    const current = await content.read(kind, id);
    if (!current) return { status: "missing" };
    // Checked here as well as in the store, so a stale editor never has its stamp computed against a
    // body it did not see; the store's own check is the one that holds under a race.
    if (current.revision !== expectedRevision) return { status: "stale" };
    const stamped = stampForStudio(entity, studioStampOf(current.entity), now());
    const result = await content.saveIfUnchanged(stamped.entity, expectedRevision);
    if (result.status !== "saved") return { status: result.status };
    return {
      status: "saved",
      summary: summaryOfListing(result.summary),
      revision: result.summary.revision,
    };
  }

  /**
   * Send-only-what-changed save: no whole-entity read or new studio stamp. The result carries the
   * exact listing snapshot the ContentStore committed, including the preserved studio stamp.
   */
  async comparePatch(kindRaw: string, idRaw: string, expectedRevision: string, patch: PiecePatch, uploads: readonly PartBlob[] = [], intent: import("../stage/contracts/content-store").SaveIntent = "manual", extensionCommit?: import("../stage/contracts/extension-store").ExtensionCommitContext): Promise<CompareSaveResult> {
    const kind = assertStudioEntityKind(kindRaw);
    const id = assertSafeStudioId(idRaw);
    const result = extensionCommit
      ? await this.content().patchWithCommit(kind, id, expectedRevision, patch, uploads, intent, extensionCommit)
      : await this.content().patch(kind, id, expectedRevision, patch, uploads, intent);
    if (result.status !== "saved") return { status: result.status };
    return {
      status: "saved",
      summary: summaryOfListing(result.summary),
      revision: result.summary.revision,
    };
  }
}
