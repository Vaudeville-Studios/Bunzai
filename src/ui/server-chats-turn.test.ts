/**
 * The turn routes over HTTP: the AI wing lists Kit's saved connections
 * (no keys, and the ones scenes cannot use say why), a scene remembers its pick, a reply streams
 * from a real OpenAI-compatible server on this machine and lands in the scene, and a scene with no
 * connection is refused before anything opens. Kit's vault is sandboxed for the file.
 */
import { afterAll, afterEach, beforeAll, expect, setDefaultTimeout, test } from "bun:test";
import { useTestBunzaiHome } from "../../scripts/test-home";
import { randomUUID } from "node:crypto";
import { Engine } from "rp-core";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CANONICAL_SCHEMA_VERSION } from "../core/canonical";
import { saveProvider } from "../kit/providers/vault";
import { libraryFor } from "../studio/library-content";
import { openCoreScene } from "../studio/core-scene";
import { chatRouteRig as rig, cleanupChatRouteRigs, vera } from "./fake-server-chats-rig";
import { apiReq } from "./server-test-rig";

afterEach(cleanupChatRouteRigs);

// Sealing the vault spawns the OS keystore (about a second, cold).
setDefaultTimeout(30_000);
const HOME = join(tmpdir(), `bunzai-turn-routes-${randomUUID()}`);
const UNLOCK = { passphrase: "turn-routes-test" };
let restoreBunzaiHome: (() => void) | undefined;
let server: ReturnType<typeof Bun.serve>;
const asked: { model: string; messages: { role: string; content: string }[] }[] = [];
let localId = "";
let subId = "";

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
  subId = (await saveProvider({ kind: "claude-sub", model: "claude-opus-5-5" }, UNLOCK)).id!;
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
async function readEvents(res: Response, onEvent: (e: { type: string; [k: string]: unknown }) => void): Promise<{ type: string; [k: string]: unknown }[]> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  const seen: { type: string; [k: string]: unknown }[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (value) buf += decoder.decode(value, { stream: true });
    let at: number;
    while ((at = buf.indexOf("\n\n")) !== -1) {
      const frame = buf.slice(0, at);
      buf = buf.slice(at + 2);
      const line = frame.split("\n").find((l) => l.startsWith("data: "));
      if (line) {
        const e = JSON.parse(line.slice(6)) as { type: string; [k: string]: unknown };
        seen.push(e);
        onEvent(e);
      }
    }
    if (done) return seen;
  }
}

async function readyScene() {
  const r = await rig();
  await r.store.save(vera);
  const chat = (await (await r.post("/api/chats/start", { characterId: "vera" })).json()) as { id: string };
  const send = await r.post("/api/chats/send", { chatId: chat.id, content: "Any storms?", greetingIndex: 0, expectedVersion: 1 });
  if (send.status !== 200) throw new Error(`${send.status}: ${await send.text()}`);
  const sent = (await send.json()) as { branchVersion: number };
  return { ...r, chatId: chat.id, version: sent.branchVersion };
}

test("new core scene sends through rp-core and keeps the reply in Bunzai", async () => {
  const r = await rig({ core: true });
  await r.store.save(vera);
  const chat = (await (await r.post("/api/chats/start", { characterId: "vera" })).json()) as { id: string };
  const send = await r.post("/api/chats/send", { chatId: chat.id, content: "Any storms?", greetingIndex: 0, expectedVersion: 1 });
  if (send.status !== 200) throw new Error(`${send.status}: ${await send.text()}`);
  const sent = (await send.json()) as { branchVersion: number };
  expect((await r.post("/api/chats/connection", { chatId: chat.id, connection: { id: localId, model: "qwen3" } })).status).toBe(200);
  const response = await r.post("/api/chats/turn", { chatId: chat.id, kind: "reply", expectedVersion: sent.branchVersion });
  if (response.status !== 200) throw new Error(`${response.status}: ${await response.text()}`);
  const result = await events(response);
  expect(result.map((e) => e.type)).toEqual(["start", "text", "done"]);
  const open = (await (await r.handler(apiReq(`/api/chats/open?id=${chat.id}`))).json()) as { messages: { role: string; swipes: { content: string }[] }[] };
  expect(open.messages.at(-1)).toMatchObject({ role: "assistant", swipes: [{ content: "It might." }] });
  const first = (await (await r.handler(apiReq(`/api/chats/open?id=${chat.id}`))).json()) as { branchVersion: number };
  expect((await events(await r.post("/api/chats/turn", { chatId: chat.id, kind: "swipe", expectedVersion: first.branchVersion }))).at(-1)?.type).toBe("done");
  const swiped = (await (await r.handler(apiReq(`/api/chats/open?id=${chat.id}`))).json()) as { branchVersion: number; messages: { transcript?: { swipeCount: number } }[] };
  expect(swiped.messages.at(-1)?.transcript?.swipeCount).toBe(2);
  const next = (await (await r.post("/api/chats/send", { chatId: chat.id, content: "Then what?", greetingIndex: 0, expectedVersion: swiped.branchVersion })).json()) as { branchVersion: number };
  expect((await events(await r.post("/api/chats/turn", { chatId: chat.id, kind: "reply", expectedVersion: next.branchVersion }))).at(-1)?.type).toBe("done");
});

test("core scene exposes its own Director and memory view, while an old scene does not", async () => {
  const r = await rig({ core: true });
  await r.store.save(vera);
  const chat = (await (await r.post("/api/chats/start", { characterId: "vera" })).json()) as { id: string };
  const open = (await (await r.handler(apiReq(`/api/chats/open?id=${chat.id}`))).json()) as { core?: true };
  expect(open.core).toBe(true);
  const snapshot = (await (await r.handler(apiReq(`/api/chats/core-state?chatId=${chat.id}`))).json()) as { director: unknown; memory: { total: number; items: unknown[] } };
  expect(snapshot.director).toBeNull();
  expect(snapshot.memory).toMatchObject({ total: 0, items: [] });
  const records = libraryFor(r.store.studioPath())!.core!;
  const linked = (await records.sceneFor(chat.id))!;
  const engine = await Engine.openWithRecordStore({ home: r.store.studioPath(), recordStore: records, lane: "manual" });
  const session = await engine.session(linked.sessionId);
  await session.memoryAdd({ title: "Storm warning", content: "The harbor closes at dusk." });
  await engine.close();
  const remembered = (await (await r.handler(apiReq(`/api/chats/core-state?chatId=${chat.id}`))).json()) as { memory: { total: number; items: { name: string; render: string }[] } };
  expect(remembered.memory.total).toBe(1);
  expect(remembered.memory.items[0]?.name).toBe("Storm warning");
  expect(remembered.memory.items[0]?.render).toContain("harbor closes at dusk");
  const sent = await r.post("/api/chats/send", { chatId: chat.id, content: "Any storms?", greetingIndex: 0, expectedVersion: 1 });
  expect((await sent.json() as { core?: true }).core).toBe(true);
  expect((await r.post("/api/chats/core-settings", { chatId: chat.id, feature: "director", enabled: true })).status).toBe(200);
  expect((await r.post("/api/chats/core-settings", { chatId: chat.id, feature: "memory", enabled: false })).status).toBe(200);
  const switched = (await (await r.handler(apiReq(`/api/chats/core-state?chatId=${chat.id}`))).json()) as { directorEnabled: boolean; memoryEnabled: boolean };
  expect(switched).toMatchObject({ directorEnabled: true, memoryEnabled: false });
  expect((await r.post("/api/chats/core-settings", { chatId: chat.id, feature: "director", enabled: "yes" })).status).toBe(400);
  const old = await rig({ core: false });
  await old.store.save(vera);
  const legacy = (await (await old.post("/api/chats/start", { characterId: "vera" })).json()) as { id: string };
  expect((await (await old.handler(apiReq(`/api/chats/open?id=${legacy.id}`))).json() as { core?: true }).core).toBeUndefined();
});

test("new core scene's prompt inspector answers the rp-core review gate", async () => {
  const r = await rig({ core: true });
  await r.store.save(vera);
  const chat = (await (await r.post("/api/chats/start", { characterId: "vera" })).json()) as { id: string };
  const sent = (await (await r.post("/api/chats/send", { chatId: chat.id, content: "Any storms?", greetingIndex: 0, expectedVersion: 1 })).json()) as { branchVersion: number };
  await r.post("/api/chats/connection", { chatId: chat.id, connection: { id: localId, model: "qwen3" } });
  const seen = await readEvents(await r.post("/api/chats/turn", { chatId: chat.id, kind: "reply", expectedVersion: sent.branchVersion, inspect: true }), (event) => {
    if (event.type === "review") void r.post("/api/chats/review", { chatId: chat.id, turnId: event.turnId, kind: "send", edits: {} });
  });
  expect(seen.map((event) => event.type)).toEqual(["start", "review", "text", "done"]);
});

test("an unsupported edit is refused before it can diverge from rp-core", async () => {
  const r = await rig({ core: true });
  await r.store.save(vera);
  const chat = (await (await r.post("/api/chats/start", { characterId: "vera" })).json()) as { id: string };
  const sent = (await (await r.post("/api/chats/send", { chatId: chat.id, content: "Any storms?", greetingIndex: 0, expectedVersion: 1 })).json()) as { branchVersion: number; messages: { id: string; swipes: { id: string }[] }[] };
  const user = sent.messages.at(-1)!;
  expect((await r.post("/api/chats/edit", { messageId: user.id, swipeId: user.swipes[0]!.id, content: "A different question", expectedVersion: sent.branchVersion })).status).toBe(501);
  const open = (await (await r.handler(apiReq(`/api/chats/open?id=${chat.id}`))).json()) as { messages: { swipes: { content: string }[] }[] };
  expect(open.messages.at(-1)?.swipes[0]?.content).toBe("Any storms?");
});

test("opening a core scene restores an answer committed before its UI projection", async () => {
  const r = await rig({ core: true });
  await r.store.save(vera);
  const chat = (await (await r.post("/api/chats/start", { characterId: "vera" })).json()) as { id: string };
  await r.post("/api/chats/send", { chatId: chat.id, content: "Any storms?", greetingIndex: 0, expectedVersion: 1 });
  const pick = { id: localId, model: "qwen3" };
  await r.post("/api/chats/connection", { chatId: chat.id, connection: pick });
  const records = libraryFor(r.store.studioPath())!.core!;
  const link = (await records.sceneFor(chat.id))!;
  const { engine, session } = await openCoreScene(records, r.store.studioPath(), link.sessionId, pick);
  const turn = await session.runTurn({ kind: "reply", expectedVersion: await session.version() });
  for await (const _ of turn.events) { /* drain */ }
  expect(await turn.result).toMatchObject({ type: "done" });
  await engine.close();
  const open = (await (await r.handler(apiReq(`/api/chats/open?id=${chat.id}`))).json()) as { messages: { role: string; swipes: { content: string }[] }[] };
  expect(open.messages.at(-1)).toMatchObject({ role: "assistant", swipes: [{ content: "It might." }] });
});

test("a stale or invalid first send never advances the core journal", async () => {
  const r = await rig({ core: true });
  await r.store.save(vera);
  const chat = (await (await r.post("/api/chats/start", { characterId: "vera" })).json()) as { id: string };
  expect((await r.post("/api/chats/send", { chatId: chat.id, content: "Hi", greetingIndex: 0, expectedVersion: 0 })).status).toBe(409);
  expect((await r.post("/api/chats/send", { chatId: chat.id, content: "Hi", greetingIndex: 99, expectedVersion: 1 })).status).toBe(400);
  expect((await r.post("/api/chats/send", { chatId: chat.id, content: "Hi", greetingIndex: 0, expectedVersion: 1 })).status).toBe(200);
});

test("the wing lists saved connections without keys, and a subscription sign-in says why scenes cannot use it", async () => {
  const { handler } = await rig();
  const list = (await (await handler(apiReq("/api/chats/connections"))).json()) as Record<string, unknown>[];
  expect(list.find((c) => c["id"] === localId)).toEqual({ id: localId, kind: "local", label: "Desk", model: "qwen3", params: expect.arrayContaining(["min_p", "top_k", "grammar_string"]) });
  expect(String(list.find((c) => c["id"] === subId)?.["unavailable"])).toContain("scenes can't send through it yet");
  expect(JSON.stringify(list)).not.toContain("apiKey");
});

test("a scene with no connection is refused before anything opens; a bad pick is refused whole", async () => {
  const { post, chatId, version } = await readyScene();
  const res = await post("/api/chats/turn", { chatId, kind: "reply", expectedVersion: version });
  expect(res.status).toBe(409);
  expect(((await res.json()) as { error: string }).error).toContain("no connection");
  expect((await post("/api/chats/connection", { chatId, connection: { id: localId } })).status).toBe(400);
});

test("a reply streams from the scene's connection and lands in the scene with its generation", async () => {
  const { post, handler, chatId, version } = await readyScene();
  const picked = (await (await post("/api/chats/connection", { chatId, connection: { id: localId, model: "qwen3" } })).json()) as { connection: unknown };
  expect(picked.connection).toEqual({ id: localId, model: "qwen3" });
  const res = await post("/api/chats/turn", { chatId, kind: "reply", expectedVersion: version });
  expect(res.headers.get("content-type")).toBe("text/event-stream");
  const seen = await events(res);
  // M5: the fake server's two chunks ("It " and "might.") arrive well inside the 40 ms coalescing
  // window, so they reach the client as one batched "text" event, not two.
  expect(seen.map((e) => e.type)).toEqual(["start", "text", "done"]);
  expect((seen.find((e) => e.type === "text") as unknown as { delta: string }).delta).toBe("It might.");
  expect(asked.at(-1)!.model).toBe("qwen3");
  expect(asked.at(-1)!.messages.map((m) => m.content)).toEqual(["Hello User.", "Any storms?"]);
  const open = (await (await handler(apiReq(`/api/chats/open?id=${chatId}`))).json()) as { messages: { swipes: { content: string; generation?: Record<string, unknown> }[] }[] };
  const reply = open.messages.at(-1)!.swipes[0]!;
  expect(reply.content).toBe("It might.");
  expect(reply.generation).toMatchObject({ model: "qwen3-local", finishReason: "stop", promptTokens: 40, completionTokens: 3 });
});

test("a continue sends the reply as a final assistant message and appends what streams to the same version", async () => {
  const { post, handler, chatId, version } = await readyScene();
  await post("/api/chats/connection", { chatId, connection: { id: localId, model: "qwen3" } });
  await events(await post("/api/chats/turn", { chatId, kind: "reply", expectedVersion: version }));
  const open = async () => (await (await handler(apiReq(`/api/chats/open?id=${chatId}`))).json()) as { branchVersion: number; messages: { id: string; swipes: { content: string }[] }[] };
  const replied = await open();
  const seen = await events(await post("/api/chats/turn", { chatId, kind: "continue", expectedVersion: replied.branchVersion }));
  expect(seen[0]).toMatchObject({ type: "start", kind: "continue", messageId: replied.messages.at(-1)!.id });
  expect((seen.find((e) => e.type === "text") as unknown as { delta: string }).delta).toBe(" And more.");
  expect(seen.at(-1)!.type).toBe("done");
  expect(asked.at(-1)!.messages.map((m) => `${m.role}:${m.content}`)).toEqual(["assistant:Hello User.", "user:Any storms?", "assistant:It might."]);
  const after = await open();
  expect(after.messages.at(-1)!.swipes.map((w) => w.content)).toEqual(["It might. And more."]);
  expect((await post("/api/chats/turn", { chatId, kind: "later", expectedVersion: after.branchVersion })).status).toBe(400);
});

test("a guided swipe sends the rejected draft and the directive, and the new version keeps the guidance; guidance on any other turn is a 400", async () => {
  const { post, handler, chatId, version } = await readyScene();
  await post("/api/chats/connection", { chatId, connection: { id: localId, model: "qwen3" } });
  await events(await post("/api/chats/turn", { chatId, kind: "reply", expectedVersion: version }));
  const open = async () => (await (await handler(apiReq(`/api/chats/open?id=${chatId}`))).json()) as { branchVersion: number; messages: { swipes: { content: string; generation?: { guidance?: string } }[] }[] };
  const replied = await open();
  expect((await post("/api/chats/turn", { chatId, kind: "reply", expectedVersion: replied.branchVersion, guidance: "Make her colder." })).status).toBe(400);
  expect((await post("/api/chats/turn", { chatId, kind: "swipe", expectedVersion: replied.branchVersion, guidance: 7 })).status).toBe(400);
  const seen = await events(await post("/api/chats/turn", { chatId, kind: "swipe", expectedVersion: replied.branchVersion, guidance: "Make her colder." }));
  expect(seen.at(-1)!.type).toBe("done");
  const [rejected, directive] = asked.at(-1)!.messages.slice(-2);
  expect(rejected).toEqual({ role: "assistant", content: "[REJECTED DRAFT - NOT PART OF THE STORY]\nIt might." });
  expect(directive!.role).toBe("system");
  expect(directive!.content).toContain("USER DIRECTION:\nMake her colder.\n");
  const swipes = (await open()).messages.at(-1)!.swipes;
  expect(swipes.at(-1)!.generation?.guidance).toBe("Make her colder.");
});

test("Stop with no turn running says so; add-anyway and discard with nothing waiting are 404", async () => {
  const { post, chatId } = await readyScene();
  expect(await (await post("/api/chats/stop", { chatId, turnId: "nope" })).json()).toEqual({ stopped: false });
  expect((await post("/api/chats/discard", { chatId, turnId: "nope" })).status).toBe(404);
  expect((await post("/api/chats/add-anyway", { chatId, turnId: "nope" })).status).toBe(404);
});

test("a scene follows its library preset: the pick is kept, the turn sends it, and a preset gone from the library is refused before anything opens", async () => {
  const { post, store, chatId, version } = await readyScene();
  const prompt = (id: string, content: string) => ({ id, name: id, content, role: "system", enabled: true, systemPrompt: true, marker: false, placement: "relative", injectionDepth: 4, injectionOrder: 100, forbidOverrides: false });
  await store.save({ schemaVersion: vera.schemaVersion, kind: "preset", id: "quill", body: { name: "Velvet Quill", prompts: [prompt("main", "Write as {{char}}."), prompt("history", "{{message_history}}")], samplers: { temperature: 0.4 } } });
  expect((await post("/api/chats/preset", { chatId, preset: { id: "quill" } })).status).toBe(400);
  const picked = (await (await post("/api/chats/preset", { chatId, preset: { kind: "preset", id: "quill", toggles: {}, samplers: { temperature: 0.9 } } })).json()) as { preset: unknown };
  expect(picked.preset).toEqual({ kind: "preset", id: "quill", toggles: {}, samplers: { temperature: 0.9 } });
  await post("/api/chats/connection", { chatId, connection: { id: localId, model: "qwen3" } });
  const seen = await events(await post("/api/chats/turn", { chatId, kind: "reply", expectedVersion: version }));
  expect(seen.at(-1)!.type).toBe("done");
  const request = asked.at(-1) as unknown as { messages: { content: string }[]; temperature: number };
  expect(request.messages[0]!.content).toBe("Write as Vera.");
  expect(request.temperature).toBe(0.9);
  await store.delete("preset", "quill");
  const refused = await post("/api/chats/turn", { chatId, kind: "reply", expectedVersion: version + 1 });
  expect(refused.status).toBe(409);
  expect(((await refused.json()) as { error: string }).error).toContain("Prompting wing");
});

// -- M5: server-side stream coalescing --------------------------------------

test("M5: a thousand tiny chunks inside the coalescing window reach the client as a few text events, concatenating to the exact text", async () => {
  const { post, chatId, version } = await readyScene();
  const pieces = Array.from({ length: 1000 }, (_, i) => String(i % 10));
  const full = pieces.join("");
  const burst = Bun.serve({
    port: 0,
    async fetch(req) {
      await req.json();
      const chunk = (o: unknown) => `data: ${JSON.stringify(o)}\n\n`;
      let body = pieces.map((p) => chunk({ choices: [{ delta: { content: p } }] })).join("");
      body += chunk({ choices: [{ delta: {}, finish_reason: "stop" }], model: "burst-model" });
      body += chunk({ choices: [], usage: { prompt_tokens: 1, completion_tokens: pieces.length } });
      body += "data: [DONE]\n\n";
      return new Response(body, { headers: { "content-type": "text/event-stream" } });
    },
  });
  const burstId = (await saveProvider({ kind: "local", model: "burst", baseURL: `http://127.0.0.1:${burst.port}/v1`, name: "Burst" }, UNLOCK)).id!;
  await post("/api/chats/connection", { chatId, connection: { id: burstId, model: "burst" } });
  const seen = await events(await post("/api/chats/turn", { chatId, kind: "reply", expectedVersion: version }));
  burst.stop(true);
  const textEvents = seen.filter((e) => e.type === "text") as unknown as { delta: string }[];
  // Pre-M5 this is 1,000 (one SSE frame per provider chunk): that is the red this test caught.
  expect(textEvents.length).toBeGreaterThan(0);
  expect(textEvents.length).toBeLessThan(50);
  expect(textEvents.map((e) => e.delta).join("")).toBe(full);
  expect(seen.at(-1)!.type).toBe("done");
});

test("M5: stopping mid-stream flushes whatever text had already arrived, never dropping or reordering it", async () => {
  const { post, handler, chatId, version } = await readyScene();
  let resolveBurst!: () => void;
  const burstReady = new Promise<void>((resolve) => { resolveBurst = resolve; });
  const burst = Bun.serve({
    port: 0,
    async fetch(req) {
      await req.json();
      const chunk = (o: unknown) => `data: ${JSON.stringify(o)}\n\n`;
      const stream = new ReadableStream({
        // All 20 chunks enqueue with no delay between them (no per-chunk sleep: Windows' timer
        // granularity, ~15 ms, would make a 1 ms sleep race the test's own Stop timer). Then the
        // stream stalls open until the client stops it, so the test controls exactly when Stop
        // lands relative to the (already-arrived) text, not the other way around.
        async start(c) {
          const enc = new TextEncoder();
          for (let i = 0; i < 20; i++) c.enqueue(enc.encode(chunk({ choices: [{ delta: { content: "x" } }] })));
          resolveBurst();
          await new Promise(() => {});
        },
      });
      return new Response(stream, { headers: { "content-type": "text/event-stream" } });
    },
  });
  const burstId = (await saveProvider({ kind: "local", model: "burst-stop", baseURL: `http://127.0.0.1:${burst.port}/v1`, name: "Burst Stop" }, UNLOCK)).id!;
  await post("/api/chats/connection", { chatId, connection: { id: burstId, model: "burst-stop" } });
  const res = await post("/api/chats/turn", { chatId, kind: "reply", expectedVersion: version });
  let turnId = "";
  const seenPromise = readEvents(res, (e) => {
    if (e.type === "start" && !turnId) {
      turnId = e["turnId"] as string;
    }
  });
  await burstReady;
  // Start the stop window only after the upstream response has enqueued its whole burst; prompt hooks
  // may take time before the provider request begins, so the turn's `start` event is not that boundary.
  await new Promise((resolve) => setTimeout(resolve, 5));
  void post("/api/chats/stop", { chatId, turnId });
  const seen = await seenPromise;
  burst.stop(true);
  expect(seen.at(-1)!.type).toBe("stopped");
  const combined = seen.filter((e) => e.type === "text").map((e) => (e as unknown as { delta: string }).delta).join("");
  expect(combined.length).toBeGreaterThan(0);
  expect(combined).toBe("x".repeat(combined.length));
  const open = (await (await handler(apiReq(`/api/chats/open?id=${chatId}`))).json()) as { messages: { swipes: { content: string; generation?: Record<string, unknown> }[] }[] };
  const reply = open.messages.at(-1)!.swipes[0]!;
  expect(reply.generation?.["finishReason"]).toBe("stopped");
  // The saved message is the source of truth; the client's coalesced "text" frames must match it
  // exactly, or Stop would have dropped or reordered text on its way to the transcript.
  expect(reply.content).toBe(combined);
});

test("M5: a mid-stream failure flushes pending text before the failed event; the draft matches what the client saw", async () => {
  const { post, chatId, version } = await readyScene();
  const flaky = Bun.serve({
    port: 0,
    async fetch(req) {
      await req.json();
      const chunk = (o: unknown) => `data: ${JSON.stringify(o)}\n\n`;
      const stream = new ReadableStream({
        async start(c) {
          const enc = new TextEncoder();
          for (const w of ["Sto", "rm ", "warn", "ing"]) {
            c.enqueue(enc.encode(chunk({ choices: [{ delta: { content: w } }] })));
            await Bun.sleep(1);
          }
          // Closed with no finish_reason and no [DONE]: a genuine mid-stream failure, not a stop.
          c.close();
        },
      });
      return new Response(stream, { headers: { "content-type": "text/event-stream" } });
    },
  });
  const flakyId = (await saveProvider({ kind: "local", model: "flaky", baseURL: `http://127.0.0.1:${flaky.port}/v1`, name: "Flaky" }, UNLOCK)).id!;
  await post("/api/chats/connection", { chatId, connection: { id: flakyId, model: "flaky" } });
  const seen = await events(await post("/api/chats/turn", { chatId, kind: "reply", expectedVersion: version }));
  flaky.stop(true);
  const failed = seen.find((e) => e.type === "failed") as { draft: string } | undefined;
  expect(failed).toBeDefined();
  const combined = seen.filter((e) => e.type === "text").map((e) => (e as unknown as { delta: string }).delta).join("");
  expect(combined).toBe("Storm warning");
  expect(combined).toBe(failed!.draft);
});

test("S5: a thousand tiny reasoning chunks are batched like text, arrive before the reply text, and are timed onto the reply", async () => {
  const { post, chatId, version } = await readyScene();
  const pieces = Array.from({ length: 1000 }, (_, i) => String(i % 10));
  const thinker = Bun.serve({
    port: 0,
    async fetch(req) {
      await req.json();
      const chunk = (o: unknown) => `data: ${JSON.stringify(o)}\n\n`;
      let body = pieces.map((p) => chunk({ choices: [{ delta: { reasoning_content: p } }] })).join("");
      body += chunk({ choices: [{ delta: { content: "Hello." }, finish_reason: "stop" }], model: "thinker-model" });
      body += chunk({ choices: [], usage: { prompt_tokens: 1, completion_tokens: 2 } });
      body += "data: [DONE]\n\n";
      return new Response(body, { headers: { "content-type": "text/event-stream" } });
    },
  });
  const id = (await saveProvider({ kind: "local", model: "thinker", baseURL: `http://127.0.0.1:${thinker.port}/v1`, name: "Thinker" }, UNLOCK)).id!;
  await post("/api/chats/connection", { chatId, connection: { id, model: "thinker" } });
  const seen = await events(await post("/api/chats/turn", { chatId, kind: "reply", expectedVersion: version }));
  thinker.stop(true);
  const thoughts = seen.filter((e) => e.type === "reasoning") as unknown as { delta: string }[];
  expect(thoughts.length).toBeGreaterThan(0);
  expect(thoughts.length).toBeLessThan(50);
  expect(thoughts.map((e) => e.delta).join("")).toBe(pieces.join(""));
  expect(seen.map((e) => e.type).lastIndexOf("reasoning")).toBeLessThan(seen.map((e) => e.type).indexOf("text"));
  const done = seen.at(-1) as unknown as { type: string; message: { swipes: { generation: { reasoning: { text: string } } }[] } };
  expect(done.type).toBe("done");
  expect(done.message.swipes[0]!.generation.reasoning.text).toBe(pieces.join(""));
});

test("a scene keeps its backdrop: the pick is answered and kept, null forgets it, a bad pick is a 400, an unknown scene a 404", async () => {
  const { post, chatId } = await readyScene();
  expect((await post("/api/chats/backdrop", { chatId, backdrop: { pack: "st" } })).status).toBe(400);
  const picked = (await (await post("/api/chats/backdrop", { chatId, backdrop: { pack: "st", item: "sp_1", dim: 0.4 } })).json()) as { backdrop: unknown };
  expect(picked.backdrop).toEqual({ pack: "st", item: "sp_1", dim: 0.4 });
  expect("backdrop" in ((await (await post("/api/chats/backdrop", { chatId, backdrop: null })).json()) as object)).toBe(false);
  expect((await post("/api/chats/backdrop", { chatId: "nope", backdrop: null })).status).toBe(404);
});

test("the Prompt Inspector: a reviewed turn holds the request over HTTP until the page answers, and Send goes on as that turn", async () => {
  const { post, handler, chatId, version } = await readyScene();
  await post("/api/chats/connection", { chatId, connection: { id: localId, model: "qwen3" } });
  const before = asked.length;
  const res = await post("/api/chats/turn", { chatId, kind: "reply", expectedVersion: version, inspect: true });
  const seen = await readEvents(res, (e) => {
    if (e.type === "review") void post("/api/chats/review", { chatId, turnId: e["turnId"], kind: "send", edits: { "1": "Any storms tonight?" } });
  });
  expect(seen.map((e) => e.type)).toEqual(["start", "review", "text", "done"]);
  expect(asked.length).toBe(before + 1);
  expect(asked.at(-1)!.messages.map((m) => m.content)).toEqual(["Hello User.", "Any storms tonight?"]);
  const open = (await (await handler(apiReq(`/api/chats/open?id=${chatId}`))).json()) as { messages: unknown[] };
  expect(open.messages).toHaveLength(3);
});

test("the Prompt Inspector: Cancel over HTTP ends the turn with nothing sent and nothing kept; a malformed answer is refused", async () => {
  const { post, handler, chatId, version } = await readyScene();
  await post("/api/chats/connection", { chatId, connection: { id: localId, model: "qwen3" } });
  const before = asked.length;
  const res = await post("/api/chats/turn", { chatId, kind: "reply", expectedVersion: version, inspect: true });
  const seen = await readEvents(res, (e) => {
    if (e.type !== "review") return;
    void (async () => {
      expect((await post("/api/chats/review", { chatId, turnId: e["turnId"], kind: "send", edits: { x: 1 } })).status).toBe(400);
      expect((await post("/api/chats/review", { chatId, turnId: e["turnId"], kind: "maybe" })).status).toBe(400);
      await post("/api/chats/review", { chatId, turnId: e["turnId"], kind: "cancel" });
    })();
  });
  expect(seen.map((e) => e.type)).toEqual(["start", "review", "stopped"]);
  expect(asked.length).toBe(before);
  const open = (await (await handler(apiReq(`/api/chats/open?id=${chatId}`))).json()) as { messages: unknown[] };
  expect(open.messages).toHaveLength(2);
  expect((await post("/api/chats/turn", { chatId, kind: "reply", expectedVersion: version, inspect: "yes" })).status).toBe(400);
});

test("a scene's prompt regex reaches the live route: the turn holds for the page, and what the page answers is what the connection is sent", async () => {
  const { post, store, chatId, version } = await readyScene();
  await store.save({ schemaVersion: CANONICAL_SCHEMA_VERSION, kind: "regex", id: "scrub", body: { name: "Scrub", rules: [{ id: "r", label: "r", find: "storms", flags: "g", replace: "weather", phases: ["prompt"], enabled: true, sortOrder: 0 }] } } as never);
  await post("/api/chats/connection", { chatId, connection: { id: localId, model: "qwen3" } });
  expect((await post("/api/chats/regex", { chatId, regex: { sets: ["scrub"] } })).status).toBe(200);
  const res = await post("/api/chats/turn", { chatId, kind: "reply", expectedVersion: version });
  const seen = await readEvents(res, (e) => {
    if (e.type !== "regex") return;
    const items = e["items"] as { index: number; text: string }[];
    void post("/api/chats/regex-answer", { chatId, turnId: e["turnId"], kind: "done", texts: Object.fromEntries(items.map((i) => [i.index, i.text.replace("storms", "weather")])) });
  });
  expect(seen.map((e) => e.type)).toContain("regex");
  expect(asked.at(-1)!.messages.map((m) => m.content)).toEqual(["Hello User.", "Any weather?"]);
});
