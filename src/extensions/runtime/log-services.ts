/** Fenced, package-scoped operational log adapter; it never exposes the underlying store. */
import type { ExtensionStore } from "../../stage/contracts/extension-store";
import type { ExtensionLogServices } from "../operations/logs/_services";

export function createExtensionLogServices(store: ExtensionStore, options: { now(): number; id(): string }): ExtensionLogServices {
  return {
    async append(packageId, input, commit) {
      if (commit.packageId !== packageId || commit.operation !== "logs.write") throw new Error("extension log authority is invalid");
      const log = { ...input, id: options.id(), createdAt: options.now() };
      await store.appendLog(packageId, log, commit);
      return { id: log.id, createdAt: log.createdAt };
    },
    readOwn(packageId, cursor, limit) { return store.listLogs(packageId, cursor, limit); },
  };
}
