/** Host adapter for an isolated sandbox-origin frame or a terminable Bun worker. */
import { extensionInvocationSchema, extensionWireReplySchema, extensionWireRequestSchema, type ExtensionInvocation, type ExtensionWireReply } from "../../extensions/contracts/wire";
import { decodeJsonValue, type JsonValue } from "../../extensions/contracts/value";
import { opaqueWorkerFrameHtml } from "./opaque-frame";
import { OPAQUE_WASM_BASE64_BYTES, OPAQUE_WORKER_SOURCE_BYTES, opaqueFrameStartSchema } from "./opaque-protocol";
import { RELEASE_JS_LIMITS } from "./limits";
import { startLaneWorker } from "../../stage/worker-lane";
import { snapshotInvocationResources } from "../../extensions/contracts/invocation-context";
import type { ResourceRef } from "../../extensions/contracts/operation";

export interface JavaScriptWorkerOptions { sandboxOrigin?: string; opaqueBrowser?: { workerSource: string; wasmBase64: string }; quickJsWasmBinary?: Uint8Array; invocationResources?: readonly ResourceRef[]; signal?: AbortSignal; timeoutMs?: number; invocation: ExtensionInvocation }

const errorFrom = (message: unknown): Error => new Error(typeof message === "string" ? message.slice(0, 500) : "RUNTIME_UNAVAILABLE");

function runInSandboxFrame(
  source: string,
  dispatch: (request: ReturnType<typeof extensionWireRequestSchema.parse>, signal: AbortSignal) => Promise<ExtensionWireReply>,
  origin: string,
  options: JavaScriptWorkerOptions,
): Promise<JsonValue> {
  let sandbox: URL;
  try { sandbox = new URL(origin); } catch { return Promise.reject(new Error("RUNTIME_UNAVAILABLE: invalid sandbox origin")); }
  if (sandbox.protocol !== "http:" || sandbox.hostname !== "127.0.0.1" || sandbox.port === "" || sandbox.pathname !== "/" || sandbox.username || sandbox.password || sandbox.search || sandbox.hash) return Promise.reject(new Error("RUNTIME_UNAVAILABLE: invalid sandbox origin"));
  const sandboxOrigin = sandbox.origin;
  const parentOrigin = location.origin;
  const nonce = crypto.randomUUID();
  const frame = document.createElement("iframe");
  frame.title = "Extension worker host";
  frame.hidden = true;
  frame.sandbox.add("allow-scripts", "allow-same-origin");
  frame.referrerPolicy = "no-referrer";
  const frameUrl = new URL("/sandbox/extension-frame.html", sandboxOrigin);
  frameUrl.searchParams.set("parent", parentOrigin);
  frame.src = frameUrl.href;
  const controller = new AbortController();
  const timeout = Math.min(options.timeoutMs ?? 300_000, 300_000);
  return new Promise<JsonValue>((resolve, reject) => {
    let settled = false;
    let ready = false;
    const outstanding = new Set<number>();
    const finish = (error?: Error, value?: JsonValue): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", abort);
      window.removeEventListener("message", receive);
      controller.abort();
      if (ready) frame.contentWindow?.postMessage({ v: 1, type: "cancel", nonce }, sandboxOrigin);
      frame.remove();
      error ? reject(error) : resolve(value ?? null);
    };
    const abort = (): void => finish(new Error("CANCELLED: JavaScript worker stopped"));
    const timer = setTimeout(() => finish(new Error("LIMIT_EXCEEDED: absolute job deadline")), timeout);
    const receive = (event: MessageEvent<unknown>): void => {
      if (settled || event.origin !== sandboxOrigin || event.source !== frame.contentWindow || !event.data || typeof event.data !== "object") return;
      const data = event.data as Record<string, unknown>;
      if (data.v !== 1 || data.nonce !== nonce || typeof data.type !== "string") return;
      if (data.type === "ready" && Object.keys(data).sort().join(",") === "nonce,type,v" && !ready) {
        ready = true;
        frame.contentWindow?.postMessage({ v: 1, type: "start", nonce, source, invocation: options.invocation, invocationResources: options.invocationResources ?? [] }, sandboxOrigin);
      } else if (data.type === "request" && Object.keys(data).sort().join(",") === "nonce,request,type,v" && ready) {
        const parsed = extensionWireRequestSchema.safeParse(data.request);
        if (!parsed.success || outstanding.has(parsed.data.id) || outstanding.size >= RELEASE_JS_LIMITS.maxPending) return finish(new Error("INVALID_REQUEST: malformed or excessive worker request"));
        outstanding.add(parsed.data.id);
        void dispatch(parsed.data, controller.signal).then((reply) => {
          const checked = extensionWireReplySchema.safeParse(reply);
          if (!checked.success || checked.data.id !== parsed.data.id) return finish(new Error("INVALID_REQUEST: malformed host reply"));
          outstanding.delete(parsed.data.id);
          if (!settled) frame.contentWindow?.postMessage({ v: 1, type: "reply", nonce, reply: checked.data }, sandboxOrigin);
        }, () => {
          outstanding.delete(parsed.data.id);
          if (!settled) frame.contentWindow?.postMessage({ v: 1, type: "reply", nonce, reply: { v: 1, type: "reply", id: parsed.data.id, ok: false, error: { code: "INTERNAL_ERROR", message: "Host operation failed" } } }, sandboxOrigin);
        });
      } else if (data.type === "result" && Object.keys(data).sort().join(",") === "logs,nonce,type,v,value" && Array.isArray(data.logs) && data.logs.length <= 64 && data.logs.every((line) => typeof line === "string" && new TextEncoder().encode(line).length <= 2_048)) {
        try { finish(undefined, decodeJsonValue(data.value)); } catch { finish(new Error("LIMIT_EXCEEDED: invalid worker result")); }
      } else if (data.type === "error" && Object.keys(data).sort().join(",") === "message,nonce,type,v") finish(errorFrom(data.message));
      else if (data.type === "stopped" && Object.keys(data).sort().join(",") !== "nonce,type,v") finish(new Error("INVALID_REQUEST: malformed sandbox stop message"));
      else if (data.type !== "stopped") finish(new Error("INVALID_REQUEST: malformed sandbox frame message"));
    };
    options.signal?.addEventListener("abort", abort, { once: true });
    if (options.signal?.aborted) return abort();
    window.addEventListener("message", receive);
    frame.addEventListener("load", () => frame.contentWindow?.postMessage({ v: 1, type: "hello", nonce }, sandboxOrigin), { once: true });
    frame.addEventListener("error", () => finish(new Error("RUNTIME_UNAVAILABLE: sandbox frame failed to load")), { once: true });
    document.body.append(frame);
  });
}

function runInOpaqueBrowserFrame(
  source: string,
  dispatch: (request: ReturnType<typeof extensionWireRequestSchema.parse>, signal: AbortSignal) => Promise<ExtensionWireReply>,
  options: JavaScriptWorkerOptions,
): Promise<JsonValue> {
  const bundle = options.opaqueBrowser;
  if (!bundle || bundle.workerSource.length > OPAQUE_WORKER_SOURCE_BYTES || bundle.wasmBase64.length > OPAQUE_WASM_BASE64_BYTES) return Promise.reject(new Error("RUNTIME_UNAVAILABLE: Browser worker bundle is unavailable"));
  const parentOrigin = location.origin;
  const nonce = crypto.randomUUID();
  const frame = document.createElement("iframe");
  frame.title = "Extension worker host";
  frame.hidden = true;
  frame.sandbox.add("allow-scripts");
  frame.referrerPolicy = "no-referrer";
  const controller = new AbortController();
  const timeout = Math.min(options.timeoutMs ?? 300_000, 300_000);
  return new Promise<JsonValue>((resolve, reject) => {
    let settled = false;
    let ready = false;
    const finish = (failure?: Error, value?: JsonValue): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", abort);
      window.removeEventListener("message", receive);
      controller.abort();
      if (ready) frame.contentWindow?.postMessage({ v: 1, type: "cancel", nonce }, "*");
      frame.remove();
      failure ? reject(failure) : resolve(value ?? null);
    };
    const abort = (): void => finish(new Error("CANCELLED: JavaScript worker stopped"));
    const timer = setTimeout(() => finish(new Error("LIMIT_EXCEEDED: absolute job deadline")), timeout);
    const outstanding = new Set<number>();
    const receive = (event: MessageEvent<unknown>): void => {
      if (settled || event.origin !== "null" || event.source !== frame.contentWindow || !event.data || typeof event.data !== "object") return;
      const data = event.data as Record<string, unknown>;
      if (data.v !== 1 || data.nonce !== nonce || typeof data.type !== "string") return;
      if (data.type === "ready" && Object.keys(data).sort().join(",") === "nonce,type,v" && !ready) {
        ready = true;
        const start = opaqueFrameStartSchema.parse({ v: 1, type: "start", nonce, source, invocation: options.invocation, invocationResources: options.invocationResources ?? [], workerSource: bundle.workerSource, wasmBase64: bundle.wasmBase64 });
        frame.contentWindow?.postMessage(start, "*");
      } else if (data.type === "request" && Object.keys(data).sort().join(",") === "nonce,request,type,v" && ready) {
        const parsed = extensionWireRequestSchema.safeParse(data.request);
        if (!parsed.success || outstanding.has(parsed.data.id) || outstanding.size >= RELEASE_JS_LIMITS.maxPending) return finish(new Error("INVALID_REQUEST: malformed or excessive worker request"));
        outstanding.add(parsed.data.id);
        void dispatch(parsed.data, controller.signal).then((reply) => {
          const checked = extensionWireReplySchema.safeParse(reply);
          if (!checked.success || checked.data.id !== parsed.data.id) return finish(new Error("INVALID_REQUEST: malformed host reply"));
          outstanding.delete(parsed.data.id);
          if (!settled) frame.contentWindow?.postMessage({ v: 1, type: "reply", nonce, reply: checked.data }, "*");
        }, () => {
          outstanding.delete(parsed.data.id);
          if (!settled) frame.contentWindow?.postMessage({ v: 1, type: "reply", nonce, reply: { v: 1, type: "reply", id: parsed.data.id, ok: false, error: { code: "INTERNAL_ERROR", message: "Host operation failed" } } }, "*");
        });
      } else if (data.type === "result" && Object.keys(data).sort().join(",") === "logs,nonce,type,v,value" && Array.isArray(data.logs) && data.logs.length <= 64 && data.logs.every((line) => typeof line === "string" && new TextEncoder().encode(line).length <= 2_048)) {
        try { finish(undefined, decodeJsonValue(data.value)); } catch { finish(new Error("LIMIT_EXCEEDED: invalid worker result")); }
      } else if (data.type === "error" && Object.keys(data).sort().join(",") === "message,nonce,type,v") finish(errorFrom(data.message));
      else if (data.type === "stopped" && Object.keys(data).sort().join(",") === "nonce,type,v") finish(new Error("CANCELLED: JavaScript worker stopped"));
      else finish(new Error("INVALID_REQUEST: malformed opaque worker message"));
    };
    options.signal?.addEventListener("abort", abort, { once: true });
    if (options.signal?.aborted) return abort();
    window.addEventListener("message", receive);
    frame.addEventListener("load", () => frame.contentWindow?.postMessage({ v: 1, type: "hello", nonce }, "*"), { once: true });
    frame.addEventListener("error", () => finish(new Error("RUNTIME_UNAVAILABLE: opaque sandbox frame failed to load")), { once: true });
    frame.srcdoc = opaqueWorkerFrameHtml(parentOrigin, nonce);
    document.body.append(frame);
  });
}

/** Browser execution is never same-origin: a trusted distinct-origin frame owns the real Worker. */
export function runJavaScriptInWorker(
  source: string,
  dispatch: (request: ReturnType<typeof extensionWireRequestSchema.parse>, signal: AbortSignal) => Promise<ExtensionWireReply>,
  options: JavaScriptWorkerOptions,
): Promise<JsonValue> {
  const invocation = extensionInvocationSchema.safeParse(options.invocation);
  if (!invocation.success) return Promise.reject(new Error("INVALID_REQUEST: package invocation is not declared"));
  let invocationResources: readonly ResourceRef[];
  try { invocationResources = snapshotInvocationResources(options.invocationResources ?? []); }
  catch { return Promise.reject(new Error("INVALID_REQUEST: invocation context is invalid")); }
  const workerOptions = { ...options, invocationResources };
  if (typeof document !== "undefined") {
    if (!options.sandboxOrigin) return options.opaqueBrowser ? runInOpaqueBrowserFrame(source, dispatch, workerOptions) : Promise.reject(new Error("RUNTIME_UNAVAILABLE: isolated sandbox origin required"));
    return runInSandboxFrame(source, dispatch, options.sandboxOrigin, workerOptions);
  }
  const worker = startLaneWorker(
    () => new Worker("./sandbox/javascript/worker.ts"),
    new URL("./worker.ts", import.meta.url).href,
  );
  const controller = new AbortController();
  const timeout = Math.min(options.timeoutMs ?? 300_000, 300_000);
  return new Promise<JsonValue>((resolve, reject) => {
    let settled = false;
    const finish = (error?: Error, value?: JsonValue): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", abort);
      controller.abort();
      worker.terminate();
      error ? reject(error) : resolve(value ?? null);
    };
    const abort = (): void => finish(new Error("CANCELLED: JavaScript worker stopped"));
    const timer = setTimeout(() => finish(new Error("LIMIT_EXCEEDED: absolute job deadline")), timeout);
    options.signal?.addEventListener("abort", abort, { once: true });
    if (options.signal?.aborted) return abort();
    const outstanding = new Set<number>();
    worker.addEventListener("error", (event) => finish(new Error(event.message || "RUNTIME_UNAVAILABLE: worker failed")));
    worker.addEventListener("message", (event: MessageEvent<unknown>) => {
      if (!event.data || typeof event.data !== "object") return finish(new Error("INVALID_REQUEST: worker message"));
      const data = event.data as Record<string, unknown>;
      const request = extensionWireRequestSchema.safeParse(data);
      if (request.success) {
        if (outstanding.has(request.data.id) || outstanding.size >= RELEASE_JS_LIMITS.maxPending) return finish(new Error("INVALID_REQUEST: duplicate or excessive worker request"));
        outstanding.add(request.data.id);
        void dispatch(request.data, controller.signal).then((reply) => {
          const checked = extensionWireReplySchema.safeParse(reply);
          if (!checked.success || checked.data.id !== request.data.id) return finish(new Error("INVALID_REQUEST: malformed host reply"));
          outstanding.delete(request.data.id);
          if (!settled) worker.postMessage(checked.data);
        }, () => { outstanding.delete(request.data.id); if (!settled) worker.postMessage({ v: 1, type: "reply", id: request.data.id, ok: false, error: { code: "INTERNAL_ERROR", message: "Host operation failed" } }); });
      } else if (data.type === "result" && Object.keys(data).sort().join(",") === "logs,type,value" && Array.isArray(data.logs) && data.logs.length <= 64 && data.logs.every((line) => typeof line === "string" && new TextEncoder().encode(line).length <= 2_048)) {
        try { finish(undefined, decodeJsonValue(data.value)); } catch { finish(new Error("LIMIT_EXCEEDED: invalid worker result")); }
      } else if (data.type === "error" && Object.keys(data).sort().join(",") === "message,type") finish(errorFrom(data.message));
      else finish(new Error("INVALID_REQUEST: malformed worker message"));
    });
    worker.postMessage({ type: "start", source, invocation: invocation.data, invocationResources, ...(options.quickJsWasmBinary ? { wasmBinary: options.quickJsWasmBinary } : {}) });
  });
}
