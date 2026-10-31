/**
 * The page's half of a scene's prompt regex (studio/scene-turn-regex.ts): the turn holds its request and hands over the rules and the
 * conversation messages; the page runs them in the sandbox worker (ADR-009), one batch per role and a hundred messages, and answers with
 * the texts that changed, or with why it could not, so the turn can stop instead of sending what a rule meant to remove.
 */
import { runScenePromptRegex, type SceneRegexAnswer, type SceneRegexInput } from "../../../studio/scene-prompt-regex";
import { runRegexBatchSandboxed } from "../workbench/regex/run-in-worker";

export type AskedRegex = SceneRegexInput;
export type RegexAnswerBody = SceneRegexAnswer;

/** Runs the canonical scene request in the isolated worker; cancellation is returned to the waiting turn. */
export async function runPromptRegex(asked: AskedRegex, workerFactory?: () => Worker, signal?: AbortSignal): Promise<RegexAnswerBody> {
  return runScenePromptRegex(asked, (items, rules, options, batchSignal) =>
    runRegexBatchSandboxed(items, rules, { ...options, ...(workerFactory ? { workerFactory } : {}), ...(batchSignal ? { signal: batchSignal } : {}) }), signal);
}

/** Runs the asked rules and sends the answer through `send`. Never throws. */
export async function answerPromptRegex(asked: AskedRegex, send: (answer: RegexAnswerBody) => Promise<unknown>, workerFactory?: () => Worker): Promise<void> {
  const answer = await runPromptRegex(asked, workerFactory);
  await send(answer).catch(() => undefined);
}
