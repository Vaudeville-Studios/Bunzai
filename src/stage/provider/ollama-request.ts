/**
 * The request half of native Ollama: `POST /api/chat` with `options.num_ctx` requesting the chosen context window.
 * Roles stay where the assembler put them (a mid-chat system message is not hoisted), samplers ride inside
 * `options` under Ollama's names, and custom headers and body fields apply as on the other spokes. Call ids are not
 * checked: Ollama's wire carries none and matches a tool result to its call by order. Pure.
 */
import { ProviderError, type ProviderMessage, type ProviderOptions, type ProviderRequest, type WireRequest } from "../contracts/provider";
import { isRecord, recOr } from "../../core/guards";
import { OLLAMA_PARAMS } from "../params/dialects";
import { sentParams, type ParamSupport } from "../params/wire";
import { finalizeMessages } from "./transport-core";
import { applyRequestBody, applyRequestHeaders, parseRequestOverrides } from "./request-overrides";

export interface OllamaConnection {
  id: string;
  /** The server's root, such as http://localhost:11434 (no `/v1`). */
  baseUrl: string;
  /** The context window, sent as `options.num_ctx` on every request. */
  numCtx: number;
  /** The model's capabilities include `thinking`: only then is `think` sent. */
  thinks?: boolean;
  /** OLLAMA_PARAMS, which is also what an undeclared connection sends. */
  params?: ParamSupport;
  customHeaders?: string;
}

const TOOL_FIELDS = ["tools"] as const;

/** A stored call's JSON text as the object Ollama takes; unreadable text goes as `{}`. */
function argsObject(text: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(text);
    return recOr(parsed);
  } catch {
    return {};
  }
}

/** Every message in its role and place. A tool result is named by its own name, else by the latest call with its id. */
export function toOllamaMessages(messages: readonly ProviderMessage[]): Record<string, unknown>[] {
  const names = new Map<string, string>();
  return messages.map((m) => {
    if (m.attachments?.some((attachment) => attachment.kind === "pdf")) {
      throw new ProviderError("Ollama does not support PDF prompt attachments. Remove the PDF or choose a provider that accepts PDF input.", { category: "invalid_request_error", code: "invalid_parameter", status: 400 });
    }
    if (m.attachments?.length && m.role !== "user") {
      throw new ProviderError("Prompt attachments require a user message for Ollama.", { category: "invalid_request_error", code: "invalid_parameter", status: 400 });
    }
    if (m.images?.length && m.attachments?.length) {
      throw new ProviderError("Legacy images and prompt attachments have no shared order. Remove one set before sending.", { category: "invalid_request_error", code: "invalid_parameter", status: 400 });
    }
    const wire: Record<string, unknown> = { role: m.role, content: m.content };
    const images = [...(m.images ?? []), ...(m.attachments ?? []).flatMap((attachment) => attachment.kind === "image" ? [attachment.dataUri] : [])];
    if (m.role === "user" && images.length) wire.images = images.map((url) => url.replace(/^data:[^,]*;base64,/, ""));
    for (const call of m.tool_calls ?? []) names.set(call.id, call.function.name);
    if (m.role === "assistant" && m.tool_calls?.length) {
      wire.tool_calls = m.tool_calls.map((c) => ({ id: c.id, function: { name: c.function.name, arguments: argsObject(c.function.arguments) } }));
    }
    if (m.role === "tool") {
      wire.tool_name = m.name || names.get(m.tool_call_id ?? "");
      if (m.tool_call_id) wire.tool_call_id = m.tool_call_id;
    }
    return wire;
  });
}

/** `tool_choice` has no Ollama form: `none` sends no tools, a named function only that one, anything else all of them. */
function toolsFor(options: ProviderOptions): ProviderOptions["tools"] {
  const choice = options.tool_choice;
  if (choice === "none") return undefined;
  return typeof choice === "object" ? options.tools?.filter((t) => t.function.name === choice.function.name) : options.tools;
}

/** Off for None, on for any other level; Auto and unset leave the model's own default. */
const thinkFor = (effort: ProviderOptions["reasoning_effort"]): boolean | undefined =>
  effort === undefined || effort === "auto" ? undefined : effort !== "none";

/** The whole wire request. Rejects with ProviderError (a bad custom header or body) before anything is sent. */
export function buildOllamaRequest(request: ProviderRequest, connection: OllamaConnection): WireRequest {
  const { model, options } = request;
  const overrides = parseRequestOverrides(options, connection);
  const customOptions = overrides.body?.options;
  if (overrides.excluded.includes("options") || (overrides.body && Object.hasOwn(overrides.body, "options") && (!isRecord(customOptions) || Object.hasOwn(customOptions, "num_ctx")))) {
    throw new ProviderError("Choose Ollama's context window in Models. Custom body options must be an object and cannot set or remove num_ctx.", { category: "invalid_request_error", code: "invalid_options", status: 400 });
  }
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  applyRequestHeaders(headers, overrides.headers);

  const { format, ...samplers } = sentParams(connection.params ?? OLLAMA_PARAMS, options, model).fields;
  const wireOptions: Record<string, unknown> = { num_ctx: connection.numCtx };
  if (options.temperature !== undefined) wireOptions.temperature = options.temperature;
  // Zero is RoleCall's "off" for top p, never a real setting.
  if (options.top_p !== undefined && options.top_p !== 0) wireOptions.top_p = options.top_p;
  if (options.max_tokens !== undefined) wireOptions.num_predict = options.max_tokens;
  Object.assign(wireOptions, samplers);

  const body: Record<string, unknown> = {
    model,
    messages: toOllamaMessages(finalizeMessages(request.messages, options.prompt_post_processing)),
    // Ollama streams when the flag is absent, so it is always sent.
    stream: options.stream === true,
    options: wireOptions,
  };
  const tools = toolsFor(options);
  if (tools?.length) body.tools = tools;
  const think = connection.thinks ? thinkFor(options.reasoning_effort) : undefined;
  if (think !== undefined) body.think = think;
  if (format !== undefined) body.format = format;

  // A custom `options` adds to the built one instead of replacing it, so it cannot drop the window by accident.
  const custom = overrides.body && isRecord(overrides.body.options) ? { ...overrides.body, options: { ...wireOptions, ...overrides.body.options } } : overrides.body;
  applyRequestBody(body, { ...overrides, body: custom }, options.disallow_tools === true, TOOL_FIELDS);
  return { url: `${connection.baseUrl.trim().replace(/\/+$/, "")}/api/chat`, headers, body };
}
