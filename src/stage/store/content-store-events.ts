/** Publishes committed piece changes and derives their semantic invalidation roots. */
import type { ContentStoreChange, PartChange } from "../contracts/content-store";

export function createContentChangePublisher() {
  const listeners = new Set<(change: ContentStoreChange) => void>();
  let listenerFailures = 0;
  return {
    publish(change: ContentStoreChange): void {
      for (const listener of listeners) {
        try { listener(change); }
        catch { if (listenerFailures++ < 3) console.warn("content change observer failed after a committed write"); }
      }
    },
    subscribe(listener: (change: ContentStoreChange) => void): () => void {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
  };
}

export function contentInvalidationRoots(change: PartChange): string[] {
  if ("restore" in change) return ["body", "original"];
  const names = [...change.put.map(({ name }) => name), ...change.drop];
  const body = names.some((name) => !name.startsWith("r/"));
  const original = names.some((name) => name.startsWith("r/"));
  return [...(body ? ["body"] : []), ...(original ? ["original"] : [])];
}
