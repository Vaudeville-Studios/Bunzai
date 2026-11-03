/**
 * The StateStore contract: the Studio's own documents, one JSON text per key, kept in the library
 * beside its pieces. Settings,
 * collections, the engine roots, Kit's block graveyard, and global macro variables each keep their own
 * parsing and rules; this only holds their text, sealed like everything else, and never parses it.
 * Types only.
 */

/**
 * The documents it holds. A closed list: a new one is a deliberate addition, never a free string.
 * `variables` is the macro engine's global variables (RoleCall's `global_variables`), added for
 * ChatStore rule 17: chat variables live on a branch, global ones in the library. `meter` is the
 * token meter's learned numbers per model: numbers only.
 * `guides` is the guide library (studio/guides.ts): RoleCall's guided responses, which no piece kind fits.
 * `loadouts` is the saved scene setups and their undo receipts (studio/loadouts.ts), kept like guides.
 * `finalCut` is the person's own Anti-Slop banks and saved Custom Agents (studio/final-cut-library.ts), kept like guides.
 */
export const STATE_KEYS = ["settings", "collections", "engines", "graveyard", "variables", "meter", "themeExtensions", "guides", "loadouts", "finalCut", "tableRead"] as const;
export type StateKey = (typeof STATE_KEYS)[number];

/** A key every backend accepts, or a throw: an unknown key is a caller bug, never a new document. */
export function checkStateKey(key: unknown): StateKey {
  if (typeof key !== "string" || !(STATE_KEYS as readonly string[]).includes(key)) throw new Error(`unknown state key: ${String(key)}`);
  return key as StateKey;
}

export interface StateStore {
  /** The text last written for this key, or null when nothing has been. */
  read(key: StateKey): Promise<string | null>;
  /** Text and monotonically increasing revision for one document; missing documents use revision -1. */
  readVersioned?(key: StateKey): Promise<{ text: string | null; revision: number }>;
  /** Replaces the text for this key, atomically. */
  write(key: StateKey, text: string): Promise<void>;
  /** Trusted application compare-and-write; extensions still require their separate fenced method. */
  writeIfRevision?(key: StateKey, text: string, expectedRevision: number): Promise<"saved" | "stale">;
  /** Extension-only compare-and-write checked against the live package authority in the same transaction. */
  compareAndWrite?(key: StateKey, text: string, expectedRevision: number, context: import("./extension-store").ExtensionCommitContext): Promise<"saved" | "stale">;
}
