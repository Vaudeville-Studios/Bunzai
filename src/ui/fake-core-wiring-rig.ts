/**
 * A scripted OpenAI-compatible model and a Core scene on it, for the tests that prove what a Core scene sends over HTTP. Call
 * installCoreModel() once per test file; `model` says how the next requests are answered and `asked` holds what reached it.
 */
import { afterAll, afterEach, beforeAll } from "bun:test";
import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { useTestBunzaiHome as enterTestHome } from "../../scripts/test-home";
import { saveProvider } from "../kit/providers/vault";
import { ARGS } from "../studio/fake-director-rig";
import { libraryFor } from "../studio/library-content";
import { chatRouteRig as rig, cleanupChatRouteRigs, vera } from "./fake-server-chats-rig";
import { apiReq } from "./server-test-rig";

export const UNLOCK = { passphrase: "core-wiring-test" };
export const asked: { messages: { role: string; content: string }[]; stream?: boolean }[] = [];
const PLAN = ARGS();
export const model = {
  localId: "",
  reply: "It might.",
  toolCallNext: null as { name: string; args: string } | null,
  attachmentsSeen: null as string[] | null,
  holdNext: false,
  toolCalls: [] as { name: string; args: string }[],
};

export function installCoreModel(): void {
  const home = join(tmpdir(), `bunzai-core-wiring-${randomUUID()}`);
  let restoreBunzaiHome: (() => void) | undefined;
  let server: ReturnType<typeof Bun.serve>;
  afterEach(() => { model.reply = "It might."; return cleanupChatRouteRigs(); });
  beforeAll(async () => {
    restoreBunzaiHome = enterTestHome(home);
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
        if (model.attachmentsSeen && JSON.stringify(request.messages).includes("Files attached to")) model.attachmentsSeen.push(JSON.stringify(request.messages));
        if (model.holdNext && !model.toolCallNext) {
          model.holdNext = false;
          return new Response(new ReadableStream({ start(out) { out.enqueue(new TextEncoder().encode(chunk({ choices: [{ delta: { content: "Half a " } }], model: "qwen3-local" }))); req.signal.addEventListener("abort", () => out.close()); } }), { headers: { "content-type": "text/event-stream" } });
        }
        if (model.toolCalls.length) {
          const calls = model.toolCalls.splice(0).map((call, index) => ({ id: `call${index}`, type: "function", index, function: { name: call.name, arguments: call.args } }));
          return new Response(chunk({ choices: [{ delta: { tool_calls: calls }, finish_reason: "tool_calls" }], model: "qwen3-local" }) + "data: [DONE]\n\n", { headers: { "content-type": "text/event-stream" } });
        }
        if (model.toolCallNext) {
          const call = { id: "call1", type: "function", index: 0, function: { name: model.toolCallNext.name, arguments: model.toolCallNext.args } };
          model.toolCallNext = null;
          return new Response(chunk({ choices: [{ delta: { tool_calls: [call] }, finish_reason: "tool_calls" }], model: "qwen3-local" }) + "data: [DONE]\n\n", { headers: { "content-type": "text/event-stream" } });
        }
        if (request.stream === false) return Response.json({ choices: [{ message: { role: "assistant", content: model.reply }, finish_reason: "stop" }], model: "qwen3-local" });
        const body = chunk({ choices: [{ delta: { content: model.reply }, finish_reason: "stop" }], model: "qwen3-local" }) + "data: [DONE]\n\n";
        return new Response(body, { headers: { "content-type": "text/event-stream" } });
      },
    });
    model.localId = (await saveProvider({ kind: "local", model: "qwen3", baseURL: `http://127.0.0.1:${server.port}/v1`, name: "Desk" }, UNLOCK)).id!;
  });
  afterAll(async () => {
    try { server.stop(true); } finally { await rm(home, { recursive: true, force: true }).finally(() => restoreBunzaiHome?.()); }
  });
}

export type Rig = Awaited<ReturnType<typeof rig>>;
export interface Opened { branchVersion: number; chat: { id: string } }

export async function coreScene(r: Rig) {
  await r.store.save(vera);
  const chat = (await (await r.post("/api/chats/start", { characterId: "vera" })).json()) as { id: string };
  await r.post("/api/chats/connection", { chatId: chat.id, connection: { id: model.localId, model: "qwen3" } });
  const open = async () => (await (await r.handler(apiReq(`/api/chats/open?id=${chat.id}`))).json()) as Opened;
  return { chatId: chat.id, open };
}

export async function sendAndAnswer(r: Rig, chatId: string, version: number, content = "Will it rain?") {
  const sent = await r.post("/api/chats/send", { chatId, content, greetingIndex: 0, expectedVersion: version });
  if (sent.status !== 200) throw new Error(`${sent.status}: ${await sent.text()}`);
  const opened = (await sent.json()) as Opened;
  const turn = await r.post("/api/chats/turn", { chatId, kind: "reply", expectedVersion: opened.branchVersion });
  if (turn.status !== 200) throw new Error(`${turn.status}: ${await turn.text()}`);
  await turn.text();
  return asked.at(-1)!;
}

export async function journal(r: Rig, chatId: string) {
  const records = libraryFor(r.store.studioPath())!.core!;
  return records.journalRevision((await records.sceneFor(chatId))!.sessionId);
}
