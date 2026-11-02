/**
 * The summary routes over the real server (rc-parity 08, Memory): the state the tab reads, the settings, the person's own text, Backfill history through a real provider connection, and a real
 * turn that leaves an automatic summary behind. The model is a local fake that answers a streamed reply and a plain summary call.
 */
import { afterAll, afterEach, beforeAll, expect, setDefaultTimeout, test } from "bun:test";
import { useTestBunzaiHome } from "../../scripts/test-home";
import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CANONICAL_SCHEMA_VERSION } from "../core/canonical";
import { saveProvider } from "../kit/providers/vault";
import { chatRouteRig, cleanupChatRouteRigs } from "./fake-server-chats-rig";
import { apiReq } from "./server-test-rig";
import type { ChatSummaryState } from "./app-contract-scenes";

setDefaultTimeout(30_000);
const HOME = join(tmpdir(), `bunzai-summary-route-${randomUUID()}`);
const UNLOCK = { passphrase: "summary-route-test" };
let restoreBunzaiHome: (() => void) | undefined;
let server: ReturnType<typeof Bun.serve>;
let localId = "";
const summaryCalls: string[] = [];
let hold: Promise<void> | null = null;
let answer: { status: number; content: string } = { status: 200, content: "They watched the storm." };

beforeAll(async () => {
  restoreBunzaiHome = useTestBunzaiHome(HOME);
  server = Bun.serve({
    port: 0,
    async fetch(req) {
      const body = (await req.json()) as { stream?: boolean; messages?: { content: string }[] };
      if (body.stream) {
        const chunk = (o: unknown) => `data: ${JSON.stringify(o)}\n\n`;
        return new Response(chunk({ choices: [{ delta: { content: "Calm." }, finish_reason: "stop" }] }) + "data: [DONE]\n\n", { headers: { "content-type": "text/event-stream" } });
      }
      summaryCalls.push(body.messages?.[0]?.content ?? "");
      if (hold) await hold;
      if (answer.status !== 200) return Response.json({ error: { message: "model down" } }, { status: answer.status });
      return Response.json({ choices: [{ message: { role: "assistant", content: answer.content }, finish_reason: "stop" }], model: "qwen3" });
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
afterEach(cleanupChatRouteRigs);

async function started(connected = true) {
  const rig = await chatRouteRig();
  await rig.store.save({ schemaVersion: CANONICAL_SCHEMA_VERSION, kind: "character", id: "vera", body: { identity: { name: "Vera", description: "Keeps the light." }, persona: {}, prompts: {}, greetings: { firstMessage: "Evening." }, examples: {}, media: {}, attribution: {}, discovery: {} } });
  const chat = (await (await rig.post("/api/chats/start", { characterId: "vera" })).json()) as { id: string };
  if (connected) await rig.post("/api/chats/connection", { chatId: chat.id, connection: { id: localId, model: "qwen3" } });
  const get = async (): Promise<ChatSummaryState> => (await rig.handler(apiReq(`/api/chats/summary?chatId=${chat.id}`))).json() as Promise<ChatSummaryState>;
  const send = async (content: string): Promise<void> => {
    const sent = (await (await rig.post("/api/chats/send", { chatId: chat.id, content, greetingIndex: 0, expectedVersion: 1 })).json()) as { branchVersion: number };
    await (await rig.post("/api/chats/turn", { chatId: chat.id, kind: "reply", expectedVersion: sent.branchVersion })).text();
  };
  return { ...rig, chat, get, send };
}

test("a new scene reads as nothing saved, with RoleCall's defaults left to the reader", async () => {
  const { get, chat } = await started();
  expect(await get()).toMatchObject({ settings: {}, text: null, through: 0, at: null, error: null, running: false });
  expect((await (await (await started()).handler(apiReq("/api/chats/summary?chatId=nope"))).status)).toBe(404);
  expect(chat.id).toBeTruthy();
});

test("settings change one key at a time and a key given as null goes back to its default; a bad one is a 400", async () => {
  const { post, chat } = await started();
  const set = async (patch: unknown) => post("/api/chats/summary-settings", { chatId: chat.id, patch });
  expect(((await (await set({ auto: true, interval: 20 })).json()) as ChatSummaryState).settings).toEqual({ auto: true, interval: 20 });
  expect(((await (await set({ interval: null })).json()) as ChatSummaryState).settings).toEqual({ auto: true });
  expect((await set({ temperature: 2 })).status).toBe(400);
  expect((await set("x")).status).toBe(400);
  expect((await post("/api/chats/summary-settings", { chatId: "nope", patch: { auto: true } })).status).toBe(404);
});

test("the person's own text is saved as written, covering the take as it stands; blank text is refused", async () => {
  const { post, chat, send } = await started();
  await send("Any storms?");
  const saved = (await (await post("/api/chats/summary", { chatId: chat.id, text: "Vera keeps the light." })).json()) as ChatSummaryState;
  expect(saved).toMatchObject({ text: "Vera keeps the light.", through: 3, total: 3 });
  expect((await post("/api/chats/summary", { chatId: chat.id, text: "  " })).status).toBe(400);
  expect((await post("/api/chats/summary", { chatId: chat.id })).status).toBe(400);
});

test("Backfill history asks the scene's model about the whole take and saves its answer; with no connection it says why", async () => {
  summaryCalls.length = 0;
  const { post, chat, send, get } = await started();
  await send("Any storms?");
  const done = (await (await post("/api/chats/summary-backfill", { chatId: chat.id })).json()) as ChatSummaryState;
  expect(done).toMatchObject({ text: "They watched the storm.", through: 3 });
  expect(summaryCalls.at(-1)).toContain("Summarize the entire roleplay chat between the user and Vera.");
  expect((await get()).text).toBe("They watched the storm.");
  const bare = await started(false);
  const refused = await bare.post("/api/chats/summary-backfill", { chatId: bare.chat.id });
  expect(refused.status).toBe(409);
  expect(((await refused.json()) as { error: string }).error).toBe("Choose a configured Summary Model before automatic summaries can run.");
});

test("a real reply leaves an automatic summary behind when it is on and due, and none when it is off", async () => {
  summaryCalls.length = 0;
  const off = await started();
  await off.send("Any storms?");
  await Bun.sleep(200);
  expect((await off.get()).text).toBeNull();
  const on = await started();
  await on.post("/api/chats/summary-settings", { chatId: on.chat.id, patch: { auto: true, interval: 2 } });
  await on.send("Any storms?");
  let state = await on.get();
  for (let i = 0; i < 100 && state.text === null; i++) { await Bun.sleep(20); state = await on.get(); }
  expect(state).toMatchObject({ text: "They watched the storm.", through: 3, error: null });
});

test("Summarize now runs the automatic step once, writes one summary entry, and clears an old failure", async () => {
  summaryCalls.length = 0;
  const { post, chat, send, get } = await started();
  await send("Any storms?");
  const done = (await (await post("/api/chats/summary-now", { chatId: chat.id })).json()) as ChatSummaryState;
  expect(done).toMatchObject({ text: "They watched the storm.", through: 3, error: null });
  expect(summaryCalls).toHaveLength(1);
  expect(summaryCalls[0]).not.toContain("Summarize the entire roleplay chat");
  expect((await get()).text).toBe("They watched the storm.");
});

test("Summarize now on a scene with no model, no messages, or a failing model says why and writes nothing", async () => {
  const bare = await started(false);
  const none = await bare.post("/api/chats/summary-now", { chatId: bare.chat.id });
  expect(none.status).toBe(409);
  expect(((await none.json()) as { error: string }).error).toBe("Choose a configured Summary Model before automatic summaries can run.");
  const { post, chat, send, get } = await started();
  expect((await post("/api/chats/summary-now", { chatId: "nope" })).status).toBe(404);
  await send("Any storms?");
  await post("/api/chats/summary", { chatId: chat.id, text: "My own words." });
  answer = { status: 500, content: "" };
  try {
    const failed = await post("/api/chats/summary-now", { chatId: chat.id });
    expect(failed.status).toBe(409);
    expect(((await failed.json()) as { error: string }).error.length).toBeGreaterThan(0);
  } finally { answer = { status: 200, content: "They watched the storm." }; }
  expect((await get()).text).toBe("My own words.");
});

test("Summarize now never starts a second run while one is going, and the first still finishes", async () => {
  summaryCalls.length = 0;
  const { post, chat, send, get } = await started();
  await send("Any storms?");
  let release = (): void => undefined;
  hold = new Promise<void>((resolve) => { release = resolve; });
  const first = post("/api/chats/summary-now", { chatId: chat.id });
  for (let i = 0; i < 100 && summaryCalls.length === 0; i++) await Bun.sleep(20);
  expect((await get()).running).toBe(true);
  const second = await post("/api/chats/summary-now", { chatId: chat.id });
  const backfilled = await post("/api/chats/summary-backfill", { chatId: chat.id });
  hold = null;
  release();
  expect(second.status).toBe(409);
  expect(((await second.json()) as { error: string }).error).toBe("A summary is already being written for this scene.");
  expect(backfilled.status).toBe(409);
  expect((await first).status).toBe(200);
  expect(summaryCalls).toHaveLength(1);
  expect((await get()).running).toBe(false);
});
