/**
 * The request half of the native Anthropic spoke: system placement, depth-note adjacency, alternating
 * roles, cache breakpoints, and the wire body. No network.
 */
import { describe, expect, test } from "bun:test";
import { ProviderError, type ProviderMessage, type ProviderRequest } from "../contracts/provider";
import { applyCacheBreakpoints, buildAnthropicRequest, resolveMessagesUrl, toAnthropicWire, type AnthropicConnection } from "./anthropic-request";

const conn = (extra: Partial<AnthropicConnection> = {}): AnthropicConnection => ({ id: "a", apiKey: "sk-ant-test", ...extra });
const req = (messages: ProviderMessage[], options: ProviderRequest["options"] = {}): ProviderRequest => ({ model: "claude-opus-5-5", messages, options });

describe("resolveMessagesUrl", () => {
  test("defaults to the real API and always ends in /v1/messages", () => {
    expect(resolveMessagesUrl(undefined)).toBe("https://api.anthropic.com/v1/messages");
    expect(resolveMessagesUrl("https://api.anthropic.com")).toBe("https://api.anthropic.com/v1/messages");
    expect(resolveMessagesUrl("https://api.anthropic.com/v1")).toBe("https://api.anthropic.com/v1/messages");
    expect(resolveMessagesUrl("https://api.anthropic.com/v1/messages")).toBe("https://api.anthropic.com/v1/messages");
    expect(resolveMessagesUrl("https://relay.example/")).toBe("https://relay.example/v1/messages");
  });
});

describe("toAnthropicWire: system placement and depth notes (matches RoleCall's native mapping)", () => {
  test("only the leading system run becomes the top-level system field, one block per message", () => {
    const wire = toAnthropicWire([
      { role: "system", content: "You are Aria." },
      { role: "system", content: "Speak in third person." },
      { role: "user", content: "Hi" },
    ]);
    expect(wire.system).toEqual([{ type: "text", text: "You are Aria." }, { type: "text", text: "Speak in third person." }]);
    expect(wire.messages).toEqual([{ role: "user", content: "Hi" }]);
  });

  test("a mid-chat system message (a depth note) becomes a bare, unlabeled inline user turn: no prefix or wrapper text, same as RoleCall's toAnthropicMessages", () => {
    const wire = toAnthropicWire([
      { role: "system", content: "Card description." },
      { role: "user", content: "Turn 1" },
      { role: "assistant", content: "Reply 1" },
      { role: "system", content: "[Depth note: remember the sword]" },
      { role: "user", content: "Turn 2" },
    ]);
    expect(wire.system).toEqual([{ type: "text", text: "Card description." }]);
    // The depth note merges into the very next user turn (adjacency preserved, not hoisted); its text
    // is carried verbatim, with no "[System note]:"-style label added anywhere.
    expect(wire.messages).toEqual([
      { role: "user", content: "Turn 1" },
      { role: "assistant", content: "Reply 1" },
      { role: "user", content: "[Depth note: remember the sword]\n\nTurn 2" },
    ]);
  });

  test("a reply that would not open with user gets a placeholder inserted", () => {
    const wire = toAnthropicWire([{ role: "assistant", content: "Hello there." }]);
    expect(wire.messages[0]!.role).toBe("user");
    expect(wire.messages[1]).toEqual({ role: "assistant", content: "Hello there." });
  });

  test("a system-only request still sends one user message (the API rejects an empty messages list)", () => {
    const wire = toAnthropicWire([{ role: "system", content: "You are the narrator." }]);
    expect(wire.messages).toHaveLength(1);
    expect(wire.messages[0]!.role).toBe("user");
  });

  test("a tool result becomes a tool_result block on a user turn", () => {
    const wire = toAnthropicWire([
      { role: "user", content: "roll a d20" },
      { role: "assistant", content: "", tool_calls: [{ id: "t1", type: "function", function: { name: "roll", arguments: "{}" } }] },
      { role: "tool", content: "17", tool_call_id: "t1" },
    ]);
    expect(wire.messages[1]).toEqual({ role: "assistant", content: [{ type: "tool_use", id: "t1", name: "roll", input: {} }] });
    expect(wire.messages[2]).toEqual({ role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: "17" }] });
  });

  test("native reasoning round-trips as a signed thinking block ahead of the text", () => {
    const wire = toAnthropicWire([
      { role: "user", content: "Think it through." },
      { role: "assistant", content: "42.", reasoning: { text: "because", signature: "sig", provider: "anthropic" } },
    ]);
    expect(wire.messages[1]).toEqual({
      role: "assistant",
      content: [{ type: "thinking", thinking: "because", signature: "sig" }, { type: "text", text: "42." }],
    });
  });

  test("prompt images and PDFs become native user content blocks in attachment order", () => {
    const wire = toAnthropicWire([{
      role: "user", content: "Inspect these.", attachments: [
        { kind: "image", name: "cover.png", mime: "image/png", dataUri: "data:image/png;base64,AA" },
        { kind: "pdf", name: "notes.pdf", base64: "UEZERg==" },
      ],
    }]);
    expect(wire.messages).toEqual([{
      role: "user",
      content: [
        { type: "text", text: "Inspect these." },
        { type: "image", source: { type: "base64", media_type: "image/png", data: "AA" } },
        { type: "document", source: { type: "base64", media_type: "application/pdf", data: "UEZERg==" }, title: "notes.pdf" },
      ],
    }]);
  });

  test("ambiguous mixed image sources and non-user attachments fail before wire construction", () => {
    expect(() => toAnthropicWire([{ role: "user", content: "x", images: ["data:image/png;base64,AA"], attachments: [{ kind: "pdf", name: "a.pdf", base64: "UEZERg==" }] }])).toThrow(ProviderError);
    expect(() => toAnthropicWire([{ role: "assistant", content: "x", attachments: [{ kind: "pdf", name: "a.pdf", base64: "UEZERg==" }] }])).toThrow(ProviderError);
  });

  test("reasoning from a different provider is not echoed back as Anthropic thinking", () => {
    const wire = toAnthropicWire([
      { role: "user", content: "hi" },
      { role: "assistant", content: "hello", reasoning: { text: "because", signature: "sig", provider: "openai" } },
    ]);
    expect(wire.messages[1]).toEqual({ role: "assistant", content: "hello" });
  });

  test("an unpaired tool call rejects before anything is built (shared tool-protocol validator)", () => {
    expect(() =>
      toAnthropicWire([{ role: "assistant", content: "", tool_calls: [{ id: "t1", type: "function", function: { name: "roll", arguments: "{}" } }] }]),
    ).toThrow(ProviderError);
  });

  test("Anthropic's alternation requirement: no two adjacent wire messages ever share a role, however many system/tool rewrites collapse into it", () => {
    const wire = toAnthropicWire([
      { role: "system", content: "Card." },
      { role: "user", content: "Turn 1" },
      { role: "system", content: "Depth note A" }, // mid-chat system, no assistant turn between it and the next
      { role: "system", content: "Depth note B" },
      { role: "assistant", content: "", tool_calls: [{ id: "t1", type: "function", function: { name: "roll", arguments: "{}" } }] },
      { role: "tool", content: "17", tool_call_id: "t1" }, // tool becomes user; follows the tool-call turn
      { role: "assistant", content: "Reply 2" },
    ]);
    for (let i = 1; i < wire.messages.length; i++) {
      expect(wire.messages[i]!.role).not.toBe(wire.messages[i - 1]!.role);
    }
    // Turn 1, then both depth notes merged into one user turn ahead of it being impossible (they
    // precede any content) - merged with "Turn 1" itself since all three are consecutive user-role.
    expect(wire.messages[0]).toEqual({ role: "user", content: "Turn 1\n\nDepth note A\n\nDepth note B" });
  });
});

describe("applyCacheBreakpoints: Anthropic's stateless multi-turn pattern (no memory of a previous request)", () => {
  const long = "x".repeat(20_000); // comfortably over every model's minimum cacheable length

  test("a breakpoint below the model's minimum cacheable length is skipped", () => {
    const wire = toAnthropicWire([{ role: "system", content: "short" }, { role: "user", content: "hi" }]);
    const marked = applyCacheBreakpoints(wire, "claude-opus-5-5");
    expect(marked.system[0]!.cache_control).toBeUndefined();
    expect(marked.messages[0]!.content).toBe("hi");
  });

  test("a long enough system block gets the mark on its last block only", () => {
    const wire = toAnthropicWire([{ role: "system", content: "one" }, { role: "system", content: long }, { role: "user", content: "hi" }]);
    const marked = applyCacheBreakpoints(wire, "claude-opus-5-5");
    expect(marked.system[0]!.cache_control).toBeUndefined();
    expect(marked.system[1]!.cache_control).toEqual({ type: "ephemeral" });
  });

  test("a single-message request marks only the newest message (there is no 'before the newest' to mark separately)", () => {
    const wire = toAnthropicWire([{ role: "user", content: long }]);
    const marked = applyCacheBreakpoints(wire, "claude-opus-5-5");
    const content = marked.messages[0]!.content;
    expect(Array.isArray(content)).toBe(true);
    expect((content as { cache_control?: unknown }[])[0]!.cache_control).toEqual({ type: "ephemeral" });
  });

  test("a multi-message request marks both the message before the newest turn and the newest message itself", () => {
    const wire = toAnthropicWire([{ role: "user", content: long }, { role: "assistant", content: long }, { role: "user", content: "new question" }]);
    const marked = applyCacheBreakpoints(wire, "claude-opus-5-5");
    expect(Array.isArray(marked.messages[1]!.content)).toBe(true); // "before the newest" (index length-2)
    expect((marked.messages[1]!.content as { cache_control?: unknown }[])[0]!.cache_control).toEqual({ type: "ephemeral" });
    expect(Array.isArray(marked.messages[2]!.content)).toBe(true); // the newest message itself
    expect((marked.messages[2]!.content as { cache_control?: unknown }[])[0]!.cache_control).toEqual({ type: "ephemeral" });
    expect(marked.messages[0]!.content).toBe(long); // never marked: it is neither boundary
  });

  test("turn 2's marks sit within a couple of messages of where turn 1's cache write ended, well inside Anthropic's 20-block lookback", () => {
    // Turn 1: one message, so its only mark is "the newest" at index 0 - that write covers
    // system + message 0.
    const turn1 = applyCacheBreakpoints(toAnthropicWire([{ role: "system", content: long }, { role: "user", content: "Hello" }]), "claude-opus-5-5");
    expect(JSON.stringify(turn1.messages[0])).toBe(JSON.stringify({ role: "user", content: [{ type: "text", text: "Hello", cache_control: { type: "ephemeral" } }] }));

    // Turn 2 extends the same, unedited history. Its own marks land at index 1 ("before the
    // newest") and index 2 (the newest) - 1 and 2 messages past where turn 1's write ended, not 0
    // messages past it, but nowhere near the 20-block lookback either. The prefix through index 0
    // (turn 1's cached content) is untouched and byte-identical, which is what makes it findable.
    const turn2 = applyCacheBreakpoints(
      toAnthropicWire([
        { role: "system", content: long },
        { role: "user", content: "Hello" },
        { role: "assistant", content: "Hi there!" },
        { role: "user", content: "How are you?" },
      ]),
      "claude-opus-5-5",
    );
    expect(turn2.messages[0]).toEqual({ role: "user", content: "Hello" }); // unmarked, but byte-identical to turn 1's cached content
    expect((turn2.messages[1]!.content as { cache_control?: unknown }[])[0]!.cache_control).toEqual({ type: "ephemeral" });
    expect((turn2.messages[2]!.content as { cache_control?: unknown }[])[0]!.cache_control).toEqual({ type: "ephemeral" });
  });
});

describe("buildAnthropicRequest: the whole wire body (pure, no cross-call state)", () => {
  test("headers use x-api-key, never a bearer token", () => {
    const wire = buildAnthropicRequest(req([{ role: "user", content: "hi" }]), conn({ apiKey: "sk-ant-x" }));
    expect(wire.headers["x-api-key"]).toBe("sk-ant-x");
    expect(wire.headers["Authorization"]).toBeUndefined();
    expect(wire.headers["anthropic-version"]).toBe("2023-06-01");
  });

  test("max_tokens defaults, and options.max_tokens wins", () => {
    expect(buildAnthropicRequest(req([{ role: "user", content: "hi" }]), conn()).body.max_tokens).toBe(4096);
    expect(buildAnthropicRequest(req([{ role: "user", content: "hi" }], { max_tokens: 200 }), conn()).body.max_tokens).toBe(200);
  });

  test("temperature wins over top_p when both are set; top_p alone is sent when temperature is not", () => {
    const a = buildAnthropicRequest(req([{ role: "user", content: "hi" }], { temperature: 0.5, top_p: 0.9 }), conn()).body;
    expect(a.temperature).toBe(0.5);
    expect(a.top_p).toBeUndefined();
    const b = buildAnthropicRequest(req([{ role: "user", content: "hi" }], { top_p: 0.9 }), conn()).body;
    expect(b.top_p).toBe(0.9);
  });

  test("extended thinking drops temperature/top_p/top_k and grows max_tokens past the budget", () => {
    const body = buildAnthropicRequest(
      req([{ role: "user", content: "hi" }], { temperature: 0.7, top_k: 5, max_tokens: 100, reasoning_budget_tokens: 1024 }),
      conn(),
    ).body;
    expect(body.thinking).toEqual({ type: "enabled", budget_tokens: 1024 });
    expect(body.temperature).toBeUndefined();
    expect(body.top_k).toBeUndefined();
    expect(body.max_tokens).toBe(1024 + 4096);
  });

  test("tools map to Anthropic's input_schema shape, and tool_choice maps by kind", () => {
    const tools = [{ type: "function" as const, function: { name: "roll", description: "Roll dice", parameters: { type: "object" }, strict: true } }];
    const body = buildAnthropicRequest(req([{ role: "user", content: "hi" }], { tools, tool_choice: "required" }), conn()).body;
    expect(body.tools).toEqual([{ name: "roll", description: "Roll dice", input_schema: { type: "object" } }]);
    expect(body.tool_choice).toEqual({ type: "any" });
  });

  test("disallow_tools removes tools and tool_choice even if a custom body tried to add them back", () => {
    const tools = [{ type: "function" as const, function: { name: "roll", description: "d", parameters: {} } }];
    const body = buildAnthropicRequest(req([{ role: "user", content: "hi" }], { tools, disallow_tools: true }), conn()).body;
    expect(body.tools).toBeUndefined();
    expect(body.tool_choice).toBeUndefined();
  });

  test("custom headers and body apply, and excluded fields are removed after", () => {
    const wire = buildAnthropicRequest(
      req([{ role: "user", content: "hi" }], { custom_include_headers: '{"X-Extra":"1"}', custom_include_body: '{"metadata":{"a":1}}', custom_exclude_body: "metadata" }),
      conn(),
    );
    expect(wire.headers["X-Extra"]).toBe("1");
    expect(wire.body.metadata).toBeUndefined();
    expect(wire.body.max_tokens).toBe(4096);
  });

  test("a request left with no positive max_tokens (excluded by a custom field) is rejected before sending", () => {
    expect(() => buildAnthropicRequest(req([{ role: "user", content: "hi" }], { custom_exclude_body: "max_tokens" }), conn())).toThrow(ProviderError);
  });
});

describe("generation parameters", () => {
  const conn = (params?: AnthropicConnection["params"]): AnthropicConnection => ({ id: "a", apiKey: "k", ...(params ? { params } : {}) });
  test("stop strings go out as stop_sequences and parameters Anthropic does not take stay out", () => {
    const { body } = buildAnthropicRequest(req([{ role: "user", content: "hi" }], { params: { stop: ["END"], min_p: 0.1, seed: 3 } }), conn({ stop: "stop_sequences", top_k: true }));
    expect(body.stop_sequences).toEqual(["END"]);
    expect(body.min_p).toBeUndefined();
    expect(body.seed).toBeUndefined();
  });
  test("top k still goes out with no declared table", () => {
    expect(buildAnthropicRequest(req([{ role: "user", content: "hi" }], { top_k: 40 }), conn()).body.top_k).toBe(40);
  });
});
