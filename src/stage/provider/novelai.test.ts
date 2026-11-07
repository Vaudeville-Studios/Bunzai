/** NovelAI's own request and stream, against a scripted server. */
import { expect, test } from "bun:test";
import { createNovelAIProvider, novelAIPrompt } from "./novelai";

const sse = (...lines: string[]) => new Response(lines.map((line) => `data: ${line}\n\n`).join(""), { headers: { "content-type": "text/event-stream" } });

test("the messages become a labelled transcript ending on the reply's cue, and blank ones are left out", () => {
  expect(novelAIPrompt([{ role: "system", content: "Be brief." }, { role: "user", content: "Hi" }, { role: "assistant", content: " " }, { role: "user", content: "Well?" }]))
    .toBe("[System]\nBe brief.\n\nUser: Hi\n\nUser: Well?\n\nAssistant:");
  expect(novelAIPrompt([{ role: "user", content: "Hi" }, { role: "assistant", content: "Once" }])).toBe("User: Hi\n\nAssistant: Once");
});

test("it sends the token, the model and the samplers, streams each token, and stops at done", async () => {
  const seen: { url: string; auth: string | null; body: Record<string, any> }[] = [];
  const provider = createNovelAIProvider({ id: "n", apiKey: "tok", baseUrl: "https://novel.test" }, { fetch: async (input, init) => {
    seen.push({ url: String(input), auth: new Headers(init?.headers).get("authorization"), body: JSON.parse(String(init?.body)) });
    return sse('{"token":"Once "}', '{"output":"upon"}', '{"done":true}', '{"token":"ignored"}');
  } });
  const deltas: string[] = [];
  const done = await provider.send({ model: "kayra-v1", messages: [{ role: "user", content: "Hi" }], options: { temperature: 0.5, max_tokens: 40, stream: true } }, { onEvent: (event) => { if ("delta" in event) deltas.push(event.delta); } });
  expect(seen[0]!.url).toBe("https://novel.test/ai/generate-stream");
  expect(seen[0]!.auth).toBe("Bearer tok");
  expect(seen[0]!.body).toMatchObject({ model: "kayra-v1", input: "User: Hi\n\nAssistant:", parameters: { temperature: 0.5, max_length: 40, use_string: true } });
  expect(deltas).toEqual(["Once ", "upon"]);
  expect(done.content).toBe("Once upon");
});

test("a refused token says so, in words", async () => {
  const provider = createNovelAIProvider({ id: "n", apiKey: "bad", baseUrl: "https://novel.test" }, { fetch: async () => new Response("nope", { status: 401 }) });
  await expect(provider.send({ model: "kayra-v1", messages: [{ role: "user", content: "Hi" }], options: {} }, {})).rejects.toThrow("NovelAI refused that token");
});
