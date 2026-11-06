/**
 * Scene writes that needed no rp-core verb, and the prompting settings a Core scene carries, each proven
 * over HTTP by what reaches the connection and by the journal staying put where nothing should enter it.
 */
import { afterAll, afterEach, beforeAll, expect, setDefaultTimeout, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { useTestBunzaiHome } from "../../scripts/test-home";
import { saveProvider } from "../kit/providers/vault";
import { libraryFor } from "../studio/library-content";
import { chatRouteRig as rig, cleanupChatRouteRigs, vera } from "./fake-server-chats-rig";
import { apiReq } from "./server-test-rig";

afterEach(() => { reply = "It might."; return cleanupChatRouteRigs(); });

// Sealing the vault spawns the OS keystore (about a second, cold).
setDefaultTimeout(30_000);
const HOME = join(tmpdir(), `bunzai-core-wiring-${randomUUID()}`);
const UNLOCK = { passphrase: "core-wiring-test" };
let restoreBunzaiHome: (() => void) | undefined;
let server: ReturnType<typeof Bun.serve>;
const asked: { messages: { role: string; content: string }[] }[] = [];
let localId = "";
let reply = "It might.";

beforeAll(async () => {
  restoreBunzaiHome = useTestBunzaiHome(HOME);
  server = Bun.serve({
    port: 0,
    async fetch(req) {
      asked.push((await req.json()) as (typeof asked)[number]);
      const chunk = (o: unknown) => `data: ${JSON.stringify(o)}\n\n`;
      const body = chunk({ choices: [{ delta: { content: reply }, finish_reason: "stop" }], model: "qwen3-local" }) + "data: [DONE]\n\n";
      return new Response(body, { headers: { "content-type": "text/event-stream" } });
    },
  });
  localId = (await saveProvider({ kind: "local", model: "qwen3", baseURL: `http://127.0.0.1:${server.port}/v1`, name: "Desk" }, UNLOCK)).id!;
});

afterAll(async () => {
  try { server.stop(true); } finally { await rm(HOME, { recursive: true, force: true }).finally(() => restoreBunzaiHome?.()); }
});

type Rig = Awaited<ReturnType<typeof rig>>;
interface Opened { branchVersion: number; chat: { id: string } }

async function coreScene(r: Rig) {
  await r.store.save(vera);
  const chat = (await (await r.post("/api/chats/start", { characterId: "vera" })).json()) as { id: string };
  await r.post("/api/chats/connection", { chatId: chat.id, connection: { id: localId, model: "qwen3" } });
  const open = async () => (await (await r.handler(apiReq(`/api/chats/open?id=${chat.id}`))).json()) as Opened;
  return { chatId: chat.id, open };
}

async function sendAndAnswer(r: Rig, chatId: string, version: number, content = "Will it rain?") {
  const sent = await r.post("/api/chats/send", { chatId, content, greetingIndex: 0, expectedVersion: version });
  if (sent.status !== 200) throw new Error(`${sent.status}: ${await sent.text()}`);
  const opened = (await sent.json()) as Opened;
  const turn = await r.post("/api/chats/turn", { chatId, kind: "reply", expectedVersion: opened.branchVersion });
  if (turn.status !== 200) throw new Error(`${turn.status}: ${await turn.text()}`);
  await turn.text();
  return asked.at(-1)!;
}

async function journal(r: Rig, chatId: string) {
  const records = libraryFor(r.store.studioPath())!.core!;
  return records.journalRevision((await records.sceneFor(chatId))!.sessionId);
}

test("a Core scene sent to the Trash comes back, and its next turn still runs on its rp-core session", async () => {
  const r = await rig({ core: true });
  const { chatId, open } = await coreScene(r);
  expect((await r.post("/api/chats/delete", { id: chatId })).status).toBe(200);
  const restored = await r.post("/api/chats/restore-scene", { id: chatId });
  expect(restored.status).toBe(200);
  const sent = await sendAndAnswer(r, chatId, (await open()).branchVersion);
  expect(JSON.stringify(sent.messages)).toContain("Will it rain?");
});

test("a Core scene's participants change on the scene alone: the journal and the take's version stay put", async () => {
  const r = await rig({ core: true });
  const { chatId, open } = await coreScene(r);
  const before = { version: (await open()).branchVersion, journal: await journal(r, chatId) };
  const applied = await r.post("/api/chats/participants/apply", { chatId, people: [{ name: "Mira", description: "The ferrywoman" }] });
  expect(applied.status).toBe(200);
  const { run, added } = (await applied.json()) as { run: string; added: number };
  expect(added).toBe(1);
  expect((await r.post("/api/chats/participants/undo", { chatId, run })).status).toBe(200);
  expect((await open()).branchVersion).toBe(before.version);
  expect(await journal(r, chatId)).toBe(before.journal);
});

test("a Core scene's forecast answers without touching the scene", async () => {
  const r = await rig({ core: true });
  const { chatId, open } = await coreScene(r);
  const before = { version: (await open()).branchVersion, journal: await journal(r, chatId), asked: asked.length };
  const forecast = await r.post("/api/chats/forecast", { chatId, draft: "Will it rain?" });
  if (forecast.status !== 200) throw new Error(`${forecast.status}: ${await forecast.text()}`);
  expect((await open()).branchVersion).toBe(before.version);
  expect(await journal(r, chatId)).toBe(before.journal);
  expect(asked.length).toBe(before.asked);
});

test("on a Core scene, old thinking reaches the next request only while Let the model see its old thinking is on", async () => {
  const r = await rig({ core: true });
  const { chatId, open } = await coreScene(r);
  reply = "<think>the barometer fell</think>It might.";
  await sendAndAnswer(r, chatId, (await open()).branchVersion);
  reply = "Yes.";
  expect(JSON.stringify((await sendAndAnswer(r, chatId, (await open()).branchVersion, "And then?")).messages)).not.toContain("the barometer fell");
  expect((await r.post("/api/chats/prompting", { chatId, prompting: { keepThinking: true } })).status).toBe(200);
  expect(JSON.stringify((await sendAndAnswer(r, chatId, (await open()).branchVersion, "And after?")).messages)).toContain("<think>the barometer fell</think>");
});

test("on a Core scene, Minimal and Extra high reasoning ride rp-core's narrator binding", async () => {
  const r = await rig({ core: true });
  const { chatId, open } = await coreScene(r);
  for (const effort of ["minimal", "xhigh"]) {
    expect((await r.post("/api/chats/prompting", { chatId, prompting: { reasoningEffort: effort } })).status).toBe(200);
    await sendAndAnswer(r, chatId, (await open()).branchVersion, `At ${effort}?`);
    const records = libraryFor(r.store.studioPath())!.core!;
    const { Engine } = await import("rp-core");
    const engine = await Engine.openWithRecordStore({ home: r.store.studioPath(), recordStore: records, lane: "manual" });
    try {
      const session = await engine.session((await records.sceneFor(chatId))!.sessionId);
      expect((await session.configurationSnapshot()).roles.narrator).toMatchObject({ reasoning: effort });
    } finally { await engine.close(); }
  }
});

/** A scene whose only reply has two versions, "First answer." and "Second answer." (the one it is on). */
async function twoVersions(r: Rig) {
  const { chatId, open } = await coreScene(r);
  reply = "First answer.";
  await sendAndAnswer(r, chatId, (await open()).branchVersion);
  reply = "Second answer.";
  const swiped = await r.post("/api/chats/turn", { chatId, kind: "swipe", expectedVersion: (await open()).branchVersion });
  if (swiped.status !== 200) throw new Error(`${swiped.status}: ${await swiped.text()}`);
  await swiped.text();
  const live = libraryFor(r.store.studioPath())!.chats;
  const tail = async () => {
    const chat = (await live.getChat(chatId))!;
    return (await live.readMessages(chat.activeBranchId, { fromSeq: 1, limit: 200 })).messages.filter((message) => !message.cut && message.role === "assistant").at(-1)!;
  };
  return { chatId, open, tail };
}

test("on a Core scene, removing a version takes it out of the scene and the next request, and restoring puts it back", async () => {
  const r = await rig({ core: true });
  const { chatId, open, tail } = await twoVersions(r);
  const reply2 = await tail();
  const second = reply2.swipes.find((swipe) => swipe.content === "Second answer.")!;
  const cut = await r.post("/api/chats/cut-version", { chatId, messageId: reply2.id, swipeId: second.id, expectedVersion: (await open()).branchVersion });
  if (cut.status !== 200) throw new Error(`${cut.status}: ${await cut.text()}`);
  expect((await tail()).swipes.map((swipe) => swipe.content)).toEqual(["First answer."]);
  reply = "Third.";
  const sent = JSON.stringify((await sendAndAnswer(r, chatId, (await open()).branchVersion, "And then?")).messages);
  expect(sent).toContain("First answer.");
  expect(sent).not.toContain("Second answer.");
  const back = await r.post("/api/chats/restore-version", { id: `${reply2.id}:${second.id}` });
  if (back.status !== 200) throw new Error(`${back.status}: ${await back.text()}`);
  expect((await r.handler(apiReq(`/api/chats/open?id=${chatId}`))).status).toBe(200);
  const chats = libraryFor(r.store.studioPath())!.chats, take = (await chats.getChat(chatId))!.activeBranchId;
  const restored = (await chats.readMessages(take, { fromSeq: 1, limit: 200 })).messages.find((message) => message.id === reply2.id)!;
  expect(restored.swipes.map((swipe) => swipe.content)).toEqual(["First answer.", "Second answer."]);
});

test("on a Core scene, the only version left and a version with messages after it are refused and change nothing", async () => {
  const r = await rig({ core: true });
  const { chatId, open, tail } = await twoVersions(r);
  const newest = await tail();
  const [first, second] = newest.swipes;
  expect((await r.post("/api/chats/cut-version", { chatId, messageId: newest.id, swipeId: first!.id, expectedVersion: (await open()).branchVersion })).status).toBe(200);
  const before = await journal(r, chatId);
  const last = await r.post("/api/chats/cut-version", { chatId, messageId: newest.id, swipeId: second!.id, expectedVersion: (await open()).branchVersion });
  expect(last.status).toBeGreaterThanOrEqual(400);
  expect(await journal(r, chatId)).toBe(before);
  reply = "Later.";
  await sendAndAnswer(r, chatId, (await open()).branchVersion, "And then?");
  const atJournal = await journal(r, chatId);
  const earlier = await r.post("/api/chats/cut-version", { chatId, messageId: newest.id, swipeId: second!.id, expectedVersion: (await open()).branchVersion });
  expect(earlier.status).toBeGreaterThanOrEqual(400);
  expect(await journal(r, chatId)).toBe(atJournal);
});

test("on a Core scene, a removed version stays removed on a take forked after it", async () => {
  const r = await rig({ core: true });
  const { chatId, open, tail } = await twoVersions(r);
  const newest = await tail();
  const second = newest.swipes.find((swipe) => swipe.content === "Second answer.")!;
  expect((await r.post("/api/chats/cut-version", { chatId, messageId: newest.id, swipeId: second.id, expectedVersion: (await open()).branchVersion })).status).toBe(200);
  const forked = await r.post("/api/chats/fork", { chatId, messageId: newest.id, name: "Other", expectedVersion: (await open()).branchVersion });
  if (forked.status !== 200) throw new Error(`${forked.status}: ${await forked.text()}`);
  expect((await tail()).swipes.map((swipe) => swipe.content)).toEqual(["First answer."]);
  reply = "Onward.";
  expect(JSON.stringify((await sendAndAnswer(r, chatId, (await open()).branchVersion, "And then?")).messages)).toContain("First answer.");
});

test("a version cut in the journal that a crash kept off the page is repaired when the scene opens", async () => {
  const r = await rig({ core: true });
  const { chatId, tail } = await twoVersions(r);
  const newest = await tail();
  const second = newest.swipes.find((swipe) => swipe.content === "Second answer.")!;
  const records = libraryFor(r.store.studioPath())!.core!;
  const { sessionId, branchId } = (await records.sceneFor(chatId))!;
  const coreId = (await records.coreMessagesFor(sessionId, branchId, newest.id)).find((version) => version.swipeId === second.id)!.coreMessageId;
  const { Engine } = await import("rp-core");
  const engine = await Engine.openWithRecordStore({ home: r.store.studioPath(), recordStore: records, lane: "manual" });
  try {
    const session = await engine.session(sessionId);
    await session.cutVersion({ messageId: coreId, cut: true, expectedVersion: await session.version() });
  } finally { await engine.close(); }
  expect((await r.handler(apiReq(`/api/chats/open?id=${chatId}`))).status).toBe(200);
  expect((await tail()).swipes.map((swipe) => swipe.content)).toEqual(["First answer."]);
});

test("on a Core scene, page-only props switch on with the journal untouched, and a prop that needs the old engine is refused plainly", async () => {
  const r = await rig({ core: true });
  const { chatId, open } = await coreScene(r);
  const before = { version: (await open()).branchVersion, journal: await journal(r, chatId) };
  const on = await r.post("/api/chats/props", { chatId, props: { on: ["mood-music", "dialogue-colors", "spotify"] } });
  if (on.status !== 200) throw new Error(`${on.status}: ${await on.text()}`);
  expect((await open()).branchVersion).toBe(before.version);
  expect(await journal(r, chatId)).toBe(before.journal);
  const refused = await r.post("/api/chats/props", { chatId, props: { on: ["story-director"] } });
  expect(refused.status).toBe(501);
  expect(await refused.json()).toEqual({ error: "that prop is not available on this scene yet" });
  expect((await r.post("/api/chats/props", { chatId, props: null })).status).toBe(200);
});
