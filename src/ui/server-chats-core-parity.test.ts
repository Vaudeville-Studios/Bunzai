/**
 * A Core scene sends what an old scene sends (core-library.ts): one scene is set up through the routes on
 * both engines, two turns run, and the second requests must be the same. Covered: block switches, inline
 * {{lore}}, the persona with no persona slot, the no-preset layout, in-chat preset depths, guides of every
 * placement and the scene note in both of its positions. rp-core then shapes a request for what the model
 * takes (its caps: a model it does not know gets no mid-chat system messages); that shaping is rp-core's,
 * so the old scene's request is compared after rp-core's own caps rules for the same connection.
 */
import { afterAll, afterEach, beforeAll, expect, setDefaultTimeout, test } from "bun:test";
import { useTestBunzaiHome } from "../../scripts/test-home";
import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CANONICAL_SCHEMA_VERSION } from "../core/canonical";
import { emptyLoreEntry, emptyLorebookBody } from "../core/lore/empty-book";
import { saveProvider } from "../kit/providers/vault";
import { chatRouteRig as rig, cleanupChatRouteRigs, vera } from "./fake-server-chats-rig";
import { apiReq } from "./server-test-rig";
import { resolveCaps } from "rp-core";
import { applyCapsRules } from "../../vendor/rp-core/src/prompt/shape";

afterEach(cleanupChatRouteRigs);
setDefaultTimeout(30_000);
const HOME = join(tmpdir(), `bunzai-core-parity-${randomUUID()}`);
let restore: (() => void) | undefined;
let server: ReturnType<typeof Bun.serve>;
const asked: { messages: { role: string; content: string }[] }[] = [];
let localId = "";
beforeAll(async () => {
  restore = useTestBunzaiHome(HOME);
  server = Bun.serve({ port: 0, async fetch(req) {
    asked.push(await req.json() as (typeof asked)[number]);
    const chunk = (o: unknown) => `data: ${JSON.stringify(o)}\n\n`;
    return new Response(chunk({ choices: [{ delta: { content: "Ok." }, finish_reason: "stop" }] }) + "data: [DONE]\n\n", { headers: { "content-type": "text/event-stream" } });
  } });
  localId = (await saveProvider({ kind: "local", model: "qwen3", baseURL: `http://127.0.0.1:${server.port}/v1`, name: "Desk" }, { passphrase: "core-parity" })).id!;
});
afterAll(async () => { server.stop(true); await rm(HOME, { recursive: true, force: true }); restore?.(); });

type Rig = Awaited<ReturnType<typeof rig>>;
const prompt = (id: string, content: string, more: Record<string, unknown> = {}) => ({ id, name: id, content, role: "system", enabled: true, systemPrompt: true, marker: false, placement: "relative", injectionDepth: 4, injectionOrder: 100, forbidOverrides: false, ...more });

/** The second reply's request of one scene, set up by `setup` through the routes on one engine. */
async function requestFor(core: boolean, setup: (r: Rig, chatId: string) => Promise<void>) {
  const r = await rig({ core });
  await r.store.save(vera);
  await r.store.save({ schemaVersion: CANONICAL_SCHEMA_VERSION, kind: "persona", id: "chi", body: { name: "Chi", content: "Chi is a lighthouse keeper.", knowledgeRefs: [] } });
  await r.settings.update({ "persona.default": "chi" });
  await r.store.save({ schemaVersion: CANONICAL_SCHEMA_VERSION, kind: "lorebook", id: "tower", body: { ...emptyLorebookBody("Tower"), entries: [{ ...emptyLoreEntry("bell"), constant: true, content: "BELL." }] } });
  const chat = (await (await r.post("/api/chats/start", { characterId: "vera" })).json()) as { id: string };
  await r.post("/api/chats/lore", { chatId: chat.id, lore: { added: ["tower"], off: [] } });
  await setup(r, chat.id);
  await r.post("/api/chats/connection", { chatId: chat.id, connection: { id: localId, model: "qwen3" } });
  let version = 1;
  for (const content of ["Hi", "And then?"]) {
    const sent = await r.post("/api/chats/send", { chatId: chat.id, content, greetingIndex: 0, expectedVersion: version });
    if (sent.status !== 200) throw new Error(`${sent.status}: ${await sent.text()}`);
    const turn = await r.post("/api/chats/turn", { chatId: chat.id, kind: "reply", expectedVersion: ((await sent.json()) as { branchVersion: number }).branchVersion });
    if (turn.status !== 200) throw new Error(`${turn.status}: ${await turn.text()}`);
    await turn.text();
    version = ((await (await r.handler(apiReq(`/api/chats/open?id=${chat.id}`))).json()) as { branchVersion: number }).branchVersion;
  }
  return asked.at(-1)!.messages;
}

async function same(setup: (r: Rig, chatId: string) => Promise<void>) {
  const core = await requestFor(true, setup);
  // The caps Bunzai resolves for this Kit connection (core-scene.ts connectionFor).
  const origin = `http://127.0.0.1:${server.port}`;
  const caps = resolveCaps({ dialect: "openai-chat", origin, local: true, model: "qwen3", server: "local" });
  const old = applyCapsRules((await requestFor(false, setup)).map((m) => ({ role: m.role as "system" | "user" | "assistant", blocks: [{ k: "text" as const, text: m.content }], src: "bunzai" })), caps)
    .map((m) => ({ role: m.role, content: m.blocks.flatMap((b) => (b.k === "text" ? [b.text] : [])).join("") }));
  expect(core).toEqual(old);
  return core.map((message) => message.content).join(" | ");
}

async function guide(r: Rig, fields: Record<string, unknown>): Promise<string> {
  const saved = await r.post("/api/chats/guides/save", { guide: { title: String(fields["content"]).slice(0, 20), ...fields } });
  if (saved.status !== 200) throw new Error(`${saved.status}: ${await saved.text()}`);
  return ((await saved.json()) as { id: string }).id;
}

test("the same preset, lorebook and persona send the same request on both engines", async () => {
  const sent = await same(async (r, chatId) => {
    await r.store.save({ schemaVersion: CANONICAL_SCHEMA_VERSION, kind: "preset", id: "quill", body: { name: "Q",
      prompts: [prompt("main", "Write as {{char}}. Main: {{lore}} END"), prompt("aside", "Aside: {{lore}} END", { systemPrompt: false }), prompt("history", "{{message_history}}")] } });
    await r.post("/api/chats/preset", { chatId, preset: { kind: "preset", id: "quill", toggles: {}, samplers: {} } });
  });
  expect(sent).toContain("Main: BELL. END");
  expect(sent).toContain("<persona name=\"Chi\">");
});

test("a scene with no preset, guides of every placement and an in-chat note send the same request on both engines", async () => {
  const sent = await same(async (r, chatId) => {
    const ids = [
      await guide(r, { content: "Keep it moody.", role: "system" }),
      await guide(r, { content: "(OOC: short answers)", role: "user" }),
      await guide(r, { content: "Remember the storm.", role: "system", mode: "depth", depth: 1 }),
      await guide(r, { content: "Chi hums sea shanties.", mode: "macro", target: "persona", side: "append" }),
    ];
    const set = await r.post("/api/chats/prompting", { chatId, prompting: { guides: ids, note: { text: "The lamp is failing.", position: "in_chat", depth: 1, frequency: 1 } } });
    if (set.status !== 200) throw new Error(`${set.status}: ${await set.text()}`);
  });
  for (const text of ["Keep it moody.", "(OOC: short answers)", "Remember the storm.", "Chi hums sea shanties.", "[Author's Note: The lamp is failing.]", "BELL."]) expect(sent).toContain(text);
});

const prompting = (fields: Record<string, unknown>) => async (r: Rig, chatId: string) => {
  const set = await r.post("/api/chats/prompting", { chatId, prompting: fields });
  if (set.status !== 200) throw new Error(`${set.status}: ${await set.text()}`);
};

test("Start Reply With in the user or system role sends the same request on both engines", async () => {
  expect(await same(prompting({ prefill: "Stay terse.", prefillRole: "user" }))).toContain("Stay terse.");
  expect(await same(prompting({ prefill: "Stay terse.", prefillRole: "system" }))).toContain("Stay terse.");
});

test("Send the last message as the user sends the same request on both engines", async () => {
  expect(await same(prompting({ prefill: "Begin.", lastAsUser: true }))).toContain("Begin.");
  expect(await same(prompting({ prefill: "Begin.", prefillRole: "system", lastAsUser: true }))).toContain("Begin.");
});

test("a chat-start guide runs once for its macros, sends no text, and later requests read what it set, on both engines", async () => {
  const sent = await same(async (r, chatId) => {
    const ids = [await guide(r, { content: "HIDDEN{{incvar::fired}}", mode: "chat_start" }), await guide(r, { content: "Fired: {{getvar::fired}}.", role: "system" })];
    await prompting({ guides: ids })(r, chatId);
  });
  expect(sent).toContain("Fired: 1.");
  expect(sent).not.toContain("HIDDEN");
});

test("an in-chat preset block and an after-scenario note send the same request on both engines", async () => {
  const sent = await same(async (r, chatId) => {
    await r.store.save({ schemaVersion: CANONICAL_SCHEMA_VERSION, kind: "preset", id: "deep", body: { name: "D",
      prompts: [prompt("main", "Write as {{char}}."), prompt("history", "{{message_history}}"), prompt("stay", "Stay in character.", { placement: "in_chat", injectionDepth: 1, systemPrompt: false })] } });
    await r.post("/api/chats/preset", { chatId, preset: { kind: "preset", id: "deep", toggles: {}, samplers: {} } });
    await r.post("/api/chats/prompting", { chatId, prompting: { note: { text: "Night falls.", position: "after_scenario", depth: 4, frequency: 1 } } });
  });
  expect(sent).toContain("Stay in character.");
  expect(sent).toContain("[Author's Note: Night falls.]");
});
