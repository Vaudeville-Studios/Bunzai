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

afterEach(cleanupChatRouteRigs);

// Sealing the vault spawns the OS keystore (about a second, cold).
setDefaultTimeout(30_000);
const HOME = join(tmpdir(), `bunzai-core-wiring-${randomUUID()}`);
const UNLOCK = { passphrase: "core-wiring-test" };
let restoreBunzaiHome: (() => void) | undefined;
let server: ReturnType<typeof Bun.serve>;
const asked: { messages: { role: string; content: string }[] }[] = [];
let localId = "";

beforeAll(async () => {
  restoreBunzaiHome = useTestBunzaiHome(HOME);
  server = Bun.serve({
    port: 0,
    async fetch(req) {
      asked.push((await req.json()) as (typeof asked)[number]);
      const chunk = (o: unknown) => `data: ${JSON.stringify(o)}\n\n`;
      const body = chunk({ choices: [{ delta: { content: "It might." }, finish_reason: "stop" }], model: "qwen3-local" }) + "data: [DONE]\n\n";
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
