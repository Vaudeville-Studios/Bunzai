/**
 * The in-memory StateStore, for tests and the temporary browser Studio: the documents in a map,
 * forgotten on reload. It checks keys exactly as the SQLite store does.
 */
import { checkStateKey, type StateKey, type StateStore } from "../../contracts/state-store";
import type { ExtensionCommitContext } from "../../contracts/extension-store";

export function memoryStateStore(options: { authorizeExtensionCommit?: (context: ExtensionCommitContext) => void } = {}): StateStore {
  const docs = new Map<StateKey, string>();
  const revisions = new Map<StateKey, number>();
  const conditionalWrite = (key: unknown, text: string, expectedRevision: number): "saved" | "stale" => {
    if (typeof text !== "string" || !Number.isSafeInteger(expectedRevision) || expectedRevision < -1) throw new Error("invalid state compare-and-write");
    const checked = checkStateKey(key);
    if ((revisions.get(checked) ?? -1) !== expectedRevision) return "stale";
    docs.set(checked, text);
    revisions.set(checked, expectedRevision + 1);
    return "saved";
  };
  return {
    async read(key) {
      return docs.get(checkStateKey(key)) ?? null;
    },
    async readVersioned(key) {
      const checked = checkStateKey(key);
      return { text: docs.get(checked) ?? null, revision: revisions.get(checked) ?? -1 };
    },
    async write(key, text) {
      if (typeof text !== "string") throw new Error("state text must be a string");
      const checked = checkStateKey(key);
      docs.set(checked, text);
      revisions.set(checked, (revisions.get(checked) ?? -1) + 1);
    },
    async compareAndWrite(key, text, expectedRevision, context) {
      if (!options.authorizeExtensionCommit) throw new Error("extension commits are unsupported by this memory StateStore");
      options.authorizeExtensionCommit(context);
      return conditionalWrite(key, text, expectedRevision);
    },
    async writeIfRevision(key, text, expectedRevision) { return conditionalWrite(key, text, expectedRevision); },
  };
}
