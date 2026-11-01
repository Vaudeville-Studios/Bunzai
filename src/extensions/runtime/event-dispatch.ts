/** Delivers validated, grant-filtered extension events with bounded causal depth and queueing. */
import type { ExtensionStore } from "../../stage/contracts/extension-store";
import type { ExtensionEventPayload } from "../contracts/events";
import { extensionEventPayloadSchema } from "../contracts/events";
import { decodeJsonValue } from "../contracts/value";
import type { ExtensionInvocationContext } from "../contracts/invocation-context";

type Activate = (id: string, kind: "command" | "event", contributionId: string, input: ReturnType<typeof decodeJsonValue>, hostContext: ExtensionInvocationContext) => Promise<unknown>;
const QUEUE_LIMIT = 32;
const DEPTH_LIMIT = 4;

export function createExtensionEventDispatcher(store: ExtensionStore, requireFence: () => Promise<unknown>, activate: Activate) {
  let tail: Promise<void> = Promise.resolve();
  let queued = 0;
  let dropped = 0;
  let processing = 0;
  const activeDepth = new Map<string, number>();
  return {
    async dispatch(input: unknown, originPackageId?: string): Promise<void> {
      const payload = extensionEventPayloadSchema.parse(input) as ExtensionEventPayload;
      const depth = originPackageId ? activeDepth.get(originPackageId) ?? 0 : 0;
      if (depth >= DEPTH_LIMIT) { dropped++; return; }
      await requireFence();
      if (queued >= QUEUE_LIMIT) { dropped++; throw new Error("extension event queue is full"); }
      queued++;
      const run = async () => {
        processing++;
        try {
          const controls = await store.listControls();
          const target = payload.type === "content.changed" ? { kind: payload.kind, id: payload.id } : { kind: "scene", id: payload.sceneId };
          const subscribers = controls.filter((control) => control.id !== originPackageId && control.enabled && !control.recoveryRequired
            && control.eventSubscriptions.some((item) => item.event === payload.type && (payload.type !== "content.changed"
              ? item.scope === "scene" && item.sceneId === payload.sceneId
              : item.scope === "content" && item.resource.kind === payload.kind && item.resource.id === payload.id))
            && control.grants.some((grant) => grant.operation === "events.subscribe"
              && grant.resources.some((resource) => resource.kind === "event" && resource.id === payload.type)
              && grant.resources.some((resource) => resource.kind === target.kind && resource.id === target.id)));
          for (const control of subscribers.slice(0, 8)) {
            const previous = activeDepth.get(control.id);
            activeDepth.set(control.id, depth + 1);
            try { await activate(control.id, "event", payload.type, decodeJsonValue(payload), { resources: [target] }); }
            catch { /* An extension event failure is isolated from the host turn. */ }
            finally { if (previous === undefined) activeDepth.delete(control.id); else activeDepth.set(control.id, previous); }
          }
        } finally {
          processing--;
        }
      };
      const work = tail.then(run);
      tail = work.catch(() => undefined).finally(() => { queued--; });
      if (processing === 0) await work;
    },
    async close(): Promise<void> { while (true) { const pending = tail; await pending; if (pending === tail) return; } },
    status(): { queued: number; dropped: number } { return { queued, dropped }; },
  };
}
