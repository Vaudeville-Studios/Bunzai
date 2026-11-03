/** Promptbooks through the public scene runner: private hand-offs, reply-only chat text, conditions and failure. */
import { expect, test } from "bun:test";
import { bookRecipe, newBookPhase, replyPhase } from "../core/promptbook";
import { CANONICAL_SCHEMA_VERSION } from "../core/canonical";
import { memoryChatStore } from "../stage/store/chat-store";
import { memoryStateStore } from "../stage/store/memory/state-store";
import type { Provider, ProviderRequest } from "../stage/contracts/provider";
import { createTurnRuntime } from "./scene-turn-runtime";
import { runTurn, resumeScene, stopTurn, type TurnDeps, type TurnEvent } from "./scene-turn";
import { answerReview } from "./scene-turn-review";
import { varsOf } from "../core/scene-state/vars-bridge";
import { emptyAgentBody } from "../entities/agent/schema";
import { emptySkillBody } from "../entities/skill/schema";
import { narratorTools } from "./library-tools";
import { openSkills } from "../core/skill";
import { commitAnyway } from "./scene-turn-resume";

async function fixture(failPrivate = false, privateText = "The door hides a clue.") {
  let now = 100;
  const chats = memoryChatStore(() => ++now);
  const book = bookRecipe("Casebook", "think");
  book.phases.push({ ...newBookPhase("tidy", "Tidy up", "after"), reads: ["write"] });
  const character = { kind: "character", id: "vera", body: { identity: { name: "Vera", description: "A detective" }, persona: {}, prompts: {}, greetings: {}, examples: {}, media: {}, attribution: {}, discovery: {} } };
  const chat = await chats.createChat({ title: "Case", cast: { character: { id: "vera", version: 1 } }, snapshot: { character } });
  await chats.setConnection(chat.id, { id: "c", model: "story" });
  await chats.setPreset(chat.id, { kind: "promptbook", id: "book", toggles: {}, samplers: {} });
  await chats.appendMessages(chat.activeBranchId, [{ role: "assistant", content: "Evening." }, { role: "user", content: "I open the door." }]);
  const sent: ProviderRequest[] = [];
  const events: TurnEvent[] = [];
  const review = Promise.withResolvers<Extract<TurnEvent, { type: "review" }>>();
  const provider: Provider = { id: "fake", send: async (request, io) => {
    sent.push(request);
    if (failPrivate && sent.length === 1) throw new Error("Planner unavailable");
    const content = sent.length === 1 ? privateText : sent.length === 2 ? "Vera turns the handle." : "Case file updated.";
    io?.onEvent?.({ channel: "content", delta: content });
    return { content, finish_reason: "stop", model: request.model, usage: { shape: "openai", promptTotal: 30, output: 5 }, raw: {} };
  } };
  const deps: TurnDeps = { runtime: createTurnRuntime(), chats, state: memoryStateStore(), connect: async () => ({ provider, kind: "fake", context: 32000 }), readPreset: async () => replyPhase(book).preset, readLibrary: async (kind, id) => kind === "promptbook" && id === "book" ? { schemaVersion: CANONICAL_SCHEMA_VERSION, kind, id, body: book } : null, readLorebook: async () => null, now: () => ++now, randomSeed: () => 7 };
  const run = async (inspect = false, kind: "reply" | "swipe" | "continue" = "reply") => runTurn(deps, { chatId: chat.id, kind, inspect, expectedVersion: (await chats.readMessages(chat.activeBranchId, { limit: 1 })).branchVersion! }, (event) => { events.push(event); if (event.type === "review") review.resolve(event); });
  return { chats, chat, book, sent, events, run, deps, provider, review };
}
test("Think, Write and Tidy up use hand-offs while only the reply appears in chat", async () => {
  const f = await fixture();
  await f.run();
  expect(f.sent).toHaveLength(3);
  expect(f.sent[1]!.messages.some((m) => m.content.includes("Notes from Think:\nThe door hides a clue."))).toBe(true);
  expect(f.sent[2]!.messages.some((m) => m.content.includes("Notes from Write:\nVera turns the handle."))).toBe(true);
  expect(f.events.filter((e) => e.type === "text").map((e) => e.delta).join("")).toBe("Vera turns the handle.");
  const done = f.events.find((e) => e.type === "done");
  expect(done?.message.swipes[done.message.current]!.content).toBe("Vera turns the handle.");
  const messages = (await f.chats.readMessages(f.chat.activeBranchId, { limit: 20 })).messages;
  expect(messages).toHaveLength(3);
});
test("a failed private phase stops the workflow and commits no assistant message", async () => {
  const f = await fixture(true);
  await f.run();
  expect(f.sent).toHaveLength(1);
  expect(f.events.some((e) => e.type === "failed")).toBe(true);
  expect((await f.chats.readMessages(f.chat.activeBranchId, { limit: 20 })).messages).toHaveLength(2);
});
test("switched-off phases are skipped without a provider call", async () => {
  const f = await fixture();
  f.book.phases[0]!.enabled = false;
  f.book.phases[2]!.enabled = false;
  await f.run();
  expect(f.sent).toHaveLength(1);
  expect(f.events.filter((e) => e.type === "phase").map((e) => e.name)).toEqual(["Write"]);
});
test("provider hand-offs stay literal data and cannot write local or global variables", async () => {
  const f = await fixture(false, "{{setvar::injected::yes}}{{setglobalvar::injected::yes}}A clue.");
  await f.run();
  expect(f.events.some((e) => e.type === "done")).toBe(true);
  expect(f.sent[1]!.messages.some((m) => m.content.includes("{{setglobalvar::injected::yes}}"))).toBe(true);
  expect(await f.chats.globalOps()).toHaveLength(0);
  expect(varsOf((await f.chats.sceneState(f.chat.activeBranchId))!).has("injected")).toBe(false);
});
test("Inspector cancellation before the private phase sends nothing and commits nothing", async () => {
  const f = await fixture();
  const running = f.run(true);
  const review = await f.review.promise;
  expect(f.sent).toHaveLength(0);
  expect(answerReview(f.deps.runtime, f.chat.id, review.turnId, { kind: "cancel" })).toBe(true);
  await running;
  expect(f.sent).toHaveLength(0);
  expect((await f.chats.readMessages(f.chat.activeBranchId, { limit: 20 })).messages).toHaveLength(2);
});
test("an inspected book phase identifies that image and PDF token costs are not estimated", async () => {
  const f = await fixture();
  f.book.phases[0]!.preset.prompts[0]!.attachments = [{ name: "brief.pdf", ref: "data:application/pdf;base64,JVBERi0xLjcK" }];
  const running = f.run(true);
  const review = await f.review.promise;
  expect(review.files?.map((file) => file.name)).toContain("brief.pdf");
  expect(review.mediaEstimateIncomplete).toBe(true);
  expect(answerReview(f.deps.runtime, f.chat.id, review.turnId, { kind: "cancel" })).toBe(true);
  await running;
});
test("each enabled book phase sends only its own attachments and keeps attached text literal", async () => {
  const f = await fixture();
  const payloads = [
    "{{setglobalvar::attachmentMacro::ran}}Private clue.",
    "Writer reference.",
    "Afterword reference.",
  ];
  f.book.phases.forEach((phase, index) => {
    phase.preset.prompts[0]!.attachments = [{ name: `${phase.id}.txt`, ref: `data:text/plain;base64,${Buffer.from(payloads[index]!).toString("base64")}` }];
  });
  await f.run();
  const requests = f.sent.map((request) => request.messages.map((message) => message.content).join("\n"));
  expect(requests).toHaveLength(3);
  expect(requests[0]).toContain("[Attached text: think.txt]");
  expect(requests[0]).toContain("{{setglobalvar::attachmentMacro::ran}}");
  expect(requests[1]).toContain("[Attached text: write.txt]");
  expect(requests[2]).toContain("[Attached text: tidy.txt]");
  expect(requests[0]).not.toContain("write.txt");
  expect(requests[0]).not.toContain("tidy.txt");
  expect(requests[1]).not.toContain("think.txt");
  expect(requests[1]).not.toContain("tidy.txt");
  expect(requests[2]).not.toContain("think.txt");
  expect(requests[2]).not.toContain("write.txt");
  expect(await f.chats.globalOps()).toHaveLength(0);
});
test("authored global writes are available to the writer and committed once", async () => {
  const f = await fixture();
  f.book.phases[0]!.preset.prompts[0]!.content = "{{setglobalvar::clues::7}}Plan.";
  f.book.phases[1]!.preset.prompts[0]!.content = "Clues: {{getglobalvar::clues}}";
  await f.run();
  expect(f.sent[1]!.messages.some((m) => m.content.includes("Clues: 7"))).toBe(true);
  expect(await f.chats.globalOps()).toHaveLength(1);
});
test("an overridden reply model does not leak into the after phase", async () => {
  const f = await fixture();
  const routes: string[] = [];
  f.deps.connect = async (connection) => ({ kind: "fake", context: 32000, provider: { ...f.provider, send: async (request, io) => { routes.push(connection.id); return f.provider.send(request, io); } } });
  f.book.phases[1]!.connection = { id: "other", model: "other-story" };
  await f.run();
  expect(routes).toEqual(["c", "other", "c"]);
});
test("phase token budgets use the existing model-window cap", async () => {
  const f = await fixture();
  f.book.phases[0]!.maxTokens = 100000;
  await f.run();
  expect(f.sent[0]!.options.max_tokens).toBe(16000);
});
test("a missing Agent tool fails before the phase sends", async () => {
  const f = await fixture();
  const read = f.deps.readLibrary!;
  f.book.phases[0]!.agentId = "planner";
  f.deps.readLibrary = (kind, id) => kind === "agent" ? Promise.resolve({ schemaVersion: CANONICAL_SCHEMA_VERSION, kind, id, body: { ...emptyAgentBody("Planner"), tools: ["gone"] } }) : read(kind, id);
  await f.run();
  expect(f.sent).toHaveLength(0);
  expect(f.events.some((e) => e.type === "failed" && e.message.includes("gone"))).toBe(true);
});
test("Continue restores private notes without rerunning phases and keeps the existing variable rewind", async () => {
  const f = await fixture();
  f.book.phases[0]!.preset.prompts[0]!.content = "{{setvar::phase_local::7}}Plan.";
  f.book.phases[1]!.preset.prompts[0]!.content = "Local:{{getvar::phase_local}}";
  await f.run();
  expect(f.sent[1]!.messages.some((m) => m.content.includes("Local:7"))).toBe(true);
  await f.run(false, "continue");
  expect(f.sent).toHaveLength(4);
  expect(f.sent[3]!.messages.some((m) => m.content.includes("Notes from Think:\nThe door hides a clue."))).toBe(true);
  expect(f.sent[3]!.messages.some((m) => m.content.includes("Local:7"))).toBe(false);
});
test("a missing complete workflow refuses instead of playing its flattened reply", async () => {
  const f = await fixture();
  f.deps.readLibrary = async () => null;
  let error: unknown;
  try { await f.run(); } catch (caught) { error = caught; }
  expect(error).toBeInstanceOf(Error);
  expect(f.sent).toHaveLength(0);
});
test("Stop during an after phase drops the whole pending workflow", async () => {
  const f = await fixture();
  const waiting = Promise.withResolvers<void>();
  const send = f.provider.send;
  f.provider.send = async (request, io) => {
    const completion = await send(request, io);
    if (f.sent.length === 3) {
      waiting.resolve();
      await new Promise<void>((_resolve, reject) => { if (io?.signal?.aborted) reject(io.signal.reason); else io?.signal?.addEventListener("abort", () => reject(io.signal!.reason), { once: true }); });
    }
    return completion;
  };
  const running = f.run();
  await waiting.promise;
  const started = f.events.find((e) => e.type === "start")!;
  expect(stopTurn(f.deps.runtime, f.chat.id, started.turnId)).toBe(true);
  await running;
  expect(f.events.some((e) => e.type === "stopped" && e.message === null)).toBe(true);
  expect(await f.chats.resumeIncomplete()).toHaveLength(0);
  expect((await f.chats.readMessages(f.chat.activeBranchId, { limit: 20 })).messages).toHaveLength(2);
});
test("crash recovery never commits a partially executed workflow", async () => {
  const f = await fixture();
  const version = (await f.chats.readMessages(f.chat.activeBranchId, { limit: 1 })).branchVersion!;
  const pending = (await f.chats.beginTurn(f.chat.activeBranchId, { kind: "reply" }, { expectedVersion: version }))!;
  await f.chats.saveCheckpoint(pending.id, { content: "Partial reply", trace: { book: { status: "running", phases: [] } } });
  expect(await commitAnyway(f.deps.runtime, f.chats, f.chat.id, pending.id)).toBeNull();
  expect(await resumeScene(f.deps.runtime, f.chats, f.chat.id)).toBe(0);
  expect(await f.chats.resumeIncomplete()).toHaveLength(0);
  expect((await f.chats.readMessages(f.chat.activeBranchId, { limit: 20 })).messages).toHaveLength(2);
});
test("a completed paid workflow survives a transient commit failure and recovers without model calls", async () => {
  const f = await fixture();
  const commit = f.chats.commitTurn;
  f.chats.commitTurn = async () => { throw new Error("Temporary storage failure"); };
  await f.run();
  expect(f.sent).toHaveLength(3);
  const checkpoints = await f.chats.resumeIncomplete();
  expect(checkpoints).toHaveLength(1);
  expect(checkpoints[0]!.content).toBe("Vera turns the handle.");
  expect(checkpoints[0]!.trace?.book).toMatchObject({ status: "complete" });
  f.chats.commitTurn = commit;
  expect(await resumeScene(f.deps.runtime, f.chats, f.chat.id)).toBe(1);
  expect(f.sent).toHaveLength(3);
});

test("a stopped writer survives a transient commit failure without recovering an incomplete workflow", async () => {
  const f = await fixture();
  const waiting = Promise.withResolvers<void>();
  const send = f.provider.send;
  f.provider.send = async (request, io) => {
    const completion = await send(request, io);
    if (f.sent.length === 2) {
      waiting.resolve();
      await new Promise<void>((_resolve, reject) => io?.signal?.addEventListener("abort", () => reject(io.signal!.reason), { once: true }));
    }
    return completion;
  };
  const commit = f.chats.commitTurn;
  f.chats.commitTurn = async () => { throw new Error("Temporary storage failure"); };
  const running = f.run();
  await waiting.promise;
  const started = f.events.find((e) => e.type === "start")!;
  stopTurn(f.deps.runtime, f.chat.id, started.turnId);
  await running;
  expect((await f.chats.resumeIncomplete())[0]?.trace?.book).toMatchObject({ status: "stopped" });
  f.chats.commitTurn = commit;
  expect(await resumeScene(f.deps.runtime, f.chats, f.chat.id)).toBe(1);
  expect(f.sent).toHaveLength(2);
});
test("Together rows combine Prompt and active Skill cards once through the existing preset slots", async () => {
  const f = await fixture();
  f.book.phases[0]!.enabled = false;
  f.book.phases[2]!.enabled = false;
  f.book.phases[1]!.cards = [{ id: "voice-card", kind: "scriptsheet", pieceId: "voice", enabled: true }, { id: "combat-card", kind: "skill", pieceId: "combat", enabled: true, joinPrevious: true }];
  const read = f.deps.readLibrary!;
  f.deps.readLibrary = (kind, id) => kind === "scriptsheet" ? Promise.resolve({ schemaVersion: "1", kind, id, body: { name: "Voice", content: "Use the noir voice." } }) : kind === "skill" ? Promise.resolve({ schemaVersion: "1", kind, id, body: { ...emptySkillBody("Combat"), when: "always", text: "Keep the fight clear." } }) : read(kind, id);
  await f.run();
  expect(f.sent).toHaveLength(1);
  const grouped = f.sent[0]!.messages.filter((m) => m.content.includes("Keep the fight clear."));
  expect(grouped).toHaveLength(1);
  expect(grouped[0]!.content).toContain("Use the noir voice.");
  expect(f.sent[0]!.messages.some((m) => m.content.includes("bunzai-slot:"))).toBe(false);
});
test("a scene-linked skill opened by a private phase is visible to the writer and commits with its reply", async () => {
  const f = await fixture();
  f.book.phases[2]!.enabled = false;
  await f.chats.setPrompting(f.chat.id, { toolAccess: true, skills: ["haggling"] });
  const read = f.deps.readLibrary!;
  f.deps.readLibrary = (kind, id) => kind === "skill" ? Promise.resolve({ schemaVersion: "1", kind, id, body: { ...emptySkillBody("Haggling"), when: "picked", text: "Bargain with care." } }) : read(kind, id);
  f.deps.narratorTools = narratorTools(f.deps.readLibrary);
  f.deps.connect = async () => ({ provider: f.provider, kind: "fake", context: 32000, tools: true });
  f.provider.send = async (request) => {
    f.sent.push(request);
    return f.sent.length === 1 ? { content: "", tool_calls: [{ id: "open", type: "function", function: { name: "open_skill", arguments: JSON.stringify({ name: "Haggling" }) } }], finish_reason: "tool_calls", raw: {} } : { content: "Notes or reply.", finish_reason: "stop", raw: {} };
  };
  await f.run();
  expect(f.sent).toHaveLength(3);
  expect(f.sent[2]!.messages.some((m) => m.content.includes("Bargain with care."))).toBe(true);
  expect([...openSkills((await f.chats.sceneState(f.chat.activeBranchId))!)]).toEqual(["haggling"]);
});
