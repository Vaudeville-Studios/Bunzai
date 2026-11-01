/** Purpose: prove terminal regex admission rejects overload before starting workers and releases slots. */
import { describe, expect, test } from "bun:test";
import { createTerminalRegexPreviewServices } from "./regex-preview";
import { terminalRegexWorkerAdmission } from "./regex-admission";
import { runTerminalSceneRegex } from "./regex-preview";

class FakeWorker {
  private listeners = new Map<string, (event: MessageEvent<unknown> | ErrorEvent) => void>();
  job: { runId: number } | null = null;
  stopped = false;
  addEventListener(type: string, listener: (event: MessageEvent<unknown> | ErrorEvent) => void): void { this.listeners.set(type, listener); }
  removeEventListener(type: string): void { this.listeners.delete(type); }
  postMessage(value: { runId: number }): void { this.job = value; }
  terminate(): void { this.stopped = true; }
  reply(): void { this.listeners.get("message")?.({ data: { runId: this.job!.runId, ok: true, result: { text: "done" } } } as MessageEvent<unknown>); }
}

const input = { text: "sample", phase: "display", rules: [] };

describe("Terminal regex worker admission", () => {
  test("runs the scene turn batch through the isolated worker", async () => {
    const answer = await runTerminalSceneRegex({ sceneId: "scene-1", turnId: "turn-1", rules: [{ id: "redact", label: "Redact", find: "hello", flags: "gi", replace: "greetings", phases: ["prompt"], enabled: true, sortOrder: 0 }],
      items: [{ index: 0, role: "user", depth: 0, text: "Say hello." }], macros: { user: "User", char: "Vera" }, phase: "prompt" }, new AbortController().signal);
    expect(answer).toEqual({ status: "scene-regex-result", answer: { kind: "done", texts: { "0": "Say greetings." } } });
  });

  test("caps concurrent workers before construction and releases capacity on completion", async () => {
    expect(terminalRegexWorkerAdmission.active()).toBe(0);
    const workers: FakeWorker[] = [];
    const services = createTerminalRegexPreviewServices(() => {
      const worker = new FakeWorker(); workers.push(worker); return worker as unknown as Worker;
    });
    const controller = Array.from({ length: 6 }, () => new AbortController());
    const runs = controller.map((item) => services.run(input, item.signal));
    expect(workers).toHaveLength(4);
    expect(terminalRegexWorkerAdmission.active()).toBe(4);
    expect(await Promise.allSettled(runs.slice(4))).toMatchObject([{ status: "rejected" }, { status: "rejected" }]);
    workers.forEach((worker) => worker.reply());
    expect(await Promise.all(runs.slice(0, 4))).toEqual(Array.from({ length: 4 }, () => ({ ok: true, text: "done", error: null })));
    expect(workers.every((worker) => worker.stopped)).toBe(true);
    expect(terminalRegexWorkerAdmission.active()).toBe(0);
  });

  test("an aborted run frees the slot for the next request", async () => {
    const workers: FakeWorker[] = [];
    const services = createTerminalRegexPreviewServices(() => {
      const worker = new FakeWorker(); workers.push(worker); return worker as unknown as Worker;
    });
    const controller = new AbortController();
    const cancelled = services.run(input, controller.signal);
    controller.abort();
    expect(await Promise.allSettled([cancelled])).toMatchObject([{ status: "rejected" }]);
    expect(terminalRegexWorkerAdmission.active()).toBe(0);
    const next = services.run(input, new AbortController().signal);
    expect(workers).toHaveLength(2);
    workers[1]!.reply();
    await expect(next).resolves.toMatchObject({ ok: true, text: "done" });
  });

  test("worker construction failure releases its reserved slot", async () => {
    const services = createTerminalRegexPreviewServices(() => { throw new Error("worker unavailable"); });
    await expect(services.run(input, new AbortController().signal)).rejects.toThrow("worker unavailable");
    expect(terminalRegexWorkerAdmission.active()).toBe(0);
  });
});
