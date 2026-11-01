/** Trusted worker entry; guest code runs only in the nested QuickJS WASM VM. */
import { extensionInvocationSchema, extensionWireReplySchema, extensionWireRequestSchema, type ExtensionInvocation, type ExtensionWireReply, type ExtensionWireRequest } from "../../extensions/contracts/wire";
import { runGuest } from "./engine";
import { RELEASE_JS_LIMITS } from "./limits";
import { extensionInvocationContextSchema } from "../../extensions/contracts/invocation-context";
import type { ResourceRef } from "../../extensions/contracts/operation";

type Start = { type: "start"; source: string; wasmUrl?: string; wasmBinary?: Uint8Array; invocationResources?: readonly ResourceRef[]; invocation: ExtensionInvocation };
const pending = new Map<number, (reply: ExtensionWireReply) => void>();
let started = false;

self.addEventListener("message", (event: MessageEvent<unknown>) => {
  const raw = event.data as Record<string, unknown> | null;
  if (!raw || typeof raw !== "object") return;
  if (raw.type === "start" && !started && typeof raw.source === "string") {
    const invocation = extensionInvocationSchema.safeParse(raw.invocation);
    const resources = extensionInvocationContextSchema.safeParse({ resources: raw.invocationResources ?? [] });
    const keys = Object.keys(raw).sort().join(",");
    if (!invocation.success || !resources.success || !["invocation,source,type", "invocation,source,type,wasmUrl", "invocation,source,type,wasmBinary", "invocation,invocationResources,source,type", "invocation,invocationResources,source,type,wasmUrl", "invocation,invocationResources,source,type,wasmBinary"].includes(keys)
      || (Object.hasOwn(raw, "wasmBinary") && !(raw.wasmBinary instanceof Uint8Array))) return;
    started = true;
    const start = raw as Start;
    void runGuest(raw.source, (request: ExtensionWireRequest) => {
      return new Promise((resolve) => {
        if (pending.has(request.id) || pending.size >= RELEASE_JS_LIMITS.maxPending) {
          resolve({ v: 1, type: "reply", id: request.id, ok: false, error: { code: "LIMIT_EXCEEDED", message: "Too many pending host requests" } });
          return;
        }
        pending.set(request.id, resolve);
        self.postMessage(request);
      });
    }, { wasmUrl: start.wasmUrl, wasmBinary: start.wasmBinary, invocation: invocation.data, invocationResources: resources.data.resources }).then((result) => self.postMessage({ type: "result", ...result }), (error: unknown) => {
      const message = error instanceof Error ? error.message.slice(0, 500) : "RUNTIME_UNAVAILABLE";
      self.postMessage({ type: "error", message });
    });
    return;
  }
  const parsed = extensionWireReplySchema.safeParse(raw);
  if (parsed.success) {
    const resolve = pending.get(parsed.data.id);
    if (resolve) { pending.delete(parsed.data.id); resolve(parsed.data); }
  }
});
