/**
 * The World wing's Lorebook routes (2e-d4 plan step 5, the contract in app-contract-scenes.ts):
 * `GET /api/chats/lore` answers the books this scene reads from all three sources, `off` and missing
 * included, plus the active take's last reply trace; `POST /api/chats/lore` round-trips the scene's
 * own choice. Modeled on server-chats-turn.test.ts's preset route test.
 */
import { afterAll, afterEach, beforeAll, expect, setDefaultTimeout, test } from "bun:test";
import { useTestBunzaiHome } from "../../scripts/test-home";
import { CANONICAL_SCHEMA_VERSION } from "../core/canonical";
import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { testCharacter } from "../studio/test-character";
import { emptyLoreEntry, emptyLorebookBody } from "../core/lore/empty-book";
import { saveProvider } from "../kit/providers/vault";
import { chatRouteRig as rig, cleanupChatRouteRigs } from "./fake-server-chats-rig";
import { apiReq } from "./server-test-rig";

afterEach(cleanupChatRouteRigs);
setDefaultTimeout(30_000);
const HOME = join(tmpdir(), `bunzai-lore-routes-${randomUUID()}`);
const UNLOCK = { passphrase: "lore-routes-test" };
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

const persona = (id: string, refs: string[]) => ({
  schemaVersion: CANONICAL_SCHEMA_VERSION,
  kind: "persona",
  id,
  body: { name: id, content: "", knowledgeRefs: refs },
});
const book = (id: string, name: string, over: Record<string, unknown> = {}) => ({
  schemaVersion: CANONICAL_SCHEMA_VERSION,
  kind: "lorebook",
  id,
  body: { ...emptyLorebookBody(name), entries: [{ ...emptyLoreEntry("e1"), constant: true, content: "Always true." }], ...over },
});

async function readyScene() {
  const r = await rig();
  await r.store.save(testCharacter("vera", ["char-book"], { firstMessage: "Evening." }));
  await r.store.save(persona("chi", ["persona-book"]));
  await r.settings.update({ "persona.default": "chi" });
  await r.store.save(book("char-book", "Character Book"));
  await r.store.save(book("persona-book", "Persona Book"));
  const chat = (await (await r.post("/api/chats/start", { characterId: "vera" })).json()) as { id: string };
  return { ...r, chatId: chat.id };
}

test("GET answers books from all three sources, with off and missing", async () => {
  const { handler, post, chatId } = await readyScene();
  const set = await post("/api/chats/lore", { chatId, lore: { added: ["scene-book", "ghost"], off: ["persona-book"] } });
  expect(set.status).toBe(200);

  const res = await handler(apiReq(`/api/chats/lore?chatId=${chatId}`));
  expect(res.status).toBe(200);
  const body = (await res.json()) as { books: Record<string, unknown>[]; lastTurn: unknown };
  expect(body.books).toEqual([
    { id: "char-book", name: "Character Book", source: "character", enabled: true, missing: false, entries: 1, tokens: expect.any(Number) },
    { id: "persona-book", name: "Persona Book", source: "persona", enabled: false, missing: false, entries: 1, tokens: expect.any(Number) },
    { id: "scene-book", name: "scene-book", source: "scene", enabled: true, missing: true, entries: 0, tokens: 0 },
    { id: "ghost", name: "ghost", source: "scene", enabled: true, missing: true, entries: 0, tokens: 0 },
  ]);
  expect(body.lastTurn).toBeNull();
});

test("POST round-trips the scene's choice, and null clears it", async () => {
  const { handler, post, chatId } = await readyScene();
  const set = (await (await post("/api/chats/lore", { chatId, lore: { added: ["extra-book"], off: [] } })).json()) as { books: Record<string, unknown>[] };
  // char-book and persona-book come from the cast regardless; the scene's own choice adds a third.
  expect(set.books.map((b) => b["id"])).toEqual(["char-book", "persona-book", "extra-book"]);

  const cleared = (await (await post("/api/chats/lore", { chatId, lore: null })).json()) as { books: Record<string, unknown>[] };
  expect(cleared.books.map((b) => b["id"])).toEqual(["char-book", "persona-book"]);
  const reread = (await (await handler(apiReq(`/api/chats/lore?chatId=${chatId}`))).json()) as { books: Record<string, unknown>[] };
  expect(reread.books.map((b) => b["id"])).toEqual(["char-book", "persona-book"]);
});

test("a validation error from the store comes back as a 400", async () => {
  const { post, chatId } = await readyScene();
  const bad = await post("/api/chats/lore", { chatId, lore: { added: "not-a-list", off: [] } });
  expect(bad.status).toBe(400);
});

test("an absent lore field is a validation error, not a silent clear", async () => {
  const { handler, post, chatId } = await readyScene();
  await post("/api/chats/lore", { chatId, lore: { added: ["extra-book"], off: [] } });
  const missing = await post("/api/chats/lore", { chatId });
  expect(missing.status).toBe(400);
  const still = (await (await handler(apiReq(`/api/chats/lore?chatId=${chatId}`))).json()) as { books: Record<string, unknown>[] };
  expect(still.books.map((b) => b["id"])).toContain("extra-book");
});

test("a trashed book is missing, same as one never in the library", async () => {
  const { store, handler, post, chatId } = await readyScene();
  await post("/api/chats/lore", { chatId, lore: { added: ["char-book"], off: [] } });
  await store.delete("lorebook", "char-book");
  const body = (await (await handler(apiReq(`/api/chats/lore?chatId=${chatId}`))).json()) as { books: Record<string, unknown>[] };
  expect(body.books.find((b) => b["id"] === "char-book")).toEqual({ id: "char-book", name: "char-book", source: "character", enabled: true, missing: true, entries: 0, tokens: 0 });
});

test("an unknown chat is 404 on both routes", async () => {
  const { handler, post } = await readyScene();
  expect((await handler(apiReq("/api/chats/lore?chatId=nope"))).status).toBe(404);
  expect((await post("/api/chats/lore", { chatId: "nope", lore: null })).status).toBe(404);
});

test("lastTurn reflects a real committed turn's trace", async () => {
  const { handler, post, chatId } = await readyScene();
  const sent = (await (await post("/api/chats/send", { chatId, content: "Any storms?", greetingIndex: 0, expectedVersion: 1 })).json()) as { branchVersion: number };
  await post("/api/chats/connection", { chatId, connection: { id: localId, model: "qwen3" } });
  const res = await post("/api/chats/turn", { chatId, kind: "reply", expectedVersion: sent.branchVersion });
  await res.text();

  const lore = (await (await handler(apiReq(`/api/chats/lore?chatId=${chatId}`))).json()) as {
    lastTurn: { fired: Record<string, unknown>[]; totalTokens: number } | null;
  };
  expect(lore.lastTurn).not.toBeNull();
  expect(lore.lastTurn!.fired.map((f) => f["bookId"]).sort()).toEqual(["char-book", "persona-book"]);
  for (const f of lore.lastTurn!.fired) expect(f).toMatchObject({ entryId: "e1", title: "", reason: "constant", matched: [], cut: false });
  expect(lore.lastTurn!.totalTokens).toBeGreaterThan(0);
});
