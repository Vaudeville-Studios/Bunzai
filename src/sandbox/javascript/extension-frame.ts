/** Trusted sandbox-origin frame. It owns the same-origin Worker and relays versioned values only. */
import { extensionInvocationSchema, extensionWireReplySchema, extensionWireRequestSchema } from "../../extensions/contracts/wire";
import { decodeJsonValue } from "../../extensions/contracts/value";
import { extensionInvocationContextSchema } from "../../extensions/contracts/invocation-context";

const query = new URL(location.href).searchParams;
const parentOrigin = query.get("parent") ?? "";
const ownOrigin = location.origin;
let nonce = "";
let worker: Worker | undefined;
let active = false;
const post = (message: Record<string, unknown>): void => window.parent.postMessage({ v: 1, nonce, ...message }, parentOrigin);

window.addEventListener("message", (event: MessageEvent<unknown>) => {
  if (event.source !== window.parent || event.origin !== parentOrigin || !event.data || typeof event.data !== "object") return;
  const message = event.data as Record<string, unknown>;
  if (!nonce && message.type === "hello" && message.v === 1 && Object.keys(message).sort().join(",") === "nonce,type,v") {
    if (typeof message.nonce !== "string" || !message.nonce || !parentOrigin || parentOrigin === ownOrigin) return;
    nonce = message.nonce;
    post({ type: "ready" });
    return;
  }
  if (!nonce || message.v !== 1 || message.nonce !== nonce || typeof message.type !== "string") return;
  if (message.type === "cancel" && Object.keys(message).sort().join(",") === "nonce,type,v") {
    active = false;
    worker?.terminate(); worker = undefined;
    post({ type: "stopped" });
  } else if (message.type === "start" && !worker && typeof message.source === "string" && Object.keys(message).sort().join(",") === "invocation,invocationResources,nonce,source,type,v") {
    const invocation = extensionInvocationSchema.safeParse(message.invocation);
    const resources = extensionInvocationContextSchema.safeParse({ resources: message.invocationResources });
    if (!invocation.success || !resources.success) return post({ type: "error", message: "INVALID_REQUEST: invocation is not declared" });
    active = true;
    worker = new Worker(new URL("./extension-worker.js", location.href), { type: "module" });
    worker.addEventListener("message", (workerEvent: MessageEvent<unknown>) => {
      if (!active || !workerEvent.data || typeof workerEvent.data !== "object") return;
      const data = workerEvent.data as Record<string, unknown>;
      const request = extensionWireRequestSchema.safeParse(data);
      if (request.success) return post({ type: "request", request: request.data });
      if (data.type === "result" && Object.keys(data).sort().join(",") === "logs,type,value" && Array.isArray(data.logs) && data.logs.length <= 64 && data.logs.every((line) => typeof line === "string" && new TextEncoder().encode(line).length <= 2_048)) {
        try { post({ type: "result", value: decodeJsonValue(data.value), logs: data.logs }); }
        catch { post({ type: "error", message: "LIMIT_EXCEEDED: malformed worker result" }); }
      } else if (data.type === "error" && typeof data.message === "string" && Object.keys(data).sort().join(",") === "message,type") post({ type: "error", message: data.message.slice(0, 500) });
      else post({ type: "error", message: "INVALID_REQUEST: malformed worker message" });
      active = false;
      worker?.terminate(); worker = undefined;
    });
    worker.addEventListener("error", () => { post({ type: "error", message: "RUNTIME_UNAVAILABLE: QuickJS worker failed" }); worker?.terminate(); worker = undefined; active = false; });
    worker.postMessage({ type: "start", source: message.source, invocation: invocation.data, invocationResources: resources.data.resources, wasmUrl: new URL("./quickjs.wasm", location.href).href });
  } else if (message.type === "reply" && active && Object.keys(message).sort().join(",") === "nonce,reply,type,v") {
    const parsed = extensionWireReplySchema.safeParse(message.reply);
    if (parsed.success) worker?.postMessage(parsed.data);
  }
});
