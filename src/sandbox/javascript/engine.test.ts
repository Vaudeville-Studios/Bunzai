/** Hostile tests for the disposable QuickJS context and its sole value bridge. */
import { describe, expect, test } from "bun:test";
import { EXTENSION_WIRE_VERSION, type ExtensionWireReply } from "../../extensions/contracts/wire";
import { runGuest } from "./engine";

const dispatch = async (request: { id: number }): Promise<ExtensionWireReply> => ({ v: EXTENSION_WIRE_VERSION, type: "reply", id: request.id, ok: true, value: request.id });

describe("QuickJS extension engine", () => {
  test("exposes only the frozen host-selected invocation resource references", async () => {
    const resources = [{ kind: "character", id: "mira" }];
    const result = await runGuest(`return {resources:bunzai.context.invocation.resources, frozen:Object.isFrozen(bunzai.context.invocation.resources), itemFrozen:Object.isFrozen(bunzai.context.invocation.resources[0]), document:typeof document}`, dispatch, { invocationResources: resources });
    expect(result.value).toEqual({ resources, frozen: true, itemFrozen: true, document: "undefined" });
    expect(resources).toEqual([{ kind: "character", id: "mira" }]);
    await expect(runGuest("return 1", dispatch, { invocationResources: Array.from({ length: 17 }, (_, index) => ({ kind: "character", id: `item-${index}` })) })).rejects.toThrow();
  });

  test("guest has no host globals and denied operations remain rejected values", async () => {
    const result = await runGuest(`const denied=await bunzai.call("test.denied").catch(e=>e.message); return {fetch:typeof fetch,document:typeof document,process:typeof process,Bun:typeof Bun,require:typeof require,importScripts:typeof importScripts, denied}`, async (request) => ({
      v: EXTENSION_WIRE_VERSION, type: "reply", id: request.id, ok: false, error: { code: "PERMISSION_DENIED", message: "not granted" },
    }));
    expect(result.value).toEqual({ fetch: "undefined", document: "undefined", process: "undefined", Bun: "undefined", require: "undefined", importScripts: "undefined", denied: "PERMISSION_DENIED: not granted" });
  });

  test("an uncaught denied host reply settles an async handler as a rejection", async () => {
    const invocation = { kind: "command" as const, id: "run", input: null, commands: ["run"], events: [] };
    const run = runGuest(`bunzai.extension.define({commands:{run:()=>bunzai.call("content.read",{id:"Ada"})}})`, async (request) => ({
      v: EXTENSION_WIRE_VERSION, type: "reply", id: request.id, ok: false, error: { code: "STALE_PRINCIPAL", message: "access changed" },
    }), { invocation });
    await expect(run).rejects.toThrow("STALE_PRINCIPAL: access changed");
  });

  test("registers and invokes only a manifest-declared command", async () => {
    const value = await runGuest("bunzai.extension.define({commands:{'demo.run':input=>input},events:{}})", dispatch, {
      invocation: { kind: "command", id: "demo.run", input: { ok: true }, commands: ["demo.run"], events: [] },
    });
    expect(value.value).toEqual({ ok: true });
  });

  test("allows omitted command or event maps while still rejecting unknown registration keys", async () => {
    const value = await runGuest("bunzai.extension.define({commands:{'demo.run':input=>input}})", dispatch, {
      invocation: { kind: "command", id: "demo.run", input: { optional: true }, commands: ["demo.run"], events: [] },
    });
    expect(value.value).toEqual({ optional: true });
    await expect(runGuest("bunzai.extension.define({commands:{},events:{},extra:{}})", dispatch, {
      invocation: { kind: "command", id: "demo.run", input: null, commands: ["demo.run"], events: [] },
    })).rejects.toThrow("handler registration keys");
  });

  test("initialization cannot invoke capabilities or register undeclared IDs", async () => {
    let calls = 0;
    const initCall = await runGuest("bunzai.call('test.early').catch(()=>{}); bunzai.extension.define({commands:{'demo.run':()=>1},events:{}})", async (request) => {
      calls++;
      return dispatch(request);
    }, { invocation: { kind: "command", id: "demo.run", input: null, commands: ["demo.run"], events: [] } });
    expect(initCall.value).toBe(1);
    expect(calls).toBe(0);
    await expect(runGuest("bunzai.extension.define({commands:{'demo.other':()=>1},events:{}})", dispatch, {
      invocation: { kind: "command", id: "demo.run", input: null, commands: ["demo.run"], events: [] },
    })).rejects.toThrow("undeclared handler ID");
  });

  test("keeps concurrent request IDs separate when replies arrive out of order", async () => {
    const requests: number[] = [];
    const result = await runGuest(`return await Promise.all([bunzai.call("test.one"),bunzai.call("test.two")])`, (request) => {
      requests.push(request.id);
      return new Promise((resolve) => setTimeout(() => resolve({ v: EXTENSION_WIRE_VERSION, type: "reply", id: request.id, ok: true, value: request.operation }), request.operation === "test.one" ? 10 : 1));
    });
    expect(requests).toEqual([1, 2]);
    expect(result.value).toEqual(["test.one", "test.two"]);
  });

  test("bounds serialized bridge arguments before host JSON parsing", async () => {
    let calls = 0;
    const result = await runGuest(`return await bunzai.call("test.oversized", "x".repeat(260000)).catch(error=>error.message)`, async (request) => {
      calls++;
      return dispatch(request);
    });
    expect(calls).toBe(0);
    expect(result.value).toBe("LIMIT_EXCEEDED: host request exceeds value byte limit");
  });

  test("caps guest logs by UTF-8 bytes without splitting multibyte characters", async () => {
    const result = await runGuest(`console.log("é".repeat(1200)); return null`, dispatch);
    expect(new TextEncoder().encode(result.logs[0]!).byteLength).toBeLessThanOrEqual(2_048);
    expect(result.logs[0]).not.toContain("�");
    expect(result.logs[0]!.length).toBe(1_024);
  });

  test("excludes tracked 30 and 120 second host waits from active VM time", async () => {
    for (const hostWaitMs of [30_000, 120_000]) {
      let clock = 100;
      const result = await runGuest("return await bunzai.call('test.wait')", async (request) => {
        await new Promise((resolve) => setTimeout(resolve, 1));
        clock += hostWaitMs;
        return { v: EXTENSION_WIRE_VERSION, type: "reply", id: request.id, ok: true, value: hostWaitMs };
      }, { now: () => clock });
      expect(result.value).toBe(hostWaitMs);
    }
  });

  test("does not charge a pending host approval to the active VM deadline", async () => {
    let clock = 0;
    const waiting = runGuest("return await bunzai.call('test.approval.wait')", (request) => new Promise((resolve) => {
      setTimeout(() => { clock = 11_000; setTimeout(() => resolve({ v: EXTENSION_WIRE_VERSION, type: "reply", id: request.id, ok: true, value: "approved" }), 10); }, 1);
    }), { now: () => clock });
    await expect(waiting.then(({ value }) => value)).resolves.toBe("approved");
  });

  test("interrupts synchronous loops and memory pressure", async () => {
    await expect(runGuest("while(true){}", dispatch, { cpuMs: 30 })).rejects.toThrow();
    await expect(runGuest("let x=''; while(true) x += '1234567890';", dispatch, { memoryBytes: 1_000_000 })).rejects.toThrow();
  });

  test("uses a capped WebAssembly memory and records the actual worker heap", async () => {
    const samples: number[] = [];
    await runGuest("const rows=[]; for(let i=0;i<50000;i++) rows.push({i, text:'allocation'}); return rows.length", dispatch, { onWasmMemorySample: (bytes) => samples.push(bytes) });
    expect(samples.length).toBe(2);
    expect(Math.max(...samples)).toBeLessThanOrEqual(128 * 1024 * 1024);
  });

  test("starts QuickJS from inline WebAssembly bytes for the opaque Browser bootstrap", async () => {
    const wasm = new Uint8Array(await Bun.file("node_modules/@jitl/quickjs-wasmfile-release-sync/dist/emscripten-module.wasm").arrayBuffer());
    expect((await runGuest("return 6*7", dispatch, { wasmBinary: wasm })).value).toBe(42);
  });

  test("rejects guest module loading and oversized source before VM creation", async () => {
    await expect(runGuest("return await import('node:fs')", dispatch)).rejects.toThrow();
    await expect(runGuest("x".repeat(1_048_577), dispatch)).rejects.toThrow("source-size");
  });
});
