/**
 * The request half of native Ollama: the window on every
 * request, samplers inside `options` under Ollama's names, roles kept in place, images, tools, `think`, `format`, and
 * the shared custom header and body rules. No network.
 */
import { describe, expect, test } from "bun:test";
import { ProviderError, type ProviderMessage, type ProviderRequest, type ProviderToolDefinition } from "../contracts/provider";
import { OLLAMA_PARAMS } from "../params/dialects";
import { sentParams } from "../params/wire";
import { buildOllamaRequest, type OllamaConnection } from "./ollama-request";

const conn = (extra: Partial<OllamaConnection> = {}): OllamaConnection => ({ id: "ollama", baseUrl: "http://localhost:11434", numCtx: 16_384, params: OLLAMA_PARAMS, ...extra });
const req = (options: ProviderRequest["options"] = {}, messages: ProviderMessage[] = [{ role: "user", content: "hi" }]): ProviderRequest => ({ model: "llama3.1", messages, options });
const body = (r: ProviderRequest, c = conn()) => buildOllamaRequest(r, c).body;
const tool = (name: string): ProviderToolDefinition => ({ type: "function", function: { name, description: `${name} tool`, parameters: { type: "object", properties: {} } } });

describe("the wire request", () => {
  test("posts to /api/chat with JSON headers and always sends the window and an explicit stream flag", () => {
    const wire = buildOllamaRequest(req(), conn({ baseUrl: "http://gpu-box:11434/" }));
    expect(wire.url).toBe("http://gpu-box:11434/api/chat");
    expect(wire.headers).toEqual({ "Content-Type": "application/json" });
    expect(wire.body).toEqual({ model: "llama3.1", messages: [{ role: "user", content: "hi" }], stream: false, options: { num_ctx: 16_384 } });
    expect(body(req({ stream: true }), conn({ numCtx: 8_192 }))).toMatchObject({ stream: true, options: { num_ctx: 8_192 } });
  });

  test("temperature, top p and the reply cap ride inside options; a top p of zero is off", () => {
    expect(body(req({ temperature: 0.7, top_p: 0.9, max_tokens: 512 })).options).toEqual({ num_ctx: 16_384, temperature: 0.7, top_p: 0.9, num_predict: 512 });
    expect(body(req({ top_p: 0 })).options).toEqual({ num_ctx: 16_384 });
  });

  test("samplers go inside options under Ollama's names, and the ones it does not take are reported as not sent", () => {
    const options: ProviderRequest["options"] = {
      top_k: 40,
      repetition_penalty: 1.1,
      params: { min_p: 0.05, typical_p: 0.9, seed: 7, presence_penalty: 0.2, frequency_penalty: 0.3, stop: ["\nUser:"], mirostat_mode: 2, mirostat_tau: 4, mirostat_eta: 0.2, tfs: 0.9, dry_multiplier: 0.8 },
    };
    const out = body(req(options));
    expect(out.options).toEqual({
      num_ctx: 16_384, top_k: 40, repeat_penalty: 1.1, min_p: 0.05, typical_p: 0.9, seed: 7, presence_penalty: 0.2, frequency_penalty: 0.3,
      stop: ["\nUser:"],
    });
    expect(Object.keys(out)).toEqual(["model", "messages", "stream", "options"]);
    expect(sentParams(OLLAMA_PARAMS, options).notSent).toEqual([
      { id: "mirostat_mode", why: "unsupported" }, { id: "mirostat_tau", why: "unsupported" }, { id: "mirostat_eta", why: "unsupported" },
      { id: "tfs", why: "unsupported" }, { id: "dry_multiplier", why: "unsupported" },
    ]);
  });

  test("a connection that declares no parameters still sends Ollama's own", () => {
    expect(body(req({ params: { min_p: 0.1 } }), conn({ params: undefined })).options).toEqual({ num_ctx: 16_384, min_p: 0.1 });
  });
});

describe("messages", () => {
  test("every role stays in its place: a mid-chat system message is not hoisted or merged", () => {
    const messages: ProviderMessage[] = [
      { role: "system", content: "Card." },
      { role: "user", content: "Turn 1" },
      { role: "assistant", content: "Reply 1" },
      { role: "system", content: "[Depth note]" },
      { role: "user", content: "Turn 2" },
    ];
    expect(body(req({}, messages)).messages).toEqual(messages);
  });

  test("prompt post-processing applies as on the other spokes", () => {
    const messages: ProviderMessage[] = [{ role: "user", content: "a" }, { role: "user", content: "b" }];
    expect(body(req({ prompt_post_processing: "merge" }, messages)).messages).toEqual([{ role: "user", content: "a\n\nb" }]);
  });

  test("a user message's images go as bare base64, the data-URI prefix removed", () => {
    const messages: ProviderMessage[] = [{ role: "user", content: "look", images: ["data:image/png;base64,iVBORw0KGgo=", "data:image/jpeg;base64,/9j/4AAQ"] }];
    expect(body(req({}, messages)).messages).toEqual([{ role: "user", content: "look", images: ["iVBORw0KGgo=", "/9j/4AAQ"] }]);
  });

  test("prompt image attachments use Ollama's native user images field", () => {
    const messages: ProviderMessage[] = [{ role: "user", content: "look", attachments: [{ kind: "image", name: "cover.png", mime: "image/png", dataUri: "data:image/png;base64,iVBORw0KGgo=" }] }];
    expect(body(req({}, messages)).messages).toEqual([{ role: "user", content: "look", images: ["iVBORw0KGgo="] }]);
  });

  test("PDF attachments and non-user attachment placements fail before wire construction", () => {
    expect(() => body(req({}, [{ role: "user", content: "read", attachments: [{ kind: "pdf", name: "notes.pdf", base64: "UEZERg==" }] }]))).toThrow(ProviderError);
    expect(() => body(req({}, [{ role: "system", content: "read", attachments: [{ kind: "image", name: "cover.png", mime: "image/png", dataUri: "data:image/png;base64,AA" }] }]))).toThrow(ProviderError);
  });

  test("an assistant's tool calls go with object arguments ({} when unreadable) and a tool result carries its tool name", () => {
    const messages: ProviderMessage[] = [
      { role: "user", content: "weather?" },
      {
        role: "assistant",
        content: "",
        tool_calls: [
          { id: "call_0", type: "function", function: { name: "get_weather", arguments: "{\"city\":\"Oslo\"}" } },
          { id: "call_1", type: "function", function: { name: "get_time", arguments: "not json" } },
        ],
      },
      { role: "tool", tool_call_id: "call_0", name: "get_weather", content: "rain" },
      { role: "tool", tool_call_id: "call_1", content: "noon" },
    ];
    expect(body(req({}, messages)).messages).toEqual([
      { role: "user", content: "weather?" },
      { role: "assistant", content: "", tool_calls: [{ id: "call_0", function: { name: "get_weather", arguments: { city: "Oslo" } } }, { id: "call_1", function: { name: "get_time", arguments: {} } }] },
      { role: "tool", content: "rain", tool_name: "get_weather", tool_call_id: "call_0" },
      { role: "tool", content: "noon", tool_name: "get_time", tool_call_id: "call_1" },
    ]);
  });

  test("the reply's own call ids may repeat across rounds: Ollama matches results by order, not id", () => {
    const round = (name: string): ProviderMessage[] => [
      { role: "assistant", content: "", tool_calls: [{ id: "call_0", type: "function", function: { name, arguments: "{}" } }] },
      { role: "tool", tool_call_id: "call_0", content: `${name} done` },
    ];
    const out = body(req({}, [{ role: "user", content: "go" }, ...round("first"), ...round("second")])).messages as Record<string, unknown>[];
    expect(out.filter((m) => m.role === "tool").map((m) => m.tool_name)).toEqual(["first", "second"]);
  });
});

describe("tools and tool choice", () => {
  const tools = [tool("look"), tool("roll")];
  const sent = (options: ProviderRequest["options"]) => body(req({ tools, ...options })).tools;
  test("auto, unset and required send every tool; Ollama has no forced call", () => {
    expect(sent({})).toEqual(tools);
    expect(sent({ tool_choice: "auto" })).toEqual(tools);
    expect(sent({ tool_choice: "required" })).toEqual(tools);
  });
  test("a named function sends only that tool", () => {
    expect(sent({ tool_choice: { type: "function", function: { name: "roll" } } })).toEqual([tools[1]]);
  });
  test("none, and disallow_tools, send no tools at all", () => {
    expect(sent({ tool_choice: "none" })).toBeUndefined();
    expect(sent({ disallow_tools: true })).toBeUndefined();
    expect(body(req({})).tools).toBeUndefined();
  });
});

describe("think", () => {
  const think = (effort: ProviderRequest["options"]["reasoning_effort"], thinks = true) => body(req(effort ? { reasoning_effort: effort } : {}), conn({ thinks })).think;
  test("a thinking model gets false for None, true for any other level, and nothing for Auto or unset", () => {
    expect(think("none")).toBe(false);
    expect(think("low")).toBe(true);
    expect(think("high")).toBe(true);
    expect(think("auto")).toBeUndefined();
    expect(think(undefined)).toBeUndefined();
  });
  test("a model that cannot think is never sent think", () => {
    expect(think("high", false)).toBeUndefined();
    expect(think("none", false)).toBeUndefined();
  });
});

describe("format", () => {
  const schema = { type: "object", properties: { name: { type: "string" } } };
  test("a scene's JSON schema goes as the top-level format, never inside options", () => {
    const out = body(req({ params: { json_schema: schema } }));
    expect(out.format).toEqual(schema);
    expect(out.options).toEqual({ num_ctx: 16_384 });
  });
  test("JSON mode asks for json, a response format's schema goes as itself, and a schema param wins over both", () => {
    expect(body(req({ params: { response_format: { type: "json_object" } } })).format).toBe("json");
    expect(body(req({ params: { response_format: { type: "json_schema", json_schema: { name: "x", schema } } } })).format).toEqual(schema);
    expect(body(req({ params: { response_format: { type: "text" } } })).format).toBeUndefined();
    expect(body(req({ params: { json_schema: schema, response_format: { type: "json_object" } } })).format).toEqual(schema);
  });
});

describe("custom headers and body", () => {
  test("the connection's and the scene's headers are applied", () => {
    const wire = buildOllamaRequest(req({ custom_include_headers: "{\"X-Scene\":\"1\"}" }), conn({ customHeaders: "{\"Authorization\":\"Bearer proxy\"}" }));
    expect(wire.headers).toEqual({ "Content-Type": "application/json", "X-Scene": "1", Authorization: "Bearer proxy" });
  });
  test("custom body fields are added, an excluded one is removed, and a custom options object adds to the window rather than replacing it", () => {
    const out = body(req({ temperature: 0.5, custom_include_body: "{\"keep_alive\":\"10m\",\"options\":{\"num_gpu\":20}}", custom_exclude_body: "think" }), conn({ thinks: true }));
    expect(out.keep_alive).toBe("10m");
    expect(out.options).toEqual({ num_ctx: 16_384, temperature: 0.5, num_gpu: 20 });
    expect(body(req({ reasoning_effort: "high", custom_exclude_body: "think" }), conn({ thinks: true })).think).toBeUndefined();
  });
});
