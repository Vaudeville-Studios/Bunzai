/**
 * The request half of the native Anthropic spoke (Anthropic's Messages API, `/v1/messages`), our own
 * design read against `platform.claude.com` docs and, for placement only, RoleCall's
 * adapter (`providers/adapters/{anthropic,base}.ts`, read-only, not copied). Unlike
 * the OpenAI-compatible spoke this connection talks to, the native API takes `system` as its own
 * top-level field and never hoists a mid-chat system message: matching RoleCall's own native mapping
 * exactly (`toAnthropicMessages` in `base.ts`), it is rewritten to a bare, unlabeled inline `user`
 * turn instead (no prefix, no wrapper - just `{role: "user", content: <the same text>}`), so a depth
 * note (a card's depth field, an in-chat preset block, Author's Note) stays next to the turn it was
 * injected for. Cache breakpoints need no memory of a previous request either (see
 * `applyCacheBreakpoints`): the whole file is pure, no I/O, and never throws outside ProviderError.
 */
import { type ProviderMessage, type ProviderOptions, type ProviderRequest, type WireRequest } from "../contracts/provider";
import { countText } from "../../core/tokens/base";
import { cacheRulesFor } from "../../core/tokens/cache";
import { finalizeMessages, invalidRequest, PROMPT_PLACEHOLDER } from "./transport-core";
import { claudeCanDisable, claudeThinking, type ClaudeThinking } from "./reasoning-wire";
import { validateToolProtocol } from "./openai-compatible-request";
import { applyRequestBody, applyRequestHeaders, parseRequestOverrides } from "./request-overrides";
import { isRecord } from "../../core/guards";
import { sentParams, type ParamSupport } from "../params/wire";

/** Without a declared table, the one sampler beyond temperature and top p the Messages API reads. */
const ANTHROPIC_FLAT: ParamSupport = { top_k: true };

export interface AnthropicConnection {
  id: string;
  baseUrl?: string;
  apiKey?: string;
  customHeaders?: string;
  customBody?: string;
  customExcludeBody?: string;
  params?: ParamSupport;
}

type CacheControl = { type: "ephemeral" };
type TextBlock = { type: "text"; text: string; cache_control?: CacheControl };
type ThinkingBlock = { type: "thinking"; thinking: string; signature: string };
type RedactedThinkingBlock = { type: "redacted_thinking"; data: string };
type ToolUseBlock = { type: "tool_use"; id: string; name: string; input: Record<string, unknown>; cache_control?: CacheControl };
type ToolResultBlock = { type: "tool_result"; tool_use_id: string; content: string; cache_control?: CacheControl };
type ImageBlock = { type: "image"; source: { type: "base64"; media_type: string; data: string } | { type: "url"; url: string }; cache_control?: CacheControl };
type DocumentBlock = { type: "document"; source: { type: "base64"; media_type: "application/pdf"; data: string }; title: string };
export type AnthropicContentPart = TextBlock | ThinkingBlock | RedactedThinkingBlock | ToolUseBlock | ToolResultBlock | ImageBlock | DocumentBlock;
export interface AnthropicWireMessage {
  role: "user" | "assistant";
  content: string | AnthropicContentPart[];
}


/** `https://api.anthropic.com`, or a pasted base with any `/v1`, `/v1/messages` suffix trimmed. */
export function resolveMessagesUrl(baseUrl: string | undefined): string {
  const trimmed = (baseUrl ?? "https://api.anthropic.com").trim().replace(/\/+$/, "");
  const base = trimmed.replace(/\/v1(\/messages)?$/i, "");
  return `${base}/v1/messages`;
}

function imagePart(url: string): ImageBlock {
  const dataUrl = /^data:([^;]+);base64,(.+)$/s.exec(url);
  if (dataUrl) return { type: "image", source: { type: "base64", media_type: dataUrl[1]!, data: dataUrl[2]! } };
  return { type: "image", source: { type: "url", url } };
}

function toolUseParts(message: ProviderMessage): AnthropicContentPart[] {
  const parts: AnthropicContentPart[] = [];
  const details = message.reasoning_details?.filter(
    (b): b is ThinkingBlock | RedactedThinkingBlock =>
      (b.type === "thinking" && typeof b.thinking === "string" && typeof b.signature === "string") ||
      (b.type === "redacted_thinking" && typeof b.data === "string"),
  );
  if (details?.length) parts.push(...details);
  else if (message.reasoning?.text && message.reasoning.signature && message.reasoning.provider === "anthropic") {
    parts.push({ type: "thinking", thinking: message.reasoning.text, signature: message.reasoning.signature });
  }
  if (message.content) parts.push({ type: "text", text: message.content });
  for (const call of message.tool_calls ?? []) {
    let input: Record<string, unknown> = {};
    try {
      const parsed = call.function.arguments.trim() ? (JSON.parse(call.function.arguments) as unknown) : {};
      if (isRecord(parsed)) input = parsed;
    } catch {
      // A model that sent malformed JSON args gets an empty object rather than a crashed turn.
    }
    parts.push({ type: "tool_use", id: call.id, name: call.function.name, input });
  }
  return parts;
}

/** Two content values of a role Anthropic is about to merge, combined into one. */
function mergeContent(a: string | AnthropicContentPart[], b: string | AnthropicContentPart[]): string | AnthropicContentPart[] {
  if (typeof a === "string" && typeof b === "string") return `${a}\n\n${b}`;
  const left = typeof a === "string" ? (a ? [{ type: "text" as const, text: a }] : []) : a;
  const right = typeof b === "string" ? (b ? [{ type: "text" as const, text: b }] : []) : b;
  return [...left, ...right];
}

/**
 * `ProviderMessage[]` to the native wire shape: a leading `system` run (one text block per message,
 * never merged into one, so `cache_control` can land on just the last of them) and the rest as
 * alternating `user`/`assistant` turns. A mid-chat `system` message becomes an inline `user` turn,
 * in place, matching RoleCall's placement rule (read, not copied): the instruction stays next to the
 * turn it anchors rather than being lifted to the top. Tool results become `tool_result` blocks on a
 * `user` turn; an assistant's tool calls become `tool_use` blocks, with a leading `thinking` block
 * when native reasoning round-trips. Consecutive same-role turns the rewrite produces are merged, and
 * a reply that would not open with `user` gets one inserted, both required by the API.
 */
export function toAnthropicWire(messages: readonly ProviderMessage[]): { system: TextBlock[]; messages: AnthropicWireMessage[] } {
  messages.forEach((message, index) => {
    if (message.attachments?.length && message.role !== "user") throw invalidRequest(`Attachments at message ${index} require a user role.`, "invalid_parameter");
    if (message.images?.length && message.attachments?.length) throw invalidRequest(`Legacy images and prompt attachments at message ${index} have no shared order.`, "invalid_parameter");
  });
  validateToolProtocol(messages);
  let firstTurn = 0;
  while (firstTurn < messages.length && messages[firstTurn]!.role === "system") firstTurn++;
  const system: TextBlock[] = messages
    .slice(0, firstTurn)
    .filter((m) => m.content.trim().length > 0)
    .map((m) => ({ type: "text", text: m.content }));

  const turns: AnthropicWireMessage[] = [];
  for (const raw of messages.slice(firstTurn)) {
    if (raw.role === "tool") {
      turns.push({ role: "user", content: [{ type: "tool_result", tool_use_id: raw.tool_call_id ?? "", content: raw.content }] });
      continue;
    }
    const role: "user" | "assistant" = raw.role === "assistant" ? "assistant" : "user";
    if (role === "assistant" && raw.tool_calls?.length) {
      turns.push({ role, content: toolUseParts(raw) });
    } else if (role === "assistant" && raw.reasoning?.text && raw.reasoning.signature && raw.reasoning.provider === "anthropic") {
      const parts: AnthropicContentPart[] = [{ type: "thinking", thinking: raw.reasoning.text, signature: raw.reasoning.signature }];
      if (raw.content) parts.push({ type: "text", text: raw.content });
      turns.push({ role, content: parts });
    } else if ((raw.images?.length || raw.attachments?.length) && role === "user") {
      const parts: AnthropicContentPart[] = [
        ...(raw.content.length ? [{ type: "text" as const, text: raw.content }] : []),
        ...(raw.images ?? []).map(imagePart),
        ...(raw.attachments ?? []).map((attachment): AnthropicContentPart => attachment.kind === "image"
          ? imagePart(attachment.dataUri)
          : { type: "document", source: { type: "base64", media_type: "application/pdf", data: attachment.base64 }, title: attachment.name }),
      ];
      turns.push({ role, content: parts });
    } else {
      turns.push({ role, content: raw.content });
    }
  }

  const merged: AnthropicWireMessage[] = [];
  for (const turn of turns) {
    const prev = merged[merged.length - 1];
    if (prev && prev.role === turn.role) prev.content = mergeContent(prev.content, turn.content);
    else merged.push({ ...turn });
  }
  // The Messages API requires at least one message and a user turn first; a system-only request gets
  // the same placeholder the OpenAI-compatible transport uses (transport-core.ts).
  if (merged.length === 0) merged.push({ role: "user", content: PROMPT_PLACEHOLDER });
  else if (merged[0]!.role !== "user") merged.unshift({ role: "user", content: PROMPT_PLACEHOLDER });
  return { system, messages: merged };
}

/** Every text-bearing part of a wire content value, joined for a cheap token estimate. Never billed
 * on; only decides whether a breakpoint clears the provider's minimum cacheable length. */
function wireText(content: string | AnthropicContentPart[]): string {
  if (typeof content === "string") return content;
  return content
    .map((part) => ("text" in part ? part.text : "thinking" in part ? part.thinking : "content" in part ? part.content : ""))
    .join("\n");
}

/**
 * Marks `cache_control` at up to three of Anthropic's four breakpoints, all derived from THIS
 * request alone: no memory of a previous turn, no per-connection state. This is Anthropic's own
 * documented pattern for a stateless multi-turn client (platform.claude.com prompt-caching docs):
 * a request that marks its last message writes a cache entry covering everything up to it; the
 * *next* request, marking its own breakpoints, has its server-side lookup walk back up to 20 content
 * blocks from each mark to find that entry and reuse it. Turn N's mark becomes turn N+1's hit with
 * nothing carried between the two Provider instances that sent them.
 *
 * The marks:
 * 1. the last system block (the card, persona, and instructions: the least likely to change turn to
 *    turn);
 * 2. `messages[length - 2]`, "just before the first message that varies turn to turn" (RoleCall's
 *    framing): normally the last exchange's assistant reply, right before this turn's new user
 *    message. This is the one most likely to land inside 20 blocks of what the *previous* turn wrote
 *    at its own last-message mark, so it is the one that actually reads from cache today. Depth
 *    notes and in-chat blocks that got merged into an OLDER message (not the newest turn) are
 *    already covered by it;
 * 3. `messages[length - 1]`, the newest message: written now so *next* turn's mark 2 can read it.
 *
 * Each mark is skipped when the text up to it does not clear the model's minimum cacheable length,
 * so a short system prompt or a short first exchange gets no breakpoint rather than a silently
 * ignored one. A one-message request only gets marks 1 and 3 (there is no "before the newest" to
 * mark separately from the newest itself).
 */
export function applyCacheBreakpoints(
  wire: { system: TextBlock[]; messages: AnthropicWireMessage[] },
  modelId: string,
): { system: TextBlock[]; messages: AnthropicWireMessage[] } {
  const minTokens = cacheRulesFor("anthropic", modelId).minTokens;
  const system = wire.system.map((b) => ({ ...b }));
  const messages = wire.messages.map((m) => ({ ...m }));
  const clearsMinimum = (through: number): boolean => {
    const systemText = system.map((b) => b.text).join("\n");
    const historyText = messages.slice(0, through + 1).map((m) => wireText(m.content)).join("\n");
    return countText(`${systemText}\n${historyText}`) >= minTokens;
  };
  const mark = (index: number) => {
    const target = messages[index]!;
    const blocks = typeof target.content === "string" ? [{ type: "text" as const, text: target.content }] : [...target.content];
    blocks[blocks.length - 1] = { ...blocks[blocks.length - 1]!, cache_control: { type: "ephemeral" } } as AnthropicContentPart;
    target.content = blocks;
  };

  if (system.length > 0 && clearsMinimum(-1)) system[system.length - 1]!.cache_control = { type: "ephemeral" };
  const beforeNewest = messages.length - 2;
  if (beforeNewest >= 0 && clearsMinimum(beforeNewest)) mark(beforeNewest);
  const newest = messages.length - 1;
  if (newest >= 0 && clearsMinimum(newest)) mark(newest);
  return { system, messages };
}

const TOOL_FIELDS = ["tools", "tool_choice"] as const;

function toolChoice(options: ProviderOptions): Record<string, unknown> | undefined {
  const choice = options.tool_choice;
  const disable = options.parallel_tool_calls === undefined ? {} : { disable_parallel_tool_use: !options.parallel_tool_calls };
  if (choice === undefined || choice === "auto") return { type: "auto", ...disable };
  if (choice === "required") return { type: "any", ...disable };
  if (choice === "none") return { type: "none" };
  return { type: "tool", name: choice.function.name, ...disable };
}

/** Extended thinking (Anthropic's reasoning): the request's one budget field, unchanged from the
 * OpenAI-compatible path's `reasoning_budget_tokens`. Temperature, top p, and top k are dropped when
 * it is on, and `max_tokens` grows past the budget: both are the API's own requirements, not a choice
 * made here. */
/** The thinking a request asks for: an explicit budget, else the scene's Reasoning Effort for this model; null for none. */
function thinkingFor(options: ProviderOptions, model: string, maxTokens: number, stream: boolean): ClaudeThinking {
  return options.reasoning_budget_tokens ? { budget: options.reasoning_budget_tokens } : claudeThinking(model, options.reasoning_effort, maxTokens, stream);
}

function applyThinking(body: Record<string, unknown>, level: ClaudeThinking, model: string): void {
  if (!level) {
    if (claudeCanDisable(model)) body.thinking = { type: "disabled" };
    return;
  }
  const budget = "budget" in level ? level.budget : undefined;
  if (level && "adaptive" in level) {
    // Adaptive thinking (Opus 4.6+, the 5 series): the effort rides in output_config, and sampling is refused as with a budget.
    body.thinking = { type: "adaptive" };
    body.output_config = { effort: level.effort };
    delete body.temperature;
    delete body.top_p;
    delete body.top_k;
    return;
  }
  if (!budget || budget <= 0) return;
  body.thinking = { type: "enabled", budget_tokens: budget };
  delete body.temperature;
  delete body.top_p;
  delete body.top_k;
  const maxTokens = typeof body.max_tokens === "number" ? body.max_tokens : 0;
  if (maxTokens <= budget) body.max_tokens = budget + 4096;
}

/**
 * The whole wire request. Pure and stateless: `applyCacheBreakpoints` derives every mark from this
 * one request, so a fresh `AnthropicConnection` on every turn (today's `sceneProvider()`) still
 * caches correctly - nothing about a previous turn needs to survive to build this one. Rejects with
 * ProviderError before anything is sent.
 */
export function buildAnthropicRequest(request: ProviderRequest, connection: AnthropicConnection): WireRequest {
  const { model, options } = request;
  const url = resolveMessagesUrl(connection.baseUrl);

  const overrides = parseRequestOverrides(options, connection);

  const headers: Record<string, string> = { "Content-Type": "application/json", "anthropic-version": "2023-06-01" };
  if (connection.apiKey) headers["x-api-key"] = connection.apiKey;
  applyRequestHeaders(headers, overrides.headers);

  const maxTokens = options.max_tokens ?? 4096;
  const thinking = thinkingFor(options, model, maxTokens, options.stream === true);
  // Earlier thinking goes back signed only while this request thinks: the API refuses a thinking block otherwise.
  const prepared = finalizeMessages(request.messages, options.prompt_post_processing).map((m) => (thinking || !m.reasoning ? m : { ...m, reasoning: undefined }));
  const wire = applyCacheBreakpoints(toAnthropicWire(prepared), model);

  const body: Record<string, unknown> = {
    model,
    messages: wire.messages,
    stream: options.stream === true,
    max_tokens: options.max_tokens ?? 4096,
  };
  if (wire.system.length > 0) body.system = wire.system;
  if (options.temperature !== undefined) body.temperature = options.temperature;
  else if (options.top_p !== undefined && options.top_p !== 0) body.top_p = options.top_p;
  Object.assign(body, sentParams(connection.params ?? ANTHROPIC_FLAT, options, model).fields);

  if (options.tools?.length) {
    body.tools = options.tools.map((t) => ({ name: t.function.name, description: t.function.description, input_schema: t.function.parameters }));
    body.tool_choice = toolChoice(options);
  }
  applyThinking(body, thinking, model);

  applyRequestBody(body, overrides, options.disallow_tools === true, TOOL_FIELDS);
  if (!body.max_tokens || typeof body.max_tokens !== "number" || body.max_tokens <= 0) throw invalidRequest("Anthropic requires a positive max_tokens.");
  return { url, headers, body };
}
