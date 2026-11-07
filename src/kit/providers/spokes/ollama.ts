/**
 * Ollama, on its own API. Its OpenAI-compatible `/v1` cannot set the context window, so a long
 * prompt there may use Ollama's default; `/api/chat` requests the connection's chosen window with `options.num_ctx`.
 * Keyless, answering at http://localhost:11434 unless the connection names another address (the egress gate allows that one host).
 * The connection chooses its window (Ollama reloads a model when it changes, so it is fixed per connection); `/api/show` says what each
 * model can do and how long it can read. Scenes send through the native transport; Kit's agent does too, through `chat`, with Kit's
 * system prompt, so both get the window and the model's tools. Every request goes through the egress-guarded fetch.
 */
import type { FetchFunction } from "@ai-sdk/provider-utils";
import type { ProviderConfig } from "../config";
import type { ModelInfo } from "../models";
import type { ChatFn, ModelMessage, ModelToolCall, ToolSpec } from "../provider";
import type { ModelTraits, ProviderSpoke } from "../spoke";
import { allowedHost, guardedFetch } from "../egress";
import { readUsage } from "../usage";
import { isRecord, strArray } from "../../../core/guards";
import { readStreamCapped } from "../../../core/stream-bytes";
import { OLLAMA_PARAMS } from "../../../stage/params/dialects";
import type { ProviderMessage, ProviderRequest } from "../../../stage/contracts/provider";
import { createOllamaProvider } from "../../../stage/provider/ollama";
import { badReply } from "../../../stage/provider/transport-core";

const DEFAULT_BASE = "http://localhost:11434";
const DEFAULT_WINDOW = 16_384;
const WINDOWS = [8_192, 16_384, 32_768, 65_536, 131_072];
const METADATA_MS = 8_000;
const METADATA_BYTES = 2 * 1024 * 1024;
const MAX_MODELS = 512;
const MODEL_WORKERS = 4;

/** The server's root: a pasted `/v1` (the OpenAI-compatible path) or trailing slash is taken off. */
const rootOf = (c: ProviderConfig): string => (c.baseURL || DEFAULT_BASE).replace(/\/+$/, "").replace(/\/v1$/, "");
/** The connection's chosen window, one of the offered sizes. */
const chosen = (c: ProviderConfig): number => (WINDOWS.includes(Number(c.options?.["numCtx"])) ? Number(c.options!["numCtx"]) : DEFAULT_WINDOW);
/** The proxy headers the connection carries, on every request, not only the chat. */
const headersOf = (c: ProviderConfig): Record<string, string> => ({ "content-type": "application/json", ...(c.headers ?? {}) });
const positive = (v: unknown): number | undefined => (typeof v === "number" && Number.isSafeInteger(v) && v > 0 ? v : undefined);

/** A model's traits from what the server says of it: the window is the connection's choice capped by the model's own positive length. */
const traitsOf = (config: ProviderConfig, length: number | undefined, caps: readonly string[]): ModelTraits =>
  ({ window: Math.min(chosen(config), length ?? chosen(config)), tools: caps.includes("tools"), thinks: caps.includes("thinking") });

/** Bounded metadata reads share the byte pump and cancellation used by the rest of the engine. */
async function metadata(fetchFn: FetchFunction, url: string, init: RequestInit, signal: AbortSignal): Promise<unknown> {
  signal.throwIfAborted();
  const response = await fetchFn(url, { ...init, signal });
  signal.throwIfAborted();
  if (!response.ok) { await response.body?.cancel(); throw new Error(`Ollama metadata request failed (${String(response.status)}).`); }
  const read = await readStreamCapped(response.body, METADATA_BYTES, { signal });
  signal.throwIfAborted();
  if (!read.ok) throw new Error("Ollama metadata exceeded its read limit or could not be read.");
  return JSON.parse(new TextDecoder().decode(read.bytes)) as unknown;
}

/** One resolution owns one description; no process cache or TTL can mix proxy identities or budget snapshots. */
async function inspect(config: ProviderConfig, fetch: FetchFunction, parent?: AbortSignal): Promise<ModelTraits> {
  parent?.throwIfAborted();
  const timeout = AbortSignal.timeout(METADATA_MS);
  const signal = parent ? AbortSignal.any([parent, timeout]) : timeout;
  try {
    const body = await metadata(fetch, `${rootOf(config)}/api/show`, { method: "POST", headers: headersOf(config), body: JSON.stringify({ model: config.model }) }, signal);
    const info = isRecord(body) && isRecord(body["model_info"]) ? body["model_info"] : {};
    const arch = typeof info["general.architecture"] === "string" ? info["general.architecture"] : null;
    const length = positive(arch ? info[`${arch}.context_length`] : Object.entries(info).find(([k]) => k.endsWith(".context_length"))?.[1]);
    return traitsOf(config, length, isRecord(body) ? strArray(body["capabilities"]) : []);
  } catch {
    parent?.throwIfAborted();
    return { window: chosen(config) };
  }
}

/** The provider for one connection and model, sized and told what the model takes. */
async function providerFor(config: ProviderConfig, fetch: FetchFunction, label: string, signal?: AbortSignal) {
  const traits = await inspect(config, fetch, signal);
  const headers = config.headers && Object.keys(config.headers).length > 0 ? JSON.stringify(config.headers) : undefined;
  const provider = createOllamaProvider(
    { id: config.id ?? "ollama", baseUrl: rootOf(config), numCtx: traits.window ?? chosen(config), thinks: traits.thinks === true, params: OLLAMA_PARAMS, ...(headers ? { customHeaders: headers } : {}) },
    { fetch: fetch as (url: string, init: RequestInit) => Promise<Response>, label },
  );
  return { provider, traits };
}

/** Kit's messages as the stage's: tool calls as JSON text, a tool result named by its call. */
function toProvider(m: ModelMessage): ProviderMessage {
  return {
    role: m.role,
    content: m.content,
    ...(m.toolCalls?.length ? { tool_calls: m.toolCalls.map((c) => ({ id: c.id, type: "function" as const, function: { name: c.name, arguments: JSON.stringify(c.args ?? {}) } })) } : {}),
    ...(m.toolCallId ? { tool_call_id: m.toolCallId } : {}),
    ...(m.toolName ? { name: m.toolName } : {}),
  };
}
/** What Kit is told when its model takes no tools. */
const NO_TOOLS_NOTE = "This model takes no tools here, so you cannot look anything up in the Studio. Answer from the conversation, and say plainly what you could not check.";
const toolOf = (t: ToolSpec) => ({ type: "function" as const, function: { name: t.name, description: t.description, parameters: t.schema } });
const argsOf = (text: string): unknown => { try { return JSON.parse(text) as unknown; } catch { return {}; } };

const ollama: ProviderSpoke = {
  id: "ollama",
  group: "Custom",
  label: "Ollama",
  brand: "#A3A3A3",
  defaultModel: "llama3.1",
  keyless: true,
  defaultBaseURL: DEFAULT_BASE,
  options: [{
    key: "numCtx",
    label: "Context window",
    choices: WINDOWS.map((n) => ({ value: String(n), label: `${String(n / 1024)}K tokens` })),
    defaultValue: String(DEFAULT_WINDOW),
  }],
  async listModels(config, fetch, parent): Promise<ModelInfo[]> {
    parent?.throwIfAborted();
    const timeout = AbortSignal.timeout(METADATA_MS);
    const signal = parent ? AbortSignal.any([parent, timeout]) : timeout;
    const body = await metadata(fetch, `${rootOf(config)}/api/tags`, { method: "GET", headers: headersOf(config) }, signal);
    if (!isRecord(body) || !Array.isArray(body.models) || body.models.length > MAX_MODELS || !body.models.every(isRecord)) throw new Error("Ollama returned an unreadable model list or more than 512 models.");
    const models = body.models;
    if (models.some((m) => typeof m.name !== "string" || !m.name.trim())) throw new Error("Ollama returned a model without a name.");
    const results: (ModelInfo | null)[] = Array(models.length).fill(null);
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(MODEL_WORKERS, models.length) }, async () => {
      for (;;) {
        const index = next++;
        if (index >= models.length) return;
        signal.throwIfAborted();
        const m = models[index]!;
        const id = m.name as string;
        const details = isRecord(m.details) ? m.details : {};
        const caps = strArray(m.capabilities);
        if (caps.length > 0 && !caps.includes("completion")) continue;
        const size = typeof details.parameter_size === "string" ? details.parameter_size : null;
        const traits = caps.length > 0 && positive(details.context_length)
          ? traitsOf({ ...config, model: id }, positive(details.context_length), caps)
          : await inspect({ ...config, model: id }, fetch, signal);
        results[index] = { id, label: size ? `${id} (${size})` : id, ...(traits.window ? { context: traits.window } : {}) };
      }
    }));
    return results.filter((m): m is ModelInfo => m !== null);
  },
  async chat(config, signal, system): Promise<ChatFn> {
    const fetch = guardedFetch(allowedHost(config, ollama));
    const { provider, traits } = await providerFor(config, fetch, config.name ?? "Ollama", signal);
    return async (messages, tools, onDelta) => {
      const send = traits.tools === true && tools.length > 0;
      // Kit's protocol says to look Studio facts up with tools; a model that takes none is told so, rather than left to invent them.
      const said = send || tools.length === 0 ? system : [system, NO_TOOLS_NOTE].filter(Boolean).join("\n\n");
      const request: ProviderRequest = {
        model: config.model,
        messages: [...(said ? [{ role: "system" as const, content: said }] : []), ...messages.map(toProvider)],
        options: { stream: true, ...(send ? { tools: tools.map(toolOf), tool_choice: "auto" as const } : {}) },
      };
      const done = await provider.send(request, {
        ...(signal ? { signal } : {}),
        onEvent: (e) => { if ("delta" in e) onDelta?.({ kind: e.channel === "reasoning" ? "reasoning" : "text", text: e.delta }); },
      });
      const usage = readUsage({ input: done.usage?.promptTotal ?? done.usage?.uncached, output: done.usage?.output });
      const advertised = new Set(send ? tools.map((tool) => tool.name) : []);
      if (done.tool_calls?.some((call) => !advertised.has(call.function.name))) throw badReply("Ollama proposed a tool that was not offered in this request.");
      const calls: ModelToolCall[] = (done.tool_calls ?? []).map((c) => ({ id: c.id, name: c.function.name, args: argsOf(c.function.arguments) }));
      return calls.length > 0 ? { kind: "use", text: done.content, calls, usage } : { kind: "say", text: done.content, usage };
    };
  },
  scene: {
    base: rootOf,
    params: OLLAMA_PARAMS,
    resolve: providerFor,
  },
};

export default ollama;
