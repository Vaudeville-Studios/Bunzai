/** Regression coverage for the regex worker's hard termination boundary. */
import { expect, test } from "bun:test";
import { runRegexBatchSandboxed, runRegexSandboxed } from "./run-in-worker";

test("static Pages refuses regex when its opaque worker bundle is unavailable", async () => {
  const scope = globalThis as typeof globalThis & { document?: Document };
  const prior = scope.document;
  const dataScope = globalThis as typeof globalThis & { __BUNZAI_POCKET_DATA__?: unknown };
  const priorData = dataScope.__BUNZAI_POCKET_DATA__;
  scope.document = {
    querySelector: (selector: string) => selector === 'meta[name="bunzai-runtime"]' ? { getAttribute: () => "browser" } : null,
  } as unknown as Document;
  Reflect.deleteProperty(dataScope, "__BUNZAI_POCKET_DATA__");
  try {
    const result = await runRegexSandboxed("sample", [], {
      phase: "output",
    });
    expect(result).toMatchObject({ ok: false, error: expect.stringContaining("isolated sandbox origin") });
  } finally {
    if (prior) scope.document = prior;
    else Reflect.deleteProperty(scope, "document");
    if (priorData === undefined) Reflect.deleteProperty(dataScope, "__BUNZAI_POCKET_DATA__");
    else dataScope.__BUNZAI_POCKET_DATA__ = priorData;
  }
});

test("terminates an unresponsive worker at the hard deadline", async () => {
  let terminated = false;
  const worker = {
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    postMessage: () => undefined,
    terminate: () => { terminated = true; },
  } as unknown as Worker;
  const result = await runRegexSandboxed("sample", [], {
    phase: "output",
    hardTimeoutMs: 5,
    workerFactory: () => worker,
  });
  expect(result).toMatchObject({ ok: false, reason: "timeout" });
  expect(terminated).toBe(true);
});

test("returns an error result when the browser refuses to create a worker", async () => {
  const result = await runRegexSandboxed("sample", [], {
    phase: "output",
    workerFactory: () => { throw new Error("blocked by policy"); },
  });
  expect(result).toMatchObject({ ok: false, reason: "error", error: expect.stringContaining("blocked by policy") });
});

test("terminates a worker when posting its request fails", async () => {
  let terminated = false;
  const worker = {
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    postMessage: () => { throw new Error("clone failed"); },
    terminate: () => { terminated = true; },
  } as unknown as Worker;
  const result = await runRegexSandboxed("sample", [], {
    phase: "output",
    workerFactory: () => worker,
  });
  expect(result).toMatchObject({ ok: false, reason: "error", error: expect.stringContaining("clone failed") });
  expect(terminated).toBe(true);
});

/** A worker that answers the first message it is posted with `reply(request)`. */
function echoWorker(reply: (request: { runId: number; items?: unknown }) => unknown): { worker: Worker; posted: unknown[]; terminated: () => boolean } {
  let listener: ((e: MessageEvent) => void) | undefined;
  let done = false;
  const posted: unknown[] = [];
  const worker = {
    addEventListener: (type: string, fn: (e: MessageEvent) => void) => { if (type === "message") listener = fn; },
    removeEventListener: () => undefined,
    postMessage: (request: { runId: number }) => { posted.push(request); queueMicrotask(() => listener?.({ data: reply(request) } as MessageEvent)); },
    terminate: () => { done = true; },
  } as unknown as Worker;
  return { worker, posted, terminated: () => done };
}

test("a batch goes to the worker as one value-only request and the texts come back, then the worker is gone", async () => {
  const e = echoWorker((r) => ({ runId: r.runId, ok: true, texts: ["x", "y"] }));
  const result = await runRegexBatchSandboxed([{ text: "a", depth: 0 }, { text: "b", depth: 1 }], [], { phase: "display", workerFactory: () => e.worker });
  expect(result).toEqual({ ok: true, texts: ["x", "y"] });
  expect(e.posted).toEqual([{ runId: expect.any(Number), items: [{ text: "a", depth: 0 }, { text: "b", depth: 1 }], rules: [], options: { phase: "display" } }]);
  expect(e.terminated()).toBe(true);
});

test("a batch answered with the wrong number of texts is an error, never a partial success", async () => {
  const e = echoWorker((r) => ({ runId: r.runId, ok: true, texts: ["x"] }));
  const result = await runRegexBatchSandboxed([{ text: "a", depth: 0 }, { text: "b", depth: 1 }], [], { phase: "display", workerFactory: () => e.worker });
  expect(result).toMatchObject({ ok: false, reason: "error" });
});

test("an empty batch needs no worker", async () => {
  const result = await runRegexBatchSandboxed([], [], { phase: "display", workerFactory: () => { throw new Error("must not start"); } });
  expect(result).toEqual({ ok: true, texts: [] });
});

test("a batch that never answers is stopped at its deadline and the worker is terminated", async () => {
  const e = echoWorker(() => ({ runId: -5, ok: true, texts: [] }));
  const result = await runRegexBatchSandboxed([{ text: "a", depth: 0 }], [], { phase: "display", hardTimeoutMs: 5, workerFactory: () => e.worker });
  expect(result).toMatchObject({ ok: false, reason: "timeout" });
  expect(e.terminated()).toBe(true);
});
