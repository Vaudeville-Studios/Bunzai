/** Adapt Bunzai's native Ollama transport to rp-core's streaming provider contract. */
import { categoryOf, ProviderError as CoreError, type ModelRequest, type Provider as CoreProvider, type StreamEv } from "rp-core";
import { ProviderError as StageError, type Provider as StageProvider, type ProviderCompletion, type ProviderMessage, type ProviderRequest } from "../stage/contracts/provider";

function stageRequest(req: ModelRequest): ProviderRequest {
  const stop = req.stop ?? req.samplers.stop;
  const messages: ProviderMessage[] = req.messages.map((message) => {
    const calls = message.blocks.filter((block) => block.k === "tool_call");
    const result = message.blocks.find((block) => block.k === "tool_result");
    return {
      role: message.role,
      content: message.blocks.filter((block) => block.k === "text").map((block) => block.text).join("\n\n") || (result?.k === "tool_result" ? result.text : ""),
      ...(calls.length ? { tool_calls: calls.map((block) => ({ id: block.id, type: "function" as const, function: { name: block.name, arguments: block.args } })) } : {}),
      ...(result?.k === "tool_result" ? { tool_call_id: result.callId, name: result.name } : {}),
    };
  });
  if (req.prefill) messages.push({ role: "assistant", content: req.prefill });
  return {
    model: req.model.model,
    messages,
    options: {
      stream: true,
      max_tokens: req.maxTokens,
      ...(req.samplers.temperature !== undefined ? { temperature: req.samplers.temperature } : {}),
      ...(req.samplers.top_p !== undefined ? { top_p: req.samplers.top_p } : {}),
      ...(req.samplers.top_k !== undefined ? { top_k: req.samplers.top_k } : {}),
      ...(req.samplers.min_p !== undefined ? { min_p: req.samplers.min_p } : {}),
      ...(req.samplers.repetition_penalty !== undefined ? { repetition_penalty: req.samplers.repetition_penalty } : {}),
      ...(req.samplers.frequency_penalty !== undefined ? { frequency_penalty: req.samplers.frequency_penalty } : {}),
      ...(req.samplers.presence_penalty !== undefined ? { presence_penalty: req.samplers.presence_penalty } : {}),
      ...(stop?.length || req.responseSchema || req.samplers.typical_p !== undefined || req.samplers.seed !== undefined ? { params: {
        ...(stop?.length ? { stop } : {}),
        ...(req.samplers.typical_p !== undefined ? { typical_p: req.samplers.typical_p } : {}),
        ...(req.samplers.seed !== undefined ? { seed: req.samplers.seed } : {}),
        ...(req.responseSchema ? { json_schema: req.responseSchema.schema } : {}),
      } } : {}),
      ...(req.reasoning ? { reasoning_effort: req.reasoning } : {}),
      ...(req.tools?.length ? { tools: req.tools.map((tool) => ({ type: "function" as const, function: { name: tool.name, description: tool.description, parameters: tool.schema } })), tool_choice: req.toolChoice ?? "auto" } : {}),
    },
  };
}

function coreError(cause: unknown, afterOutput: boolean): CoreError {
  const code = cause instanceof StageError
    ? cause.code === "invalid_api_key" ? "auth_failed"
      : cause.code === "rate_limit_exceeded" ? "rate_limited"
      : cause.code === "invalid_parameter" ? "bad_request"
      : cause.code === "model_not_found" ? "model_not_found"
      : cause.code === "context_length_exceeded" ? "context_length_exceeded"
      : cause.code === "gateway_timeout" ? "timeout" : "overloaded"
    : "unreachable";
  const category = categoryOf(code);
  const message = code === "auth_failed" || code === "rate_limited" || code === "bad_request" ? (cause as Error).message : code === "model_not_found" ? "the server does not know this model" : code === "context_length_exceeded" ? "the prompt does not fit the model's context window" : code === "timeout" ? "the server did not answer in time" : code === "unreachable" ? "the server could not be reached" : "the server failed or is overloaded";
  return new CoreError({ category, code, message, afterOutput, ...(cause instanceof StageError ? { status: cause.status } : {}) });
}

function finish(completion: ProviderCompletion): StreamEv {
  const raw = completion.finish_reason ?? "stop";
  const reason = raw === "length" ? "length" : raw === "content_filter" ? "content_filter" : "end";
  return { t: "finish", reason, raw, ...(completion.model ? { model: completion.model } : {}) };
}

export function coreOllamaProvider(native: StageProvider): CoreProvider {
  return { async *stream(req: ModelRequest): AsyncGenerator<StreamEv> {
    const queue: StreamEv[] = [];
    let wake: (() => void) | undefined;
    let settled = false;
    let completion: ProviderCompletion | undefined;
    let failure: unknown;
    let written = 0;
    let reasoning = 0;
    const push = (event: StreamEv): void => { queue.push(event); wake?.(); wake = undefined; };
    void native.send(stageRequest(req), { signal: req.signal, onEvent: (event) => {
      if ("delta" in event) {
        if (event.channel === "content") { push({ t: "text", i: 0, d: event.delta }); written += event.delta.length; }
        else { push({ t: "reasoning", i: 0, d: event.delta }); reasoning += event.delta.length; }
      } else {
        const prior = event.channel === "content" ? written : reasoning;
        if (event.full.length > prior) {
          const delta = event.full.slice(prior);
          push(event.channel === "content" ? { t: "text", i: 0, d: delta } : { t: "reasoning", i: 0, d: delta });
          if (event.channel === "content") written = event.full.length;
          else reasoning = event.full.length;
        }
      }
    } }).then((value) => { completion = value; }, (error: unknown) => { failure = error; }).finally(() => { settled = true; wake?.(); });
    while (!settled || queue.length) {
      if (queue.length) yield queue.shift()!;
      else await new Promise<void>((resolve) => { wake = resolve; });
    }
    if (failure) { yield { t: "error", err: coreError(failure, written > 0), afterOutput: written > 0 }; return; }
    if (!completion) { yield { t: "error", err: coreError(null, written > 0), afterOutput: written > 0 }; return; }
    if (completion.content.length > written) yield { t: "text", i: 0, d: completion.content.slice(written) };
    for (const [i, call] of (completion.tool_calls ?? []).entries()) {
      yield { t: "tool_start", i, id: call.id, name: call.function.name };
      yield { t: "tool_args", i, d: call.function.arguments };
      yield { t: "tool_end", i };
    }
    if (completion.usage) yield { t: "usage", u: {
      ...(completion.usage.promptTotal !== undefined ? { inputTotal: completion.usage.promptTotal } : {}),
      ...(completion.usage.output !== undefined ? { outputTotal: completion.usage.output } : {}),
    } };
    yield finish(completion);
  } };
}
