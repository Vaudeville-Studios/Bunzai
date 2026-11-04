/** Bounded Table Read inference uses saved provider connections and returns strictly decoded, value-only proposals. */
import type { Connected } from "../scene-turn";
import { extractObject } from "../../core/model-json";
import { splitReasoning } from "../../core/reasoning-tags";
import { utf8ByteLength } from "../../shared/utf8";
import { tableReadPrompt } from "../../core/table-read/prompts";
import { deckAnswerSchema, modelAnswerSchema, TABLE_READ_LIMITS, type TableReadSession } from "../../core/table-read/schema";
import { applyDeck, applyModelAnswer } from "../../core/table-read/interview";
import { countText } from "../../core/tokens";
import { StudioValidationError } from "../errors";
import { toErrorMessage } from "../../error-message";

export type TableReadConnect = (pick: TableReadSession["settings"]["connection"], signal?: AbortSignal) => Promise<Connected | null>;

/** Enforce cancellation even if a provider fails to honor its signal; a late answer has no mutation authority. */
export async function generateInterview(session: TableReadSession, kind: "start" | "answer" | "finish", connect: TableReadConnect, requestSignal: AbortSignal, now: () => number): Promise<TableReadSession> {
  const cap = new AbortController();
  const signal = AbortSignal.any([requestSignal, cap.signal]);
  let abort: () => void = () => {};
  const stopped = new Promise<never>((_resolve, reject) => {
    abort = () => reject(signal.reason ?? new Error("Interview stopped"));
    if (signal.aborted) abort(); else signal.addEventListener("abort", abort, { once: true });
  });
  const run = async (): Promise<TableReadSession> => {
    signal.throwIfAborted();
    const connected = await connect(session.settings.connection, signal);
    signal.throwIfAborted();
    if (!connected) throw new StudioValidationError("That saved connection is no longer available. Choose a connection in Settings.");
    const prompt = tableReadPrompt(session, kind);
    const size = utf8ByteLength(prompt.system + prompt.user);
    if (size > TABLE_READ_LIMITS.request) throw new StudioValidationError("This interview is too large to send. Shorten a long field or finish with the draft you have.");
    const maxTokens = Math.min(6_000, Math.floor((connected.context ?? 32_000) / 3));
    if (connected.context && countText(prompt.system + prompt.user) + maxTokens > connected.context) throw new StudioValidationError("This interview no longer fits that model's context. Shorten a long field before retrying.");
    const received = { content: 0, reasoning: 0 };
    const completion = await connected.provider.send({ model: session.settings.connection.model, messages: [{ role: "system", content: prompt.system }, { role: "user", content: prompt.user }], options: { temperature: 0.7, max_tokens: maxTokens, disallow_tools: true, stream: true } }, {
      signal,
      onEvent(event) {
        if (signal.aborted) return;
        const text = "delta" in event ? event.delta : event.full;
        const bytes = utf8ByteLength(text);
        received[event.channel] = "delta" in event ? received[event.channel] + bytes : bytes;
        if (received.content + received.reasoning > TABLE_READ_LIMITS.output) cap.abort(new StudioValidationError("The interviewer returned too much text. Your draft is kept; retry with a shorter response."));
      },
    });
    signal.throwIfAborted();
    const finalBytes = utf8ByteLength(completion.content) + utf8ByteLength(completion.reasoning ?? "");
    if (finalBytes > TABLE_READ_LIMITS.output) throw new StudioValidationError("The interviewer returned too much text. Your draft is kept.");
    const raw = extractObject(splitReasoning(completion.content).reply);
    if (session.settings.tempo === "rapid-fire" && kind === "start") {
      const result = deckAnswerSchema.safeParse(raw);
      if (!result.success) throw new StudioValidationError("The interviewer returned an unreadable set of choices. Your idea is kept; retry this turn.");
      return applyDeck(session, result.data, now());
    }
    const result = modelAnswerSchema.safeParse(raw);
    if (!result.success) throw new StudioValidationError("The interviewer returned an unreadable draft. Your answers are kept; retry this turn.");
    try { return applyModelAnswer(session, result.data, kind === "finish"); }
    catch (error) { throw new StudioValidationError(toErrorMessage(error, "The interviewer did not return a usable question.")); }
  };
  try { return await Promise.race([run(), stopped]); }
  finally { signal.removeEventListener("abort", abort); }
}
