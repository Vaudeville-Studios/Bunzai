/**
 * `GET /api/chats/trace`. Most cases drive `handleTraceRoute`
 * directly over a memory ChatStore with hand-committed traces, the same shape `traceOf`
 * (scene-turn.ts) stores: deterministic and exhaustive over every miss reason, without needing the
 * lore engine's rng or a real streamed reply. One test at the end goes through the real HTTP route
 * (modeled on server-chats-lore.test.ts) to prove the wiring.
 */
import { afterAll, afterEach, beforeAll, expect, setDefaultTimeout, test } from "bun:test";
import { useTestBunzaiHome } from "../../scripts/test-home";
import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CANONICAL_SCHEMA_VERSION } from "../core/canonical";
import { sheetAsPreset } from "../core/preset/script-sheet";
import { emptyLoreEntry, emptyLorebookBody } from "../core/lore/empty-book";
import type { LorebookEntry } from "../entities/lorebook/schema";
import { emptyPresetBody } from "../entities/preset/schema";
import { saveProvider } from "../kit/providers/vault";
import { memoryChatStore } from "../stage/store/chat-store";
import type { ChatStore, JsonObject } from "../stage/contracts/chat-store";
import type { ReadLorebook } from "../studio/scene-lore";
import { handleTraceRoute } from "./server-chats-trace";
import { chatRouteRig as rig, cleanupChatRouteRigs } from "./fake-server-chats-rig";
import { apiReq } from "./server-test-rig";
import type { SceneTrace } from "./app-contract-scenes";

afterEach(cleanupChatRouteRigs);

// --- direct-route harness: a memory ChatStore, no HTTP, no provider, no rng ---

const CHAR = {
  kind: "character",
  id: "vera",
  body: { identity: { name: "Vera" }, persona: {}, prompts: {}, greetings: {}, examples: {}, media: {}, attribution: {}, discovery: {}, knowledgeRefs: ["b1"] },
};

const entry = (id: string, over: Partial<LorebookEntry> = {}): LorebookEntry => ({ ...emptyLoreEntry(id), title: `Entry ${id}`, ...over });

async function bookStore(entries: LorebookEntry[], bodyOver: Record<string, unknown> = {}) {
  const book = { id: "b1", name: "The Book", body: { ...emptyLorebookBody("The Book"), ...bodyOver, entries } };
  const readLorebook: ReadLorebook = async (id) => (id === "b1" ? book : null);
  return readLorebook;
}

async function readyChat(readLorebook: ReadLorebook) {
  const chats = memoryChatStore();
  const chat = await chats.createChat({ title: "Night", cast: { character: { id: "vera", version: 1 } }, snapshot: { character: CHAR } });
  return { chats, chat, readLorebook };
}

/** Appends a plain message (no trace): the greeting, or a prior exchange. */
async function say(chats: ChatStore, branchId: string, role: "assistant" | "user", content: string) {
  return (await chats.appendMessage(branchId, { role, content }))!;
}

/** Begins and commits a reply with a hand-built trace, exactly traceOf's shape (scene-turn.ts). */
async function commitReply(chats: ChatStore, branchId: string, content: string, trace: JsonObject, texts?: string[]) {
  const turn = await chats.beginTurn(branchId, { kind: "reply" });
  return (await chats.commitTurn(turn!.id, { content, trace, ...(texts ? { request: { texts } } : {}) }))!;
}

const baseTrace = (over: Partial<JsonObject> = {}): JsonObject => ({
  estimate: { mid: 100, bound: 120, samples: 1 },
  budget: { budgeter: "app", trimmed: [], finalPassDropped: 0 },
  request: { model: "vera-1-routed", stream: true },
  window: { context: 8_000, reply: 1_000, stated: true },
  blocks: [],
  ...over,
});

async function traceUrl(chatId: string, messageId?: string) {
  return new URL(`http://local/api/chats/trace?chatId=${chatId}${messageId ? `&messageId=${messageId}` : ""}`);
}

test("no reply yet answers null, and an unknown message answers 404", async () => {
  const { chats, chat, readLorebook } = await readyChat(await bookStore([]));
  await say(chats, chat.activeBranchId, "assistant", "Evening.");
  const noReply = await handleTraceRoute(await traceUrl(chat.id), chats, readLorebook);
  expect(noReply.status).toBe(200);
  expect(await noReply.json()).toBeNull();

  const unknown = await handleTraceRoute(await traceUrl(chat.id, "nope"), chats, readLorebook);
  expect(unknown.status).toBe(404);

  const user = await say(chats, chat.activeBranchId, "user", "Hi");
  const notAssistant = await handleTraceRoute(await traceUrl(chat.id, user.id), chats, readLorebook);
  expect(notAssistant.status).toBe(404);

  const unknownChat = await handleTraceRoute(await traceUrl("nope"), chats, readLorebook);
  expect(unknownChat.status).toBe(404);
});

test("blocks are labeled and categorized; the greeting alone (no trace) is still 'no reply'", async () => {
  const { chats, chat, readLorebook } = await readyChat(await bookStore([]));
  const greeting = await say(chats, chat.activeBranchId, "assistant", "Evening.");
  const stillNull = await handleTraceRoute(await traceUrl(chat.id), chats, readLorebook);
  expect(await stillNull.json()).toBeNull();

  const user1 = await say(chats, chat.activeBranchId, "user", "Hi");
  const reply1 = await say(chats, chat.activeBranchId, "assistant", "Hello.");
  const user2 = await say(chats, chat.activeBranchId, "user", "Any storms?");
  const trace = baseTrace({
    blocks: [
      { source: { kind: "prompt", name: "Main Prompt", id: "main" }, role: "system", tokens: 10 },
      { source: { kind: "prompt", name: "Character Description", id: "charDescription" }, role: "system", tokens: 20 },
      { source: { kind: "prompt", name: "Persona", id: "personaDescription" }, role: "system", tokens: 5 },
      { source: { kind: "prompt", name: "World Info", id: "worldInfoBefore" }, role: "system", tokens: 5 },
      { source: { kind: "greeting", messageId: greeting.id }, role: "assistant", tokens: 3 },
      { source: { kind: "history", messageId: user1.id }, role: "user", tokens: 2 },
      { source: { kind: "history", messageId: reply1.id }, role: "assistant", tokens: 2 },
      { source: { kind: "depth", depth: 4 }, role: "system", tokens: 6 },
      { source: { kind: "note" }, role: "system", tokens: 3 },
      { source: { kind: "current", messageId: user2.id }, role: "user", tokens: 4 },
      { source: { kind: "guide" }, role: "system", tokens: 2 },
    ],
  });
  const final = await commitReply(chats, chat.activeBranchId, "It might.", trace, [
    "main", "desc", "persona", "world", "greeting", "u1", "r1", "depth note", "note", "current", "guide",
  ]);

  const res = await handleTraceRoute(await traceUrl(chat.id), chats, readLorebook);
  expect(res.status).toBe(200);
  const body = (await res.json()) as SceneTrace;
  expect(body.reply).toEqual({ messageId: final.id, swipeId: final.swipes[0]!.id, number: 5, model: "vera-1-routed", take: "Director's Cut" });
  expect(body.blocks.map((b) => [b.kind, b.label, b.category])).toEqual([
    ["prompt", "Main Prompt", "preset"],
    ["prompt", "Character Description", "character"],
    ["prompt", "Persona", "persona"],
    ["prompt", "World Info", "lore"],
    ["greeting", "Greeting", "history"],
    ["history", "Message 2", "history"],
    ["history", "Message 3", "history"],
    ["depth", "Depth note (4)", "character"],
    ["note", "Scene note", "other"],
    ["current", "Message 4", "current"],
    ["guide", "Guide", "other"],
  ]);
  // The latest reply: raw text is available and lines up with the blocks.
  expect(body.rawAvailable).toBe(true);
  expect(body.blocks.map((b) => b.text)).toEqual(["main", "desc", "persona", "world", "greeting", "u1", "r1", "depth note", "note", "current", "guide"]);
  expect(body.replies.map((r) => r.number)).toEqual([5, 3, 1]);
});

test("raw text is kept for the take's latest reply only; an older reply answers rawAvailable: false", async () => {
  const { chats, chat, readLorebook } = await readyChat(await bookStore([]));
  await say(chats, chat.activeBranchId, "assistant", "Evening.");
  await say(chats, chat.activeBranchId, "user", "Hi");
  const first = await commitReply(chats, chat.activeBranchId, "First.", baseTrace({ blocks: [{ source: { kind: "current", messageId: "x" }, role: "user", tokens: 1 }] }), ["one"]);
  await say(chats, chat.activeBranchId, "user", "Again?");
  await commitReply(chats, chat.activeBranchId, "Second.", baseTrace({ blocks: [{ source: { kind: "current", messageId: "y" }, role: "user", tokens: 1 }] }), ["two"]);

  const older = (await (await handleTraceRoute(await traceUrl(chat.id, first.id), chats, readLorebook)).json()) as SceneTrace;
  expect(older.rawAvailable).toBe(false);
  expect(older.blocks[0]!.text).toBeUndefined();

  const latest = (await (await handleTraceRoute(await traceUrl(chat.id), chats, readLorebook)).json()) as SceneTrace;
  expect(latest.rawAvailable).toBe(true);
  expect(latest.blocks[0]!.text).toBe("two");
  // Newest first; the greeting is a plain assistant message too, so it is the oldest "reply".
  expect(latest.replies.map((r) => r.number)).toEqual([5, 3, 1]);
});

test("missed explains cooldown, chance, and budget wording, and excludes the routine reasons", async () => {
  const readLorebook = await bookStore([
    entry("fired", { title: "Fired" }),
    entry("cooling", { title: "Cooling" }),
    entry("gambled", { title: "Gambled" }),
    entry("overbudget", { title: "Over budget" }),
    entry("nomatch", { title: "No match" }),
    entry("off", { title: "Off" }),
    entry("bare", { title: "Bare" }),
  ]);
  const { chats, chat } = await readyChat(readLorebook);
  await say(chats, chat.activeBranchId, "assistant", "Evening.");
  await say(chats, chat.activeBranchId, "user", "Hi");
  const trace = baseTrace({
    lore: {
      fires: [],
      injected: [{ entryKey: "b1:fired", bookId: "b1", entryId: "fired", title: "Fired", reason: "constant", matched: [], tokens: 5, position: { kind: "world" } }],
      cut: [],
      totalTokens: 5,
      seed: 1,
      verdicts: [
        { entryKey: "b1:fired", fired: true, reason: "constant", matched: [], loop: 0, tokens: 5 },
        { entryKey: "b1:cooling", fired: false, reason: "cooldown", matched: [], loop: 0, tokens: 5, detail: { remaining: 1 } },
        { entryKey: "b1:gambled", fired: false, reason: "chance", matched: [], loop: 0, tokens: 5, detail: { rolled: 71, needed: 50 } },
        { entryKey: "b1:overbudget", fired: false, reason: "budget-cut", matched: ["wreck"], loop: 0, tokens: 200, detail: { cost: 200, left: 90 } },
        { entryKey: "b1:nomatch", fired: false, reason: "no-key-match", matched: [], loop: 0, tokens: 5 },
        { entryKey: "b1:off", fired: false, reason: "disabled", matched: [], loop: 0, tokens: 5 },
        { entryKey: "b1:bare", fired: false, reason: "empty-keys", matched: [], loop: 0, tokens: 5 },
      ],
    },
  });
  await commitReply(chats, chat.activeBranchId, "Reply.", trace);
  const body = (await (await handleTraceRoute(await traceUrl(chat.id), chats, readLorebook)).json()) as SceneTrace;
  const byId = new Map(body.lore!.missed.map((m) => [m.entryId, m]));
  expect([...byId.keys()].sort()).toEqual(["cooling", "gambled", "overbudget"]);
  expect(byId.get("cooling")).toMatchObject({ title: "Cooling", why: "cooling down: 1 turn left" });
  expect(byId.get("gambled")).toMatchObject({ title: "Gambled", why: "chance: rolled 71, needed 50" });
  expect(byId.get("overbudget")).toMatchObject({ title: "Over budget", why: 'matched "wreck", over budget: 200 tok, 90 left' });
  expect(body.lore!.injected).toEqual([expect.objectContaining({ entryId: "fired", title: "Fired", place: "World", loop: 0 })]);
});

test("chains: only edges where both ends fired and the target fired by recursion", async () => {
  const wakerA = entry("waker", { constant: true, content: "the SECRETWORD glows", title: "Waker" });
  const wokenB = entry("woken", { title: "Woken", triggers: [{ keyword: "SECRETWORD", isRegex: false }] });
  const neverFiredC = entry("silent", { title: "Silent", triggers: [{ keyword: "SECRETWORD", isRegex: false }] });
  const readLorebook = await bookStore([wakerA, wokenB, neverFiredC], { globalRecursion: true });
  const { chats, chat } = await readyChat(readLorebook);
  await say(chats, chat.activeBranchId, "assistant", "Evening.");
  await say(chats, chat.activeBranchId, "user", "Hi");
  const hit = (entryId: string, title: string, reason: string) => ({ entryKey: `b1:${entryId}`, bookId: "b1", entryId, title, reason, matched: [], tokens: 1, position: { kind: "world" } });
  const trace = baseTrace({
    lore: {
      fires: [],
      injected: [hit("waker", "Waker", "constant"), hit("woken", "Woken", "recursion")],
      cut: [],
      totalTokens: 2,
      seed: 1,
      verdicts: [
        { entryKey: "b1:waker", fired: true, reason: "constant", matched: [], loop: 0, tokens: 1 },
        { entryKey: "b1:woken", fired: true, reason: "recursion", matched: [], loop: 1, tokens: 1 },
        { entryKey: "b1:silent", fired: false, reason: "no-key-match", matched: [], loop: 0, tokens: 1 },
      ],
    },
  });
  await commitReply(chats, chat.activeBranchId, "Reply.", trace);
  const body = (await (await handleTraceRoute(await traceUrl(chat.id), chats, readLorebook)).json()) as SceneTrace;
  expect(body.lore!.chains).toEqual([{ from: "Waker", to: "Woken", keyword: "SECRETWORD" }]);
});

// th-t4-gaps 1/2: a fired verdict's own detail (already additive in engine.ts) reaches the hit as
// `roll` (a real chance roll that passed) and `stickyLeft` (a fired sticky entry's countdown).
test("roll and stickyLeft reach the hit from the fired verdict's detail", async () => {
  const readLorebook = await bookStore([entry("gambled", { title: "Gambled" }), entry("clingy", { title: "Clingy" })]);
  const { chats, chat } = await readyChat(readLorebook);
  await say(chats, chat.activeBranchId, "assistant", "Evening.");
  await say(chats, chat.activeBranchId, "user", "Hi");
  const hit = (entryId: string, title: string, reason: string) => ({ entryKey: `b1:${entryId}`, bookId: "b1", entryId, title, reason, matched: [], tokens: 1, position: { kind: "world" } });
  const trace = baseTrace({
    lore: {
      fires: [],
      injected: [hit("gambled", "Gambled", "key"), hit("clingy", "Clingy", "sticky")],
      cut: [],
      totalTokens: 2,
      seed: 1,
      verdicts: [
        { entryKey: "b1:gambled", fired: true, reason: "key", matched: ["dice"], loop: 0, tokens: 1, detail: { rolled: 34, needed: 60 } },
        { entryKey: "b1:clingy", fired: true, reason: "sticky", matched: [], loop: 0, tokens: 1, detail: { remaining: 2 } },
      ],
    },
  });
  await commitReply(chats, chat.activeBranchId, "Reply.", trace);
  const body = (await (await handleTraceRoute(await traceUrl(chat.id), chats, readLorebook)).json()) as SceneTrace;
  const byId = new Map(body.lore!.injected.map((h) => [h.entryId, h]));
  expect(byId.get("gambled")).toMatchObject({ roll: { rolled: 34, needed: 60 } });
  expect(byId.get("gambled")!.stickyLeft).toBeUndefined();
  expect(byId.get("clingy")).toMatchObject({ stickyLeft: 2 });
  expect(byId.get("clingy")!.roll).toBeUndefined();
});

// th-t4-gaps 3: the take name matches the scene's own take pill (scene-page.tsx): the original branch
// is always "Director's Cut" regardless of its stored name; a fork uses its own name.
test("reply.take names the active branch: Director's Cut for the original, the branch's own name for a fork", async () => {
  const { chats, chat, readLorebook } = await readyChat(await bookStore([]));
  await say(chats, chat.activeBranchId, "assistant", "Evening.");
  const user1 = await say(chats, chat.activeBranchId, "user", "Hi");
  await commitReply(chats, chat.activeBranchId, "Original reply.", baseTrace());
  const original = (await (await handleTraceRoute(await traceUrl(chat.id), chats, readLorebook)).json()) as SceneTrace;
  expect(original.reply.take).toBe("Director's Cut");

  const fork = await chats.fork(chat.activeBranchId, user1.id, { name: "Chapter Two" });
  await chats.setActiveBranch(chat.id, fork!.id);
  await commitReply(chats, fork!.id, "Forked reply.", baseTrace());
  const forked = (await (await handleTraceRoute(await traceUrl(chat.id), chats, readLorebook)).json()) as SceneTrace;
  expect(forked.reply.take).toBe("Chapter Two");
});

// th-t4-gaps 4: presetName is read from the library preset through the same reader the turn route
// already builds; absent both when the scene has no preset and when the caller gives no reader.
test("presetName comes from the scene's own preset through readPreset; absent without either", async () => {
  const { chats, chat, readLorebook } = await readyChat(await bookStore([]));
  await say(chats, chat.activeBranchId, "assistant", "Evening.");
  await commitReply(chats, chat.activeBranchId, "Reply.", baseTrace());
  const readPreset = async (id: string) => (id === "p1" ? emptyPresetBody("Velvet Quill") : null);

  const noPreset = (await (await handleTraceRoute(await traceUrl(chat.id), chats, readLorebook, readPreset)).json()) as SceneTrace;
  expect(noPreset.presetName).toBeUndefined();

  await chats.setPreset(chat.id, { kind: "preset", id: "p1", toggles: {}, samplers: {} });
  const withReader = (await (await handleTraceRoute(await traceUrl(chat.id), chats, readLorebook, readPreset)).json()) as SceneTrace;
  expect(withReader.presetName).toBe("Velvet Quill");

  const withoutReader = (await (await handleTraceRoute(await traceUrl(chat.id), chats, readLorebook)).json()) as SceneTrace;
  expect(withoutReader.presetName).toBeUndefined();
});

test("an old trace without verdicts still answers, with missed: []", async () => {
  const readLorebook = await bookStore([entry("e1", { title: "Old Entry" })]);
  const { chats, chat } = await readyChat(readLorebook);
  await say(chats, chat.activeBranchId, "assistant", "Evening.");
  await say(chats, chat.activeBranchId, "user", "Hi");
  // Pre-th-t3 shape: injected/cut with no `position`, no `verdicts` at all.
  const trace = baseTrace({
    lore: {
      fires: [],
      injected: [{ entryKey: "b1:e1", bookId: "b1", entryId: "e1", title: "Old Entry", reason: "constant", matched: [], tokens: 4 }],
      cut: [],
      totalTokens: 4,
      seed: 1,
    },
  });
  await commitReply(chats, chat.activeBranchId, "Reply.", trace);
  const body = (await (await handleTraceRoute(await traceUrl(chat.id), chats, readLorebook)).json()) as SceneTrace;
  expect(body.lore!.missed).toEqual([]);
  // No stored position: falls back to the entry's current position (world, per empty-book default).
  expect(body.lore!.injected[0]).toMatchObject({ entryId: "e1", place: "World", loop: 0 });
});

// --- wired-into-the-server integration check (one test, modeled on server-chats-lore.test.ts) ---

setDefaultTimeout(30_000);
const HOME = join(tmpdir(), `bunzai-trace-route-${randomUUID()}`);
const UNLOCK = { passphrase: "trace-route-test" };
let restoreBunzaiHome: (() => void) | undefined;
let server: ReturnType<typeof Bun.serve>;
let localId = "";

beforeAll(async () => {
  restoreBunzaiHome = useTestBunzaiHome(HOME);
  server = Bun.serve({
    port: 0,
    async fetch() {
      const chunk = (o: unknown) => `data: ${JSON.stringify(o)}\n\n`;
      const body = chunk({ choices: [{ delta: { content: "Calm." }, finish_reason: "stop" }] }) + "data: [DONE]\n\n";
      return new Response(body, { headers: { "content-type": "text/event-stream" } });
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

test("the real server answers a real turn's trace at GET /api/chats/trace", async () => {
  const { store, handler, post } = await rig();
  await store.save({ schemaVersion: CANONICAL_SCHEMA_VERSION, kind: "character", id: "vera", body: { identity: { name: "Vera" }, persona: {}, prompts: {}, greetings: { firstMessage: "Evening." }, examples: {}, media: {}, attribution: {}, discovery: {} } });
  const chat = (await (await post("/api/chats/start", { characterId: "vera" })).json()) as { id: string };
  const preset = sheetAsPreset({ name: "Attached", content: "Use the attached note." });
  preset.prompts[0]!.attachments = [{ name: "notes.txt", ref: "data:text/plain;base64,SGVsbG8gZnJvbSB0cmFjZS4=" }];
  await store.save({ schemaVersion: CANONICAL_SCHEMA_VERSION, kind: "preset", id: "attached", body: preset });
  await post("/api/chats/preset", { chatId: chat.id, preset: { kind: "preset", id: "attached", toggles: {}, samplers: {} } });
  const sent = (await (await post("/api/chats/send", { chatId: chat.id, content: "Any storms?", greetingIndex: 0, expectedVersion: 1 })).json()) as { branchVersion: number };
  await post("/api/chats/connection", { chatId: chat.id, connection: { id: localId, model: "qwen3" } });
  await (await post("/api/chats/turn", { chatId: chat.id, kind: "reply", expectedVersion: sent.branchVersion })).text();
  const res = await handler(apiReq(`/api/chats/trace?chatId=${chat.id}`));
  expect(res.status).toBe(200);
  const body = (await res.json()) as SceneTrace;
  expect(body.reply.model).toBe("qwen3");
  expect(body.blocks.length).toBeGreaterThan(0);
  expect(body.rawAvailable).toBe(true);
  expect(body.files?.map((file) => [file.name, file.kind])).toEqual([["notes.txt", "text"]]);
  expect(body.blocks.some((block) => block.text?.includes("[Attached text: notes.txt]") && block.text.includes("Hello from trace."))).toBe(true);
});

test("a guided re-roll's two added messages are labelled rows, with their text when it is the latest reply", async () => {
  const { chats, chat, readLorebook } = await readyChat(await bookStore([]));
  await say(chats, chat.activeBranchId, "user", "Hi");
  const trace = baseTrace({
    blocks: [
      { source: { kind: "guided-draft" }, role: "assistant", tokens: 4 },
      { source: { kind: "guided-directive" }, role: "system", tokens: 90 },
    ],
  });
  const reply = await commitReply(chats, chat.activeBranchId, "Colder.", trace, ["[REJECTED DRAFT - NOT PART OF THE STORY]\nMaybe.", "<<<MANDATORY GUIDED SWIPE DIRECTIVE>>>"]);
  const view = (await (await handleTraceRoute(await traceUrl(chat.id, reply.id), chats, readLorebook)).json()) as SceneTrace;
  expect(view.blocks.map((b) => [b.label, b.role, b.text?.slice(0, 10)])).toEqual([
    ["Guided re-roll: rejected draft", "assistant", "[REJECTED "],
    ["Guided re-roll: directive", "system", "<<<MANDATO"],
  ]);
});

test("a reply's recall: its block reads as Lore named 'Recalled knowledge', and its section lists what was placed and cut with the selector's reasons, books named from the scene now", async () => {
  const { chats, chat, readLorebook } = await readyChat(await bookStore([entry("e1", { title: "Mira" })]));
  await say(chats, chat.activeBranchId, "assistant", "Evening.");
  const user = await say(chats, chat.activeBranchId, "user", "Any storms?");
  const trace = baseTrace({
    blocks: [{ source: { kind: "recall" }, role: "system", tokens: 12 }, { source: { kind: "current", messageId: user.id }, role: "user", tokens: 4 }],
    recall: {
      status: "recalled", model: "vera-1", calls: 1, cached: false,
      selected: [{ entryKey: "b1:e1", title: "Mira", reason: "She is in the scene" }, { entryKey: "b1:e2", title: "Harbor", reason: "Where it happens" }],
      unknown: 0, repeated: 0, trimmed: 0, omitted: 0,
      injected: [{ entryKey: "b1:e1", title: "Mira", tokens: 9 }], cut: [{ entryKey: "b1:e2", title: "Harbor", tokens: 400 }], alreadyPlaced: [],
    },
  });
  const reply = await commitReply(chats, chat.activeBranchId, "Soon.", trace, ["recalled text", "current"]);
  const body = (await (await handleTraceRoute(await traceUrl(chat.id), chats, readLorebook)).json()) as SceneTrace;
  expect(body.blocks.map((b) => [b.kind, b.label, b.category])).toEqual([["recall", "Recalled knowledge", "lore"], ["current", "Message 2", "current"]]);
  expect(body.recall).toEqual({
    status: "recalled", model: "vera-1", calls: 1, cached: false, alreadyPlaced: 0, at: reply.swipes[reply.current]!.createdAt,
    injected: [{ bookId: "b1", entryId: "e1", bookName: "The Book", title: "Mira", tokens: 9, reason: "She is in the scene" }],
    cut: [{ bookId: "b1", entryId: "e2", bookName: "The Book", title: "Harbor", tokens: 400, reason: "Where it happens" }],
  });
  expect(body.lore).toBeNull();
});

test("a reply with no recall section answers recall null", async () => {
  const { chats, chat, readLorebook } = await readyChat(await bookStore([]));
  await say(chats, chat.activeBranchId, "assistant", "Evening.");
  await say(chats, chat.activeBranchId, "user", "Hi");
  await commitReply(chats, chat.activeBranchId, "Hello.", baseTrace());
  const body = (await (await handleTraceRoute(await traceUrl(chat.id), chats, readLorebook)).json()) as SceneTrace;
  expect(body.recall).toBeNull();
});

test("a Historian recap block reads as 'Summary: <title>' in the chat history, and the count of messages it replaced comes back", async () => {
  const { chats, chat, readLorebook } = await readyChat(await bookStore([]));
  const greeting = await say(chats, chat.activeBranchId, "assistant", "Evening.");
  const old1 = await say(chats, chat.activeBranchId, "user", "One.");
  const old2 = await say(chats, chat.activeBranchId, "assistant", "Two.");
  const user = await say(chats, chat.activeBranchId, "user", "Any storms?");
  const trace = baseTrace({
    blocks: [
      { source: { kind: "greeting", messageId: greeting.id }, role: "assistant", tokens: 3 },
      { source: { kind: "summary", entryKey: "b1:r1" }, role: "system", tokens: 9 },
      { source: { kind: "current", messageId: user.id }, role: "user", tokens: 4 },
    ],
    summaries: { dropped: [old1.id, old2.id, "gone-in-a-fork"], injected: [{ entryKey: "b1:r1", title: "Fog night", tokens: 9 }] },
  });
  await commitReply(chats, chat.activeBranchId, "It might.", trace);
  const body = (await (await handleTraceRoute(await traceUrl(chat.id), chats, readLorebook)).json()) as SceneTrace;
  expect(body.blocks.map((b) => [b.kind, b.label, b.category])).toEqual([["greeting", "Greeting", "history"], ["summary", "Summary: Fog night", "history"], ["current", "Message 4", "current"]]);
  // The greeting is Message 1; an id the take no longer has (a fork's copy) has no number and is left out.
  expect(body.summarized).toEqual([2, 3]);
});

test("a reply with no recaps carries no summarized count", async () => {
  const { chats, chat, readLorebook } = await readyChat(await bookStore([]));
  await say(chats, chat.activeBranchId, "assistant", "Evening.");
  await say(chats, chat.activeBranchId, "user", "Hi");
  await commitReply(chats, chat.activeBranchId, "Hello.", baseTrace());
  const body = (await (await handleTraceRoute(await traceUrl(chat.id), chats, readLorebook)).json()) as SceneTrace;
  expect(body.summarized).toBeUndefined();
});

test("a reply's tool calls: the Tokens block reads 'Tool answer', and the tools section lists each call with the entries it returned and the narrator's own model", async () => {
  const { chats, chat, readLorebook } = await readyChat(await bookStore([]));
  await say(chats, chat.activeBranchId, "assistant", "Evening.");
  const user = await say(chats, chat.activeBranchId, "user", "Any storms?");
  const trace = baseTrace({
    blocks: [{ source: { kind: "current", messageId: user.id }, role: "user", tokens: 4 }, { source: { kind: "tool", id: "explore_lorebook" }, role: "tool", tokens: 30 }],
    tools: {
      maxRounds: 8, rounds: 1, defs: ["explore_lorebook"],
      calls: [
        { round: 1, name: "explore_lorebook", args: '{"query":"mira"}', ok: true, ms: 12, chars: 90, tokens: 30, detail: { query: "mira", entries: [{ bookId: "b1", entryId: "e1", bookName: "The Book", title: "Mira", tokens: 9 }] } },
        { round: 1, name: "explore_lorebook", args: "{", ok: false, error: "The arguments were not valid JSON.", ms: 1, chars: 40, tokens: 9 },
      ],
    },
  });
  const reply = await commitReply(chats, chat.activeBranchId, "Soon.", trace, ["current", "The Book: Mira"]);
  const body = (await (await handleTraceRoute(await traceUrl(chat.id), chats, readLorebook)).json()) as SceneTrace;
  expect(body.blocks.map((b) => [b.kind, b.label, b.category])).toEqual([["current", "Message 2", "current"], ["tool", "Tool answer: explore_lorebook", "other"]]);
  expect(body.tools).toEqual({
    at: reply.swipes[reply.current]!.createdAt, model: "vera-1-routed", maxRounds: 8, rounds: 1,
    calls: [
      { round: 1, name: "explore_lorebook", args: '{"query":"mira"}', ok: true, ms: 12, tokens: 30, query: "mira", entries: [{ bookId: "b1", entryId: "e1", bookName: "The Book", title: "Mira", tokens: 9 }] },
      { round: 1, name: "explore_lorebook", args: "{", ok: false, error: "The arguments were not valid JSON.", ms: 1, tokens: 9, entries: [] },
    ],
  });
});

test("a reply with no tool calls answers tools null", async () => {
  const { chats, chat, readLorebook } = await readyChat(await bookStore([]));
  await say(chats, chat.activeBranchId, "assistant", "Evening.");
  await say(chats, chat.activeBranchId, "user", "Hi");
  await commitReply(chats, chat.activeBranchId, "Hello.", baseTrace());
  const body = (await (await handleTraceRoute(await traceUrl(chat.id), chats, readLorebook)).json()) as SceneTrace;
  expect(body.tools).toBeNull();
});

test("the trackers' block reads as its own 'Trackers' line, so the Tokens sheet shows what the tracker Props cost", async () => {
  const { chats, chat, readLorebook } = await readyChat(await bookStore([]));
  await say(chats, chat.activeBranchId, "assistant", "Evening.");
  const user = await say(chats, chat.activeBranchId, "user", "Any storms?");
  const trace = baseTrace({ blocks: [{ source: { kind: "trackers" }, role: "system", tokens: 24 }, { source: { kind: "storyboards" }, role: "system", tokens: 40 }, { source: { kind: "current", messageId: user.id }, role: "user", tokens: 4 }] });
  await commitReply(chats, chat.activeBranchId, "Soon.", trace, ["### Current Game State (Immersion Trackers)", "[COMPENDIUM STORYBOARDS CONTEXT]", "current"]);
  const body = (await (await handleTraceRoute(await traceUrl(chat.id), chats, readLorebook)).json()) as SceneTrace;
  expect(body.blocks.map((b) => [b.kind, b.label, b.category])).toEqual([["trackers", "Trackers", "trackers"], ["storyboards", "Storyboards", "trackers"], ["current", "Message 2", "current"]]);
});
