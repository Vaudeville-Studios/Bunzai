/** Purpose: run Terminal regex previews in a bounded, terminable Bun Worker. */
import { startLaneWorker } from "../../stage/worker-lane";
import { extensionRegexPreviewInputSchema, sceneTurnRegexInputSchema, sceneTurnRegexAnswerSchema } from "../../extensions/contracts/host-actions";
import { MAX_EXTENSION_REGEX_PREVIEW_BYTES } from "../../extensions/contracts/limits";
import type { ExtensionRegexPreviewServices } from "../../extensions/operations/regex/_services";
import { terminalRegexWorkerAdmission } from "./regex-admission";
import { runScenePromptRegex } from "../../studio/scene-prompt-regex";
import type { RegexRule } from "../../entities/regex/schema";
import { hasErrorName } from "../../core/guards";

let nextRunId = 0;
const HARD_TIMEOUT_MS = 750;
const startWorker = () => startLaneWorker(() => new Worker("./sandbox/regex/worker.ts"), new URL("../../sandbox/regex/worker.ts", import.meta.url).href);

async function runWorker(work: { text: string; rules: unknown[]; options: Record<string, unknown> } | { items: readonly { text: string; depth: number }[]; rules: readonly RegexRule[]; options: Record<string, unknown> }, signal: AbortSignal, timeoutMs: number, start: () => Worker): Promise<unknown> {
  signal.throwIfAborted();
  const release = terminalRegexWorkerAdmission.acquire();
  if (!release) throw new Error("LIMIT_EXCEEDED: Terminal regex worker capacity is full.");
  let worker: Worker;
  try { worker = start(); } catch (error) { release(); throw error; }
  const runId = ++nextRunId;
  try { return await new Promise((resolve, reject) => {
    let settled = false;
    const finish = (value?: unknown, error?: Error): void => {
      if (settled) return;
      settled = true; clearTimeout(timer); signal.removeEventListener("abort", abort);
      error ? reject(error) : resolve(value);
    };
    const abort = (): void => finish(undefined, new DOMException("Regex run cancelled.", "AbortError"));
    const timer = setTimeout(() => finish(undefined, new Error(`LIMIT_EXCEEDED: Terminal regex worker exceeded ${timeoutMs} ms`)), timeoutMs);
    signal.addEventListener("abort", abort, { once: true });
    worker.addEventListener("error", () => finish(undefined, new Error("RUNTIME_UNAVAILABLE: regex worker failed")), { once: true });
    worker.addEventListener("message", (event: MessageEvent<unknown>) => {
      const reply = event.data as { runId?: unknown; ok?: unknown; result?: unknown; texts?: unknown; error?: unknown } | null;
      if (!reply || reply.runId !== runId || typeof reply.ok !== "boolean") return finish(undefined, new Error("INVALID_REQUEST: malformed regex worker reply"));
      finish(reply);
    }, { once: true });
    worker.postMessage({ runId, ...work });
  }); } finally { try { worker.terminate(); } catch { /* worker may already have stopped */ } release(); }
}

export function createTerminalRegexPreviewServices(start = startWorker): ExtensionRegexPreviewServices {
  return {
    async run(raw, signal) {
      const input = extensionRegexPreviewInputSchema.parse(raw);
      const reply = await runWorker({ text: input.text, rules: input.rules, options: { phase: input.phase, timeoutMs: 250, maxMatches: 250 } }, signal, HARD_TIMEOUT_MS, start) as { ok: boolean; result?: { text?: unknown }; error?: unknown };
      if (!reply.ok) return { ok: false, text: "", error: typeof reply.error === "string" ? reply.error.slice(0, 500) : "Regex preview failed." };
      const text = typeof reply.result?.text === "string" ? reply.result.text : "";
      if (new TextEncoder().encode(text).byteLength > MAX_EXTENSION_REGEX_PREVIEW_BYTES) return { ok: false, text: "", error: "Preview output exceeds the 16 KiB limit." };
      return { ok: true, text, error: null };
    },
  };
}

/** Run the existing scene regex gate in Terminal's killable Worker, never through a UI ticket. */
export async function runTerminalSceneRegex(raw: unknown, signal: AbortSignal, start = startWorker) {
  const asked = sceneTurnRegexInputSchema.parse(raw);
  const answer = await runScenePromptRegex(asked, async (items, rules, options, batchSignal) => {
    const currentSignal = batchSignal ?? signal;
    try {
      const reply = await runWorker({ items, rules, options }, currentSignal,
        Math.min(750 + 5 * items.length, 5_000), start) as { ok: boolean; texts?: unknown; error?: unknown };
      if (!reply.ok) return { ok: false as const, reason: "error" as const, error: typeof reply.error === "string" ? reply.error.slice(0, 500) : "Regex worker failed." };
      return Array.isArray(reply.texts) && reply.texts.length === items.length && reply.texts.every((text) => typeof text === "string")
        ? { ok: true as const, texts: reply.texts }
        : { ok: false as const, reason: "error" as const, error: "The regex worker returned an invalid batch." };
    } catch (error) {
      const cancelled = currentSignal.aborted || hasErrorName(error, "AbortError");
      return { ok: false as const, reason: cancelled ? "cancelled" as const : "error" as const, error: error instanceof Error ? error.message.slice(0, 500) : "Regex worker failed." };
    }
  }, signal);
  const projected = sceneTurnRegexAnswerSchema.parse({ status: "scene-regex-result", answer });
  if (new TextEncoder().encode(JSON.stringify(projected)).byteLength > MAX_EXTENSION_REGEX_PREVIEW_BYTES) throw new Error("LIMIT_EXCEEDED: regex answer exceeds the shared 16 KiB wire limit.");
  return projected;
}
