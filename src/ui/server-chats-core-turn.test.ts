/**
 * A Core scene's own actions over HTTP, each proven by what reaches the connection: an Anthropic
 * connection, plain refusals before the first send, a half-created scene finished, the scene's preset
 * and lorebooks, edits, versions, hidden replies, held answers and takes (one rp-core session each).
 */
import { afterAll, afterEach, beforeAll, expect, setDefaultTimeout, test } from "bun:test";
import { useTestBunzaiHome } from "../../scripts/test-home";
import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { saveProvider } from "../kit/providers/vault";
import { libraryFor } from "../studio/library-content";
import { emptyLoreEntry, emptyLorebookBody } from "../core/lore/empty-book";
import { chatRouteRig as rig, cleanupChatRouteRigs, vera } from "./fake-server-chats-rig";
import { apiReq } from "./server-test-rig";

afterEach(cleanupChatRouteRigs);

// Sealing the vault spawns the OS keystore (about a second, cold).
setDefaultTimeout(30_000);
const HOME = join(tmpdir(), `bunzai-core-turn-routes-${randomUUID()}`);
const UNLOCK = { passphrase: "core-turn-routes-test" };
let restoreBunzaiHome: (() => void) | undefined;
let server: ReturnType<typeof Bun.serve>;
const asked: { model: string; messages: { role: string; content: string }[] }[] = [];
let localId = "";

beforeAll(async () => {
  restoreBunzaiHome = useTestBunzaiHome(HOME);
  // A chat-completions server that streams "It might." in two pieces, then usage.
  server = Bun.serve({
    port: 0,
    async fetch(req) {
      const sentBody = (await req.json()) as (typeof asked)[number];
      asked.push(sentBody);
      // A request ending on an assistant message is a continue: the server resumes it.
      const [first, second] = sentBody.messages.at(-1)?.role === "assistant" ? [" And", " more."] : ["It ", "might."];
      // A draft asks for one whole answer.
      if ((sentBody as { stream?: boolean }).stream !== true) return Response.json({ choices: [{ message: { role: "assistant", content: "I wave back." }, finish_reason: "stop" }], model: "qwen3-local" });
      const chunk = (o: unknown) => `data: ${JSON.stringify(o)}\n\n`;
      const body =
        chunk({ choices: [{ delta: { content: first } }] }) +
        chunk({ choices: [{ delta: { content: second }, finish_reason: "stop" }], model: "qwen3-local" }) +
        chunk({ choices: [], usage: { prompt_tokens: 40, completion_tokens: 3 } }) +
        "data: [DONE]\n\n";
      return new Response(body, { headers: { "content-type": "text/event-stream" } });
    },
  });
  localId = (await saveProvider({ kind: "local", model: "qwen3", baseURL: `http://127.0.0.1:${server.port}/v1`, name: "Desk" }, UNLOCK)).id!;
});

afterAll(async () => {
  try { server.stop(true); } finally { await rm(HOME, { recursive: true, force: true }).finally(() => restoreBunzaiHome?.()); }
});

async function events(res: Response) {
  const text = await res.text();
  return text.split("\n\n").filter(Boolean).map((frame) => JSON.parse(frame.split("\ndata: ")[1]!) as { type: string; [k: string]: unknown });
}

/** Reads the SSE body frame by frame instead of waiting for it to close, so a test can act (Stop)
 * while the turn is still streaming. `onEvent` sees each frame as soon as it parses. */
test("a new core scene on an Anthropic connection runs its turn through rp-core's Messages provider", async () => {
  const anthropicId = (await saveProvider({ kind: "anthropic", model: "claude-test", apiKey: "sk-ant-test" }, UNLOCK)).id!;
  const seen: { url: string; key: string | null; body: { messages?: unknown[] } }[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    if (new URL(request.url).host !== "api.anthropic.com") return realFetch(input, init);
    seen.push({ url: request.url, key: request.headers.get("x-api-key"), body: await request.json() });
    const event = (o: unknown) => `event: ${(o as { type: string }).type}\ndata: ${JSON.stringify(o)}\n\n`;
    const body = event({ type: "message_start", message: { model: "claude-test", usage: { input_tokens: 40, output_tokens: 0 } } })
      + event({ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } })
      + event({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Storms, " } })
      + event({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "always." } })
      + event({ type: "content_block_stop", index: 0 })
      + event({ type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 3 } })
      + event({ type: "message_stop" });
    return new Response(body, { headers: { "content-type": "text/event-stream" } });
  }) as typeof fetch;
  try {
    const r = await rig({ core: true });
    await r.store.save(vera);
    const chat = (await (await r.post("/api/chats/start", { characterId: "vera" })).json()) as { id: string };
    const sent = (await (await r.post("/api/chats/send", { chatId: chat.id, content: "Any storms?", greetingIndex: 0, expectedVersion: 1 })).json()) as { branchVersion: number };
    expect((await r.post("/api/chats/connection", { chatId: chat.id, connection: { id: anthropicId, model: "claude-test" } })).status).toBe(200);
    const response = await r.post("/api/chats/turn", { chatId: chat.id, kind: "reply", expectedVersion: sent.branchVersion });
    if (response.status !== 200) throw new Error(`${response.status}: ${await response.text()}`);
    expect((await events(response)).at(-1)?.type).toBe("done");
    expect(seen).toHaveLength(1);
    expect(seen[0]!.url).toBe("https://api.anthropic.com/v1/messages");
    expect(seen[0]!.key).toBe("sk-ant-test");
    const open = (await (await r.handler(apiReq(`/api/chats/open?id=${chat.id}`))).json()) as { messages: { role: string; swipes: { content: string }[] }[] };
    expect(open.messages.at(-1)).toMatchObject({ role: "assistant", swipes: [{ content: "Storms, always." }] });
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("swipe or continue before the first send is refused plainly and commits nothing to rp-core", async () => {
  const r = await rig({ core: true });
  await r.store.save(vera);
  const chat = (await (await r.post("/api/chats/start", { characterId: "vera" })).json()) as { id: string };
  await r.post("/api/chats/connection", { chatId: chat.id, connection: { id: localId, model: "qwen3" } });
  const swipe = await r.post("/api/chats/turn", { chatId: chat.id, kind: "swipe", expectedVersion: 1 });
  expect(swipe.status).toBe(400);
  expect(await swipe.json()).toEqual({ error: "there is no reply to swipe yet" });
  const resume = await r.post("/api/chats/turn", { chatId: chat.id, kind: "continue", expectedVersion: 1 });
  expect(resume.status).toBe(400);
  expect(await resume.json()).toEqual({ error: "send a message before continuing" });
  // Nothing ran ahead of the scene: the first send and reply still project normally.
  const sent = (await (await r.post("/api/chats/send", { chatId: chat.id, content: "Any storms?", greetingIndex: 0, expectedVersion: 1 })).json()) as { branchVersion: number };
  expect((await events(await r.post("/api/chats/turn", { chatId: chat.id, kind: "reply", expectedVersion: sent.branchVersion }))).at(-1)?.type).toBe("done");
  const open = (await (await r.handler(apiReq(`/api/chats/open?id=${chat.id}`))).json()) as { messages: { role: string; swipes: { content: string }[] }[] };
  expect(open.messages.at(-1)).toMatchObject({ role: "assistant", swipes: [{ content: "It might." }] });
});

test("a scene whose rp-core session was never written is finished on its next send instead of blocked", async () => {
  const r = await rig({ core: true });
  await r.store.save(vera);
  const records = libraryFor(r.store.studioPath())!.core!;
  const hostCreate = records.forHostSceneCreation;
  let failed = false;
  records.forHostSceneCreation = (sceneId, takeId) => {
    const store = hostCreate(sceneId, takeId);
    return { ...store, async create(header, entries) {
      if (!failed) { failed = true; throw new Error("simulated crash before the session header"); }
      return store.create(header, entries);
    } };
  };
  try {
    expect((await r.post("/api/chats/start", { characterId: "vera" })).status).toBe(500);
  } finally {
    records.forHostSceneCreation = hostCreate;
  }
  const chats = (await (await r.handler(apiReq("/api/chats/list"))).json()) as { id: string }[] | { chats: { id: string }[] };
  const chatId = (Array.isArray(chats) ? chats : chats.chats)[0]!.id;
  expect((await records.unlinkedBirth(chatId))?.origin).toBe("host");
  const send = await r.post("/api/chats/send", { chatId, content: "Any storms?", greetingIndex: 0, expectedVersion: 1 });
  if (send.status !== 200) throw new Error(`${send.status}: ${await send.text()}`);
  expect(await records.sceneFor(chatId)).not.toBeNull();
});

type Opened = { branchVersion: number; messages: { id: string; role: string; hidden?: boolean; current: number; swipes: { id: string; content: string }[] }[] };
async function coreSceneWithReply(r: Awaited<ReturnType<typeof rig>>) {
  await r.store.save(vera);
  const chat = (await (await r.post("/api/chats/start", { characterId: "vera" })).json()) as { id: string };
  const sent = (await (await r.post("/api/chats/send", { chatId: chat.id, content: "Any storms?", greetingIndex: 0, expectedVersion: 1 })).json()) as { branchVersion: number };
  await r.post("/api/chats/connection", { chatId: chat.id, connection: { id: localId, model: "qwen3" } });
  expect((await events(await r.post("/api/chats/turn", { chatId: chat.id, kind: "reply", expectedVersion: sent.branchVersion }))).at(-1)?.type).toBe("done");
  const open = async () => (await (await r.handler(apiReq(`/api/chats/open?id=${chat.id}`))).json()) as Opened;
  return { chatId: chat.id, open };
}
async function nextRequest(r: Awaited<ReturnType<typeof rig>>, chatId: string, version: number) {
  const next = (await (await r.post("/api/chats/send", { chatId, content: "Then what?", greetingIndex: 0, expectedVersion: version })).json()) as { branchVersion: number };
  const before = asked.length;
  expect((await events(await r.post("/api/chats/turn", { chatId, kind: "reply", expectedVersion: next.branchVersion }))).at(-1)?.type).toBe("done");
  expect(asked.length).toBe(before + 1);
  return asked.at(-1)!.messages.map((message) => message.content).join(" | ");
}

test("on a core scene, editing a message and switching the newest reply's version go through rp-core and reach the next request", async () => {
  const r = await rig({ core: true });
  const { chatId, open } = await coreSceneWithReply(r);
  const replied = await open();
  const [user, reply] = [replied.messages.at(-2)!, replied.messages.at(-1)!];
  const firstVersion = reply.swipes[0]!.id;
  expect((await events(await r.post("/api/chats/turn", { chatId, kind: "swipe", expectedVersion: replied.branchVersion }))).at(-1)?.type).toBe("done");
  let scene = await open();
  // Edit the reply's first version while the second one is shown, then switch back to it.
  const edited = await r.post("/api/chats/edit", { messageId: reply.id, swipeId: firstVersion, content: "Storms, always.", expectedVersion: scene.branchVersion });
  if (edited.status !== 200) throw new Error(`${edited.status}: ${await edited.text()}`);
  scene = await open();
  const picked = await r.post("/api/chats/select-swipe", { chatId, messageId: reply.id, index: 0, expectedVersion: scene.branchVersion });
  if (picked.status !== 200) throw new Error(`${picked.status}: ${await picked.text()}`);
  expect(((await picked.json()) as Opened).messages.at(-1)).toMatchObject({ current: 0, swipes: [{ content: "Storms, always." }] });
  scene = await open();
  const userEdit = await r.post("/api/chats/edit", { messageId: user.id, swipeId: user.swipes[0]!.id, content: "Any rain?", expectedVersion: scene.branchVersion });
  if (userEdit.status !== 200) throw new Error(`${userEdit.status}: ${await userEdit.text()}`);
  expect(((await userEdit.json()) as Opened["messages"][number]).swipes[0]?.content).toBe("Any rain?");
  const sent = await nextRequest(r, chatId, (await open()).branchVersion);
  expect(sent).toContain("Any rain?");
  expect(sent).toContain("Storms, always.");
  expect(sent).not.toContain("Any storms?");
});

test("on a core scene, the scene's preset, its block switches, its samplers and its lorebooks reach rp-core's request", async () => {
  const r = await rig({ core: true });
  await r.store.save(vera);
  const prompt = (id: string, content: string) => ({ id, name: id, content, role: "system", enabled: true, systemPrompt: true, marker: false, placement: "relative", injectionDepth: 4, injectionOrder: 100, forbidOverrides: false });
  await r.store.save({ schemaVersion: vera.schemaVersion, kind: "preset", id: "quill", body: { name: "Velvet Quill",
    prompts: [prompt("main", "Write as {{char}}."), prompt("aside", "Keep it short."), prompt("history", "{{message_history}}")], samplers: { temperature: 0.4 } } });
  await r.store.save({ schemaVersion: vera.schemaVersion, kind: "lorebook", id: "tower",
    body: { ...emptyLorebookBody("Tower"), entries: [{ ...emptyLoreEntry("bell"), constant: true, content: "The tower bell rings at dusk." }] } });
  const chat = (await (await r.post("/api/chats/start", { characterId: "vera" })).json()) as { id: string };
  const lore = await r.post("/api/chats/lore", { chatId: chat.id, lore: { added: ["tower"], off: [] } });
  if (lore.status !== 200) throw new Error(`${lore.status}: ${await lore.text()}`);
  const preset = await r.post("/api/chats/preset", { chatId: chat.id, preset: { kind: "preset", id: "quill", toggles: { aside: false }, samplers: { temperature: 0.9 } } });
  if (preset.status !== 200) throw new Error(`${preset.status}: ${await preset.text()}`);
  const sent = (await (await r.post("/api/chats/send", { chatId: chat.id, content: "Any storms?", greetingIndex: 0, expectedVersion: 1 })).json()) as { branchVersion: number };
  await r.post("/api/chats/connection", { chatId: chat.id, connection: { id: localId, model: "qwen3" } });
  expect((await events(await r.post("/api/chats/turn", { chatId: chat.id, kind: "reply", expectedVersion: sent.branchVersion }))).at(-1)?.type).toBe("done");
  const request = asked.at(-1) as unknown as { messages: { content: string }[]; temperature: number };
  const text = request.messages.map((message) => message.content).join(" | ");
  expect(text).toContain("Write as Vera.");
  expect(text).toContain("The tower bell rings at dusk.");
  expect(text).not.toContain("Keep it short.");
  expect(request.temperature).toBe(0.9);
  // Switching the book off for the scene takes it out of the next request.
  expect((await r.post("/api/chats/lore", { chatId: chat.id, lore: { added: ["tower"], off: ["tower"] } })).status).toBe(200);
  const open = (await (await r.handler(apiReq(`/api/chats/open?id=${chat.id}`))).json()) as { branchVersion: number };
  expect((await events(await r.post("/api/chats/turn", { chatId: chat.id, kind: "swipe", expectedVersion: open.branchVersion }))).at(-1)?.type).toBe("done");
  expect(asked.at(-1)!.messages.map((message) => message.content).join(" | ")).not.toContain("The tower bell rings at dusk.");
});

test("on a core scene, discard and add-anyway reach rp-core and say plainly when no reply is waiting", async () => {
  const r = await rig({ core: true });
  const { chatId } = await coreSceneWithReply(r);
  for (const path of ["/api/chats/discard", "/api/chats/add-anyway"]) {
    const res = await r.post(path, { chatId, turnId: "no-such-turn" });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "that reply is no longer waiting" });
  }
});

test("on a core scene, a forked take keeps every version, continues on its own rp-core history, and switching or deleting takes follows the scene", async () => {
  const r = await rig({ core: true });
  const { chatId, open } = await coreSceneWithReply(r);
  const replied = await open();
  expect((await events(await r.post("/api/chats/turn", { chatId, kind: "swipe", expectedVersion: replied.branchVersion }))).at(-1)?.type).toBe("done");
  await nextRequest(r, chatId, (await open()).branchVersion);
  const original = await open();
  const replyId = original.messages.at(-3)!.id;
  const forked = await r.post("/api/chats/fork", { chatId, messageId: replyId, expectedVersion: original.branchVersion });
  if (forked.status !== 200) throw new Error(`${forked.status}: ${await forked.text()}`);
  const take = await open();
  expect(take.messages).toHaveLength(original.messages.length - 2);
  expect((take.messages.at(-1) as { transcript?: { swipeCount: number } }).transcript?.swipeCount).toBe(2);
  // The fork point is the take's newest message now, so its versions switch in place.
  expect((await r.post("/api/chats/select-swipe", { chatId, messageId: take.messages.at(-1)!.id, index: 0, expectedVersion: take.branchVersion })).status).toBe(200);
  const onTake = await nextRequest(r, chatId, (await open()).branchVersion);
  expect(onTake.split("Then what?").length - 1).toBe(1);
  const chats = libraryFor(r.store.studioPath())!.chats;
  const takes = await chats.listBranches(chatId);
  const mainId = takes[0]!.id, forkId = takes.at(-1)!.id;
  const back = await r.post("/api/chats/take", { chatId, branchId: mainId });
  if (back.status !== 200) throw new Error(`${back.status}: ${await back.text()}`);
  expect((await open()).messages).toHaveLength(original.messages.length);
  const onMain = await nextRequest(r, chatId, (await open()).branchVersion);
  expect(onMain.split("Then what?").length - 1).toBe(2);
  expect((await r.post("/api/chats/take", { chatId, branchId: forkId })).status).toBe(200);
  const gone = await r.post("/api/chats/delete-take", { chatId, branchId: forkId });
  if (gone.status !== 200) throw new Error(`${gone.status}: ${await gone.text()}`);
  expect((await chats.getChat(chatId))?.activeBranchId).toBe(mainId);
  await nextRequest(r, chatId, (await open()).branchVersion);
});

test("on a core scene, a hidden reply leaves the next request and stays dimmed on the page", async () => {
  const r = await rig({ core: true });
  const { chatId, open } = await coreSceneWithReply(r);
  const scene = await open();
  const reply = scene.messages.at(-1)!;
  const hidden = await r.post("/api/chats/hide", { chatId, messageId: reply.id, hidden: true, expectedVersion: scene.branchVersion });
  if (hidden.status !== 200) throw new Error(`${hidden.status}: ${await hidden.text()}`);
  expect((await open()).messages.at(-1)).toMatchObject({ id: reply.id, hidden: true });
  const sent = await nextRequest(r, chatId, (await open()).branchVersion);
  expect(sent).toContain("Any storms?");
  expect(sent).not.toContain("It might.");
});

test("on a core scene, an earlier message's other version is refused plainly and changes nothing", async () => {
  const r = await rig({ core: true });
  const { chatId, open } = await coreSceneWithReply(r);
  const replied = await open();
  expect((await events(await r.post("/api/chats/turn", { chatId, kind: "swipe", expectedVersion: replied.branchVersion }))).at(-1)?.type).toBe("done");
  const swiped = await open();
  await nextRequest(r, chatId, swiped.branchVersion);
  const later = await open();
  const reply = later.messages.at(-3)!;
  const res = await r.post("/api/chats/select-swipe", { chatId, messageId: reply.id, index: 0, expectedVersion: later.branchVersion });
  expect(res.status).toBe(400);
  expect(((await open()).messages)).toHaveLength(later.messages.length);
});

test("on a core scene, a new persona and an alt-art variant reach rp-core's next request", async () => {
  const r = await rig({ core: true });
  const withLook = { ...vera, body: { ...vera.body, persona: { ...vera.body.persona, personality: "Calm." },
    variants: [{ id: "storm", label: "Storm", overrides: { persona: { personality: "Wild as weather." } } }] } };
  await r.store.save(withLook);
  await r.store.save({ schemaVersion: vera.schemaVersion, kind: "persona", id: "mara", body: { name: "Mara", content: "Mara keeps the lighthouse.", knowledgeRefs: [] } });
  const chat = (await (await r.post("/api/chats/start", { characterId: "vera" })).json()) as { id: string };
  const sent = (await (await r.post("/api/chats/send", { chatId: chat.id, content: "Any storms?", greetingIndex: 0, expectedVersion: 1 })).json()) as { branchVersion: number };
  await r.post("/api/chats/connection", { chatId: chat.id, connection: { id: localId, model: "qwen3" } });
  expect((await events(await r.post("/api/chats/turn", { chatId: chat.id, kind: "reply", expectedVersion: sent.branchVersion }))).at(-1)?.type).toBe("done");
  const before = asked.at(-1)!.messages.map((m) => m.content).join(" | ");
  expect(before).toContain("Calm.");
  const persona = await r.post("/api/chats/persona", { chatId: chat.id, personaId: "mara" });
  if (persona.status !== 200) throw new Error(`${persona.status}: ${await persona.text()}`);
  const look = await r.post("/api/chats/variant", { chatId: chat.id, variantId: "storm" });
  if (look.status !== 200) throw new Error(`${look.status}: ${await look.text()}`);
  const open = (await (await r.handler(apiReq(`/api/chats/open?id=${chat.id}`))).json()) as { branchVersion: number };
  const next = (await (await r.post("/api/chats/send", { chatId: chat.id, content: "Then what?", greetingIndex: 0, expectedVersion: open.branchVersion })).json()) as { branchVersion: number };
  expect((await events(await r.post("/api/chats/turn", { chatId: chat.id, kind: "reply", expectedVersion: next.branchVersion }))).at(-1)?.type).toBe("done");
  const after = asked.at(-1)!.messages.map((m) => m.content).join(" | ");
  expect(after).toContain("Mara keeps the lighthouse.");
  expect(after).toContain("Wild as weather.");
  expect(after).not.toContain("Calm.");
});

test("on a core scene, the person's own wording of the greeting is what the scene shows and what rp-core sends", async () => {
  const r = await rig({ core: true });
  await r.store.save(vera);
  const chat = (await (await r.post("/api/chats/start", { characterId: "vera" })).json()) as { id: string };
  const opening = await r.post("/api/chats/opening", { chatId: chat.id, opening: { edits: [{ index: 1, text: "Evening, keeper." }] } });
  if (opening.status !== 200) throw new Error(`${opening.status}: ${await opening.text()}`);
  const sent = await r.post("/api/chats/send", { chatId: chat.id, content: "Any storms?", greetingIndex: 1, expectedVersion: 1 });
  if (sent.status !== 200) throw new Error(`${sent.status}: ${await sent.text()}`);
  const shown = ((await sent.json()) as { messages: { role: string; swipes: { content: string }[] }[] }).messages[0]!;
  expect(shown.swipes.map((swipe) => swipe.content)).toContain("Evening, keeper.");
  await r.post("/api/chats/connection", { chatId: chat.id, connection: { id: localId, model: "qwen3" } });
  const open = (await (await r.handler(apiReq(`/api/chats/open?id=${chat.id}`))).json()) as { branchVersion: number };
  expect((await events(await r.post("/api/chats/turn", { chatId: chat.id, kind: "reply", expectedVersion: open.branchVersion }))).at(-1)?.type).toBe("done");
  const request = asked.at(-1)!.messages.map((m) => m.content);
  expect(request).toContain("Evening, keeper.");
  expect(request).not.toContain("Evening.");
});

test("on a core scene, a draft reads the scene without writing anything", async () => {
  const r = await rig({ core: true });
  const { chatId, open } = await coreSceneWithReply(r);
  const before = await open();
  const drafted = await r.post("/api/chats/draft", { chatId, kind: "impersonate" });
  if (drafted.status !== 200) throw new Error(`${drafted.status}: ${await drafted.text()}`);
  expect(typeof ((await drafted.json()) as { text: unknown }).text).toBe("string");
  expect((await open()).branchVersion).toBe(before.branchVersion);
});


test("on a core scene, Reasoning Effort rides rp-core's narrator binding, and an effort it does not know is refused plainly", async () => {
  const r = await rig({ core: true });
  const { chatId, open } = await coreSceneWithReply(r);
  expect((await r.post("/api/chats/prompting", { chatId, prompting: { reasoningEffort: "high" } })).status).toBe(200);
  const refused = await r.post("/api/chats/prompting", { chatId, prompting: { reasoningEffort: "ludicrous" } });
  expect(refused.status).toBe(501);
  expect(await refused.json()).toEqual({ error: "that reasoning effort is not one this scene knows" });
  await nextRequest(r, chatId, (await open()).branchVersion);
  const records = libraryFor(r.store.studioPath())!.core!;
  const { Engine } = await import("rp-core");
  const engine = await Engine.openWithRecordStore({ home: r.store.studioPath(), recordStore: records, lane: "manual" });
  try {
    const session = await engine.session((await records.sceneFor(chatId))!.sessionId);
    expect((await session.configurationSnapshot()).roles.narrator).toMatchObject({ reasoning: "high" });
  } finally { await engine.close(); }
  expect((await r.post("/api/chats/prompting", { chatId, prompting: { toolAccess: null } })).status).toBe(200);
});

test("on a core scene, the prompt regex holds the turn for the page, and what the page answers is what rp-core sends", async () => {
  const r = await rig({ core: true });
  await r.store.save(vera);
  await r.store.save({ schemaVersion: vera.schemaVersion, kind: "regex", id: "scrub", body: { name: "Scrub", rules: [{ id: "r", label: "r", find: "storms", flags: "g", replace: "weather", phases: ["prompt"], enabled: true, sortOrder: 0 }] } } as never);
  const chat = (await (await r.post("/api/chats/start", { characterId: "vera" })).json()) as { id: string };
  expect((await r.post("/api/chats/regex", { chatId: chat.id, regex: { sets: ["scrub"] } })).status).toBe(200);
  const sent = (await (await r.post("/api/chats/send", { chatId: chat.id, content: "Any storms?", greetingIndex: 0, expectedVersion: 1 })).json()) as { branchVersion: number };
  await r.post("/api/chats/connection", { chatId: chat.id, connection: { id: localId, model: "qwen3" } });
  const res = await r.post("/api/chats/turn", { chatId: chat.id, kind: "reply", expectedVersion: sent.branchVersion });
  const reader = res.body!.getReader(), decoder = new TextDecoder();
  let wire = "", answered = false;
  for (;;) {
    const { done, value } = await reader.read();
    if (value) wire += decoder.decode(value, { stream: true });
    const frame = wire.split("\n\n").find((f) => f.startsWith("event: regex"));
    if (frame && !answered) {
      answered = true;
      const event = JSON.parse(frame.split("\ndata: ")[1]!) as { turnId: string; items: { index: number; text: string }[] };
      expect(event.items.map((item) => item.text)).toContain("Any storms?");
      await r.post("/api/chats/regex-answer", { chatId: chat.id, turnId: event.turnId, kind: "done", texts: Object.fromEntries(event.items.map((item) => [item.index, item.text.replace("storms", "weather")])) });
    }
    if (done) break;
  }
  expect(answered).toBe(true);
  expect(wire).toContain("event: done");
  const request = asked.at(-1)!.messages.map((m) => m.content);
  expect(request).toContain("Any weather?");
  expect(request).not.toContain("Any storms?");
});

test("on a core scene, a cut leaves rp-core's next request, a restore in place puts it back, and a restore after moving on becomes its own take", async () => {
  const r = await rig({ core: true });
  const { chatId, open } = await coreSceneWithReply(r);
  await nextRequest(r, chatId, (await open()).branchVersion);
  const full = await open();
  const second = full.messages.at(-2)!; // "Then what?"
  expect((await r.post("/api/chats/cut", { chatId, messageId: full.messages.at(-3)!.id, scope: "one", expectedVersion: full.branchVersion })).status).toBe(400);
  const cut = await r.post("/api/chats/cut", { chatId, messageId: second.id, scope: "from", expectedVersion: full.branchVersion });
  if (cut.status !== 200) throw new Error(`${cut.status}: ${await cut.text()}`);
  const live = async () => (await open()).messages.filter((m) => !(m as { cut?: unknown }).cut);
  expect(await live()).toHaveLength(full.messages.length - 2);
  const chats = libraryFor(r.store.studioPath())!.chats;
  const cutIdOf = async () => (await chats.readMessages((await chats.getChat(chatId))!.activeBranchId, { limit: 100 })).messages.find((m) => m.cut)!.cut!.id;
  const back = await r.post("/api/chats/restore-cut", { chatId, cutId: await cutIdOf(), expectedVersion: (await open()).branchVersion });
  if (back.status !== 200) throw new Error(`${back.status}: ${await back.text()}`);
  expect((await open()).messages).toHaveLength(full.messages.length);
  expect(await nextRequest(r, chatId, (await open()).branchVersion)).toContain("Then what?");
  // Cut again, move on, then restore: the cut comes back as a take of its own.
  const now = await open();
  expect((await r.post("/api/chats/cut", { chatId, messageId: now.messages.at(-2)!.id, scope: "from", expectedVersion: now.branchVersion })).status).toBe(200);
  const mainTake = (await chats.getChat(chatId))!.activeBranchId;
  const cutId = await cutIdOf();
  const movedRes = await r.post("/api/chats/send", { chatId, content: "Never mind.", greetingIndex: 0, expectedVersion: (await open()).branchVersion });
  if (movedRes.status !== 200) throw new Error(`send ${movedRes.status}: ${await movedRes.text()}`);
  const moved = (await movedRes.json()) as { branchVersion: number };
  const restored = await r.post("/api/chats/restore-cut", { chatId, cutId, expectedVersion: moved.branchVersion });
  if (restored.status !== 200) throw new Error(`${restored.status}: ${await restored.text()}`);
  expect((await chats.getChat(chatId))!.activeBranchId).not.toBe(mainTake);
  expect(await nextRequest(r, chatId, (await open()).branchVersion)).not.toContain("Never mind.");
  expect((await r.post("/api/chats/take", { chatId, branchId: mainTake })).status).toBe(200);
  expect(await nextRequest(r, chatId, (await open()).branchVersion)).toContain("Never mind.");
});
