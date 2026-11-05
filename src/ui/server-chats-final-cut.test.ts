/**
 * Final Cut over HTTP (ChatStore rule 44): the switch and passes are kept by the scene and a bad patch is a 400; a reply streams from a
 * real OpenAI-compatible server on this machine, the pass runs on it before the reply is saved, and what the passes did is read back from the
 * saved reply; a re-run answers a preview and writes nothing; and the person's banks and agents are kept, soft-deleted, and joined to Anti-Slop.
 * Kit's vault is sandboxed for the file.
 */
import { afterAll, afterEach, beforeAll, expect, setDefaultTimeout, test } from "bun:test";
import { useTestBunzaiHome } from "../../scripts/test-home";
import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CANONICAL_SCHEMA_VERSION } from "../core/canonical";
import { createPass } from "../core/final-cut/pass";
import { saveProvider } from "../kit/providers/vault";
import { chatRouteRig as rig, cleanupChatRouteRigs, vera } from "./fake-server-chats-rig";
import { apiReq } from "./server-test-rig";

afterEach(cleanupChatRouteRigs);
setDefaultTimeout(30_000);

const HOME = join(tmpdir(), `bunzai-final-cut-routes-${randomUUID()}`);
const UNLOCK = { passphrase: "final-cut-routes-test" };
let restoreBunzaiHome: (() => void) | undefined;
let server: ReturnType<typeof Bun.serve>;
const asked: { model: string; stream?: boolean; messages: { role: string; content: string }[] }[] = [];
let localId = "";
let passBody = "It might, and the light holds.";

beforeAll(async () => {
  restoreBunzaiHome = useTestBunzaiHome(HOME);
  server = Bun.serve({
    port: 0,
    async fetch(req) {
      const body = (await req.json()) as (typeof asked)[number];
      asked.push(body);
      const pass = /post-generation|Anti-Slop Engine/.test(body.messages[0]?.content ?? "");
      if (pass) {
        const text = "[CHANGELOG]\n- Tone: warmer\n[REFINED]\n" + passBody;
        return Response.json({ choices: [{ message: { role: "assistant", content: text }, finish_reason: "stop" }], model: "qwen3-local", usage: { prompt_tokens: 20, completion_tokens: 8 } });
      }
      const chunk = (o: unknown) => `data: ${JSON.stringify(o)}\n\n`;
      const sse = chunk({ choices: [{ delta: { content: "It " } }] }) + chunk({ choices: [{ delta: { content: "might." }, finish_reason: "stop" }], model: "qwen3-local" }) + chunk({ choices: [], usage: { prompt_tokens: 40, completion_tokens: 3 } }) + "data: [DONE]\n\n";
      return new Response(sse, { headers: { "content-type": "text/event-stream" } });
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

async function scene(core = false) {
  const r = await rig({ core });
  await r.store.save(vera);
  const chat = (await (await r.post("/api/chats/start", { characterId: "vera" })).json()) as { id: string };
  const sent = (await (await r.post("/api/chats/send", { chatId: chat.id, content: "Any storms?", greetingIndex: 0, expectedVersion: 1 })).json()) as { branchVersion: number };
  await r.post("/api/chats/connection", { chatId: chat.id, connection: { id: localId, model: "qwen3" } });
  const open = async () => (await (await r.handler(apiReq(`/api/chats/open?id=${chat.id}`))).json()) as { branchVersion: number; messages: { id: string; role: string; swipes: { content: string; generation?: Record<string, unknown> }[]; current: number }[]; chat: { finalCut?: unknown } };
  return { ...r, chatId: chat.id, version: sent.branchVersion, open };
}
const editor = { ...createPass("editor", 0), outputMode: "tagged" as const };

async function turn(s: Awaited<ReturnType<typeof scene>>, version: number) {
  const res = await s.post("/api/chats/turn", { chatId: s.chatId, kind: "reply", expectedVersion: version });
  const text = await res.text();
  return text.split("\n\n").filter(Boolean).map((f) => JSON.parse(f.split("\ndata: ")[1]!) as { type: string; [k: string]: unknown });
}

test("a scene keeps its Final Cut, a bad patch is a 400 that changes nothing, and null clears it", async () => {
  const s = await scene();
  const set = await s.post("/api/chats/final-cut", { chatId: s.chatId, finalCut: { on: true, passes: [editor] } });
  expect(set.status).toBe(200);
  expect(((await s.open()).chat.finalCut as { on: boolean }).on).toBe(true);
  expect((await s.post("/api/chats/final-cut", { chatId: s.chatId, finalCut: { passes: [{ ...editor, temperature: 9 }] } })).status).toBe(400);
  expect((await s.post("/api/chats/final-cut", { chatId: "nope", finalCut: { on: true } })).status).toBe(404);
  expect(((await s.open()).chat.finalCut as { passes: unknown[] }).passes).toHaveLength(1);
  await s.post("/api/chats/final-cut", { chatId: s.chatId, finalCut: { on: null, passes: null } });
  expect((await s.open()).chat.finalCut).toBeUndefined();
});

test("a reply runs through the pass before it is saved, and the saved reply says what the pass did", async () => {
  asked.length = 0;
  const s = await scene();
  await s.post("/api/chats/final-cut", { chatId: s.chatId, finalCut: { on: true, passes: [editor] } });
  const e = await turn(s, s.version);
  expect(e.map((x) => x.type)).toContain("finalcut");
  expect(e.at(-1)!.type).toBe("done");
  const reply = (await s.open()).messages.at(-1)!;
  expect(reply.swipes[reply.current]!.content).toBe("It might, and the light holds.");
  expect(reply.swipes[reply.current]!.generation!["finalCut"]).toEqual({ passes: 1, changed: true, failed: 0 });
  const run = (await (await s.handler(apiReq(`/api/chats/final-cut/run?chatId=${s.chatId}&messageId=${reply.id}`))).json()) as { text: string; run: { original: string; passes: { type: string; status: string }[] } };
  expect(run.run.original).toBe("It might.");
  expect(run.run.passes[0]).toMatchObject({ type: "editor", status: "applied" });
  expect(asked.filter((a) => /post-generation/.test(a.messages[0]?.content ?? ""))).toHaveLength(1);
});

test("a re-run is a preview: it answers the new text and the run, and the scene is exactly as it was", async () => {
  const s = await scene();
  await s.post("/api/chats/final-cut", { chatId: s.chatId, finalCut: { on: true, passes: [editor] } });
  await turn(s, s.version);
  const before = JSON.stringify(await s.open());
  const reply = (await s.open()).messages.at(-1)!;
  const res = await s.post("/api/chats/final-cut/rerun", { chatId: s.chatId, messageId: reply.id });
  expect(res.status).toBe(200);
  const out = (await res.json()) as { text: string; run: { passes: unknown[] }; summary: { passes: number } };
  expect(out.run.passes).toHaveLength(1);
  expect(out.summary.passes).toBe(1);
  expect(JSON.stringify(await s.open())).toBe(before);
});

test("a re-run with no pass, or on a reply that is gone, is refused", async () => {
  const s = await scene();
  await turn(s, s.version);
  const reply = (await s.open()).messages.at(-1)!;
  expect((await s.post("/api/chats/final-cut/rerun", { chatId: s.chatId, messageId: reply.id })).status).toBe(409);
  await s.post("/api/chats/final-cut", { chatId: s.chatId, finalCut: { passes: [editor] } });
  expect((await s.post("/api/chats/final-cut/rerun", { chatId: s.chatId, messageId: "nope" })).status).toBe(404);
});

test("the person's banks are made, listed, changed and deleted softly; a bad one is a 400, and an enabled one reaches the Anti-Slop pass", async () => {
  asked.length = 0;
  const s = await scene();
  const bank = { label: "Melodrama tells", kind: "phrase", pattern: "Overwrought stock beats.", examples: ["a single tear traced her cheek"], replace: "Show the cause." };
  const made = (await (await s.post("/api/chats/final-cut/library/bank", { bank })).json()) as { id: string; bankId: string; enabled: boolean };
  expect(made).toMatchObject({ bankId: "user/melodrama-tells", enabled: true });
  expect((await s.post("/api/chats/final-cut/library/bank", { bank: { ...bank, label: "" } })).status).toBe(400);
  expect((await s.post("/api/chats/final-cut/library/bank", { bank: { ...bank, label: "Other", bankId: "melodrama-tells" } })).status).toBe(400);
  const edited = (await (await s.post("/api/chats/final-cut/library/bank", { bank: { ...bank, id: made.id, label: "Melodrama tells", examples: ["one", "two"] } })).json()) as { examples: string[] };
  expect(edited.examples).toEqual(["one", "two"]);
  expect((await s.post("/api/chats/final-cut/library/bank", { bank: { ...bank, id: "nope" } })).status).toBe(404);
  await s.post("/api/chats/final-cut", { chatId: s.chatId, finalCut: { on: true, passes: [{ ...createPass("anti-slop", 0), outputMode: "tagged", enabledBanks: [] }] } });
  await turn(s, s.version);
  expect(asked.find((a) => /Anti-Slop Engine/.test(a.messages[0]?.content ?? ""))!.messages[0]!.content).toContain("## Melodrama tells  [phrase] [user-authored]");
  expect(await (await s.post("/api/chats/final-cut/library/bank/delete", { id: made.id })).json()).toEqual({ deleted: true });
  expect(await (await s.post("/api/chats/final-cut/library/bank/delete", { id: made.id })).json()).toEqual({ deleted: false });
  expect(((await (await s.handler(apiReq("/api/chats/final-cut/library"))).json()) as { banks: unknown[] }).banks).toEqual([]);
});

test("a saved agent is kept by name, overwrites on the same name, keeps the pass's bounds, and deletes softly", async () => {
  const s = await scene();
  const agent = { name: "Tightener", instructions: "Tighten pacing.", connection: { id: "k", model: "m" }, temperature: 0.4, contextMessages: 4 };
  const one = (await (await s.post("/api/chats/final-cut/library/agent", { agent })).json()) as { id: string; revision: string };
  const two = (await (await s.post("/api/chats/final-cut/library/agent", { agent: { ...agent, id: one.id, revision: one.revision, name: "tightener", instructions: "Tighter." } })).json()) as { id: string; instructions: string; revision: string };
  expect(two).toMatchObject({ id: one.id, instructions: "Tighter." });
  for (const bad of [{ ...agent, temperature: 1.8 }, { ...agent, contextMessages: 0 }, { ...agent, instructions: "" }, { ...agent, connection: { id: "k" } }, { ...agent, presetPromptStates: { a: "yes" } }]) {
    expect((await s.post("/api/chats/final-cut/library/agent", { agent: bad })).status).toBe(400);
  }
  expect(((await (await s.handler(apiReq("/api/chats/final-cut/library"))).json()) as { agents: unknown[] }).agents).toHaveLength(1);
  expect(await (await s.post("/api/chats/final-cut/library/agent/delete", { id: one.id, revision: two.revision })).json()).toEqual({ deleted: true });
  expect(((await (await s.handler(apiReq("/api/chats/final-cut/library"))).json()) as { agents: unknown[] }).agents).toEqual([]);
});

test("a re-run cannot run the scene's regex (it runs only in the page): it says so, unless the pass has the toggle off", async () => {
  const s = await scene();
  await s.store.save({ schemaVersion: CANONICAL_SCHEMA_VERSION, kind: "regex", id: "rx", body: { name: "Dress", rules: [{ id: "r1", label: "r1", find: "storm", flags: "g", replace: "gale", phases: ["display"], enabled: true, sortOrder: 0 }] } } as never);
  await s.post("/api/chats/regex", { chatId: s.chatId, regex: { sets: ["rx"] } });
  await s.post("/api/chats/final-cut", { chatId: s.chatId, finalCut: { on: true, passes: [{ ...editor, applyRegexToInput: false }] } });
  asked.length = 0;
  const e = await turn(s, s.version);
  expect(e.some((x) => x.type === "regex")).toBe(false);
  const reply = (await s.open()).messages.at(-1)!;
  expect((await s.post("/api/chats/final-cut/rerun", { chatId: s.chatId, messageId: reply.id })).status).toBe(200);
  await s.post("/api/chats/final-cut", { chatId: s.chatId, finalCut: { passes: [editor] } });
  const refused = await s.post("/api/chats/final-cut/rerun", { chatId: s.chatId, messageId: reply.id });
  expect(refused.status).toBe(409);
  expect(JSON.stringify(await refused.json())).toContain("cannot run this scene's regex");
});

test("an applied re-run edits the reply (the old text stays in the edit history) and is kept in the reply's run; a preview never is", async () => {
  const s = await scene();
  await s.post("/api/chats/final-cut", { chatId: s.chatId, finalCut: { on: true, passes: [editor] } });
  await turn(s, s.version);
  const reply = (await s.open()).messages.at(-1)!;
  const run = async () => (await (await s.handler(apiReq(`/api/chats/final-cut/run?chatId=${s.chatId}&messageId=${reply.id}`))).json()) as { text: string; run: { reruns?: { before: string; after: string }[] } };
  const first = await run();
  passBody = "A second pass, a colder light.";
  const pre = (await (await s.post("/api/chats/final-cut/rerun", { chatId: s.chatId, messageId: reply.id })).json()) as { rerunId: string; text: string };
  passBody = "It might, and the light holds.";
  expect(pre.rerunId.length).toBeGreaterThan(8);
  expect((await run()).run.reruns).toBeUndefined();
  const open = await s.open();
  const applied = await s.post("/api/chats/final-cut/rerun/apply", { chatId: s.chatId, rerunId: pre.rerunId, expectedVersion: open.branchVersion });
  expect(applied.status).toBe(200);
  expect(((await applied.json()) as { recorded: boolean }).recorded).toBe(true);
  const after = await run();
  expect(after.text).toBe(pre.text);
  expect(after.run.reruns).toEqual([expect.objectContaining({ before: first.text, after: pre.text })]);
  const edited = (await s.open()).messages.at(-1)!;
  expect(edited.swipes[edited.current]!.content).toBe(pre.text);
  // One preview applies once: it is spent.
  expect((await s.post("/api/chats/final-cut/rerun/apply", { chatId: s.chatId, rerunId: pre.rerunId, expectedVersion: (await s.open()).branchVersion })).status).toBe(404);
});

test("applying a re-run is refused when the scene moved on, the reply was edited since, or the preview is unknown", async () => {
  const s = await scene();
  await s.post("/api/chats/final-cut", { chatId: s.chatId, finalCut: { on: true, passes: [editor] } });
  await turn(s, s.version);
  const reply = (await s.open()).messages.at(-1)!;
  passBody = "Another body entirely.";
  const pre = (await (await s.post("/api/chats/final-cut/rerun", { chatId: s.chatId, messageId: reply.id })).json()) as { rerunId: string };
  passBody = "It might, and the light holds.";
  expect((await s.post("/api/chats/final-cut/rerun/apply", { chatId: s.chatId, rerunId: pre.rerunId, expectedVersion: 1 })).status).toBe(409);
  await s.post("/api/chats/edit", { messageId: reply.id, swipeId: (reply.swipes[reply.current] as unknown as { id: string }).id, content: "I changed it.", expectedVersion: (await s.open()).branchVersion });
  expect((await s.post("/api/chats/final-cut/rerun/apply", { chatId: s.chatId, rerunId: pre.rerunId, expectedVersion: (await s.open()).branchVersion })).status).toBe(409);
  expect((await s.post("/api/chats/final-cut/rerun/apply", { chatId: s.chatId, rerunId: "nope", expectedVersion: (await s.open()).branchVersion })).status).toBe(404);
  expect((await s.post("/api/chats/final-cut/rerun/apply", { chatId: "other", rerunId: pre.rerunId, expectedVersion: 1 })).status).toBe(404);
});

test("on a core scene, the reply runs through the pass before rp-core commits it, and the saved version keeps what the pass did", async () => {
  asked.length = 0;
  const s = await scene(true);
  expect((await s.post("/api/chats/final-cut", { chatId: s.chatId, finalCut: { on: true, passes: [editor] } })).status).toBe(200);
  const e = await turn(s, s.version);
  expect(e.map((x) => x.type)).toContain("finalcut");
  expect(e.at(-1)!.type).toBe("done");
  const reply = (await s.open()).messages.at(-1)!;
  expect(reply.swipes[reply.current]!.content).toBe("It might, and the light holds.");
  expect(reply.swipes[reply.current]!.generation!.finalCut).toEqual({ passes: 1, changed: true, failed: 0 });
  const run = (await (await s.handler(apiReq(`/api/chats/final-cut/run?chatId=${s.chatId}&messageId=${reply.id}`))).json()) as { run: { original: string } };
  expect(run.run.original).toBe("It might.");
});


test("on a core scene, an applied re-run edits the reply in rp-core's journal and is kept in the reply's run", async () => {
  const s = await scene(true);
  await s.post("/api/chats/final-cut", { chatId: s.chatId, finalCut: { on: true, passes: [editor] } });
  await turn(s, s.version);
  const reply = (await s.open()).messages.at(-1)!;
  passBody = "A second pass, a colder light.";
  const pre = (await (await s.post("/api/chats/final-cut/rerun", { chatId: s.chatId, messageId: reply.id })).json()) as { rerunId: string; text: string };
  passBody = "It might, and the light holds.";
  const applied = await s.post("/api/chats/final-cut/rerun/apply", { chatId: s.chatId, rerunId: pre.rerunId, expectedVersion: (await s.open()).branchVersion });
  if (applied.status !== 200) throw new Error(`${applied.status}: ${await applied.text()}`);
  expect(((await applied.json()) as { recorded: boolean }).recorded).toBe(true);
  const edited = (await s.open()).messages.at(-1)!;
  expect(edited.swipes[edited.current]!.content).toBe(pre.text);
  // The next request reads the journal: it carries the applied text.
  const next = (await (await s.post("/api/chats/send", { chatId: s.chatId, content: "Then what?", greetingIndex: 0, expectedVersion: (await s.open()).branchVersion })).json()) as { branchVersion: number };
  await turn(s, next.branchVersion);
  expect(asked.filter((a) => !/post-generation|Anti-Slop Engine/.test(a.messages[0]?.content ?? "")).at(-1)!.messages.map((m) => m.content)).toContain(pre.text);
});
