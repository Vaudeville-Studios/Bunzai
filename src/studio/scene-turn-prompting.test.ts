/**
 * A turn with the Prompting wing's settings (ChatStore rule 37): the scene note and the scene's switched-on
 * guides reach the request on the right turns, and nothing of them is stored in the transcript.
 */
import { describe, expect, test } from "bun:test";
import { createTurnRuntime } from "./scene-turn-runtime";
import type { PresetBody } from "../entities/preset/schema";
import type { Provider, ProviderCompletion, ProviderRequest } from "../stage/contracts/provider";
import { memoryChatStore } from "../stage/store/chat-store";
import { memoryStateStore } from "../stage/store/memory/state-store";
import { deleteGuide, saveGuide } from "./guides";
import { runTurn, stopTurn, type Connected, type TurnEvent } from "./scene-turn";
import { varsOf } from "../core/scene-state/vars-bridge";
import { countText } from "../core/tokens";
import { answerReview } from "./scene-turn-review";

const vera = {
  kind: "character",
  id: "vera",
  body: { identity: { name: "Vera", description: "Keeps the light." }, persona: {}, prompts: {}, greetings: {}, examples: {}, media: {}, attribution: {}, discovery: {} },
};
const withPrefill: PresetBody = {
  name: "Quill",
  prompts: [
    { id: "main", name: "main", content: "Write as {{char}}.{{persona}}{{lore}}{{summary}}", role: "system", enabled: true, systemPrompt: true, marker: false, placement: "relative", injectionDepth: 4, injectionOrder: 100, forbidOverrides: false },
    { id: "h", name: "h", content: "{{message_history}}", role: "system", enabled: true, systemPrompt: true, marker: false, placement: "relative", injectionDepth: 4, injectionOrder: 100, forbidOverrides: false },
  ],
  systemPrompts: { assistantPrefill: "Preset:" },
};

async function scene(options: { context?: number; applyExtensionPrompts?: (sceneId: string, messages: readonly { role: "system" | "user" | "assistant" | "tool"; content: string }[], signal: AbortSignal) => Promise<readonly string[]> } = {}) {
  let now = 1_000;
  const chats = memoryChatStore(() => now);
  const state = memoryStateStore();
  const chat = await chats.createChat({ title: "Night", cast: { character: { id: "vera", version: 1 } }, snapshot: { character: vera } });
  await chats.setConnection(chat.id, { id: "conn", model: "vera-1" });
  await chats.appendMessages(chat.activeBranchId, [{ role: "assistant", content: "Evening." }, { role: "user", content: "Any storms?" }]);
  const sent: ProviderRequest[] = [];
  const provider: Provider = {
    id: "fake",
    async send(request) {
      sent.push(request);
      return { content: "Maybe.", finish_reason: "stop", raw: {} } as ProviderCompletion;
    },
  };
  const deps = { runtime: createTurnRuntime(),
    chats,
    state,
    connect: async (): Promise<Connected | null> => ({ provider, kind: "openrouter", context: options.context ?? 32_000 }),
    readPreset: async () => withPrefill,
    readLorebook: async () => null,
    now: () => (now += 10),
    randomSeed: () => 7,
    ...(options.applyExtensionPrompts ? { applyExtensionPrompts: options.applyExtensionPrompts } : {}),
  };
  const events: TurnEvent[] = [];
  const turn = async (inspect = false) => {
    const version = (await chats.readMessages(chat.activeBranchId, { limit: 1 })).branchVersion!;
    return runTurn(deps, { chatId: chat.id, kind: "reply", expectedVersion: version, ...(inspect ? { inspect: true } : {}) }, (e) => events.push(e));
  };
  /** Another exchange: the person writes, and the reply is asked for. */
  const next = async (text: string) => {
    await chats.appendMessage(chat.activeBranchId, { role: "user", content: text });
    await turn();
  };
  const texts = (i: number) => sent[i]!.messages.map((m) => `${m.role}:${m.content}`);
  const trace = async () => {
    const message = (await chats.readMessages(chat.activeBranchId, { limit: 50 })).messages.at(-1)!;
    return (await chats.swipeTrace(message.id, message.swipes[message.current]!.id)) as Record<string, unknown>;
  };
  return { chats, state, chat, sent, events, turn, next, texts, trace, deps, now: () => now };
}

describe("the scene note on a live scene", () => {
  test("at depth 4, every 2nd turn: it rides turns 1, 3 and 5 and not 2 and 4, where RoleCall puts it", async () => {
    const s = await scene();
    await s.chats.setPrompting(s.chat.id, { note: { text: "Keep it tense.", position: "in_chat", depth: 4, frequency: 2 } });
    await s.turn();
    await s.next("Tell me more");
    await s.next("And then?");
    await s.next("Go on");
    await s.next("Last one");
    const has = s.sent.map((r) => r.messages.some((m) => m.content === "[Author's Note: Keep it tense.]"));
    expect(has).toEqual([true, false, true, false, true]);
    // Turn 1 has only two chat messages, so depth 4 is past the total and the note sits before the first.
    expect(s.texts(0)).toEqual(["system:Keeps the light.", "system:[Author's Note: Keep it tense.]", "assistant:Evening.", "user:Any storms?"]);
    // Turn 5 has 10 chat messages (greeting, 4 exchanges and the question): depth 4 is before the last five.
    const t5 = s.texts(4);
    const at = t5.indexOf("system:[Author's Note: Keep it tense.]");
    expect(t5.slice(at + 1)).toEqual(["user:And then?", "assistant:Maybe.", "user:Go on", "assistant:Maybe.", "user:Last one"]);
  });

  test("a scene with no note sends none, and the note is never written into the transcript", async () => {
    const s = await scene();
    await s.turn();
    expect(s.sent[0]!.messages.some((m) => m.content.includes("Author's Note"))).toBe(false);
    await s.chats.setPrompting(s.chat.id, { note: { text: "Hold.", position: "after_scenario", depth: 4, frequency: 1 } });
    await s.next("More");
    const stored = (await s.chats.readMessages((await s.chats.getChat(s.chat.id))!.activeBranchId, { limit: 100 })).messages;
    expect(stored.every((m) => !m.swipes[m.current]!.content.includes("Hold."))).toBe(true);
    expect(s.sent[1]!.messages.some((m) => m.content === "[Author's Note: Hold.]")).toBe(true);
  });
});

describe("guides on a live scene", () => {
  test("a switched-on guide reaches the request; deleting it, or hiding it, takes it out; the transcript never holds it", async () => {
    const s = await scene();
    const next = (() => {
      let n = 0;
      return () => `g${++n}`;
    })();
    const user = await saveGuide(s.state, { title: "Push", content: "Push the plot.", role: "user" }, 1, next);
    const depth = await saveGuide(s.state, { title: "Mood", content: "Moody.", role: "system", mode: "depth", depth: 0 }, 2, next);
    await s.chats.setPrompting(s.chat.id, { guides: [user.id, depth.id] });
    await s.turn();
    expect(s.texts(0)).toEqual(["system:Keeps the light.", "assistant:Evening.", "user:Push the plot.\n\nAny storms?", "system:Moody."]);
    const stored = (await s.chats.readMessages((await s.chats.getChat(s.chat.id))!.activeBranchId, { limit: 100 })).messages;
    expect(stored.map((m) => m.swipes[m.current]!.content)).toEqual(["Evening.", "Any storms?", "Maybe."]);

    await deleteGuide(s.state, user.id, 9);
    await saveGuide(s.state, { id: depth.id, title: "Mood", content: "Moody.", role: "system", mode: "depth", depth: 0, visible: false }, 10, next);
    await s.next("Again");
    expect(s.texts(1)).toEqual(["system:Keeps the light.", "assistant:Evening.", "user:Any storms?", "assistant:Maybe.", "user:Again"]);
  });

  test("an assistant-role guide replaces the preset's prefill", async () => {
    const s = await scene();
    await s.chats.setPreset(s.chat.id, { kind: "preset", id: "quill", toggles: {}, samplers: {} });
    await s.turn();
    expect(s.texts(0).at(-1)).toBe("assistant:Preset:");
    const g = await saveGuide(s.state, { title: "Start", content: "Vera:", role: "assistant" }, 1, () => "p1");
    await s.chats.setPrompting(s.chat.id, { guides: [g.id] });
    await s.next("More");
    expect(s.texts(1).at(-1)).toBe("assistant:Vera:");
  });

  test("a chat-start guide runs on the first turn only: its variables are kept on the take and its latch stops a second run", async () => {
    const s = await scene();
    const g = await saveGuide(s.state, { title: "Init", content: "{{setvar::mood::calm}}", mode: "chat_start" }, 1, () => "s1");
    await s.chats.setPrompting(s.chat.id, { guides: [g.id] });
    await s.turn();
    const branch = (await s.chats.getChat(s.chat.id))!.activeBranchId;
    expect([...varsOf(await s.chats.sceneState(branch)).keys()].sort()).toEqual(["__rc_chat_start_fired::s1", "mood"]);
    expect(s.texts(0)).toEqual(["system:Keeps the light.", "assistant:Evening.", "user:Any storms?"]);
    // The person's own edit of mood, made on the message whose version set it, wins on that message, and the next reply builds from it.
    const tip = (await s.chats.readMessages(branch, { limit: 50 })).messages.at(-1)!;
    await s.chats.recordMessageDeltas(branch, tip.id, [{ slot: "vars", path: ["mood"], value: "stormy", at: 5 }]);
    await s.next("More");
    expect(varsOf(await s.chats.sceneState(branch)).get("mood")!.value).toBe("stormy");
  });
});

describe("extension prompt contributions", () => {
  test("a required hook failure stops before provider send and does not add a partial transcript message", async () => {
    const s = await scene({ applyExtensionPrompts: async () => { throw new Error("required prompt hook failed"); } });
    const before = (await s.chats.readMessages(s.chat.activeBranchId, { limit: 50 })).messages;
    await s.turn();
    expect(s.sent).toHaveLength(0);
    expect((await s.chats.readMessages(s.chat.activeBranchId, { limit: 50 })).messages).toEqual(before);
    expect(s.events.at(-1)).toMatchObject({ type: "failed" });
  });

  test("a named append reaches the provider and the stored token trace", async () => {
    const text = "Keep the archive quiet.";
    const s = await scene({ applyExtensionPrompts: async () => [text] });
    await s.turn();
    expect(s.events.at(-1)!.type).toBe("done");
    expect(s.sent[0]!.messages).toContainEqual({ role: "system", content: text });
    const storedTrace = await s.trace();
    expect(storedTrace).not.toBeNull();
    const blocks = storedTrace!["blocks"] as { source: Record<string, string>; role: string; tokens: number }[];
    expect(blocks).toContainEqual({ source: { kind: "prompt", name: "Extension contributions" }, role: "system", tokens: countText(text) });
  });

  test("a contribution that overflows is rejected before send, including after reviewed edits", async () => {
    const s = await scene({ context: 5_000, applyExtensionPrompts: async () => ["x".repeat(16_000)] });
    await s.turn();
    expect(s.sent).toHaveLength(0);
    expect(s.events.at(-1)).toMatchObject({ type: "failed", code: "context_length_exceeded" });

    const reviewed = await scene({ context: 100_000, applyExtensionPrompts: async () => ["small instruction"] });
    const pending = reviewed.turn(true);
    for (let i = 0; i < 200 && !reviewed.events.some((event) => event.type === "review"); i++) await new Promise((resolve) => setTimeout(resolve, 5));
    const review = reviewed.events.find((event) => event.type === "review");
    if (!review) {
      const start = reviewed.events.find((event) => event.type === "start");
      if (start?.type === "start") stopTurn(reviewed.deps.runtime, reviewed.chat.id, start.turnId);
      await pending;
      throw new Error(`review was not requested; last event: ${JSON.stringify(reviewed.events.at(-1))}`);
    }
    answerReview(reviewed.deps.runtime, reviewed.chat.id, review.type === "review" ? review.turnId : "", { kind: "send", edits: { 0: "x".repeat(500_000) } });
    await pending;
    expect(reviewed.sent).toHaveLength(0);
    expect(reviewed.events.at(-1)).toMatchObject({ type: "failed", code: "context_length_exceeded" });
  });
});
