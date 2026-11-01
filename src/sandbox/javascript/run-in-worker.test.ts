/** Public worker-boundary checks for termination, replies and late host completions. */
import { expect, test } from "bun:test";
import { EXTENSION_WIRE_VERSION } from "../../extensions/contracts/wire";
import { runJavaScriptInWorker } from "./run-in-worker";

const invocation = { kind: "command" as const, id: "demo.echo", input: { n: 4 }, commands: ["demo.echo"], events: [] };

test("executes in a real worker and resolves asynchronous broker values", async () => {
  const value = await runJavaScriptInWorker("bunzai.extension.define({commands:{'demo.echo':input=>bunzai.call('test.echo',input)},events:{}})", async (request) => ({ v: EXTENSION_WIRE_VERSION, type: "reply", id: request.id, ok: true, value: request.args }), { invocation });
  expect(value).toEqual({ n: 4 });
});

test("settles an uncaught strict broker error through the real worker", async () => {
  const result = await runJavaScriptInWorker("bunzai.extension.define({commands:{'demo.echo':()=>bunzai.call('test.read',null)},events:{}})", async (request) => ({
    v: EXTENSION_WIRE_VERSION, type: "reply", id: request.id, ok: false, error: { code: "OPERATION_FAILED", message: "access changed" },
  }), { invocation }).then(() => null, (error: Error) => error.message);
  expect(result).toContain("OPERATION_FAILED: access changed");
});

test("accepts inline WASM bytes for hosts that bake assets into a compiled worker", async () => {
  const wasmBinary = new Uint8Array(await Bun.file(new URL("../../../node_modules/@jitl/quickjs-wasmfile-release-sync/dist/emscripten-module.wasm", import.meta.url)).arrayBuffer());
  const value = await runJavaScriptInWorker("bunzai.extension.define({commands:{'demo.echo':()=>42},events:{}})", async () => { throw new Error("unused"); }, { invocation, quickJsWasmBinary: wasmBinary });
  expect(value).toBe(42);
});

test("transfers immutable host invocation refs through the terminable worker boundary", async () => {
  const resources = [{ kind: "character", id: "mira" }];
  const value = await runJavaScriptInWorker("bunzai.extension.define({commands:{'demo.echo':()=>({resources:bunzai.context.invocation.resources,frozen:Object.isFrozen(bunzai.context.invocation.resources)})},events:{}})", async () => { throw new Error("unused"); }, { invocation, invocationResources: resources });
  expect(value).toEqual({ resources, frozen: true });
});

test("worker deletes settled request IDs and ignores duplicate or unknown replies", async () => {
  const worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
  const result = await new Promise<unknown>((resolve, reject) => {
    const timer = setTimeout(() => { worker.terminate(); reject(new Error("worker reply test timed out")); }, 2_000);
    let calls = 0;
    worker.addEventListener("message", (event: MessageEvent<unknown>) => {
      const message = event.data as Record<string, unknown>;
      if (message.type === "error") { clearTimeout(timer); worker.terminate(); reject(new Error(String(message.message))); }
      if (message.type === "result") { clearTimeout(timer); worker.terminate(); resolve(message.value); }
      if (message.type !== "request") return;
      const request = message as { id: number; operation: string };
      calls++;
      const reply = { v: 1, type: "reply", id: request.id, ok: true, value: request.operation };
      worker.postMessage(reply);
      if (calls === 1) { worker.postMessage(reply); worker.postMessage({ ...reply, id: 999 }); }
    });
    worker.postMessage({ type: "start", source: "bunzai.extension.define({commands:{'demo.echo':async()=>{await bunzai.call('test.first',null);return bunzai.call('test.second',null)}},events:{}})", invocation });
  });
  expect(result).toBe("test.second");
});

test("Bun worker caps concurrently pending broker requests at the shared release limit", async () => {
  let calls = 0;
  const error = await runJavaScriptInWorker("bunzai.extension.define({commands:{'demo.echo':()=>Promise.all(Array.from({length:33},(_,i)=>bunzai.call('test.echo',{i})))},events:{}})", async () => {
    calls++;
    return await new Promise(() => {});
  }, { invocation, timeoutMs: 2_000 }).then(() => null, (caught: Error) => caught);
  expect(error?.message).toContain("LIMIT_EXCEEDED");
  expect(calls).toBeLessThanOrEqual(32);
});

test("abort terminates a running worker and ignores late broker replies", async () => {
  const controller = new AbortController();
  let observedSignal: AbortSignal | undefined;
  let started!: () => void;
  const requested = new Promise<void>((resolve) => { started = resolve; });
  const run = runJavaScriptInWorker("bunzai.extension.define({commands:{'demo.echo':()=>bunzai.call('test.wait')},events:{}})", async (request, signal) => {
    observedSignal = signal;
    started();
    await new Promise((resolve) => setTimeout(resolve, 30));
    return { v: EXTENSION_WIRE_VERSION, type: "reply", id: request.id, ok: true, value: 1 };
  }, { invocation, signal: controller.signal });
  await requested;
  controller.abort();
  const error = await run.then(() => null, (caught: Error) => caught);
  await new Promise((resolve) => setTimeout(resolve, 40));
  expect(error?.message).toContain("CANCELLED");
  expect(observedSignal?.aborted).toBe(true);
});

test("absolute deadline terminates a worker even when the host request never settles", async () => {
  const error = await runJavaScriptInWorker("bunzai.extension.define({commands:{'demo.echo':()=>bunzai.call('test.wait')},events:{}})", async () => new Promise(() => {}), {
    invocation, timeoutMs: 300,
  }).then(() => null, (caught: Error) => caught);
  expect(error?.message).toContain("absolute job deadline");
});
