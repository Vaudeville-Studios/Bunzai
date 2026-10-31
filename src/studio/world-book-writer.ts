/**
 * The one writer of a lorebook for the Compendium: filing, Undo and
 * Reconcile all change a book here and nowhere else. A caller hands over a pure edit of the book's entries; the writer reads the
 * book once, applies the edit, sends only the entries that changed as one revision-checked patch through the same
 * `buildPiecePatch` the World wing's Lorebook tab saves with, and never writes an unversioned book. Books are written one at a
 * time (a queue per book), so two passes cannot race each other in this process; the person editing at the same moment can,
 * and then the book is read again once: if every entry the edit touched is exactly as it was, the edit is applied to the fresh
 * book and sent again, and otherwise nothing is written and the touched entries are reported (F4: no loop, no half write).
 */
import { deepEq } from "../core/guards";
import type { LorebookEntry } from "../entities/lorebook/schema";
import type { ParsedCanonicalEntity } from "../entities/runtime-schema";
import { entityRevision } from "../kit/changes/revision";
import { buildPiecePatch } from "../entities/editor-patch";
import type { StudioStoreLike } from "./contracts";
import type { ExtensionCommitContext } from "../stage/contracts/extension-store";
import { requireCommitResource } from "../stage/store/extension-commit-access";
import { EXTENSION_BACKGROUND_FIELDS } from "../extensions/contracts/background-fields";

export type BookStore = Pick<StudioStoreLike, "read" | "comparePatch">;

/** What changed in one entry: `before` is absent for a created one. */
export interface EntryChange {
  id: string;
  before?: LorebookEntry;
  after: LorebookEntry;
}

export type BookWrite =
  | { status: "saved"; revision: string; changes: EntryChange[] }
  | { status: "unchanged" }
  | { status: "missing" }
  /** The book changed under the entries the edit touched; nothing was written. */
  | { status: "conflict"; ids: string[] };

/** A pure edit: the book's entries in, the next entries out. It must not mutate its input. */
export type BookEdit = (entries: readonly LorebookEntry[]) => readonly LorebookEntry[];

const queues = new WeakMap<object, Map<string, Promise<unknown>>>();

interface Book {
  entity: Extract<ParsedCanonicalEntity, { kind: "lorebook" }>;
  revision: string;
}

async function readBook(store: BookStore, bookId: string): Promise<Book | null> {
  const entity = await store.read("lorebook", bookId);
  return entity?.kind === "lorebook" ? { entity, revision: entityRevision(entity) } : null;
}

function changesOf(base: readonly LorebookEntry[], next: readonly LorebookEntry[]): EntryChange[] {
  const before = new Map(base.map((e) => [e.id, e]));
  const out: EntryChange[] = [];
  for (const after of next) {
    const was = before.get(after.id);
    if (!was || !deepEq(was, after)) out.push({ id: after.id, ...(was ? { before: was } : {}), after });
  }
  return out;
}

/** The ids among `changes` whose entry differs between the base read and the fresh one (a created one counts as changed once the other writer holds that id). */
const movedSince = (changes: readonly EntryChange[], base: readonly LorebookEntry[], fresh: readonly LorebookEntry[]): string[] =>
  changes.filter((c) => !deepEq(base.find((e) => e.id === c.id), fresh.find((e) => e.id === c.id))).map((c) => c.id);

async function attempt(store: BookStore, bookId: string, edit: BookEdit, commit?: ExtensionCommitContext): Promise<BookWrite> {
  const base = await readBook(store, bookId);
  if (!base) return { status: "missing" };
  const baseEntries = base.entity.body.entries;
  const planned = changesOf(baseEntries, edit(baseEntries));
  if (planned.length === 0) return { status: "unchanged" };
  const sent = await send(store, base, planned, commit);
  if (sent !== "stale") return sent;

  const fresh = await readBook(store, bookId);
  if (!fresh) return { status: "missing" };
  const again = changesOf(fresh.entity.body.entries, edit(fresh.entity.body.entries));
  // The edit runs again on the fresh book (it may choose differently, say a name the other writer just added): it may touch only entries still exactly as they were when the base was read.
  const outside = movedSince(again, baseEntries, fresh.entity.body.entries);
  if (outside.length > 0) return { status: "conflict", ids: outside };
  if (again.length === 0) return { status: "unchanged" };
  const second = await send(store, fresh, again, commit);
  return second === "stale" ? { status: "conflict", ids: again.map((c) => c.id) } : second;
}

async function send(store: BookStore, book: Book, changes: readonly EntryChange[], commit?: ExtensionCommitContext): Promise<BookWrite | "stale"> {
  const byId = new Map(changes.map((c) => [c.id, c.after]));
  const kept = book.entity.body.entries.map((e) => byId.get(e.id) ?? e);
  const added = changes.filter((c) => !c.before).map((c) => c.after);
  const next = { ...book.entity, body: { ...book.entity.body, entries: [...kept, ...added] } } as ParsedCanonicalEntity;
  const patch = buildPiecePatch(book.entity, next);
  if (commit) requireCommitResource(commit, { kind: "lorebook", id: book.entity.id }, [EXTENSION_BACKGROUND_FIELDS.compendiumEntries]);
  const result = await store.comparePatch!("lorebook", book.entity.id, book.revision, patch, undefined, "manual", commit);
  if (result.status !== "saved") return result.status === "stale" ? "stale" : { status: "missing" };
  return { status: "saved", revision: result.revision, changes: [...changes] };
}

/** Edits one book as a single revision-checked patch, after any write already queued for the same book. */
export function writeBook(store: BookStore, bookId: string, edit: BookEdit, commit?: ExtensionCommitContext): Promise<BookWrite> {
  const lanes = queues.get(store) ?? new Map<string, Promise<unknown>>();
  queues.set(store, lanes);
  const run = (lanes.get(bookId) ?? Promise.resolve()).catch(() => undefined).then(() => attempt(store, bookId, edit, commit));
  lanes.set(bookId, run);
  void run.finally(() => lanes.get(bookId) === run && lanes.delete(bookId)).catch(() => undefined);
  return run;
}
