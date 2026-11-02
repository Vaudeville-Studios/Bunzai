/** A core-linked scene keeps Ollama on its native /api/chat transport and chosen context window. */
import { afterAll, afterEach, beforeAll, expect, setDefaultTimeout, test } from "bun:test";
import { useTestBunzaiHome } from "../../scripts/test-home";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { saveProvider } from "../kit/providers/vault";
import { chatRouteRig, cleanupChatRouteRigs, vera } from "./fake-server-chats-rig";

setDefaultTimeout(30_000);
let server: ReturnType<typeof Bun.serve>;
let home: string;
let restoreBunzaiHome: (() => void) | undefined;
let providerId: string;
const requests: Array<{ model: string; options: { num_ctx: number } }> = [];

beforeAll(async () => {
  home = await mkdtemp(join(tmpdir(), "bunzai-ollama-core-"));
  restoreBunzaiHome = useTestBunzaiHome(home);
  server = Bun.serve({ port: 0, async fetch(request) {
    const path = new URL(request.url).pathname;
    if (path === "/api/show") return Response.json({ model_info: { "general.architecture": "llama", "llama.context_length": 32768 }, capabilities: ["completion"] });
    if (path !== "/api/chat") return new Response("wrong endpoint", { status: 404 });
    requests.push(await request.json() as { model: string; options: { num_ctx: number } });
    return new Response([
      JSON.stringify({ model: "fake-ollama", message: { role: "assistant", content: "Ollama speaks." }, done: false }),
      JSON.stringify({ model: "fake-ollama", message: { role: "assistant", content: "" }, done: true, done_reason: "stop", prompt_eval_count: 20, eval_count: 3 }),
      "",
    ].join("\n"), { headers: { "content-type": "application/x-ndjson" } });
  } });
  providerId = (await saveProvider({ kind: "ollama", name: "Test Ollama", model: "fake-ollama", baseURL: `http://127.0.0.1:${server.port}`, options: { numCtx: "16384" } }, { passphrase: "ollama-core-test" })).id!;
});
afterEach(cleanupChatRouteRigs);
afterAll(async () => {
  try {
    server.stop(true);
  } finally {
    try {
      await rm(home, { recursive: true, force: true });
    } finally {
      restoreBunzaiHome?.();
    }
  }
});

test("rp-core sends a scene reply to /api/chat with the configured num_ctx", async () => {
  const rig = await chatRouteRig({ core: true });
  await rig.store.save(vera);
  const chat = await (await rig.post("/api/chats/start", { characterId: "vera" })).json() as { id: string };
  const sent = await (await rig.post("/api/chats/send", { chatId: chat.id, content: "Hello", greetingIndex: 0, expectedVersion: 1 })).json() as { branchVersion: number };
  expect((await rig.post("/api/chats/connection", { chatId: chat.id, connection: { id: providerId, model: "fake-ollama" } })).status).toBe(200);
  const response = await rig.post("/api/chats/turn", { chatId: chat.id, kind: "reply", expectedVersion: sent.branchVersion });
  expect(response.status).toBe(200);
  const events = (await response.text()).split("\n\n").filter((frame) => frame.includes("data: ")).map((frame) => JSON.parse(frame.split("data: ")[1]!) as { type: string; message?: unknown });
  expect(events.map((event) => event.type)).toEqual(["start", "text", "done"]);
  expect(requests).toHaveLength(1);
  expect(requests[0]).toMatchObject({ model: "fake-ollama", options: { num_ctx: 16384 } });
});
