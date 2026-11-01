/** QuickJS guest context with bounded resources and a value-only asynchronous capability bridge. */
import { newQuickJSWASMModuleFromVariant, newVariant, type QuickJSHandle } from "quickjs-emscripten-core";
import variant from "@jitl/quickjs-wasmfile-release-sync";
import { decodeJsonValue, MAX_VALUE_BYTES, type JsonValue } from "../../extensions/contracts/value";
import { EXTENSION_WIRE_VERSION, extensionInvocationSchema, extensionWireReplySchema, extensionWireRequestSchema, type ExtensionInvocation, type ExtensionWireReply, type ExtensionWireRequest } from "../../extensions/contracts/wire";
import { snapshotInvocationResources } from "../../extensions/contracts/invocation-context";
import type { ResourceRef } from "../../extensions/contracts/operation";
import { assertJavaScriptSource, RELEASE_JS_LIMITS } from "./limits";

export type GuestDispatch = (message: ExtensionWireRequest) => Promise<ExtensionWireReply>;

function boundedUtf8(parts: Iterable<string>, maxBytes: number): string {
  let output = "";
  let used = 0;
  for (const part of parts) {
    for (const character of part) {
      const point = character.codePointAt(0)!;
      const bytes = point <= 0x7f ? 1 : point <= 0x7ff ? 2 : point <= 0xffff ? 3 : 4;
      if (used + bytes > maxBytes) return output;
      output += character;
      used += bytes;
    }
  }
  return output;
}

/** One disposable runtime per job; host functions only move validated JSON and short logs. */
export async function runGuest(
  source: string,
  dispatch: GuestDispatch,
  options: { now?: () => number; cpuMs?: number; memoryBytes?: number; maxPending?: number; wasmUrl?: string; wasmBinary?: Uint8Array; invocation?: ExtensionInvocation; invocationResources?: readonly ResourceRef[]; onWasmMemorySample?: (bytes: number) => void } = {},
): Promise<{ value: JsonValue; logs: string[] }> {
  assertJavaScriptSource(source);
  const invocation = options.invocation ? extensionInvocationSchema.parse(options.invocation) : undefined;
  const invocationResources = snapshotInvocationResources(options.invocationResources ?? []);
  const now = options.now ?? (() => performance.now());
  const started = now();
  let cpuUsed = 0;
  let hostWaitMs = 0;
  let hostWaitStarted: number | undefined;
  let sliceStarted = started;
  const cpuLimit = Math.min(options.cpuMs ?? RELEASE_JS_LIMITS.cpuMs, RELEASE_JS_LIMITS.cpuMs);
  const timed = <T>(run: () => T): T => {
    sliceStarted = now();
    try { return run(); } finally { cpuUsed += Math.max(0, now() - sliceStarted); }
  };
  const pendingLimit = Math.min(options.maxPending ?? RELEASE_JS_LIMITS.maxPending, RELEASE_JS_LIMITS.maxPending);
  const boundedVariant = newVariant(variant, {
    wasmMemory: async () => new WebAssembly.Memory({ initial: 256, maximum: RELEASE_JS_LIMITS.wasmMemoryBytes / 65_536 }),
    ...(options.wasmBinary ? { wasmBinary: async () => options.wasmBinary!.slice().buffer } : {}),
    ...(options.wasmUrl ? { wasmLocation: options.wasmUrl } : {}),
  });
  const module = await newQuickJSWASMModuleFromVariant(boundedVariant);
  options.onWasmMemorySample?.(module.getWasmMemory().buffer.byteLength);
  const runtime = module.newRuntime();
  runtime.setMemoryLimit(Math.min(options.memoryBytes ?? RELEASE_JS_LIMITS.memoryBytes, RELEASE_JS_LIMITS.memoryBytes));
  runtime.setMaxStackSize(RELEASE_JS_LIMITS.stackBytes);
  runtime.setInterruptHandler(() => cpuUsed + now() - sliceStarted >= cpuLimit);
  const context = runtime.newContext();
  const jsonObject = context.getProp(context.global, "JSON");
  const jsonParse = context.getProp(jsonObject, "parse");
  const messageOf = (handle: QuickJSHandle): string => {
    const message = context.getProp(handle, "message");
    try { if (context.typeof(message) === "string") return context.getString(message).slice(0, 500); }
    finally { message.dispose(); }
    const dumped = context.dump(handle);
    return (typeof dumped === "string" ? dumped : "INTERNAL_ERROR").slice(0, 500);
  };
  const pending = new Map<number, { resolve: ReturnType<typeof context.newFunction>; reject: ReturnType<typeof context.newFunction> }>();
  const logs: string[] = [];
  let nextId = 0;
  let guestPromise: QuickJSHandle | undefined;
  const handlers = new Map<string, QuickJSHandle>();
  let registered = false;
  let invocationStarted = !invocation;
  try {
    const hostCall = context.newFunction("__hostCall", (operation, argsText, resolve, reject) => {
      if (!invocationStarted) throw new Error("PERMISSION_DENIED: calls are unavailable during package initialization");
      if (pending.size >= pendingLimit) throw new Error("LIMIT_EXCEEDED: too many pending requests");
      if (context.typeof(operation) !== "string" || context.typeof(argsText) !== "string" || context.typeof(resolve) !== "function" || context.typeof(reject) !== "function") throw new Error("INVALID_REQUEST: malformed guest bridge call");
      const argsJson = context.getString(argsText);
      if (new TextEncoder().encode(argsJson).byteLength > MAX_VALUE_BYTES) throw new Error("LIMIT_EXCEEDED: host request exceeds value byte limit");
      const operationName = context.getString(operation);
      if (new TextEncoder().encode(operationName).byteLength > 160) throw new Error("INVALID_REQUEST: malformed operation ID");
      const id = ++nextId;
      const message: ExtensionWireRequest = extensionWireRequestSchema.parse({
        v: EXTENSION_WIRE_VERSION, type: "request", id, operation: operationName,
        args: decodeJsonValue(JSON.parse(argsJson)),
      });
      if (pending.size === 0) hostWaitStarted = now();
      pending.set(id, { resolve: resolve.dup(), reject: reject.dup() });
      void dispatch(message).then((reply) => {
        const checked = extensionWireReplySchema.safeParse(reply);
        if (!checked.success || checked.data.id !== id) throw new Error("INVALID_REQUEST: mismatched host reply");
        const deferred = pending.get(id);
        if (!deferred) return;
        let handle: QuickJSHandle;
        if (checked.data.ok) {
          const json = context.newString(JSON.stringify(checked.data.value));
          const parsed = timed(() => context.callFunction(jsonParse, jsonObject, json));
          json.dispose();
          if (parsed.error) { const detail = String(context.dump(parsed.error)); parsed.error.dispose(); throw new Error(detail); }
          handle = parsed.value;
        } else handle = context.newError(new Error(`${checked.data.error.code}: ${checked.data.error.message}`));
        const called = timed(() => context.callFunction(checked.data.ok ? deferred.resolve : deferred.reject, context.undefined, handle));
        handle.dispose();
        deferred.resolve.dispose(); deferred.reject.dispose();
        if (called.error) called.error.dispose(); else called.value.dispose();
        pending.delete(id);
        if (pending.size === 0 && hostWaitStarted !== undefined) { hostWaitMs += now() - hostWaitStarted; hostWaitStarted = undefined; }
      }).catch(() => {
        const deferred = pending.get(id);
        if (!deferred) return;
        pending.delete(id);
        if (pending.size === 0 && hostWaitStarted !== undefined) { hostWaitMs += now() - hostWaitStarted; hostWaitStarted = undefined; }
        const error = context.newError(new Error("INTERNAL_ERROR: host request failed"));
        const called = timed(() => context.callFunction(deferred.reject, context.undefined, error));
        error.dispose(); deferred.resolve.dispose(); deferred.reject.dispose();
        if (called.error) called.error.dispose(); else called.value.dispose();
      });
    });
    const register = context.newFunction("__register", (definitions) => {
      if (!invocation || registered || context.typeof(definitions) !== "object") throw new Error("INVALID_REQUEST: invalid handler registration");
      const rootProps = context.getOwnPropertyNames(definitions, { strings: true });
      if (rootProps.error) { rootProps.error.dispose(); throw new Error("INVALID_REQUEST: handler registration shape"); }
      const rootKeys = rootProps.value.map((key) => String(context.dump(key)));
      rootProps.value.dispose();
      if (rootKeys.some((key) => key !== "commands" && key !== "events")) throw new Error("INVALID_REQUEST: handler registration keys");
      const add = (kind: "command" | "event", allowed: readonly string[]): void => {
        if (!rootKeys.includes(kind === "command" ? "commands" : "events")) return;
        const map = context.getProp(definitions, kind === "command" ? "commands" : "events");
        if (context.typeof(map) !== "object") { map.dispose(); throw new Error("INVALID_REQUEST: handler map"); }
        const props = context.getOwnPropertyNames(map, { strings: true });
        if (props.error) { props.error.dispose(); map.dispose(); throw new Error("INVALID_REQUEST: handler map"); }
        for (const keyHandle of props.value) {
          const id = context.getString(keyHandle);
          keyHandle.dispose();
          if (!allowed.includes(id)) { props.value.dispose(); map.dispose(); throw new Error("INVALID_REQUEST: undeclared handler ID"); }
          const key = context.newString(id);
          const handler = context.getProp(map, key);
          key.dispose();
          if (context.typeof(handler) !== "function") { handler.dispose(); props.value.dispose(); map.dispose(); throw new Error("INVALID_REQUEST: handler must be a function"); }
          handlers.set(`${kind}:${id}`, handler.dup());
          handler.dispose();
        }
        props.value.dispose();
        map.dispose();
      };
      add("command", invocation.commands);
      add("event", invocation.events);
      registered = true;
    });
    const log = context.newFunction("__guestLog", (...values) => {
      const chunks: string[] = [];
      for (const value of values.slice(0, 16)) {
        const type = context.typeof(value);
        chunks.push(type === "string" ? context.getString(value) : type === "object" || type === "function" ? "[object]" : String(context.dump(value)));
      }
      logs.push(boundedUtf8(chunks.flatMap((part, index) => index ? [" ", part] : [part]), RELEASE_JS_LIMITS.maxLogBytes));
      if (logs.length > 64) logs.shift();
    });
    context.setProp(context.global, "__hostCall", hostCall);
    context.setProp(context.global, "__guestLog", log);
    context.setProp(context.global, "__register", register);
    hostCall.dispose(); log.dispose(); register.dispose();
    const resourceJson = context.newString(JSON.stringify(invocationResources));
    const parsedResources = timed(() => context.callFunction(jsonParse, jsonObject, resourceJson));
    resourceJson.dispose();
    if (parsedResources.error) { parsedResources.error.dispose(); throw new Error("RUNTIME_UNAVAILABLE: invocation context bootstrap failed"); }
    context.setProp(context.global, "__invocationResources", parsedResources.value);
    parsedResources.value.dispose();
    const bootstrap = timed(() => context.evalCode(`globalThis.console=Object.freeze({log:__guestLog,info:__guestLog,warn:__guestLog,error:__guestLog});const resources=globalThis.__invocationResources;for(const item of resources)Object.freeze(item);Object.freeze(resources);globalThis.bunzai=Object.freeze({call:(operation,args=null)=>new Promise((resolve,reject)=>__hostCall(operation,JSON.stringify(args),resolve,reject)),extension:Object.freeze({define:__register}),context:Object.freeze({invocation:Object.freeze({resources})})});delete globalThis.__invocationResources;delete globalThis.__guestLog;`, "bunzai-bootstrap.js"));
    if (bootstrap.error) { bootstrap.error.dispose(); throw new Error("RUNTIME_UNAVAILABLE: guest bootstrap failed"); }
    bootstrap.value.dispose();
    const evaluated = timed(() => context.evalCode(invocation ? source : `(async()=>{${source}\n})()`, "extension-main.js"));
    if (evaluated.error) { const error = messageOf(evaluated.error); evaluated.error.dispose(); throw new Error(error); }
    if (invocation) {
      evaluated.value.dispose();
      if (!registered) throw new Error("INVALID_REQUEST: package did not register handlers");
      const handler = handlers.get(`${invocation.kind}:${invocation.id}`);
      if (!handler) throw new Error("INVALID_REQUEST: declared handler is not registered");
      invocationStarted = true;
      const json = context.newString(JSON.stringify(invocation.input));
      const parsed = timed(() => context.callFunction(jsonParse, jsonObject, json));
      json.dispose();
      if (parsed.error) { const error = messageOf(parsed.error); parsed.error.dispose(); throw new Error(error); }
      const invoked = timed(() => context.callFunction(handler, context.undefined, parsed.value));
      parsed.value.dispose();
      if (invoked.error) { const error = messageOf(invoked.error); invoked.error.dispose(); throw new Error(error); }
      guestPromise = invoked.value;
    } else guestPromise = evaluated.value;
    for (;;) {
      const pumped = timed(() => runtime.executePendingJobs(RELEASE_JS_LIMITS.maxPumpJobs));
      if (pumped.error) { const error = messageOf(pumped.error); pumped.error.dispose(); throw new Error(error); }
      if (pumped.value > 0) continue;
      const state = context.getPromiseState(guestPromise);
      if (state.type === "fulfilled") {
        const value = state.value;
        const dumped = context.dump(value);
        const output = dumped === undefined ? null : decodeJsonValue(dumped);
        value.dispose();
        options.onWasmMemorySample?.(module.getWasmMemory().buffer.byteLength);
        return { value: output, logs };
      }
      if (state.type === "rejected") {
        const rejected = state.error;
        const error = messageOf(rejected);
        rejected.dispose();
        throw new Error(error);
      }
      if (cpuUsed >= cpuLimit) throw new Error("LIMIT_EXCEEDED: guest CPU deadline");
      const wallNow = now();
      const activeHostWaitMs = pending.size > 0 && hostWaitStarted !== undefined ? wallNow - hostWaitStarted : 0;
      if (wallNow - started - hostWaitMs - activeHostWaitMs >= RELEASE_JS_LIMITS.activeMs) throw new Error("LIMIT_EXCEEDED: active VM deadline");
      await new Promise<void>((resolve) => setTimeout(resolve, 1));
    }
  } finally {
    for (const deferred of pending.values()) { deferred.reject.dispose(); deferred.resolve.dispose(); }
    pending.clear();
    for (const handler of handlers.values()) handler.dispose();
    jsonParse.dispose();
    jsonObject.dispose();
    if (guestPromise?.alive) guestPromise.dispose();
    context.dispose();
    runtime.dispose();
  }
}
