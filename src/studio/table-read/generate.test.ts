/** The actual inference boundary caps cumulative streams and fences late or malformed provider answers. */
import { expect, test } from "bun:test";
import { newInterview } from "../../core/table-read/interview";
import { TABLE_READ_LIMITS } from "../../core/table-read/schema";
import { generateInterview, type TableReadConnect } from "./generate";

const session = () => newInterview({ tempo: "cold-read", connection: { id: "local", model: "writer" }, idea: "A bartender who collects debts." }, "session", "card");

test("many small content and reasoning chunks trip the real cap and abort a cancellation-ignoring provider", async () => {
  let aborted = false;
  const connect: TableReadConnect = async () => ({ kind: "script", provider: { id: "script", send: async (_request, io) => {
    io!.signal!.addEventListener("abort", () => { aborted = true; });
    for (let i = 0; i < TABLE_READ_LIMITS.output / 1_000 + 1; i++) io!.onEvent!({ channel: i % 2 ? "content" : "reasoning", delta: "x".repeat(1_000) });
    return new Promise(() => {});
  } } });
  const error = await generateInterview(session(), "start", connect, new AbortController().signal, () => 0).then(() => null, (value: unknown) => value);
  expect(error).toBeInstanceOf(Error);
  expect(String(error)).toContain("too much text");
  expect(aborted).toBe(true);
});

test("authoritative full frames replace previous channel bytes; malformed final output still fails closed", async () => {
  let aborted = false;
  const connect: TableReadConnect = async () => ({ kind: "script", provider: { id: "script", send: async (_request, io) => {
    io!.signal!.addEventListener("abort", () => { aborted = true; });
    io!.onEvent!({ channel: "content", delta: "x".repeat(60_000) });
    io!.onEvent!({ channel: "content", full: "replacement" });
    io!.onEvent!({ channel: "reasoning", delta: "y".repeat(60_000) });
    return { content: "unreadable", raw: null };
  } } });
  const error = await generateInterview(session(), "start", connect, new AbortController().signal, () => 0).then(() => null, (value: unknown) => value);
  expect(String(error)).toContain("unreadable draft");
  expect(aborted).toBe(false);
});

test("a non-streamed completion cannot bypass the combined cap with final reasoning", async () => {
  const content = JSON.stringify({ patches: [], covered: [], question: { field: "name", text: "What name do they use?", chips: ["Vesper", "A borrowed name"] }, note: "", followUp: null, deflection: false });
  const connect: TableReadConnect = async () => ({ kind: "script", provider: { id: "script", send: async () => ({ content, reasoning: "r".repeat(TABLE_READ_LIMITS.output), raw: null }) } });
  const error = await generateInterview(session(), "start", connect, new AbortController().signal, () => 0).then(() => null, (value: unknown) => value);
  expect(String(error)).toContain("too much text");
});
