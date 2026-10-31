/** Shared package-owned storage adapter for desktop, browser and terminal hosts. */
import type { ExtensionStore } from "../../stage/contracts/extension-store";
import type { ExtensionStorageServices } from "../operations/storage/_services";
import { EXTENSION_SETTINGS_DATA_KEY } from "../operations/settings/_services";

export function createExtensionStorageServices(store: ExtensionStore): ExtensionStorageServices {
  return {
    async read(packageId, key) {
      if (key === EXTENSION_SETTINGS_DATA_KEY) throw new Error("extension settings are not generic storage");
      return store.readData(packageId, key);
    },
    async list(packageId, limit) {
      return (await store.listDataKeys(packageId, limit + 1)).filter((key) => key !== EXTENSION_SETTINGS_DATA_KEY).slice(0, limit);
    },
    async write(packageId, key, value, expectedRevision, commit) {
      if (key === EXTENSION_SETTINGS_DATA_KEY || commit.packageId !== packageId || commit.operation !== "storage.set") throw new Error("extension storage authority is invalid");
      if (await store.compareAndSaveData(packageId, key, value, expectedRevision, commit) !== "saved") return { status: "stale" };
      const saved = await store.readData(packageId, key);
      if (!saved || saved.revision !== expectedRevision + 1) throw new Error("extension data write did not persist");
      return { status: "saved", revision: saved.revision };
    },
    async delete(packageId, key, expectedRevision, commit) {
      if (key === EXTENSION_SETTINGS_DATA_KEY || commit.packageId !== packageId || commit.operation !== "storage.delete") throw new Error("extension storage authority is invalid");
      return await store.deleteData(packageId, key, expectedRevision, commit) === "saved" ? { status: "deleted" } : { status: "stale" };
    },
  };
}
