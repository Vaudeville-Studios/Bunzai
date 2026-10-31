/** Narrow opened-library reads shared by local and approved remote Studio handlers. */
import type { ThemeReadService } from "./server-theme-extensions";
import type { PackagedAssets } from "./assets";
import type { LibraryHandle, OpenedLibrary } from "./library-root";

type ReadOnlyOpenedLibrary = {
  search: Pick<OpenedLibrary["search"], "search">;
  chats: Pick<OpenedLibrary["chats"], "castPortraitRef" | "getChat">;
  keyring: Pick<OpenedLibrary["keyring"], "leaseKeys">;
  isCurrent(): boolean;
};
export interface LibraryReadCapability {
  opened(): ReadOnlyOpenedLibrary | null;
  themeReader(): Promise<ThemeReadService | null>;
}

type ExtensionOwner = { get(): Promise<({ themeEffective: ThemeReadService["effective"]; themeAsset: ThemeReadService["asset"]; themeRevision: ThemeReadService["revisionStamp"]; themeMarkBroken: ThemeReadService["markBroken"]; themeConfirmHealthy: ThemeReadService["confirmHealthy"] }) | null> };

export function libraryReadCapability(library: LibraryHandle | undefined, _packaged?: PackagedAssets, extensionOwner?: ExtensionOwner): LibraryReadCapability | undefined {
  if (!library) return undefined;
  return { opened: () => {
    const opened = library.opened();
    return opened ? {
      keyring: { leaseKeys: () => opened.keyring.leaseKeys() }, search: opened.search, chats: opened.chats,
      isCurrent: () => library.opened() === opened,
    } : null;
  }, themeReader: async () => {
    if (!extensionOwner) return null;
    const runtime = await extensionOwner.get();
    if (!runtime) return null;
    return { effective: runtime.themeEffective, asset: runtime.themeAsset, revisionStamp: runtime.themeRevision,
      markBroken: runtime.themeMarkBroken, confirmHealthy: runtime.themeConfirmHealthy };
  } };
}
