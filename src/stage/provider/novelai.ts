/**
 * NovelAI's own text API (`/ai/generate-stream`): one prompt string and a `parameters` object, no chat roles, as RoleCall's adapter
 * sends it (apps/rc/src/lib/providers/adapters/novelai.ts). The messages become a labelled transcript ending on the reply's cue.
 */
import { ProviderError, type Provider, type ProviderCompletion, type ProviderMessage } from "../contracts/provider";

type Fetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

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

function failure(status: number, detail: string): ProviderError {
  const words = detail.slice(0, 200);
  if (status === 401 || status === 403) return new ProviderError(`NovelAI refused that token. ${words}`.trim(), { category: "invalid_request_error", code: "invalid_api_key", status });
  if (status === 429) return new ProviderError(`NovelAI is rate limiting this account. ${words}`.trim(), { category: "rate_limit_error", code: "rate_limit_exceeded", status });
  return new ProviderError(`NovelAI answered ${status}. ${words}`.trim(), { category: status >= 500 ? "api_error" : "invalid_request_error", code: status >= 500 ? "backend_error" : "invalid_parameter", status });
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

export function createNovelAIProvider(connection: { id: string; apiKey: string; baseUrl: string }, deps: { fetch: Fetch }): Provider {
  return {
    id: connection.id,
    async send(request, io) {
      const options = request.options;
      const response = await deps.fetch(`${connection.baseUrl}/ai/generate-stream`, {
        method: "POST",
        ...(io?.signal ? { signal: io.signal } : {}),
        headers: { authorization: `Bearer ${connection.apiKey}`, "content-type": "application/json", accept: "text/event-stream" },
        body: JSON.stringify({
          input: novelAIPrompt(request.messages),
          model: request.model,
          parameters: {
            max_length: options?.max_tokens ?? 300, use_string: true, generate_until_sentence: true,
            ...(options?.temperature !== undefined ? { temperature: options.temperature } : {}),
            ...(options?.top_p !== undefined ? { top_p: options.top_p } : {}),
            ...(options?.top_k !== undefined ? { top_k: options.top_k } : {}),
            ...(options?.frequency_penalty !== undefined ? { repetition_penalty: options.frequency_penalty } : {}),
          },
        }),
      });
      if (!response.ok) throw failure(response.status, await response.text().catch(() => ""));
      if (!response.body) throw failure(response.status, "It sent no reply.");
      let content = "", buffer = "", done = false;
      const decoder = new TextDecoder();
      const line = (raw: string): void => {
        if (done || !raw.startsWith("data:")) return;
        const token = tokenOf(raw.slice(5).trim());
        done ||= token.done;
        if (token.text) { content += token.text; io?.onEvent?.({ channel: "content", delta: token.text }); }
      };
      const reader = response.body.getReader();
      while (!done) {
        const { value, done: ended } = await reader.read();
        if (ended) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() ?? "";
        lines.forEach(line);
      }
      if (buffer) line(buffer);
      const completion: ProviderCompletion = { content, finish_reason: "stop", model: request.model, raw: {} };
      return completion;
    },
  };
}
