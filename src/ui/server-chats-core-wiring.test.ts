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
import { emptyDirectorState } from "../core/director/state";
import { saveProvider } from "../kit/providers/vault";
import { ARGS } from "../studio/fake-director-rig";
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
const asked: { messages: { role: string; content: string }[]; stream?: boolean }[] = [];
let localId = "";
let reply = "It might.";
const PLAN = ARGS();

beforeAll(async () => {
  restoreBunzaiHome = useTestBunzaiHome(HOME);
  server = Bun.serve({
    port: 0,
    async fetch(req) {
      const request = (await req.json()) as (typeof asked)[number];
      asked.push(request);
      const chunk = (o: unknown) => `data: ${JSON.stringify(o)}\n\n`;
      if (request.messages[0]?.content.startsWith("You are the Story Director")) {
        const call = { id: "c1", type: "function", index: 0, function: { name: "commit_planning_round", arguments: JSON.stringify(PLAN) } };
        const planned = { choices: [{ message: { role: "assistant", content: "", tool_calls: [call] }, delta: { tool_calls: [call] }, finish_reason: "tool_calls" }], model: "qwen3-local" };
        return request.stream === false ? Response.json(planned) : new Response(chunk(planned) + "data: [DONE]\n\n", { headers: { "content-type": "text/event-stream" } });
      }
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

test("on a Core scene, every prop switches on with the journal untouched", async () => {
  const r = await rig({ core: true });
  const { chatId, open } = await coreScene(r);
  const before = { version: (await open()).branchVersion, journal: await journal(r, chatId) };
  const on = await r.post("/api/chats/props", { chatId, props: { on: ["mood-music", "dialogue-colors", "spotify", "story-director", "dramaturg", "trackhare", "tracker-inventory"] } });
  if (on.status !== 200) throw new Error(`${on.status}: ${await on.text()}`);
  expect((await open()).branchVersion).toBe(before.version);
  expect(await journal(r, chatId)).toBe(before.journal);
  expect((await r.post("/api/chats/props", { chatId, props: null })).status).toBe(200);
});

test("on a Core scene, continuing a reply with old thinking on keeps the thinking out of the reply being continued", async () => {
  const r = await rig({ core: true });
  const { chatId, open } = await coreScene(r);
  reply = "<think>the barometer fell</think>It might.";
  await sendAndAnswer(r, chatId, (await open()).branchVersion);
  expect((await r.post("/api/chats/prompting", { chatId, prompting: { keepThinking: true } })).status).toBe(200);
  reply = " And more.";
  const cont = await r.post("/api/chats/turn", { chatId, kind: "continue", expectedVersion: (await open()).branchVersion });
  if (cont.status !== 200) throw new Error(`${cont.status}: ${await cont.text()}`);
  await cont.text();
  expect(JSON.stringify(asked.at(-1)!.messages)).not.toContain("<think>");
});

test("what a Core reply's versions hold stays with them through a swipe, a switch, an edit, and a removed and restored version", async () => {
  const r = await rig({ core: true });
  const { chatId, open, tail } = await twoVersions(r);
  const chats = libraryFor(r.store.studioPath())!.chats, take = (await chats.getChat(chatId))!.activeBranchId;
  const held = await tail();
  const ids = held.swipes.map((swipe) => swipe.id);
  const note = (name: string, swipe: string, at: number) => [{ slot: "summary", path: [swipe], value: { version: swipe, text: name, through: 1, at }, at }];
  expect(await chats.recordDeltas(take, ids[0]!, note("onFirst", ids[0]!, 1))).toBe(true);
  expect(await chats.recordDeltas(take, ids[1]!, note("onSecond", ids[1]!, 2))).toBe(true);
  expect(await chats.putDirector(chatId, held.id, { ...emptyDirectorState(), notes: [{ id: "n1", content: "kept", createdAt: 1 }] }, { expectedVersion: null })).not.toBeNull();
  const check = async (step: string, shown: "onFirst" | "onSecond") => {
    const now = await tail();
    expect(`${step}: ${now.id} ${now.swipes.map((swipe) => swipe.id).join()}`).toBe(`${step}: ${held.id} ${(step === "cut" ? [ids[0]] : ids).join()}`);
    const state = JSON.stringify(await chats.sceneState(take));
    expect(`${step}: ${state.includes(shown)}`).toBe(`${step}: true`);
    expect(`${step}: ${state.includes(shown === "onFirst" ? "onSecond" : "onFirst")}`).toBe(`${step}: false`);
    // A Director snapshot belongs to the version it was written on (ChatStore rule 47), as on an old scene.
    expect((await chats.getDirector(chatId, held.id))?.state.notes[0]?.content ?? null).toBe(shown === "onSecond" ? "kept" : null);
  };
  const post = async (path: string, body: Record<string, unknown>) => {
    const out = await r.post(path, body);
    if (out.status !== 200) throw new Error(`${path} ${out.status}: ${await out.text()}`);
  };
  await check("recorded", "onSecond");
  await post("/api/chats/select-swipe", { chatId, messageId: held.id, index: 0, expectedVersion: (await open()).branchVersion });
  await check("switched", "onFirst");
  await post("/api/chats/edit", { chatId, messageId: held.id, swipeId: ids[0], content: "First, reworded.", expectedVersion: (await open()).branchVersion });
  await check("edited", "onFirst");
  await post("/api/chats/cut-version", { chatId, messageId: held.id, swipeId: ids[1], expectedVersion: (await open()).branchVersion });
  await check("cut", "onFirst");
  await post("/api/chats/restore-version", { id: `${held.id}:${ids[1]}` });
  expect((await r.handler(apiReq(`/api/chats/open?id=${chatId}`))).status).toBe(200);
  await check("restored", "onFirst");
  await post("/api/chats/select-swipe", { chatId, messageId: held.id, index: 1, expectedVersion: (await open()).branchVersion });
  await check("switched back", "onSecond");
  reply = "Later.";
  await sendAndAnswer(r, chatId, (await open()).branchVersion, "And then?");
  const next = await tail();
  expect(next.id).not.toBe(held.id);
  expect(JSON.stringify(await chats.sceneState(take))).toContain("onSecond");
  expect((await chats.getDirector(chatId, next.id))?.state.notes[0]?.content).toBe("kept");
});

const narrated = () => asked.filter((request) => !request.messages[0]?.content.startsWith("You are")).at(-1)!;

test("on a Core scene, the Story Director plans before the reply: its constraints reach the model, and its story is saved on the version the reply landed as", async () => {
  const r = await rig({ core: true });
  const { chatId, open } = await coreScene(r);
  expect((await r.post("/api/chats/props", { chatId, props: { on: ["story-director"] } })).status).toBe(200);
  await sendAndAnswer(r, chatId, (await open()).branchVersion);
  expect(asked.some((request) => request.messages[0]?.content.startsWith("You are the Story Director"))).toBe(true);
  const sent = narrated().messages;
  const at = sent.findLastIndex((message) => message.content.includes("[DIRECTOR CONSTRAINTS"));
  expect(sent.findIndex((message) => message.content.includes("Story Director Authority"))).toBeLessThan(at);
  if (at < 0) throw new Error(JSON.stringify(sent).slice(0, 1500));
  expect(sent[at]!.content).toContain("Let Vera slip once.");
  expect(sent.map((message) => message.content).join()).toContain("Story Director Authority");
  // A model that takes no system message mid-chat reads the constraints folded into the message they sit above.
  expect((sent.slice(at).find((message) => message.role === "user") ?? sent[at]!).content).toContain("Will it rain?");
  const chats = libraryFor(r.store.studioPath())!.chats, take = (await chats.getChat(chatId))!.activeBranchId;
  const tip = (await chats.readMessagesBefore(take, { limit: 1, liveOnly: true })).messages[0]!;
  expect((await chats.getDirector(chatId, tip.id))?.state.arcs.map((arc) => arc.title)).toEqual(["The Lamp"]);
});

test("on a Core scene with the Director off, nothing plans and no contract is sent", async () => {
  const r = await rig({ core: true });
  const { chatId, open } = await coreScene(r);
  const was = asked.length;
  await sendAndAnswer(r, chatId, (await open()).branchVersion);
  expect(asked.length).toBe(was + 1);
  expect(JSON.stringify(asked.at(-1))).not.toContain("Story Director");
});

test("on a Core scene, a tracker that is on reaches the model in the block an old scene sends, in front of the conversation, and a macro in it is not read again", async () => {
  const r = await rig({ core: true });
  const { chatId, open } = await coreScene(r);
  expect((await r.post("/api/chats/props", { chatId, props: { on: ["tracker-inventory"] } })).status).toBe(200);
  const chats = libraryFor(r.store.studioPath())!.chats, take = (await chats.getChat(chatId))!.activeBranchId;
  const first = await sendAndAnswer(r, chatId, (await open()).branchVersion);
  expect(JSON.stringify(first.messages)).not.toContain("Current Game State");
  const tip = (await chats.readMessagesBefore(take, { limit: 1, liveOnly: true })).messages[0]!;
  const wrote = await r.post("/api/chats/tracker-state", { chatId, branchId: take, messageId: tip.id, expectedVersion: (await open()).branchVersion, writes: [{ module: "inventory", data: { items: [{ id: "i1", name: "A {{char}} key", description: "", category: "key", rarity: "common", quantity: 1, obtainedAt: 1 }], equipment: {}, currency: 0 } }] });
  if (wrote.status !== 200) throw new Error(`${wrote.status}: ${await wrote.text()}`);
  const sent = (await sendAndAnswer(r, chatId, (await open()).branchVersion, "And now?")).messages;
  const at = sent.findIndex((message) => message.content.includes("Current Game State"));
  if (at < 0) throw new Error(JSON.stringify(sent).slice(0, 1500));
  expect(sent[at]!.content).toContain("A {{char}} key");
  expect(at).toBeLessThan(sent.findIndex((message) => message.content.includes("Will it rain?")));
});

test("on a Core scene, the saved summary fills the summary slot and stands in for the messages it covers, which stay on the page and in the journal", async () => {
  const r = await rig({ core: true });
  const { chatId, open } = await coreScene(r);
  await sendAndAnswer(r, chatId, (await open()).branchVersion, "First question.");
  await sendAndAnswer(r, chatId, (await open()).branchVersion, "Second question.");
  const saved = await r.post("/api/chats/summary", { chatId, text: "SUMMARY {{char}}: they asked twice." });
  if (saved.status !== 200) throw new Error(`${saved.status}: ${await saved.text()}`);
  const settings = await r.post("/api/chats/summary-settings", { chatId, patch: { include: true, hideOld: true, keepRecent: 1 } });
  if (settings.status !== 200) throw new Error(`${settings.status}: ${await settings.text()}`);
  const seq = await journal(r, chatId);
  const sent = JSON.stringify((await sendAndAnswer(r, chatId, (await open()).branchVersion, "Third question.")).messages);
  expect(sent).toContain("SUMMARY {{char}}: they asked twice.");
  expect(sent).not.toContain("First question.");
  expect(sent).toContain("Third question.");
  expect(await journal(r, chatId)).toBeGreaterThan(seq);
  const chats = libraryFor(r.store.studioPath())!.chats, take = (await chats.getChat(chatId))!.activeBranchId;
  expect(JSON.stringify((await chats.readMessages(take, { fromSeq: 1, limit: 200 })).messages)).toContain("First question.");
});
