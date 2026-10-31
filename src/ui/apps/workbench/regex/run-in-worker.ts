/**
 * Browser shell for regex execution: posts value-only work to the sandbox-origin worker and
 * terminates the worker at a hard wall-clock deadline or when a superseding preview aborts. One text
 * (the bench) or a batch of texts each at its own depth (a scene's messages) go through the same
 * worker, the same engine and the same deadline logic; there is no other way to run an imported rule.
 */
import type { RegexRunOptions, RegexRunResult } from "../../../../core/regex";
import type { RegexRule } from "../../../../entities/regex/schema";
import { isBrowserStudio } from "../../../../browser-mode";
import { toErrorMessage } from "../../../_shared/error-message";
import { createOpaqueRegexWorker } from "../../../../sandbox/regex/opaque-worker";

const HARD_TIMEOUT_MS = 750;
/** A batch earns a little more time per text, up to a ceiling. */
const BATCH_MS_PER_ITEM = 5;
const BATCH_TIMEOUT_CEILING_MS = 5_000;
let runSequence = 0;

export type RegexFailure = { ok: false; reason: "timeout" | "cancelled" | "error"; error: string };
export type RegexSandboxResult = { ok: true; result: RegexRunResult } | RegexFailure;
export type RegexBatchResult = { ok: true; texts: string[] } | RegexFailure;

export interface RegexSandboxOptions extends Omit<RegexRunOptions, "now"> {
  signal?: AbortSignal;
  hardTimeoutMs?: number;
  /** Test seam for proving termination without starting a real browser worker. */
  workerFactory?: () => Worker;
}

const workerHref = (): string => {
  if (typeof document !== "undefined") {
    const origin = document.querySelector('meta[name="vaude-sandbox-origin"]')?.getAttribute("content")?.trim();
    if (origin?.startsWith("http://127.0.0.1:")) return `${origin.replace(/\/$/, "")}/sandbox/regex-worker.js`;
    return new URL("sandbox/regex-worker.js", document.baseURI).href;
  }
  return new URL("../../../../sandbox/regex/worker.ts", import.meta.url).href;
};

/** Posts one request to a fresh worker and settles with `read(data)` of its answer, or a failure. Never throws. */
function callWorker<T>(
  work: Record<string, unknown>,
  options: RegexSandboxOptions,
  ceiling: number,
  read: (data: { result?: unknown; texts?: unknown }) => T | null,
): Promise<{ ok: true; value: T } | RegexFailure> {
  const browser = isBrowserStudio();
  const regexWorkerSource = browser ? (globalThis as typeof globalThis & { __BUNZAI_POCKET_DATA__?: { browserSandbox?: { regexWorkerSource?: string } } }).__BUNZAI_POCKET_DATA__?.browserSandbox?.regexWorkerSource : undefined;
  if (browser && !options.workerFactory && !regexWorkerSource) {
    return Promise.resolve({
      ok: false,
      reason: "error",
      error: "Regex execution needs the installed Bunzai app so it can run on an isolated sandbox origin.",
    });
  }
  const runId = ++runSequence;
  const deadline = Math.max(1, Math.min(options.hardTimeoutMs ?? ceiling, ceiling));
  const { signal, hardTimeoutMs: _hardTimeoutMs, workerFactory, ...wireOptions } = options;
  return new Promise((resolve) => {
    let worker: Worker;
    try {
      worker = workerFactory?.() ?? (browser ? createOpaqueRegexWorker(regexWorkerSource!) : new Worker(workerHref(), { type: "module" }));
    } catch (error) {
      resolve({
        ok: false,
        reason: "error",
        error: `regex worker failed to start: ${toErrorMessage(error)}`,
      });
      return;
    }
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (result: { ok: true; value: T } | RegexFailure): void => {
      if (settled) return;
      settled = true;
      if (timer !== undefined) clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      worker.terminate();
      resolve(result);
    };
    const abort = (): void => finish({ ok: false, reason: "cancelled", error: "regex preview cancelled" });
    timer = setTimeout(
      () => finish({ ok: false, reason: "timeout", error: `regex worker exceeded ${deadline}ms` }),
      deadline,
    );
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) {
      abort();
      return;
    }
    worker.addEventListener("message", (event: MessageEvent<unknown>) => {
      const data = event.data as { runId?: unknown; ok?: unknown; result?: unknown; texts?: unknown; error?: unknown };
      if (data.runId !== runId) return;
      const value = data.ok === true ? read(data) : null;
      if (value !== null) finish({ ok: true, value });
      else finish({ ok: false, reason: "error", error: typeof data.error === "string" ? data.error : "regex worker failed" });
    });
    worker.addEventListener("error", () =>
      finish({ ok: false, reason: "error", error: "regex worker failed to load" }));
    try {
      worker.postMessage({ runId, ...work, options: wireOptions });
    } catch (error) {
      finish({
        ok: false,
        reason: "error",
        error: `regex worker rejected the request: ${toErrorMessage(error)}`,
      });
    }
  });
}

/** Execute a rule set outside the UI thread. This function never throws. */
export async function runRegexSandboxed(
  text: string,
  rules: readonly RegexRule[],
  options: RegexSandboxOptions,
): Promise<RegexSandboxResult> {
  const out = await callWorker({ text, rules }, options, HARD_TIMEOUT_MS, (d) => (d.result && typeof d.result === "object" ? (d.result as RegexRunResult) : null));
  return out.ok ? { ok: true, result: out.value } : out;
}

/** Executes a rule set over many texts, each at its own depth, in one worker run. Answers one text per item or a failure; never partial, never throws. */
export async function runRegexBatchSandboxed(
  items: readonly { text: string; depth: number }[],
  rules: readonly RegexRule[],
  options: RegexSandboxOptions,
): Promise<RegexBatchResult> {
  if (items.length === 0) return { ok: true, texts: [] };
  const ceiling = Math.min(HARD_TIMEOUT_MS + BATCH_MS_PER_ITEM * items.length, BATCH_TIMEOUT_CEILING_MS);
  const out = await callWorker({ items, rules }, options, ceiling, (d) =>
    Array.isArray(d.texts) && d.texts.length === items.length && d.texts.every((t) => typeof t === "string") ? (d.texts as string[]) : null);
  return out.ok ? { ok: true, texts: out.value } : out;
}
