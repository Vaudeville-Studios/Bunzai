/**
 * The request half of the OpenAI-compatible spoke, pinned to RoleCall's adapter (base.ts, openai.ts)
 * and to the differences lists.
 */
import { describe, expect, test } from "bun:test";
import { ProviderError, type ProviderMessage, type ProviderRequest } from "../contracts/provider";
import {
  buildWireRequest,
  normalizeBaseUrlForPath,
  resolveChatCompletionsUrl,
  resolveModelsUrl,
  toWireMessages,
  type OpenAICompatibleConnection,
} from "./openai-compatible-request";

const conn = (extra: Partial<OpenAICompatibleConnection> = {}): OpenAICompatibleConnection => ({
  id: "local",
  baseUrl: "http://127.0.0.1:5001",
  ...extra,
});
const req = (extra: Partial<ProviderRequest["options"]> = {}, messages?: ProviderMessage[]): ProviderRequest => ({
  model: "m",
  messages: messages ?? [{ role: "user", content: "hi" }],
  options: extra,
});
const ctx = { connectionId: "local", model: "m" };
const call = (id: string, name = "roll", args = "{}") => ({ id, type: "function" as const, function: { name, arguments: args } });

function rejects(fn: () => unknown, code: string) {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(ProviderError);
    expect((error as ProviderError).code).toBe(code as ProviderError["code"]);
    return;
  }
  throw new Error("expected a ProviderError");
}

describe("URLs (RoleCall's helpers)", () => {
  test("a bare base gets /v1/chat/completions", () => {
    expect(resolveChatCompletionsUrl({ baseUrl: "http://127.0.0.1:5001/" })).toBe("http://127.0.0.1:5001/v1/chat/completions");
  });

  test("an explicit version segment is kept", () => {
    expect(resolveChatCompletionsUrl({ baseUrl: "https://api.z.ai/api/coding/paas/v4" })).toBe(
      "https://api.z.ai/api/coding/paas/v4/chat/completions",
    );
    expect(resolveChatCompletionsUrl({ baseUrl: "https://proxy/v2/chat/completions/" })).toBe("https://proxy/v2/chat/completions");
  });

  test("an explicit endpoint wins over the base URL", () => {
    expect(resolveChatCompletionsUrl({ baseUrl: "https://a", chatCompletionsEndpoint: "https://b/x/" })).toBe("https://b/x");
  });

  test("pasted resource suffixes are removed", () => {
    expect(normalizeBaseUrlForPath("https://api.anthropic.com/v1/messages")).toBe("https://api.anthropic.com/v1");
    expect(resolveModelsUrl("https://proxy/v3/models")).toBe("https://proxy/v3/models");
    expect(resolveModelsUrl("https://proxy")).toBe("https://proxy/v1/models");
  });

  test("no URL at all rejects as missing configuration", () => {
    rejects(() => resolveChatCompletionsUrl({}), "provider_config_missing");
  });
});

describe("wire messages (RoleCall's toOpenAIMessages)", () => {
  test("leading system messages merge into one; a later system message stays", () => {
    const out = toWireMessages(
      [
        { role: "system", content: "A" },
        { role: "system", content: "B" },
        { role: "user", content: "U" },
        { role: "system", content: "note" },
      ],
      ctx,
    );
    expect(out.map((m) => [m.role, m.content])).toEqual([
      ["system", "A\n\nB"],
      ["user", "U"],
      ["system", "note"],
    ]);
  });

  test("for a Claude model, a later system message becomes user in place and merges", () => {
    const out = toWireMessages(
      [
        { role: "system", content: "S" },
        { role: "user", content: "U" },
        { role: "system", content: "note" },
        { role: "assistant", content: "A" },
      ],
      { connectionId: "or", model: "anthropic/claude-x" },
    );
    expect(out.map((m) => [m.role, m.content])).toEqual([
      ["system", "S"],
      ["user", "U\n\nnote"],
      ["assistant", "A"],
    ]);
  });

  test("images become image_url parts on user messages", () => {
    const [m] = toWireMessages([{ role: "user", content: "look", images: ["data:image/png;base64,AA"] }], ctx);
    expect(m!.content).toEqual([
      { type: "text", text: "look" },
      { type: "image_url", image_url: { url: "data:image/png;base64,AA", detail: "auto" } },
    ]);
  });

  test("prompt images and PDFs become native user content parts in attachment order", () => {
    const [message] = toWireMessages([{
      role: "user", content: "Inspect these.", attachments: [
        { kind: "image", name: "cover.png", mime: "image/png", dataUri: "data:image/png;base64,AA" },
        { kind: "pdf", name: "notes.pdf", base64: "UEZERg==" },
      ],
    }], { ...ctx, pdfAttachments: true });
    expect(message!.content).toEqual([
      { type: "text", text: "Inspect these." },
      { type: "image_url", image_url: { url: "data:image/png;base64,AA", detail: "auto" } },
      { type: "file", file: { filename: "notes.pdf", file_data: "data:application/pdf;base64,UEZERg==" } },
    ]);
  });

  test("PDF needs an explicit compatible-endpoint capability", () => {
    rejects(() => toWireMessages([{ role: "user", content: "read", attachments: [{ kind: "pdf", name: "a.pdf", base64: "UEZERg==" }] }], ctx), "invalid_parameter");
  });

  test("ambiguous mixed image sources and non-user attachments fail before wire construction", () => {
    rejects(() => toWireMessages([{ role: "user", content: "x", images: ["data:image/png;base64,AA"], attachments: [{ kind: "pdf", name: "a.pdf", base64: "UEZERg==" }] }], ctx), "invalid_parameter");
    rejects(() => toWireMessages([{ role: "system", content: "x", attachments: [{ kind: "pdf", name: "a.pdf", base64: "UEZERg==" }] }], ctx), "invalid_parameter");
  });

  test("Claude's same-role rewrite never merges away an attachment", () => {
    const out = toWireMessages([
      { role: "user", content: "Read this.", attachments: [{ kind: "pdf", name: "a.pdf", base64: "UEZERg==" }] },
      { role: "system", content: "Keep it concise." },
    ], { connectionId: "a", model: "anthropic/claude-x", pdfAttachments: true });
    expect(out[0]!.content).toEqual([
      { type: "text", text: "Read this." },
      { type: "file", file: { filename: "a.pdf", file_data: "data:application/pdf;base64,UEZERg==" } },
    ]);
    expect(out[1]).toEqual({ role: "user", content: "Keep it concise." });
  });

  test("a tool-only assistant turn sends null content, and the tool result keeps its id", () => {
    const out = toWireMessages(
      [
        { role: "user", content: "go" },
        { role: "assistant", content: "", tool_calls: [call("c1")] },
        { role: "tool", content: "4", tool_call_id: "c1" },
      ],
      ctx,
    );
    expect(out[1]).toEqual({ role: "assistant", content: null, tool_calls: [call("c1")] });
    expect(out[2]).toEqual({ role: "tool", content: "4", tool_call_id: "c1" });
  });

  test("reasoning is echoed only to the connection that produced it, in the field it reads", () => {
    const history: ProviderMessage[] = [
      { role: "user", content: "q" },
      { role: "assistant", content: "a", reasoning: { text: "think", provider: "local" } },
    ];
    expect(toWireMessages(history, { ...ctx, reasoningEcho: "reasoning_content" })[1]!.reasoning_content).toBe("think");
    expect(toWireMessages(history, { ...ctx, connectionId: "other", reasoningEcho: "reasoning" })[1]!.reasoning).toBeUndefined();
    expect(Object.keys(toWireMessages(history, ctx)[1]!)).toEqual(["role", "content"]);
  });

  test("reasoning details pass through unmodified, keeping only reasoning blocks", () => {
    const details = [{ type: "reasoning.encrypted", data: "x" }, { type: "other" }];
    const [m] = toWireMessages([{ role: "user", content: "q", reasoning_details: details }], ctx);
    expect(m!.reasoning_details).toEqual([details[0]]);
  });

  test("a broken tool protocol rejects", () => {
    // Each bad call is answered, so only the fault under test can be the reason for rejecting.
    const answered = (c: ReturnType<typeof call>): ProviderMessage[] => [
      { role: "assistant", content: "", tool_calls: [c] },
      { role: "tool", content: "x", tool_call_id: c.id },
    ];
    expect(() => toWireMessages(answered(call("c1")), ctx)).not.toThrow();
    rejects(() => toWireMessages([{ role: "assistant", content: "", tool_calls: [call("c1")] }], ctx), "invalid_parameter");
    rejects(() => toWireMessages([{ role: "tool", content: "x", tool_call_id: "nope" }], ctx), "invalid_parameter");
    rejects(() => toWireMessages(answered(call("c1", "roll", "[1]")), ctx), "invalid_parameter");
    rejects(() => toWireMessages(answered(call("c1", "roll", "{bad")), ctx), "invalid_parameter");
    rejects(() => toWireMessages(answered(call("c1", "bad name")), ctx), "invalid_parameter");
    rejects(
      () =>
        toWireMessages(
          [
            { role: "assistant", content: "", tool_calls: [call("c1")] },
            { role: "user", content: "interrupting" },
            { role: "tool", content: "x", tool_call_id: "c1" },
          ],
          ctx,
        ),
      "invalid_parameter",
    );
    rejects(
      () =>
        toWireMessages(
          [
            { role: "assistant", content: "", tool_calls: [call("c1")] },
            { role: "tool", content: "x", tool_call_id: "c1", name: "other" },
          ],
          ctx,
        ),
      "invalid_parameter",
    );
    rejects(
      () => toWireMessages([{ role: "assistant", content: "", tool_calls: [call("c1")] }, { role: "user", content: "x" }], ctx),
      "invalid_parameter",
    );
  });
});

describe("the body", () => {
  test("is minimal by default: RoleCall's generic samplers only", () => {
    const { body } = buildWireRequest(
      req({ temperature: 0.8, top_p: 0.9, top_k: 40, min_p: 0.05, top_a: 0.1, repetition_penalty: 1.1, max_tokens: 300 }),
      conn(),
    );
    expect(body).toEqual({
      model: "m",
      messages: [{ role: "user", content: "hi" }],
      stream: false,
      temperature: 0.8,
      top_p: 0.9,
      max_tokens: 300,
    });
  });

  test("extra samplers are sent when the connection says the backend takes them", () => {
    const { body } = buildWireRequest(
      req({ top_k: 40, min_p: 0.05, top_a: 0.1, repetition_penalty: 1.1 }),
      conn({ params: { top_k: true, min_p: true, top_a: true, repetition_penalty: true } }),
    );
    expect(body).toMatchObject({ top_k: 40, min_p: 0.05, top_a: 0.1, repetition_penalty: 1.1 });
  });

  test("top p of zero is off, and neutral values are removed", () => {
    const { body } = buildWireRequest(
      req({ top_p: 0, frequency_penalty: 0, presence_penalty: 0, repetition_penalty: 1, top_k: 0, temperature: 0 }),
      conn({ params: { top_k: true, repetition_penalty: true, frequency_penalty: true, presence_penalty: true } }),
    );
    expect(body).toEqual({ model: "m", messages: [{ role: "user", content: "hi" }], stream: false, temperature: 0 });
  });

  test("stream usage, chat template arguments, and reasoning effort are opt-in", () => {
    const options = { stream: true, chat_template_kwargs: { enable_thinking: false }, reasoning_effort: "high" as const };
    expect(buildWireRequest(req(options), conn()).body).toEqual({ model: "m", messages: [{ role: "user", content: "hi" }], stream: true });
    const on = buildWireRequest(req(options), conn({ support: { streamUsage: true, chatTemplateKwargs: true, reasoningEffort: true } }));
    expect(on.body).toMatchObject({
      stream_options: { include_usage: true },
      chat_template_kwargs: { enable_thinking: false },
      reasoning_effort: "high",
    });
    const auto = buildWireRequest(req({ reasoning_effort: "auto" }), conn({ support: { reasoningEffort: true } }));
    expect(auto.body.reasoning_effort).toBeUndefined();
  });

  const tool = { type: "function" as const, function: { name: "roll", description: "d", parameters: {}, strict: true } };

  test("tools lose `strict` unless the backend takes it; parallel calls are opt-in", () => {
    const plain = buildWireRequest(req({ tools: [tool], tool_choice: "auto" }), conn()).body;
    expect(plain.tools).toEqual([{ type: "function", function: { name: "roll", description: "d", parameters: {} } }]);
    expect(plain.tool_choice).toBe("auto");
    expect(plain.parallel_tool_calls).toBeUndefined();
    const strict = buildWireRequest(req({ tools: [tool] }), conn({ support: { strictTools: true, parallelToolCalls: true } })).body;
    expect(strict.tools).toEqual([tool]);
    expect(strict.parallel_tool_calls).toBe(true);
    const declined = buildWireRequest(req({ tools: [tool], parallel_tool_calls: false }), conn({ support: { parallelToolCalls: true } }));
    expect(declined.body.parallel_tool_calls).toBe(false);
  });

  test("control fields never reach the wire", () => {
    const { body } = buildWireRequest(
      req({
        prompt_post_processing: "merge",
        custom_include_headers: '{"X-A": 1}',
        custom_include_body: "{}",
        custom_exclude_body: "",
        disallow_tools: false,
        roundtrip_native_reasoning: true,
        reasoning_budget_tokens: 2000,
      }),
      conn(),
    );
    expect(Object.keys(body).sort()).toEqual(["messages", "model", "stream"]);
  });

  test("post-processing runs before the wire shape", () => {
    const { body } = buildWireRequest(
      req({ prompt_post_processing: "merge" }, [
        { role: "user", content: "a" },
        { role: "user", content: "b" },
      ]),
      conn(),
    );
    expect(body.messages).toEqual([{ role: "user", content: "a\n\nb" }]);
  });
});

describe("custom headers and body", () => {
  test("headers: bearer key, then custom headers; a connection's own Authorization is honoured, scene text's is refused", () => {
    const { headers } = buildWireRequest(req(), conn({ apiKey: "k", customHeaders: '{"X-A":1}' }));
    expect(headers).toEqual({ "Content-Type": "application/json", Authorization: "Bearer k", "X-A": "1" });
    expect(buildWireRequest(req(), conn({ apiKey: "k", customHeaders: '{"Authorization":"Basic x"}' })).headers.Authorization).toBe("Basic x");
    expect(buildWireRequest(req({ custom_include_headers: '{"X-S":"1"}' }), conn({ apiKey: "k", customHeaders: '{"Authorization":"Basic x"}' })).headers).toMatchObject({ Authorization: "Basic x", "X-S": "1" });
    expect(() => buildWireRequest(req({ custom_include_headers: '{"authorization":"x"}' }), conn({ apiKey: "k" }))).toThrow(/protected/);
  });

  test("a chat's text adds to the connection's, and YAML is not", () => {
    const { headers, body } = buildWireRequest(
      req({ custom_include_headers: '{"X-Chat": "yes"}', custom_include_body: '{"min_p": 0.1, "seed": 7}' }),
      conn({ customHeaders: '{"X-Conn": "yes"}', customBody: '{"top_a": 1}' }),
    );
    expect(headers["X-Chat"]).toBe("yes");
    expect(headers["X-Conn"]).toBe("yes");
    expect(body).toMatchObject({ min_p: 0.1, seed: 7, model: "m" });
    expect(body.top_a).toBeUndefined();
  });

  test("custom body is not neutral-stripped: a value the user wrote by hand is sent", () => {
    const { body } = buildWireRequest(req({ custom_include_body: '{"frequency_penalty": 0}' }), conn());
    expect(body.frequency_penalty).toBe(0);
  });

  test("excluded fields are removed after the custom body", () => {
    const { body } = buildWireRequest(req({ temperature: 1, custom_include_body: '{"x": 1}', custom_exclude_body: "x\n temperature \n" }), conn());
    expect(body.x).toBeUndefined();
    expect(body.temperature).toBeUndefined();
  });

  test("disallow_tools has the final say, even over a custom body that adds tools", () => {
    const { body } = buildWireRequest(
      req({
        tools: [{ type: "function", function: { name: "roll", description: "d", parameters: {} } }],
        tool_choice: "required",
        disallow_tools: true,
        custom_include_body: '{"functions": [1], "function_call": "auto"}',
      }),
      conn({ support: { parallelToolCalls: true } }),
    );
    for (const key of ["tools", "tool_choice", "parallel_tool_calls", "functions", "function_call"]) expect(body[key]).toBeUndefined();
  });

  test("unreadable or non-object custom text rejects (RoleCall silently dropped it)", () => {
    rejects(() => buildWireRequest(req({ custom_include_body: "{not json" }), conn()), "invalid_options");
    rejects(() => buildWireRequest(req({ custom_include_body: "- a\n- b" }), conn()), "invalid_options");
    rejects(() => buildWireRequest(req({ custom_include_headers: "just words" }), conn()), "invalid_options");
  });
});

describe("generation parameters", () => {
  test("only enabled parameters the connection accepts are sent, under its names", () => {
    const { body } = buildWireRequest(req({ params: { seed: 7, min_p: 0.1, tfs: 0.9 } }), conn({ params: { seed: "random_seed", min_p: true } }));
    expect(body).toMatchObject({ random_seed: 7, min_p: 0.1 });
    expect(body.tfs).toBeUndefined();
    expect(body.seed).toBeUndefined();
  });
  test("a parameter that is off is simply absent from the request", () => {
    const { body } = buildWireRequest(req({ params: {} }), conn({ params: { seed: true } }));
    expect(body.seed).toBeUndefined();
  });
  test("a scene's custom body is merged last, over a parameter", () => {
    const { body } = buildWireRequest(req({ params: { seed: 7 }, custom_include_body: '{"seed": 9}' }), conn({ params: { seed: true } }));
    expect(body.seed).toBe(9);
  });
});
