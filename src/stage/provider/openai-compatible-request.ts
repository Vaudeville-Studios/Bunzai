/**
 * The request half of the OpenAI-compatible spoke, ported
 * from RoleCall's adapter (providers/adapters/base.ts and openai.ts). Pure: it turns a
 * ProviderRequest and a connection into a URL, headers, and a body, or rejects before anything is sent.
 */
import { ProviderError, type ProviderMessage, type ProviderRequest, type WireRequest } from "../contracts/provider";
import { isRecord } from "../../core/guards";
import { finalizeMessages, invalidRequest } from "./transport-core";
import { geminiEffort, openAIEffort, openRouterEffort } from "./reasoning-wire";
import { sentParams, type ParamSupport } from "../params/wire";
import { applyRequestBody, applyRequestHeaders, parseRequestOverrides } from "./request-overrides";

/** What the backend accepts beyond the minimal body. Everything is off unless named. */
export interface OpenAICompatibleSupport {
  /** PDF file parts are enabled only for the known OpenAI API, never inferred for arbitrary compatible servers. */
  pdfAttachments?: boolean;
  chatTemplateKwargs?: boolean;
  /** How this backend takes Reasoning Effort: `true` as given, `openai` (reasoning models only, levels clamped), `openrouter` (nested `reasoning.effort`) or `gemini` (Gemini models, clamped). Absent: not sent. */
  reasoningEffort?: boolean | "openai" | "openrouter" | "gemini";
  streamUsage?: boolean;
  parallelToolCalls?: boolean;
  strictTools?: boolean;
  /** The field this backend reads earlier reasoning from, when it reads it at all. */
  reasoningEcho?: "reasoning_content" | "reasoning";
}

export interface OpenAICompatibleConnection {
  /** Also the reasoning provider name: reasoning is echoed only to the connection that produced it. */
  id: string;
  baseUrl?: string;
  chatCompletionsEndpoint?: string;
  apiKey?: string;
  /** Custom headers, body fields, and excluded body fields, as text. A chat's own text replaces these. */
  customHeaders?: string;
  customBody?: string;
  customExcludeBody?: string;
  /** The generation parameters this server accepts and their wire names. */
  params?: ParamSupport;
  support?: OpenAICompatibleSupport;
}


const VERSION_SEGMENT = /\/v\d+$/i;
const trimSlashes = (url: string) => url.trim().replace(/\/+$/, "");

/** A base URL or pasted endpoint, reduced to the base that resource paths are appended to. */
export function normalizeBaseUrlForPath(baseUrl: string): string {
  const trimmed = trimSlashes(baseUrl);
  if (/\/chat\/completions$/i.test(trimmed)) return trimmed.replace(/\/chat\/completions$/i, "");
  return trimmed.replace(/\/(models|completions|messages)$/i, "");
}

export function resolveChatCompletionsUrl(connection: Pick<OpenAICompatibleConnection, "baseUrl" | "chatCompletionsEndpoint">): string {
  const explicit = connection.chatCompletionsEndpoint?.trim();
  if (explicit) return trimSlashes(explicit);
  if (!connection.baseUrl?.trim()) {
    throw new ProviderError("This connection has no base URL or chat completions endpoint.", {
      category: "invalid_request_error",
      code: "provider_config_missing",
      status: 400,
    });
  }
  const trimmed = trimSlashes(connection.baseUrl);
  if (/\/chat\/completions$/i.test(trimmed)) return trimmed;
  const base = normalizeBaseUrlForPath(trimmed);
  return VERSION_SEGMENT.test(base) ? `${base}/chat/completions` : `${base}/v1/chat/completions`;
}

export function resolveModelsUrl(baseUrlOrEndpoint: string): string {
  const base = normalizeBaseUrlForPath(baseUrlOrEndpoint);
  return VERSION_SEGMENT.test(base) ? `${base}/models` : `${base}/v1/models`;
}

/** Every tool call answered, in order, by a tool result naming it. RoleCall's validateDirectToolProtocol. */
export function validateToolProtocol(messages: readonly ProviderMessage[]): void {
  const seen = new Set<string>();
  const pending = new Map<string, string>();
  messages.forEach((message, index) => {
    if (pending.size > 0 && message.role !== "tool") {
      throw invalidRequest(`Tool call batch is incomplete before message ${index}.`, "invalid_parameter");
    }
    if (message.tool_calls?.length) {
      if (message.role !== "assistant") {
        throw invalidRequest(`Tool calls at message ${index} require an assistant role.`, "invalid_parameter");
      }
      for (const call of message.tool_calls) {
        const id = call.id.trim();
        const name = call.function.name.trim();
        if (!id || !/^[A-Za-z_][A-Za-z0-9_-]{0,63}$/.test(name) || seen.has(id)) {
          throw invalidRequest(`Tool call at message ${index} has a missing, unsafe, or duplicate id or name.`, "invalid_parameter");
        }
        let args: unknown;
        try {
          args = JSON.parse(call.function.arguments || "{}");
        } catch {
          throw invalidRequest(`Tool call ${id} has invalid JSON arguments.`, "invalid_parameter");
        }
        if (!isRecord(args)) {
          throw invalidRequest(`Tool call ${id} arguments must be a JSON object.`, "invalid_parameter");
        }
        seen.add(id);
        pending.set(id, name);
      }
    }
    if (message.role !== "tool") return;
    const id = message.tool_call_id?.trim();
    const expected = id ? pending.get(id) : undefined;
    if (!id || !expected) {
      throw invalidRequest(`Tool result at message ${index} references unknown tool call ${id || "(missing)"}.`, "invalid_parameter");
    }
    if (message.name?.trim() && message.name.trim() !== expected) {
      throw invalidRequest(`Tool result ${id} names ${message.name.trim()} but the assistant called ${expected}.`, "invalid_parameter");
    }
    pending.delete(id);
  });
  if (pending.size > 0) throw invalidRequest("Tool call batch is incomplete at the end of the request.", "invalid_parameter");
}

/** One system message is valid everywhere; several in a row are not, once a relay fronts Anthropic. */
function mergeLeadingSystem(messages: ProviderMessage[]): ProviderMessage[] {
  let end = 0;
  while (end < messages.length && messages[end]!.role === "system") end++;
  if (end < 2) return messages;
  const text = messages
    .slice(0, end)
    .map((x) => x.content)
    .filter((c) => c.trim().length > 0)
    .join("\n\n");
  return [{ ...messages[0]!, content: text }, ...messages.slice(end)];
}

/** Relays serve Claude through this spoke; only the model id can tell. */
export const targetsAnthropic = (model: string) => {
  const m = model.toLowerCase();
  return m.startsWith("anthropic/") || m.includes("claude");
};

/** Anthropic rejects a system message after the first turn; it becomes user, in place, then merges. */
function systemToUserAfterFirstTurn(messages: ProviderMessage[]): ProviderMessage[] {
  let first = 0;
  while (first < messages.length && messages[first]!.role === "system") first++;
  if (first >= messages.length) return messages;
  const merged: ProviderMessage[] = [];
  for (const raw of messages.slice(first)) {
    const m = raw.role === "system" ? { ...raw, role: "user" as const } : raw;
    const prev = merged[merged.length - 1];
    const mergeable =
      prev &&
      prev.role === m.role &&
      (m.role === "user" || m.role === "assistant") &&
      !prev.images?.length &&
      !m.images?.length &&
      !prev.attachments?.length &&
      !m.attachments?.length &&
      !prev.tool_calls?.length &&
      !m.tool_calls?.length;
    if (mergeable) merged[merged.length - 1] = { ...prev, content: `${prev.content}\n\n${m.content}` };
    else merged.push(m);
  }
  return [...messages.slice(0, first), ...merged];
}

type WirePart = { type: "text"; text: string } | { type: "image_url"; image_url: { url: string; detail: "auto" } } | { type: "file"; file: { filename: string; file_data: string } };

const imageWirePart = (url: string): WirePart => ({ type: "image_url", image_url: { url, detail: "auto" } });

/** RoleCall's toOpenAIMessages, over the contract's message shape. */
export function toWireMessages(
  messages: readonly ProviderMessage[],
  context: { connectionId: string; model: string; reasoningEcho?: OpenAICompatibleSupport["reasoningEcho"]; pdfAttachments?: boolean },
): Record<string, unknown>[] {
  messages.forEach((message, index) => {
    if (message.attachments?.length && message.role !== "user") throw invalidRequest(`Attachments at message ${index} require a user role.`, "invalid_parameter");
    if (message.images?.length && message.attachments?.length) throw invalidRequest(`Legacy images and prompt attachments at message ${index} have no shared order.`, "invalid_parameter");
    if (message.attachments?.some((attachment) => attachment.kind === "pdf") && context.pdfAttachments !== true) throw invalidRequest(`PDF attachments are not declared for this compatible endpoint (message ${index}).`, "invalid_parameter");
  });
  validateToolProtocol(messages);
  let prepared = mergeLeadingSystem([...messages]);
  if (targetsAnthropic(context.model)) prepared = systemToUserAfterFirstTurn(prepared);
  return prepared.map((m) => {
    const wire: Record<string, unknown> = { role: m.role };
    if ((m.images?.length || m.attachments?.length) && m.role === "user") {
      const parts: WirePart[] = [
        ...(m.content.length ? [{ type: "text" as const, text: m.content }] : []),
        ...(m.images ?? []).map(imageWirePart),
        ...(m.attachments ?? []).map((attachment): WirePart => attachment.kind === "image"
          ? imageWirePart(attachment.dataUri)
          : { type: "file", file: { filename: attachment.name, file_data: `data:application/pdf;base64,${attachment.base64}` } }),
      ];
      wire.content = parts;
    } else {
      wire.content = m.content;
    }
    if (m.role === "assistant" && m.reasoning?.text && context.reasoningEcho && m.reasoning.provider === context.connectionId) {
      wire[context.reasoningEcho] = m.reasoning.text;
    }
    if (m.role === "assistant" && m.tool_calls?.length) {
      wire.tool_calls = m.tool_calls;
      // Strict servers answer `content: "" + tool_calls` with an empty body.
      if (m.content.length === 0) wire.content = null;
    }
    const details = m.reasoning_details?.filter((b) => b.type.startsWith("reasoning."));
    if (details?.length) wire.reasoning_details = details;
    if (m.role === "tool" && m.tool_call_id) wire.tool_call_id = m.tool_call_id;
    return wire;
  });
}

const TOOL_FIELDS = ["tools", "tool_choice", "parallel_tool_calls", "toolConfig", "functions", "function_call"] as const;

function samplers(options: ProviderRequest["options"], params: ParamSupport | undefined, model: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (options.temperature !== undefined) out.temperature = options.temperature;
  // Zero is RoleCall's "off" for top p, never a real setting.
  if (options.top_p !== undefined && options.top_p !== 0) out.top_p = options.top_p;
  if (options.max_tokens !== undefined) out.max_tokens = options.max_tokens;
  Object.assign(out, sentParams(params, options, model).fields);
  return out;
}

/** The whole wire request. Rejects with ProviderError before anything is sent. */
export function buildWireRequest(request: ProviderRequest, connection: OpenAICompatibleConnection): WireRequest {
  const { model, options } = request;
  const support = connection.support ?? {};
  const url = resolveChatCompletionsUrl(connection);

  const overrides = parseRequestOverrides(options, connection);

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (connection.apiKey) headers.Authorization = `Bearer ${connection.apiKey}`;
  applyRequestHeaders(headers, overrides.headers);

  const messages = toWireMessages(finalizeMessages(request.messages, options.prompt_post_processing), {
    connectionId: connection.id,
    model,
    reasoningEcho: support.reasoningEcho,
    pdfAttachments: support.pdfAttachments,
  });

  const stream = options.stream === true;
  const body: Record<string, unknown> = {
    model,
    messages,
    stream,
    ...(stream && support.streamUsage ? { stream_options: { include_usage: true } } : {}),
    ...samplers(options, connection.params, model),
  };
  if (support.chatTemplateKwargs && options.chat_template_kwargs) body.chat_template_kwargs = options.chat_template_kwargs;
  const effort = options.reasoning_effort;
  if (support.reasoningEffort === true && effort && effort !== "auto") body.reasoning_effort = effort;
  else if (support.reasoningEffort === "openai" && openAIEffort(model, effort)) body.reasoning_effort = openAIEffort(model, effort);
  else if (support.reasoningEffort === "gemini" && geminiEffort(model, effort)) body.reasoning_effort = geminiEffort(model, effort);
  else if (support.reasoningEffort === "openrouter" && openRouterEffort(effort)) body.reasoning = { effort: openRouterEffort(effort) };
  if (options.tools?.length) {
    body.tools = support.strictTools
      ? options.tools
      : options.tools.map(({ function: { strict: _strict, ...fn }, ...tool }) => ({ ...tool, function: fn }));
    if (options.tool_choice !== undefined) body.tool_choice = options.tool_choice;
    // RoleCall always asks for parallel calls where the backend supports the field; a caller may say no.
    if (support.parallelToolCalls) body.parallel_tool_calls = options.parallel_tool_calls ?? true;
  }

  applyRequestBody(body, overrides, options.disallow_tools === true, TOOL_FIELDS);
  return { url, headers, body };
}
