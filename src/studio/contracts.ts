/**
 * Structural store contracts - what the server handler actually needs from storage. The handler
 * types on these (never the concrete classes) so any backend that satisfies them can host the
 * studio: fs-backed on desktop/CLI, memory-backed on static Pages, or OPFS-backed by a future
 * persistent browser host. The classes satisfy these
 * structurally; no implements clause, no import cycle.
 */
import type { ParsedCanonicalEntity } from "../entities/runtime-schema";
import type { AssetLookup, AssetSize, GraveSummary, LightStoredEntity, StoredBody, StoredOriginalEntry, StoredPortraitAsset, StoredPortraitContent, StoredRisuNamedAssets, PartBlob, PiecePatch, SaveIntent } from "../stage/contracts/content-store";
import type { ExtensionCommitContext } from "../stage/contracts/extension-store";
import type { CompareCreateResult, CompareSaveResult, EntitySummary, StudioInventory } from "./store";
import type { StudioSettings } from "./settings-shape";
import type { ThumbnailSize } from "../stage/store/asset-thumbnails";

export interface StudioStoreLike {
  studioPath(): string;
  summary?(kind: string, id: string): Promise<EntitySummary | null>;
  inventory(kind?: string): Promise<StudioInventory>;
  list(kind?: string): Promise<EntitySummary[]>;
  read(kind: string, id: string): Promise<ParsedCanonicalEntity | null>;
  readLight?(kind: string, id: string): Promise<LightStoredEntity | null>;
  readBody?(kind: string, id: string): Promise<unknown | null>;
  readBodyVersioned?(kind: string, id: string): Promise<StoredBody | null>;
  readOriginalEntry?(kind: string, id: string, format: string): Promise<unknown | null>;
  readOriginalEntryVersioned?(kind: string, id: string, format: string): Promise<StoredOriginalEntry | null>;
  readRisuNamedAssets?(kind: string, id: string): Promise<StoredRisuNamedAssets | null>;
  readAsset?(sha: string, maxBytes: number): Promise<AssetLookup>;
  assetSize?(sha: string): Promise<AssetSize>;
  readThumbnail?(sha: string, size: ThumbnailSize): Promise<Uint8Array>;
  readPortraitAsset?(kind: string, id: string): Promise<StoredPortraitAsset | null>;
  readPortraitContent?(kind: string, id: string): Promise<StoredPortraitContent | null>;
  importCompleted?(pieceCount: number): Promise<void>;
  /** A hydrated piece with its stored revision and library version, which a chat freezes as its cast. */
  readVersioned(kind: string, id: string): Promise<{ entity: ParsedCanonicalEntity; revision: string; version: number } | null>;
  delete(kind: string, id: string, expectedRevision?: string): Promise<boolean>;
  deleteWithReceipt?(kind: string, id: string): Promise<Omit<import("../stage/contracts/content-store").PieceChangeEvent, "sequence"> | null>;
  /** The Trash, newest first. */
  graveyard(): Promise<GraveSummary[]>;
  /** Brings a piece back under its own id; null once the Trash has let it go. */
  restore(graveId: string): Promise<EntitySummary | null>;
  save(raw: unknown, opts?: { overwrite?: boolean }): Promise<EntitySummary>;
  compareAndCreate?(raw: unknown): Promise<CompareCreateResult>;
  /** A keep-both copy made by reference, never opening the piece whole; null when it is not there. */
  duplicate?(kind: string, id: string): Promise<EntitySummary | null>;
  compareAndSave(raw: unknown, expectedRevision: string): Promise<CompareSaveResult>;
  comparePatch?(kind: string, id: string, expectedRevision: string, patch: PiecePatch, uploads?: readonly PartBlob[], intent?: SaveIntent, extensionCommit?: ExtensionCommitContext): Promise<CompareSaveResult>;
}

export interface SettingsStoreLike {
  read(): Promise<StudioSettings>;
  save(raw: unknown): Promise<StudioSettings>;
  update(raw: unknown): Promise<StudioSettings>;
}
