/**
 * NovelAI's own text API (`/ai/generate-stream`): one prompt string and a `parameters` object, no chat roles, as RoleCall's adapter
 * sends it (apps/rc/src/lib/providers/adapters/novelai.ts). The messages become a labelled transcript ending on the reply's cue.
 */
import type { Provider, ProviderCompletion, ProviderEvent, ProviderMessage, ProviderRequest, WireRequest } from "../contracts/provider";
import { createProviderSend, type Fetch, type StreamReader } from "./provider-send";

export interface NovelAIConnection { id: string; apiKey: string; baseUrl: string }

export function novelAIPrompt(messages: readonly Pick<ProviderMessage, "role" | "content" | "name">[]): string {
  const lines = messages.flatMap((message) => {
    const content = message.content.trim();
    if (!content) return [];
    if (message.role === "system") return [`[System]\n${content}`];
    if (message.role === "user") return [`User: ${content}`];
    if (message.role === "assistant") return [`Assistant: ${content}`];
    return [`[Tool${message.name ? `: ${message.name}` : ""}]\n${content}`];
  });
  if (messages.at(-1)?.role !== "assistant") lines.push("Assistant:");
  return lines.join("\n\n");
}

function buildRequest(request: ProviderRequest, connection: NovelAIConnection): WireRequest {
  const options = request.options;
  const body: Record<string, unknown> = {
    input: novelAIPrompt(request.messages),
    model: request.model,
    parameters: {
      max_length: options?.max_tokens ?? 300, use_string: true, generate_until_sentence: true,
      ...(options?.temperature !== undefined ? { temperature: options.temperature } : {}),
      ...(options?.top_p !== undefined ? { top_p: options.top_p } : {}),
      ...(options?.top_k !== undefined ? { top_k: options.top_k } : {}),
      ...(options?.repetition_penalty !== undefined ? { repetition_penalty: options.repetition_penalty } : {}),
    },
  };
  // This address always streams. The shared sender reads `stream` to know that; it stays off the wire, where NovelAI has no such field.
  Object.defineProperty(body, "stream", { value: true, enumerable: false });
  return {
    url: `${connection.baseUrl}/ai/generate-stream`,
    headers: { authorization: `Bearer ${connection.apiKey}`, "content-type": "application/json", accept: "text/event-stream" },
    body,
  };
}

/** One server-sent line's text: NovelAI names the token field differently across its models, and a non-JSON line is the text itself. */
function tokenOf(data: string): { text: string; done: boolean } {
  try {
    const parsed = JSON.parse(data) as Record<string, unknown>;
    const text = [parsed["token"], parsed["output"], parsed["text"]].find((value) => typeof value === "string" && value !== "") as string | undefined;
    return { text: text ?? "", done: parsed["done"] === true || parsed["event"] === "done" };
  } catch {
    return { text: data, done: false };
  }
}

function streamReader(): StreamReader {
  let content = "", done = false;
  return {
    line(raw): ProviderEvent[] {
      if (done || !raw.startsWith("data:")) return [];
      const token = tokenOf(raw.slice(5).trim());
      done = token.done;
      if (!token.text) return [];
      content += token.text;
      return [{ channel: "content", delta: token.text }];
    },
    end: (): ProviderCompletion => ({ content, finish_reason: "stop", raw: {} }),
  };
}

export function createNovelAIProvider(connection: NovelAIConnection, deps: { fetch?: Fetch; label?: string } = {}): Provider {
  return createProviderSend(connection, {
    ...deps,
    label: deps.label ?? "NovelAI",
    buildWireRequest: buildRequest,
    createStreamReader: streamReader,
    // Never reached: this address always streams (buildRequest).
    parseCompletion: (): ProviderCompletion => ({ content: "", finish_reason: "stop", raw: {} }),
  });
}
