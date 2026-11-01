/**
 * The open library's stores for a studio folder: its ContentStore (the pieces), its StateStore
 * (the Studio's own documents), and its ChatStore (the scenes), handed out by the app's composition root (src/ui/library-root.ts).
 * Decided on every call, so a store made before the library opens starts using it the moment it
 * does. A folder whose library is still opening or failed to open is CLAIMED: it answers "no library"
 * whatever else is registered, so every Studio store refuses as locked and nothing falls back to the
 * folder or to another library. No entry at all also refuses.
 */
import type { ChatStore } from "../stage/contracts/chat-store";
import type { CoreSceneRecords } from "../stage/store/sqlite/core-record-store";
import type { CoreTurnOwner } from "./core-turn-owner";
import type { ContentStore } from "../stage/contracts/content-store";
import type { StateStore } from "../stage/contracts/state-store";
import type { createAssetThumbnails } from "../stage/store/asset-thumbnails";
import { StudioLockedError } from "./errors";

export interface LibraryStores {
  content: ContentStore;
  state: StateStore;
  chats: ChatStore;
  core?: CoreSceneRecords;
  coreTurns?: CoreTurnOwner;
  thumbnails?: ReturnType<typeof createAssetThumbnails>;
  /** Large completed imports may refresh planner statistics; memory libraries intentionally no-op. */
  importCompleted?: (pieceCount: number) => Promise<void>;
}

/** A folder's library is expected but not open: refuse rather than keep looking. */
export const CLAIMED = "claimed";
type LibraryResolver = (root: string) => LibraryStores | typeof CLAIMED | null;
/** Newest last. Each open library (and each test harness) adds one and removes only its own. */
const openLibraries: LibraryResolver[] = [];

/** Hands out a library's stores for the folders it answers for; returns the one way to take it back. */
export function addLibrary(resolver: LibraryResolver): () => void {
  openLibraries.push(resolver);
  return () => {
    const at = openLibraries.lastIndexOf(resolver);
    if (at >= 0) openLibraries.splice(at, 1);
  };
}

/** The open library's stores for this folder, or null when none is open. */
export function libraryFor(root: string): LibraryStores | null {
  for (let i = openLibraries.length - 1; i >= 0; i--) {
    const found = openLibraries[i]!(root);
    if (found === CLAIMED) return null;
    if (found) return found;
  }
  return null;
}

export const libraryContentFor = (root: string): ContentStore | null => libraryFor(root)?.content ?? null;
export const libraryStateFor = (root: string): StateStore | null => libraryFor(root)?.state ?? null;
export const libraryChatsFor = (root: string): ChatStore | null => libraryFor(root)?.chats ?? null;

/** The state store, or a refusal: a locked or opening library never answers with anything else. */
export function requireState(state: StateStore | null): StateStore {
  if (!state) throw new StudioLockedError();
  return state;
}
