/**
 * The skeleton every single-document StateStore-backed store shares (SettingsStore, CollectionsStore,
 * GraveyardStore): one JSON document under one key, read as text and written back pretty-printed,
 * every mutation serialized so a read-modify-write can never interleave with another.
 *
 * ONLY THE PARSE STEP COUNTS AS "CORRUPT". The state read itself (`state().read(key)`, which can
 * throw StudioLockedError, a damaged sealed cell, or a busy database) is never caught here - those
 * are real failures the caller must see, not a reason to report empty content. `onCorrupt` fires
 * only when the text was present but JSON.parse or `parse` itself failed on it; settings passes one
 * that throws StudioReadError, collections and graveyard pass one that returns their own empty value
 * (nothing else in the studio depends on them, so a bad grouping file should cost the groupings, not
 * the library - see each store's own header for why that split exists at all).
 */
import type { StateKey, StateStore } from "../stage/contracts/state-store";
import { libraryStateFor, requireState } from "./library-content";
import { serializer } from "./serial";
import type { ExtensionCommitContext } from "../stage/contracts/extension-store";

export interface StateDocument<T> {
  /** Runs `fn` through the one write queue for this document, so edits cannot interleave. */
  enqueue<R>(fn: () => Promise<R>): Promise<R>;
  /** The parsed document, `empty` when no file exists yet, or `onCorrupt()`'s result (or throw) when
   *  a present file failed to parse. Any OTHER failure (locked, damaged, busy) propagates as itself. */
  read(): Promise<T>;
  readVersioned(): Promise<{ value: T; revision: number }>;
  /** Writes the document, pretty-printed, and returns it unchanged. */
  write(next: T): Promise<T>;
  compareAndWrite(next: T, expectedRevision: number, context: ExtensionCommitContext): Promise<"saved" | "stale">;
}

/** One document under `key` in the library's state, opened lazily via `dir` on every call (none open
 *  means refused as locked, same as every other studio store). */
export function stateDocument<T>(
  dir: string,
  key: StateKey,
  empty: T,
  parse: (raw: unknown) => T,
  onCorrupt: () => T,
  stateFor: () => StateStore | null = () => libraryStateFor(dir),
): StateDocument<T> {
  const enqueue = serializer();
  const state = (): StateStore => requireState(stateFor());

  return {
    enqueue,
    async read(): Promise<T> {
      const text = await state().read(key);
      if (text === null) return empty;
      try {
        return parse(JSON.parse(text));
      } catch {
        return onCorrupt();
      }
    },
    async readVersioned(): Promise<{ value: T; revision: number }> {
      const source = state();
      const result = source.readVersioned ? await source.readVersioned(key) : { text: await source.read(key), revision: 0 };
      if (result.text === null) return { value: empty, revision: -1 };
      try { return { value: parse(JSON.parse(result.text)), revision: result.revision }; }
      catch { return { value: onCorrupt(), revision: result.revision }; }
    },
    async write(next: T): Promise<T> {
      await state().write(key, JSON.stringify(next, null, 2));
      return next;
    },
    async compareAndWrite(next: T, expectedRevision: number, context: ExtensionCommitContext): Promise<"saved" | "stale"> {
      const normalized = parse(next);
      const source = state();
      const compareAndWrite = source.compareAndWrite;
      if (!compareAndWrite) throw new Error("revisioned extension state commits are unavailable");
      return compareAndWrite.call(source, key, JSON.stringify(normalized, null, 2), expectedRevision, context);
    },
  };
}
