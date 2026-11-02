/**
 * POST /api/chats/tracker-item over HTTP: Generate and Refresh answer `{ item }` as a proposal and write nothing to the scene, through a real OpenAI-compatible server on
 * this machine. Every refusal is a status and a message, never an empty success or a default item; the token and same-site guards apply as to any /api route.
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

const HOME = join(tmpdir(), `bunzai-tracker-item-routes-${randomUUID()}`);
const UNLOCK = { passphrase: "tracker-item-routes-test" };
let restoreBunzaiHome: (() => void) | undefined;
let server: ReturnType<typeof Bun.serve>;
const GOOD = JSON.stringify({ name: "Fire Sword", description: "Hot.", category: "weapon", rarity: "rare", quantity: 1 });
let answers: { status: number; content: string }[] = [];
const asked: { model: string; temperature?: number; messages: { role: string; content: string }[] }[] = [];
let localId = "";

beforeAll(async () => {
  restoreBunzaiHome = useTestBunzaiHome(HOME);
  server = Bun.serve({
    port: 0,
    async fetch(req) {
      asked.push((await req.json()) as (typeof asked)[number]);
      const a = answers.shift() ?? { status: 200, content: GOOD };
      if (a.status !== 200) return new Response(JSON.stringify({ error: { message: "nope" } }), { status: a.status, headers: { "content-type": "application/json" } });
      return Response.json({ choices: [{ message: { role: "assistant", content: a.content }, finish_reason: "stop" }], model: "qwen3-local", usage: { prompt_tokens: 10, completion_tokens: 3 } });
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
  await r.post("/api/chats/send", { chatId: chat.id, content: "Any storms?", greetingIndex: 0, expectedVersion: 1 });
  if (connect) await r.post("/api/chats/connection", { chatId: chat.id, connection: { id: localId, model: "qwen3" } });
  const open = async () => JSON.stringify(await (await r.handler(apiReq(`/api/chats/open?id=${chat.id}`))).json());
  return { ...r, chatId: chat.id, open };
}

test("a generate answers the item and the scene is exactly as it was", async () => {
  asked.length = 0;
  answers = [];
  const s = await readyScene();
  const before = await s.open();
  const res = await s.post("/api/chats/tracker-item", { chatId: s.chatId, module: "inventory", action: "generate", itemName: "Fire Sword", userGuide: "a legendary fire sword" });
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ item: { name: "Fire Sword", description: "Hot.", category: "weapon", rarity: "rare", quantity: 1 } });
  expect(asked).toHaveLength(1);
  expect(asked[0]!.messages[1]!.content).toContain("Any storms?");
  expect(await s.open()).toBe(before);
});

test("a bad body is a 400 naming the field", async () => {
  const s = await readyScene();
  const bad: Record<string, unknown>[] = [
    {},
    { chatId: s.chatId, module: "nope", action: "generate", itemName: "x" },
    { chatId: s.chatId, module: "resources", action: "generate", itemName: "x" },
    { chatId: s.chatId, module: "inventory", action: "make", itemName: "x" },
    { chatId: s.chatId, module: "inventory", action: "generate" },
    { chatId: s.chatId, module: "inventory", action: "generate", itemName: 4 },
    { chatId: s.chatId, module: "inventory", action: "refresh" },
  ];
  for (const body of bad) {
    const res = await s.post("/api/chats/tracker-item", body);
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error.length).toBeGreaterThan(0);
  }
});

test("a scene that is gone is 404, one with no connection is 409, an answer that stays unreadable is 409 with the reason", async () => {
  const s = await readyScene(false);
  const body = { chatId: s.chatId, module: "inventory", action: "generate", itemName: "Key" };
  expect((await s.post("/api/chats/tracker-item", body)).status).toBe(409);
  expect((await s.post("/api/chats/tracker-item", { ...body, chatId: "nope" })).status).toBe(404);
  await s.post("/api/chats/connection", { chatId: s.chatId, connection: { id: localId, model: "qwen3" } });
  answers = [{ status: 200, content: "no" }, { status: 200, content: "still no" }];
  const res = await s.post("/api/chats/tracker-item", body);
  expect(res.status).toBe(409);
  expect(((await res.json()) as { error: string }).error).toContain("could not be read");
});

test("a provider failure is a 502 with the provider's code", async () => {
  const s = await readyScene();
  answers = [{ status: 401, content: "" }];
  const failed = await s.post("/api/chats/tracker-item", { chatId: s.chatId, module: "inventory", action: "generate", itemName: "Key" });
  expect(failed.status).toBe(502);
  expect(await failed.json()).toMatchObject({ code: "invalid_api_key", category: "invalid_request_error" });
});

test("a write without the session token, or from a foreign origin, is refused and nothing is sent", async () => {
  asked.length = 0;
  answers = [];
  const s = await readyScene();
  const body = JSON.stringify({ chatId: s.chatId, module: "inventory", action: "generate", itemName: "Key" });
  const send = (init: Parameters<typeof apiReq>[1]) => s.handler(apiReq("/api/chats/tracker-item", { method: "POST", contentType: "application/json", body, ...init }));
  expect((await send({})).status).toBe(403);
  expect((await send({ token: s.token, origin: "http://127.0.0.1:9999" })).status).toBe(403);
  expect(asked).toHaveLength(0);
});
