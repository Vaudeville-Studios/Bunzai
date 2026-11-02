/**
 * POST /api/chats/draft over HTTP: a draft answers text and writes nothing to the scene (no message, version,
 * variable or take change), through a real OpenAI-compatible server on this machine. Every refusal is a
 * status and a message, never an empty success; the token and same-site guards apply as to any /api route.
 */
import { afterAll, afterEach, beforeAll, expect, setDefaultTimeout, test } from "bun:test";
import { useTestBunzaiHome } from "../../scripts/test-home";
import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { saveProvider } from "../kit/providers/vault";
import { chatRouteRig as rig, cleanupChatRouteRigs, vera } from "./fake-server-chats-rig";
import { apiReq } from "./server-test-rig";

afterEach(cleanupChatRouteRigs);
setDefaultTimeout(30_000);

const HOME = join(tmpdir(), `bunzai-draft-routes-${randomUUID()}`);
const UNLOCK = { passphrase: "draft-routes-test" };
let restoreBunzaiHome: (() => void) | undefined;
let server: ReturnType<typeof Bun.serve>;
let answer: { status: number; content: string } = { status: 200, content: "I step into the rain." };
const asked: { model: string; temperature?: number; stream?: boolean; messages: { role: string; content: string }[] }[] = [];
let localId = "";

beforeAll(async () => {
  restoreBunzaiHome = useTestBunzaiHome(HOME);
  server = Bun.serve({
    port: 0,
    async fetch(req) {
      asked.push((await req.json()) as (typeof asked)[number]);
      if (answer.status !== 200) return new Response(JSON.stringify({ error: { message: "nope" } }), { status: answer.status, headers: { "content-type": "application/json" } });
      return Response.json({ choices: [{ message: { role: "assistant", content: answer.content }, finish_reason: "stop" }], model: "qwen3-local", usage: { prompt_tokens: 10, completion_tokens: 3 } });
    },
  });
  localId = (await saveProvider({ kind: "local", model: "qwen3", baseURL: `http://127.0.0.1:${server.port}/v1`, name: "Desk" }, UNLOCK)).id!;
});

afterAll(async () => {
  try {
    server.stop(true);
  } finally {
    try {
      await rm(HOME, { recursive: true, force: true });
    } finally {
      restoreBunzaiHome?.();
    }
  }
});

async function readyScene(connect = true) {
  const r = await rig();
  await r.store.save(vera);
  const chat = (await (await r.post("/api/chats/start", { characterId: "vera" })).json()) as { id: string };
  const sent = (await (await r.post("/api/chats/send", { chatId: chat.id, content: "Any storms?", greetingIndex: 0, expectedVersion: 1 })).json()) as { branchVersion: number };
  if (connect) await r.post("/api/chats/connection", { chatId: chat.id, connection: { id: localId, model: "qwen3" } });
  const open = async () => JSON.stringify(await (await r.handler(apiReq(`/api/chats/open?id=${chat.id}`))).json());
  return { ...r, chatId: chat.id, version: sent.branchVersion, open };
}

test("a polish answers the polished text, and the scene is exactly as it was: no message, no version, no variable", async () => {
  asked.length = 0;
  answer = { status: 200, content: "I walk in." };
  const s = await readyScene();
  const before = await s.open();
  const res = await s.post("/api/chats/draft", { chatId: s.chatId, kind: "polish", text: "i walks in" });
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ text: "I walk in." });
  expect(asked[0]!.model).toBe("qwen3");
  expect(asked[0]!.messages[0]!.content).toContain("the player's own draft");
  expect(await s.open()).toBe(before);
});

test("Expand as character sends the take and the outline, and changes nothing in the scene", async () => {
  asked.length = 0;
  answer = { status: 200, content: "I ask the keeper." };
  const s = await readyScene();
  const before = await s.open();
  const res = await s.post("/api/chats/draft", { chatId: s.chatId, kind: "impersonate", brief: "ask the keeper", perspective: "3rd" });
  expect(await res.json()).toEqual({ text: "I ask the keeper." });
  const last = asked[0]!.messages.at(-1)!;
  expect(last.role).toBe("system");
  expect(last.content).toContain("Write in third person, by name.");
  expect(last.content).toContain("ask the keeper");
  expect(await s.open()).toBe(before);
});

test("a bad body is a 400 naming the field, never an empty success", async () => {
  const s = await readyScene();
  const bad: Record<string, unknown>[] = [
    {},
    { chatId: s.chatId, kind: "nope" },
    { chatId: s.chatId, kind: "polish" },
    { chatId: s.chatId, kind: "polish", text: "   " },
    { chatId: s.chatId, kind: "impersonate", perspective: "4th" },
    { chatId: s.chatId, kind: "correct", text: "x" },
    { chatId: s.chatId, kind: "rewrite", text: "She walks.", selected: "runs", action: "rewrite" },
    { chatId: s.chatId, kind: "rewrite", text: "She walks.", selected: "walks", action: "delete" },
  ];
  for (const body of bad) {
    const res = await s.post("/api/chats/draft", body);
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error.length).toBeGreaterThan(0);
  }
});

test("a scene that is gone is 404, a scene with no connection is 409, and a correction guide that is gone is 404", async () => {
  const s = await readyScene(false);
  const none = await s.post("/api/chats/draft", { chatId: s.chatId, kind: "polish", text: "x" });
  expect(none.status).toBe(409);
  expect(((await none.json()) as { error: string }).error).toContain("no connection");
  expect((await s.post("/api/chats/draft", { chatId: "nope", kind: "polish", text: "x" })).status).toBe(404);
  await s.post("/api/chats/connection", { chatId: s.chatId, connection: { id: localId, model: "qwen3" } });
  expect((await s.post("/api/chats/draft", { chatId: s.chatId, kind: "correct", text: "x", guideId: "nope" })).status).toBe(404);
});

test("a provider failure is a 502 with the provider's code, and a model that says nothing is an error", async () => {
  const s = await readyScene();
  answer = { status: 401, content: "" };
  const failed = await s.post("/api/chats/draft", { chatId: s.chatId, kind: "polish", text: "x" });
  expect(failed.status).toBe(502);
  expect(await failed.json()).toMatchObject({ code: "invalid_api_key", category: "invalid_request_error" });
  answer = { status: 200, content: "   " };
  const empty = await s.post("/api/chats/draft", { chatId: s.chatId, kind: "polish", text: "x" });
  expect(empty.status).toBe(502);
  expect(((await empty.json()) as { error: string }).error).toContain("nothing");
  answer = { status: 200, content: "I step into the rain." };
});

test("a write without the session token, or from a foreign origin is refused, and nothing is sent", async () => {
  asked.length = 0;
  const s = await readyScene();
  const body = JSON.stringify({ chatId: s.chatId, kind: "polish", text: "x" });
  const send = (init: Parameters<typeof apiReq>[1]) => s.handler(apiReq("/api/chats/draft", { method: "POST", contentType: "application/json", body, ...init }));
  expect((await send({})).status).toBe(403);
  expect((await send({ token: s.token, origin: "http://127.0.0.1:9999" })).status).toBe(403);
  expect(asked).toHaveLength(0);
});

test("Correct: a correction guide drives the draft, and applying it through the edit route changes the shown version in place, with the old text kept in Edit history", async () => {
  asked.length = 0;
  answer = { status: 200, content: "Hello, traveller." };
  const s = await readyScene();
  const guide = (await (await s.post("/api/chats/guides/save", { guide: { title: "Warm", content: "Greet warmly.", type: "correction" } })).json()) as { id: string };
  const open = async () => (await (await s.handler(apiReq(`/api/chats/open?id=${s.chatId}`))).json()) as { branchVersion: number; branchId?: string; chat: { activeBranchId: string }; messages: { id: string; current: number; swipes: { id: string; content: string }[] }[] };
  const before = await open();
  const greeting = before.messages[0]!;
  const draft = await s.post("/api/chats/draft", { chatId: s.chatId, kind: "correct", text: greeting.swipes[greeting.current]!.content, guideId: guide.id });
  expect(await draft.json()).toEqual({ text: "Hello, traveller." });
  expect(asked[0]!.messages[0]!.content).toContain("Correction Guidelines:\nGreet warmly.");
  expect((await open()).branchVersion).toBe(before.branchVersion);

  const swipeId = greeting.swipes[greeting.current]!.id;
  expect((await s.post("/api/chats/edit", { messageId: greeting.id, swipeId, content: "Hello, traveller.", expectedVersion: before.branchVersion })).status).toBe(200);
  const after = await open();
  expect(after.messages).toHaveLength(before.messages.length);
  expect(after.messages[0]!.swipes).toHaveLength(greeting.swipes.length);
  expect(after.messages[0]!.swipes[greeting.current]!.content).toBe("Hello, traveller.");
  const history = await s.handler(apiReq(`/api/chats/swipe-history?${new URLSearchParams({ chatId: s.chatId, branchId: after.chat.activeBranchId, messageId: greeting.id, index: String(greeting.current), expectedVersion: String(after.branchVersion) })}`));
  expect(((await history.json()) as { texts: string[] }).texts).toContain(greeting.swipes[greeting.current]!.content);
  answer = { status: 200, content: "I step into the rain." };
});

test("a Custom rewrite takes the person's instruction into the prompt; one without an instruction is a 400", async () => {
  asked.length = 0;
  answer = { status: 200, content: "furious words" };
  const s = await readyScene();
  const ok = await s.post("/api/chats/draft", { chatId: s.chatId, kind: "rewrite", text: "She walks.", selected: "walks", action: "custom", instruction: "Make it furious." });
  expect(ok.status).toBe(200);
  expect(asked[0]!.messages[0]!.content).toContain("User instruction:\nMake it furious.");
  for (const instruction of [undefined, "   ", 5, "x".repeat(2001)]) {
    expect((await s.post("/api/chats/draft", { chatId: s.chatId, kind: "rewrite", text: "She walks.", selected: "walks", action: "custom", instruction })).status).toBe(400);
  }
});
