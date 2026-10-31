/** Narrow read-only adapter for the canonical Studio CollectionsStore. */
import type { ResourceRef } from "../../contracts/operation";
import type { ExtensionCommitContext } from "../../../stage/contracts/extension-store";
import type { CollectionEdit, PieceRef } from "../../../studio/collections-shape";

export const COLLECTION_READ_FIELDS = ["collection.name", "collection.note", "collection.members"] as const;
export type CollectionReadField = typeof COLLECTION_READ_FIELDS[number];
export interface ExtensionCollectionRow {
  id: string;
  name?: string;
  nameTruncated?: boolean;
  note?: string;
  noteTruncated?: boolean;
  members?: { kind: string; id: string }[];
  memberCount?: number;
  membersTruncated?: boolean;
}
export interface ExtensionCollectionPage {
  collections: readonly ExtensionCollectionRow[];
  total: number;
  nextOffset: number | null;
}
export interface ExtensionCollectionSnapshot { collection: ExtensionCollectionRow | null; revision: number }
export type ExtensionCollectionWriteResult = { status: "saved"; revision: number; id?: string; member?: boolean } | { status: "stale" };
export interface ExtensionCollectionServices {
  list(scope: readonly ResourceRef[], fields: readonly CollectionReadField[], offset: number, limit: number): Promise<ExtensionCollectionPage>;
  readOne(scope: readonly ResourceRef[], id: string, fields: readonly CollectionReadField[]): Promise<ExtensionCollectionSnapshot>;
  previewCreate(name: string, note: string | undefined, expectedRevision: number): Promise<ExtensionCollectionSnapshot & { id: string | null }>;
  create(name: string, note: string | undefined, expectedRevision: number, commit: ExtensionCommitContext): Promise<ExtensionCollectionWriteResult>;
  previewMembership(edit: Extract<CollectionEdit, { action: "add" | "remove" }>, expectedRevision: number): Promise<ExtensionCollectionSnapshot & { member: boolean | null }>;
  membership(edit: Extract<CollectionEdit, { action: "add" | "remove" }>, expectedRevision: number, commit: ExtensionCommitContext): Promise<ExtensionCollectionWriteResult>;
}
