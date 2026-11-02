/** `POST /api/chats/forecast` (rc-parity 08, Next send): the request a send would build, over the real server; a read that writes nothing and refuses what it cannot answer. */
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
import type { SceneForecast } from "./app-contract-scenes";

setDefaultTimeout(30_000);
const HOME = join(tmpdir(), `bunzai-forecast-route-${randomUUID()}`);
const UNLOCK = { passphrase: "forecast-route-test" };
let localId = "";
let calls = 0;
let restoreBunzaiHome: (() => void) | undefined;
let server: ReturnType<typeof Bun.serve>;

beforeAll(async () => {
  restoreBunzaiHome = useTestBunzaiHome(HOME);
  server = Bun.serve({ port: 0, async fetch() { calls++; return new Response("{}"); } });
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

async function started() {
  const rig = await chatRouteRig();
  await rig.store.save({ schemaVersion: CANONICAL_SCHEMA_VERSION, kind: "character", id: "vera", body: { identity: { name: "Vera", description: "Keeps the light." }, persona: {}, prompts: {}, greetings: { firstMessage: "Evening." }, examples: {}, media: {}, attribution: {}, discovery: {} } });
  const chat = (await (await rig.post("/api/chats/start", { characterId: "vera" })).json()) as { id: string };
  return { ...rig, chat };
}

test("the real server answers a forecast of the message being typed, and asks no model", async () => {
  const { post, chat } = await started();
  await post("/api/chats/connection", { chatId: chat.id, connection: { id: localId, model: "qwen3" } });
  const res = await post("/api/chats/forecast", { chatId: chat.id, draft: "Any storms?" });
  expect(res.status).toBe(200);
  const out = (await res.json()) as SceneForecast;
  expect(out.model).toBe("qwen3");
  expect(out.messages.at(-1)).toMatchObject({ role: "user", content: "Any storms?" });
  expect(out.messages.some((m) => m.content.includes("Keeps the light."))).toBe(true);
  expect(out.tokens).toBeGreaterThan(0);
  expect(calls).toBe(0);
});

test("a scene with no connection answers 409 the way a send does, and a malformed body is a 400", async () => {
  const { post, chat } = await started();
  expect((await post("/api/chats/forecast", { chatId: chat.id, draft: "Hi" })).status).toBe(409);
  expect((await post("/api/chats/forecast", { draft: "Hi" })).status).toBe(400);
  expect((await post("/api/chats/forecast", { chatId: chat.id, draft: 7 })).status).toBe(400);
});

test("an unknown scene is 404, and the route is POST only", async () => {
  const { post, handler, chat } = await started();
  expect((await post("/api/chats/forecast", { chatId: "nope", draft: "Hi" })).status).toBe(404);
  expect((await handler(apiReq(`/api/chats/forecast?chatId=${chat.id}`))).status).toBe(404);
});

type FormulaTry = import("../studio/scene-forecast").FormulaTry;
const tryFormula = async (post: (path: string, body: unknown) => Promise<Response>, chatId: string, text: unknown) => post("/api/chats/formula-try", { chatId, text });

test("formula-try runs the text read-only on the scene's own macro context, how long it took, and asks no model", async () => {
  const { post, chat } = await started();
  await post("/api/chats/connection", { chatId: chat.id, connection: { id: localId, model: "qwen3" } });
  const res = await tryFormula(post, chat.id, "{{char}} says {{calc::1 + 2}}");
  expect(res.status).toBe(200);
  const out = (await res.json()) as FormulaTry;
  expect(out).toMatchObject({ ok: true, text: "Vera says 3" });
  expect(out.ms).toBeGreaterThanOrEqual(0);
  expect(calls).toBe(0);
});

test("formula-try refuses a formula that would change a variable, says which, and changes nothing in the scene", async () => {
  const { post, chat } = await started();
  await post("/api/chats/connection", { chatId: chat.id, connection: { id: localId, model: "qwen3" } });
  const stopped = (await (await tryFormula(post, chat.id, "{{setvar::mood::grim}}")).json()) as FormulaTry;
  expect(stopped).toMatchObject({ ok: false });
  expect("error" in stopped && stopped.error).toContain("changes variables");
  const after = (await (await tryFormula(post, chat.id, "[{{getvar::mood}}]")).json()) as FormulaTry;
  expect(after).toMatchObject({ ok: true, text: "[]" });
  const blank = (await (await tryFormula(post, chat.id, "  ")).json()) as FormulaTry;
  expect(blank).toMatchObject({ ok: false, error: "This formula is empty." });
});

test("formula-try needs no connection: it asks no model, so a scene with none is read as it stands", async () => {
  const { post, chat } = await started();
  expect((await post("/api/chats/forecast", { chatId: chat.id, draft: "Hi" })).status).toBe(409);
  const out = (await (await tryFormula(post, chat.id, "{{char}} / {{mentions::Evening::1}}")).json()) as FormulaTry;
  expect(out).toMatchObject({ ok: true });
  expect(calls).toBe(0);
});

test("formula-try does not need a window the scene fits in: a connection with a tiny stated window still answers", async () => {
  const { post, chat } = await started();
  await post("/api/chats/connection", { chatId: chat.id, connection: { id: localId, model: "qwen3" } });
  const out = (await (await tryFormula(post, chat.id, "{{calc::2 * 3}}")).json()) as FormulaTry;
  expect(out).toMatchObject({ ok: true, text: "6" });
});

test("formula-try answers an unknown scene 404 and a malformed body 400", async () => {
  const { post, handler, chat } = await started();
  expect((await tryFormula(post, "nope", "{{char}}")).status).toBe(404);
  expect((await tryFormula(post, chat.id, 7)).status).toBe(400);
  expect((await post("/api/chats/formula-try", { text: "{{char}}" })).status).toBe(400);
  expect((await handler(apiReq(`/api/chats/formula-try?chatId=${chat.id}`))).status).toBe(404);
});
