/**
 * A scene on a local (Ollama / LM Studio style) connection gets narrator tools like every other connection: the turn route marks the
 * connection, a linked tracker's `update_trackers` goes out in the request and its call lands as tracker deltas, and a server that
 * answers 400 "does not support tools" is reported in one plain sentence that names the model, with nothing saved as a reply.
 */
import { afterAll, afterEach, beforeAll, expect, setDefaultTimeout, test } from "bun:test";
import { useTestBunzaiHome } from "../../scripts/test-home";
import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CANONICAL_SCHEMA_VERSION } from "../core/canonical";
import type { TrackerBody } from "../entities/tracker/schema";
import { saveProvider } from "../kit/providers/vault";
import type { SceneTrackers } from "../studio/scene-trackers";
import { chatRouteRig, cleanupChatRouteRigs, vera } from "./fake-server-chats-rig";
import { connect } from "../kit/providers/scene-connect";
import { apiReq } from "./server-test-rig";

afterEach(cleanupChatRouteRigs);
setDefaultTimeout(30_000);

const HOME = join(tmpdir(), `bunzai-local-tools-${randomUUID()}`);
const UNLOCK = { passphrase: "local-tools-test" };
const health: TrackerBody = { name: "Health", description: "", layout: "record", note: "", fields: [{ name: "hp", description: "", type: "number", min: 0, default: 20 }] };
const REFUSAL = '{"error":"registry.ollama.ai/library/qwen3 does not support tools"}';
let restoreBunzaiHome: (() => void) | undefined;
let server: ReturnType<typeof Bun.serve>;
let refuse = false;
const asked: { tools?: { function: { name: string } }[]; messages: { role: string }[] }[] = [];
let localId = "";

const sse = (...chunks: unknown[]) => new Response(chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join("") + "data: [DONE]\n\n", { headers: { "content-type": "text/event-stream" } });

beforeAll(async () => {
  restoreBunzaiHome = useTestBunzaiHome(HOME);
  server = Bun.serve({
    port: 0,
    async fetch(req) {
      const body = (await req.json()) as (typeof asked)[number];
      asked.push(body);
      if (refuse && body.tools?.length) return new Response(REFUSAL, { status: 400 });
      const called = body.messages.some((m) => m.role === "tool");
      if (body.tools?.length && !called) {
        const call = { index: 0, id: "c1", type: "function", function: { name: "update_trackers", arguments: JSON.stringify({ updates: [{ tracker: "Health", set: { hp: 5 } }] }) } };
        return sse({ choices: [{ delta: { tool_calls: [call] }, finish_reason: "tool_calls" }] });
      }
      return sse({ choices: [{ delta: { content: "She winces." }, finish_reason: "stop" }] });
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

async function linkedScene() {
  const r = await chatRouteRig();
  await r.store.save(vera);
  await r.store.save({ schemaVersion: CANONICAL_SCHEMA_VERSION, kind: "tracker", id: "health", body: health });
  const chat = (await (await r.post("/api/chats/start", { characterId: "vera" })).json()) as { id: string };
  await r.post("/api/chats/connection", { chatId: chat.id, connection: { id: localId, model: "qwen3" } });
  await r.post("/api/chats/prompting", { chatId: chat.id, prompting: { toolAccess: true, trackers: ["health"] } });
  const sent = (await (await r.post("/api/chats/send", { chatId: chat.id, content: "Any storms?", greetingIndex: 0, expectedVersion: 1 })).json()) as { branchVersion: number };
  const turn = async () => {
    const res = await r.post("/api/chats/turn", { chatId: chat.id, kind: "reply", expectedVersion: sent.branchVersion });
    return (await res.text()).split("\n\n").filter(Boolean).map((f) => JSON.parse(f.split("\ndata: ")[1]!) as { type: string; message?: string });
  };
  const open = async () => (await (await r.handler(apiReq(`/api/chats/open?id=${chat.id}`))).json()) as { messages: { swipes: { content: string }[] }[] };
  return { ...r, chat, turn, open };
}

test("the turn route marks a local connection as taking tools", async () => {
  expect((await connect({ id: localId, model: "qwen3" }))?.tools).toBe(true);
});

test("a local connection with a linked tracker is sent update_trackers and the call lands as tracker deltas", async () => {
  refuse = false;
  asked.length = 0;
  const { turn, handler, chat } = await linkedScene();
  const seen = await turn();
  expect(seen.at(-1)!.type).toBe("done");
  expect(asked[0]!.tools!.map((t) => t.function.name)).toEqual(["update_trackers"]);
  const read = (await (await handler(apiReq(`/api/chats/library-trackers?chatId=${chat.id}`))).json()) as SceneTrackers;
  expect(read.trackers[0]!.value).toEqual({ hp: 5 });
});

test("a server that refuses tools is reported in one plain sentence naming the model, and nothing is saved as a reply", async () => {
  refuse = true;
  asked.length = 0;
  const { turn, open } = await linkedScene();
  const seen = await turn();
  const failed = seen.find((e) => e.type === "failed")!;
  expect(failed.message).toBe("qwen3 cannot use tools, so turn off this scene's Narrator Tool Access for it, or pick a model that supports tools.");
  expect(asked.every((b) => b.tools?.length)).toBe(true);
  expect((await open()).messages.map((m) => m.swipes[0]!.content).at(-1)).toBe("Any storms?");
});
