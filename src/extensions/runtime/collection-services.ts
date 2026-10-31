/** Projects only collections authorized by exact collection IDs or an explicit library-wide grant. */
import type { CollectionsStore } from "../../studio/collections";
import type { CollectionReadField, ExtensionCollectionPage, ExtensionCollectionServices, ExtensionCollectionRow } from "../operations/collections/_services";
import type { ResourceRef } from "../contracts/operation";
import { addToCollection, createCollection, parseCollections, removeFromCollection, type Collection, type CollectionEdit, type CollectionsFile } from "../../studio/collections-shape";
import type { ExtensionCommitContext } from "../../stage/contracts/extension-store";
import type { StateStore } from "../../stage/contracts/state-store";

const LIBRARY = (ref: ResourceRef): boolean => ref.kind === "library" && ref.id === "library";
const MEMBER_LIMIT = 8;
const NAME_LIMIT = 200;
const NOTE_LIMIT = 1_000;
type Store = Pick<CollectionsStore, "read" | "readVersioned" | "editIfUnchanged">;

function project(item: Collection | undefined, fields: readonly CollectionReadField[]): ExtensionCollectionRow | null {
  if (!item) return null;
  return {
    id: item.id,
    ...(fields.includes("collection.name") ? { name: item.name.slice(0, NAME_LIMIT), ...(item.name.length > NAME_LIMIT ? { nameTruncated: true } : {}) } : {}),
    ...(fields.includes("collection.note") && item.note !== undefined ? { note: item.note.slice(0, NOTE_LIMIT), ...(item.note.length > NOTE_LIMIT ? { noteTruncated: true } : {}) } : {}),
    ...(fields.includes("collection.members") ? {
      members: item.members.slice(0, MEMBER_LIMIT).filter((member) => member.kind.length <= 120 && member.id.length <= 120).map(({ kind, id }) => ({ kind, id })),
      memberCount: item.members.length,
      membersTruncated: item.members.length > MEMBER_LIMIT || item.members.some((member) => member.kind.length > 120 || member.id.length > 120),
    } : {}),
  };
}
const collectionInScope = (scope: readonly ResourceRef[], id: string): boolean => scope.some((ref) => LIBRARY(ref) || ref.kind === "collection" && ref.id === id);
function editFor(file: CollectionsFile, edit: Extract<CollectionEdit, { action: "add" | "remove" }>): { file: CollectionsFile; member: boolean } {
  const current = file.collections.find((item) => item.id === edit.id);
  if (!current) return { file, member: false };
  const member = current.members.some((item) => item.kind === edit.ref.kind && item.id === edit.ref.id);
  return { file: edit.action === "add" ? addToCollection(file, edit.id, edit.ref) : removeFromCollection(file, edit.id, edit.ref), member: edit.action === "add" || !member };
}

export function extensionCollectionServices(store: Store): ExtensionCollectionServices {
  return {
    async list(scope, fields, offset, limit) {
      if (!scope.length || scope.some(LIBRARY) && (scope.length !== 1 || !LIBRARY(scope[0]!))
        || scope.some((ref) => !LIBRARY(ref) && ref.kind !== "collection")) throw new Error("collection scope is invalid");
      const selected = LIBRARY(scope[0]!) ? null : new Set(scope.map(({ id }) => id));
      const all = (await store.read()).collections.filter((item) => item.id.length <= 120 && (selected === null || selected.has(item.id)));
      const collections = all.slice(offset, offset + limit).map((item) => project(item, fields)!);
      return { collections, total: all.length, nextOffset: offset + collections.length < all.length ? offset + collections.length : null };
    },
    async readOne(scope, id, fields) {
      if (!collectionInScope(scope, id)) throw new Error("collection scope is outside the approved grant");
      const snapshot = await store.readVersioned();
      return { collection: project(snapshot.value.collections.find((item) => item.id === id), fields), revision: snapshot.revision };
    },
    async previewCreate(name, note, expectedRevision) {
      const snapshot = await store.readVersioned();
      if (snapshot.revision !== expectedRevision) return { collection: null, revision: snapshot.revision, id: null };
      const created = createCollection(snapshot.value, name, note).created;
      return { collection: project(created, ["collection.name", "collection.note"]), revision: snapshot.revision, id: created.id };
    },
    async create(name, note, expectedRevision, commit) {
      requireCommit(commit, "collections.create");
      let id: string | undefined;
      const result = await store.editIfUnchanged((current) => {
        const created = createCollection(current, name, note);
        id = created.created.id;
        return created.file;
      }, expectedRevision, commit);
      return result.status === "saved" ? { status: "saved", revision: result.revision, id } : { status: "stale" };
    },
    async previewMembership(edit, expectedRevision) {
      const snapshot = await store.readVersioned();
      const scoped = snapshot.value.collections.find((item) => item.id === edit.id);
      if (snapshot.revision !== expectedRevision || !scoped) return { collection: null, revision: snapshot.revision, member: null };
      const outcome = editFor(snapshot.value, edit);
      const after = outcome.file.collections.find((item) => item.id === edit.id);
      return { collection: project(after, ["collection.name", "collection.members"]), revision: snapshot.revision, member: outcome.member };
    },
    async membership(edit, expectedRevision, commit) {
      requireCommit(commit, "collections.membership.apply");
      let member = false;
      const result = await store.editIfUnchanged((current) => {
        const outcome = editFor(current, edit);
        member = outcome.member;
        return outcome.file;
      }, expectedRevision, commit);
      return result.status === "saved" ? { status: "saved", revision: result.revision, id: edit.id, member } : { status: "stale" };
    },
  };
}

/** Browser Studio keeps collections in its fenced in-memory StateStore rather than a filesystem store. */
export function extensionCollectionStateServices(state: StateStore): ExtensionCollectionServices {
  const readVersioned = async () => {
    if (!state.readVersioned) throw new Error("revisioned collections are unavailable on this host");
    const snapshot = await state.readVersioned("collections");
    let raw: unknown = null;
    try { raw = snapshot.text === null ? null : JSON.parse(snapshot.text); } catch { /* parseCollections owns corrupt-file behavior */ }
    return { value: parseCollections(raw), revision: snapshot.revision };
  };
  const store: Store = {
    read: async () => (await readVersioned()).value,
    readVersioned,
    async editIfUnchanged(change, expectedRevision, commit) {
      if (!state.compareAndWrite) throw new Error("fenced collection writes are unavailable on this host");
      const snapshot = await readVersioned();
      if (snapshot.revision !== expectedRevision) return { status: "stale" };
      const value = parseCollections(change(snapshot.value));
      if (await state.compareAndWrite("collections", JSON.stringify(value), expectedRevision, commit) !== "saved") return { status: "stale" };
      return { status: "saved", value, revision: expectedRevision + 1 };
    },
  };
  return extensionCollectionServices(store);
}

function requireCommit(commit: ExtensionCommitContext, operation: string): void {
  if (commit.operation !== operation || !commit.packageId || !commit.owner || !Number.isSafeInteger(commit.epoch)) throw new Error("collection commit authority is invalid");
}
