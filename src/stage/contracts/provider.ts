/**
 * The Provider contract (Decision 2): the one request, reply, stream,
 * and error shape every model call uses. It is RoleCall's inference shape, field names included
 * (`tool_calls`, `reasoning_details`, `top_p`), so ported RoleCall assembly code runs against it
 * unchanged. Kit's thinner agent call becomes a view built on this, not a second definition.
 * Types, plus the one error class every layer has to be able to catch.
 */
import type { TokenReport } from "../../core/tokens/usage";
import type { ParamValue } from "../params/types";
import type { ParamSupport } from "../params/wire";

/** RoleCall's four wire roles. System stays a role here; spokes that need it separate extract it. */
export type ProviderRole = "system" | "user" | "assistant" | "tool";

export interface ProviderToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
  /**
   * Gemini thinking-mode only, and REQUIRED to be echoed back on the model turn that made the call:
   * without it the next request fails with "Function call is missing a thought_signature".
   */
  thoughtSignature?: string;
}

/** One reviewed, already byte-validated prompt attachment carried to provider wire builders. */
export type ProviderAttachment =
  | { kind: "image"; name: string; mime: "image/png" | "image/jpeg" | "image/gif" | "image/webp"; dataUri: string }
  | { kind: "pdf"; name: string; base64: string };

export interface ProviderMessage {
  role: ProviderRole;
  content: string;
  images?: string[];
  attachments?: ProviderAttachment[];
  tool_calls?: ProviderToolCall[];
  tool_call_id?: string;
  name?: string;
  /** Native reasoning, attached only when the current model produced it (pipeline behavior 7). */
  reasoning?: { text: string; signature?: string; provider?: string };
  /**
   * OpenRouter's reasoning trace, passed back UNMODIFIED: reordering or editing it makes Gemini 3
   * stall with an empty stop. Carried by the agent loop, not by chat assembly.
   */
  reasoning_details?: Array<{ type: string; [key: string]: unknown }>;
}

export type ReasoningEffort = "auto" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "min" | "max";

/** SillyTavern's prompt post-processing modes, applied once in the transport (transport-core). */
export type RolePostProcessing = "none" | "merge" | "semi" | "strict" | "single";

export interface ProviderToolDefinition {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown>; strict?: boolean };
}

export type ProviderToolChoice =
  | "auto"
  | "none"
  | "required"
  | { type: "function"; function: { name: string } };

/** RoleCall's InferenceOptions, minus its managed-service fields. */
export interface ProviderOptions {
  temperature?: number;
  top_p?: number;
  top_k?: number;
  top_a?: number;
  min_p?: number;
  max_tokens?: number;
  frequency_penalty?: number;
  presence_penalty?: number;
  repetition_penalty?: number;
  reasoning_effort?: ReasoningEffort;
  /** Anthropic extended thinking budget. */
  reasoning_budget_tokens?: number;
  chat_template_kwargs?: Record<string, unknown>;
  stream?: boolean;
  /** Applied once before sending, then removed: it is never a valid wire field. */
  prompt_post_processing?: RolePostProcessing;
  /** Per-chat custom headers, YAML or JSON text. */
  custom_include_headers?: string;
  /** Per-chat custom body fields, YAML or JSON text. */
  custom_include_body?: string;
  /** Per-chat body field names to remove, one per line. */
  custom_exclude_body?: string;
  tools?: ProviderToolDefinition[];
  tool_choice?: ProviderToolChoice;
  parallel_tool_calls?: boolean;
  /** Final say: no native tool fields reach the wire, even if a preset or custom body adds them. */
  disallow_tools?: boolean;
  roundtrip_native_reasoning?: boolean;
  /** The scene's enabled generation parameters by registry id (stage/params); each provider sends only what it accepts, under its own names. */
  params?: Readonly<Record<string, ParamValue>>;
}

export interface ProviderRequest {
  /** The provider's own model id, already resolved. */
  model: string;
  messages: ProviderMessage[];
  options: ProviderOptions;
}

/**
 * What the provider reported the reply cost: the token meter's canonical record (src/core/tokens),
 * cache reads and writes, reasoning, and cost included, and never a made-up zero.
 */
export type ProviderUsage = TokenReport;

export interface ProviderCompletion {
  content: string;
  reasoning?: string;
  reasoning_details?: Array<{ type: string; [key: string]: unknown }>;
  tool_calls?: ProviderToolCall[];
  usage?: ProviderUsage;
  /** Normalized by normalizeFinishReason: stop, length, tool_calls, content_filter, or lowercased as sent. */
  finish_reason?: string;
  /** The model the backend actually used, which can differ from the one asked for. */
  model?: string;
  /** The raw backend body, for fields this shape does not surface. */
  raw: unknown;
}

export type StreamChannel = "content" | "reasoning";

/**
 * One streamed piece. A delta may carry the character offsets it covers, so a consumer that
 * reconnects applies only what it lacks. A `full` value is authoritative and replaces the buffer,
 * so text the server removed (a leaked tool call, stripped thinking) cannot linger on screen.
 */
export type ProviderEvent =
  | { channel: StreamChannel; delta: string; startOffset?: number; endOffset?: number }
  | { channel: StreamChannel; full: string };

/** RoleCall's error categories, minus its managed-service one. */
export type ProviderErrorCategory =
  | "invalid_request_error"
  | "api_error"
  | "service_unavailable"
  | "rate_limit_error"
  | "content_policy_violation";

/**
 * RoleCall's error codes, minus its managed-service and quota codes. One deliberate change: RoleCall
 * emits both `context_too_long` and `context_length_exceeded` for the same condition, so a caller has
 * to check two names; here there is one.
 */
export type ProviderErrorCode =
  | "invalid_api_key"
  | "provider_config_missing"
  | "model_not_found"
  | "model_access_denied"
  | "context_length_exceeded"
  | "invalid_parameter"
  | "invalid_options"
  | "content_filter"
  | "rate_limit_exceeded"
  | "gateway_timeout"
  | "service_unavailable"
  | "server_config_error"
  | "backend_error";

export class ProviderError extends Error {
  readonly category: ProviderErrorCategory;
  readonly code: ProviderErrorCode;
  /** Suggested HTTP status for anything that reports this onward. */
  readonly status: number;
  /** When the provider said how long to wait before retrying. */
  readonly retryAfterSec?: number;

  constructor(
    message: string,
    info: { category: ProviderErrorCategory; code: ProviderErrorCode; status: number; retryAfterSec?: number },
  ) {
    super(message);
    this.name = "ProviderError";
    this.category = info.category;
    this.code = info.code;
    this.status = info.status;
    if (info.retryAfterSec !== undefined) this.retryAfterSec = info.retryAfterSec;
  }
}

/** The HTTP-level request a spoke's request builder produces, before `send()` fetches it. One shape
 *  for every spoke (was defined twice, byte-identical, in anthropic-request.ts and
 *  openai-compatible-request.ts). */
export interface WireRequest {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

/** A configured connection to one provider. Spokes implement this; the pipeline never imports a spoke. */
export interface Provider {
  id: string;
  /** The generation parameters this provider accepts (stage/params/wire.ts), for whatever shows what a request sends. */
  params?: ParamSupport;
  /**
   * Sends one request. Streams through `onEvent` when `options.stream` is set, and always resolves
   * with the complete reply. An aborted signal rejects with the signal's reason and sends nothing
   * further; a provider failure rejects with ProviderError.
   */
  send(
    request: ProviderRequest,
    io?: { signal?: AbortSignal; onEvent?: (event: ProviderEvent) => void },
  ): Promise<ProviderCompletion>;
}
