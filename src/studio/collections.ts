/**
 * Collections store - atomic write; missing file = none; corrupt file = none rather than a throw.
 *
 * Deliberately a SIBLING of SettingsStore rather than a key inside it. Settings are preferences the
 * shell owns and every read of them is cheap; collections are studio content that grows with the
 * folder, and hanging membership lists off the preferences schema would mean rewriting somebody's
 * theme and accent every time they dragged a piece into a group.
 *
 * MISSING AND CORRUPT ARE BOTH "NO COLLECTIONS", which is the one place this differs from settings.
 * Settings throws on a corrupt file because starting with the wrong theme is better than starting
 * with a lie about what somebody configured. Collections are additive: nothing in the studio depends
 * on them, so refusing to open the app over a bad grouping file would take the whole library down
 * for a feature the person could simply rebuild. The parser is fail-closed per collection anyway, so
 * the total loss case is a file that is not JSON at all.
 */
import type { StateStore } from "../stage/contracts/state-store";
import {
  type CollectionsFile,
  EMPTY_COLLECTIONS,
  parseCollections,
} from "./collections-shape";
import { stateDocument } from "./state-document-store";
import type { ExtensionCommitContext } from "../stage/contracts/extension-store";

export class CollectionsStore {
  /**
   * The document, including its write queue.
   *
   * The real race edit() serializes against, and the reason this is not optional: adding two pieces
   * to a collection quickly - two clicks, or a click and an agent - has both reads see the same file
   * and the second write drop the first piece. Same reason GraveyardStore and SettingsStore serialize
   * their own.
   */
  private readonly doc;

  constructor(dir: string, stateFor?: () => StateStore | null) {
    this.doc = stateDocument(dir, "collections", EMPTY_COLLECTIONS, parseCollections, () => EMPTY_COLLECTIONS, stateFor);
  }

  read(): Promise<CollectionsFile> {
    return this.doc.read();
  }

  readVersioned(): Promise<{ value: CollectionsFile; revision: number }> {
    return this.doc.readVersioned();
  }

  /**
   * Apply a pure edit from collections-shape to the file on disk.
   *
   * The store owns I/O and ordering; it owns NO rules about what a collection may be. Every decision
   * - slug uniqueness, no duplicate members, what a rename touches - lives in the pure core where it
   * can be tested without a filesystem.
   */
  edit(change: (current: CollectionsFile) => CollectionsFile): Promise<CollectionsFile> {
    return this.doc.enqueue(async () => this.doc.write(change(await this.read())));
  }

  editIfUnchanged(change: (current: CollectionsFile) => CollectionsFile, expectedRevision: number, context: ExtensionCommitContext): Promise<
    { status: "saved"; value: CollectionsFile; revision: number } | { status: "stale" }
  > {
    return this.doc.enqueue(async () => {
      const snapshot = await this.doc.readVersioned();
      if (snapshot.revision !== expectedRevision) return { status: "stale" };
      const value = parseCollections(change(snapshot.value));
      const status = await this.doc.compareAndWrite(value, expectedRevision, context);
      return status === "saved" ? { status, value, revision: expectedRevision + 1 } : { status };
    });
  }

  /** Replace the whole file, parsed and normalised first. */
  save(raw: unknown): Promise<CollectionsFile> {
    return this.doc.enqueue(() => this.doc.write(parseCollections(raw)));
  }
}
