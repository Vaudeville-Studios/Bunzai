/**
 * The turn loop (test plan) against a scripted provider: a reply, stop with
 * and without text, a failure, a conflict on commit and "add it anyway", a resumed crash, a new
 * version of the last reply, and the refusals before a turn opens.
 */
import { describe, expect, test } from "bun:test";
import { createTurnRuntime } from "./scene-turn-runtime";
import { ProviderError, type Provider, type ProviderCompletion, type ProviderEvent } from "../stage/contracts/provider";
import type { ChatStore } from "../stage/contracts/chat-store";
import type { ExtensionCommitContext } from "../stage/contracts/extension-store";
import { memoryChatStore } from "../stage/store/chat-store";
import { memoryStateStore } from "../stage/store/memory/state-store";
import { emptyLoreEntry, emptyLorebookBody } from "../core/lore";
import { commitAnyway, discardWaiting, NoConnectionError, resumeScene, runTurn, stopTurn, type Connected, type TurnEvent } from "./scene-turn";
import { StudioConflictError } from "./errors";
import { varsOf } from "../core/scene-state/vars-bridge";

const vera = {
  kind: "character",
  id: "vera",
  body: { identity: { name: "Vera", description: "Keeps the light." }, persona: {}, prompts: {}, greetings: {}, examples: {}, media: {}, attribution: {}, discovery: {} },
};

/** A provider that plays a script: streamed pieces, then a completion or a failure. `gate` holds it mid-stream. */
function scripted(script: { pieces: string[]; end?: Partial<ProviderCompletion>; fail?: ProviderError; gate?: Promise<void> }) {
  const sent: { messages: { role: string; content: string }[]; max_tokens?: number }[] = [];
  const provider: Provider = {
    id: "fake",
    async send(request, io) {
      sent.push({ messages: request.messages, ...(request.options.max_tokens ? { max_tokens: request.options.max_tokens } : {}) });
      let text = "";
      for (const piece of script.pieces) {
        io?.signal?.throwIfAborted();
        text += piece;
        io?.onEvent?.({ channel: "content", delta: piece } satisfies ProviderEvent);
        await Promise.resolve();
      }
      if (script.gate) {
        await Promise.race([script.gate, new Promise((_, reject) => io?.signal?.addEventListener("abort", () => reject(io.signal!.reason)))]);
      }
      io?.signal?.throwIfAborted();
      if (script.fail) throw script.fail;
      return { content: text, finish_reason: "stop", model: "vera-1-routed", usage: { shape: "openai", promptTotal: 120, output: 9 }, raw: {}, ...script.end } as ProviderCompletion;
    },
  };
  return { provider, sent };
}

async function scene(provider: Provider | null, opts: { connection?: boolean; extensionCommit?: boolean; userMessage?: string } = {}) {
  let now = 1_000;
  const chats = opts.extensionCommit
    ? memoryChatStore(() => now, () => crypto.randomUUID(), { authorizeExtensionCommit: () => undefined })
    : memoryChatStore(() => now);
  const state = memoryStateStore();
  const chat = await chats.createChat({ title: "Night", cast: { character: { id: "vera", version: 1 } }, snapshot: { character: vera } });
  if (opts.connection !== false) await chats.setConnection(chat.id, { id: "conn", model: "vera-1" });
  const [greeting, hello] = (await chats.appendMessages(chat.activeBranchId, [
    { role: "assistant", content: "Evening." },
    { role: "user", content: opts.userMessage ?? "{{setvar::asked::yes}}Any storms?" },
  ]))!;
  const deps = { runtime: createTurnRuntime(),
    chats,
    state,
    connect: async (): Promise<Connected | null> => (provider ? { provider, kind: "openrouter", context: 32_000 } : null),
    readPreset: async () => null,
    readLorebook: async () => null,
    now: () => (now += 10),
    randomSeed: () => 7,
  };
  const version = async () => (await chats.readMessages(chat.activeBranchId, { limit: 1 })).branchVersion!;
  const events: TurnEvent[] = [];
  const turn = async (kind: "reply" | "swipe" = "reply", expectedVersion?: number, extensionCommit?: ExtensionCommitContext) =>
    runTurn(deps, { chatId: chat.id, kind, expectedVersion: expectedVersion ?? (await version()) }, (e) => events.push(e), extensionCommit);
  const texts = async () => (await chats.readMessages(chat.activeBranchId, { limit: 50 })).messages.map((m) => m.swipes[m.current]!.content);
  return { chats, state, chat, greeting: greeting!, hello: hello!, deps, events, turn, texts, version };
}

/** Waits for an event, polling on timers so a turn that went wrong fails the test instead of hanging it. */
async function waitFor(events: TurnEvent[], type: TurnEvent["type"]): Promise<void> {
  for (let i = 0; i < 200; i++) {
    if (events.some((e) => e.type === type)) return;
    await Bun.sleep(5);
  }
  throw new Error(`no ${type} event; saw ${JSON.stringify(events)}`);
}

const turnIdOf = (events: TurnEvent[]) => (events.find((e) => e.type === "start") as Extract<TurnEvent, { type: "start" }>).turnId;

const lastOf = async (chats: ChatStore, branchId: string) => (await chats.readMessages(branchId, { limit: 50 })).messages.at(-1)!;

describe("a reply", () => {
  test("extension turns do not inherit narrator tools from the scene", async () => {
    const { provider, sent } = scripted({ pieces: ["Reply."] });
    const s = await scene(provider, { extensionCommit: true, userMessage: "{{setglobalvar::extensionLeak::yes}}Any storms?" });
    let narratorToolsCalled = 0;
    const extensionDeps = {
      ...s.deps,
      narratorTools: () => { narratorToolsCalled++; return []; },
      connect: async (): Promise<Connected | null> => ({ provider, kind: "openrouter", context: 32_000, tools: true }),
    };
    const commit: ExtensionCommitContext = {
      owner: "00000000-0000-4000-8000-000000000001", epoch: 1, packageId: "fixture.extension",
      packageDigest: "a".repeat(64), policyFingerprint: "b".repeat(64), grantRevision: 1, operation: "turns.start",
      access: { resources: [{ kind: "scene", id: s.chat.id }, { kind: "take", id: s.chat.activeBranchId }], fields: ["turn.run", "state"], methods: [], destinations: [] }, now: () => 1,
    };
    await runTurn(extensionDeps, { chatId: s.chat.id, kind: "reply", expectedVersion: await s.version() }, () => undefined, commit);
    expect(narratorToolsCalled).toBe(0);
    expect(sent).toHaveLength(1);
    expect(await s.chats.sceneState(s.chat.activeBranchId)).not.toHaveProperty("global");
  });

  test("streams, commits with its generation and trace, writes variables first, and teaches the meter", async () => {
    const { provider, sent } = scripted({ pieces: ["It ", "might."] });
    const s = await scene(provider);
    await s.turn();
    expect(s.events.map((e) => e.type)).toEqual(["start", "text", "text", "done"]);
    expect(await s.texts()).toEqual(["Evening.", "{{setvar::asked::yes}}Any storms?", "It might."]);
    const reply = await lastOf(s.chats, s.chat.activeBranchId);
    expect(reply.swipes[0]!.generation).toMatchObject({ model: "vera-1-routed", finishReason: "stop", promptTokens: 120, completionTokens: 9, presetName: "No Preset (Defaults)" });
    const trace = await s.chats.swipeTrace(reply.id, reply.swipes[0]!.id);
    expect(trace).toMatchObject({ estimate: { samples: 0 }, budget: { budgeter: "app" }, request: { model: "vera-1", stream: true }, usage: { promptTotal: 120 } });
    expect(sent[0]!.messages.map((m) => m.content)).toEqual(["Keeps the light.", "Evening.", "Any storms?"]);
    expect(sent[0]!.max_tokens).toBe(8192);
    expect(varsOf(await s.chats.sceneState(s.chat.activeBranchId)).get("asked")!.value).toBe("yes");
    expect(await s.state.read("meter")).toContain("openrouter|vera-1|vera-1-routed");
    expect(await s.chats.resumeIncomplete()).toEqual([]);
  });

  test("native reasoning is kept with the reply, with the model that produced it", async () => {
    const s = await scene(scripted({ pieces: ["Yes."], end: { reasoning: "Weigh the sky." } }).provider);
    await s.turn();
    expect((await lastOf(s.chats, s.chat.activeBranchId)).swipes[0]!.generation?.reasoning).toEqual({ text: "Weigh the sky.", provider: "fake", model: "vera-1-routed" });
  });

  test("a new version of the last reply lands as a swipe on it", async () => {
    const s = await scene(scripted({ pieces: ["Again."] }).provider);
    await s.turn();
    await s.turn("swipe");
    const reply = await lastOf(s.chats, s.chat.activeBranchId);
    expect([reply.swipes.map((w) => w.content), reply.current]).toEqual([["Again.", "Again."], 1]);
  });

  test("a turn begun before another version was selected is stale, and nothing is sent", async () => {
    const { provider, sent } = scripted({ pieces: ["One."] });
    const s = await scene(provider);
    await s.turn();
    await s.turn("swipe");
    const stale = await s.version();
    const reply = await lastOf(s.chats, s.chat.activeBranchId);
    await s.chats.selectSwipe(reply.id, 0);
    await expect(s.turn("swipe", stale)).rejects.toBeInstanceOf(StudioConflictError);
    expect(sent.length).toBe(2);
  });
});

describe("checkpoints", () => {
  test("the text is saved as it streams, every 400 characters, so a crash mid-reply loses little", async () => {
    let release!: () => void;
    const s = await scene(scripted({ pieces: ["a".repeat(250), "b".repeat(250), "c".repeat(100)], gate: new Promise((r) => (release = r)) }).provider);
    const running = s.turn();
    await waitFor(s.events, "text");
    await Bun.sleep(20);
    expect((await s.chats.resumeIncomplete())[0]!.content).toBe("a".repeat(250) + "b".repeat(250));
    release();
    await running;
  });
});

describe("stop, failure, conflict", () => {
  test("stop keeps what arrived as the reply, finish reason stopped", async () => {
    let release!: () => void;
    const s = await scene(scripted({ pieces: ["Half a "], gate: new Promise((r) => (release = r)) }).provider);
    const running = s.turn();
    await waitFor(s.events, "text");
    expect(stopTurn(s.deps.runtime, s.chat.id, turnIdOf(s.events))).toBe(true);
    await running;
    release();
    const reply = await lastOf(s.chats, s.chat.activeBranchId);
    expect([reply.swipes[0]!.content, reply.swipes[0]!.generation?.finishReason]).toEqual(["Half a ", "stopped"]);
    expect(s.events.at(-1)).toMatchObject({ type: "stopped", message: { id: reply.id } });
  });

  test("stop before any text stores nothing and leaves no checkpoint", async () => {
    let release!: () => void;
    const s = await scene(scripted({ pieces: [], gate: new Promise((r) => (release = r)) }).provider);
    const running = s.turn();
    await waitFor(s.events, "start");
    stopTurn(s.deps.runtime, s.chat.id, turnIdOf(s.events));
    await running;
    release();
    expect(await s.texts()).toEqual(["Evening.", "{{setvar::asked::yes}}Any storms?"]);
    expect(s.events.at(-1)).toEqual({ type: "stopped", message: null });
    expect(await s.chats.resumeIncomplete()).toEqual([]);
  });

  test("a failure saves nothing, drops the checkpoint at once, and hands back the draft with its category", async () => {
    const fail = new ProviderError("slow down", { category: "rate_limit_error", code: "rate_limit_exceeded", status: 429 });
    const s = await scene(scripted({ pieces: ["Par", "tial"], fail }).provider);
    await s.turn();
    expect(s.events.at(-1)).toEqual({ type: "failed", category: "rate_limit_error", code: "rate_limit_exceeded", message: "slow down", draft: "Partial" });
    expect((await s.texts()).length).toBe(2);
    expect(await s.chats.resumeIncomplete()).toEqual([]);
  });

  test("a write that lands mid-stream makes the commit a conflict; the text is kept and can be added anyway", async () => {
    let release!: () => void;
    const s = await scene(scripted({ pieces: ["Kept."], gate: new Promise((r) => (release = r)) }).provider);
    const running = s.turn();
    await waitFor(s.events, "text");
    await s.chats.appendMessage(s.chat.activeBranchId, { role: "user", content: "meanwhile" });
    release();
    await running;
    const conflict = s.events.at(-1) as Extract<TurnEvent, { type: "conflict" }>;
    expect(conflict).toMatchObject({ type: "conflict", draft: "Kept." });
    expect((await s.chats.resumeIncomplete())[0]!.content).toBe("Kept.");
    await commitAnyway(s.deps.runtime, s.chats, s.chat.id, conflict.turnId);
    expect((await s.texts()).slice(-2)).toEqual(["meanwhile", "Kept."]);
  });
});

describe("before a turn opens", () => {
  test("no connection, or one Kit has deleted, is refused and nothing opens", async () => {
    const none = await scene(scripted({ pieces: ["x"] }).provider, { connection: false });
    await expect(none.turn()).rejects.toBeInstanceOf(NoConnectionError);
    const gone = await scene(null);
    await expect(gone.turn()).rejects.toBeInstanceOf(NoConnectionError);
    expect(await gone.chats.resumeIncomplete()).toEqual([]);
  });

  test("a second turn while one is answering is refused, and the first finishes untouched", async () => {
    let release!: () => void;
    const s = await scene(scripted({ pieces: ["First."], gate: new Promise((r) => (release = r)) }).provider);
    const first = s.turn();
    await waitFor(s.events, "text");
    await expect(s.turn()).rejects.toBeInstanceOf(StudioConflictError);
    release();
    await first;
    expect((await s.texts()).at(-1)).toBe("First.");
  });

    test("a take that does not end with a message to answer is refused", async () => {
    const s = await scene(scripted({ pieces: ["Once."] }).provider);
    await s.turn();
    await expect(s.turn("reply")).rejects.toBeInstanceOf(StudioConflictError);
  });
});

describe("fixes from review, 2026-09-28", () => {
  test("the meter learns under the backend the reply names, and the next turn reads what it learned", async () => {
    const s = await scene(scripted({ pieces: ["One."] }).provider);
    await s.turn();
    await s.chats.appendMessage(s.chat.activeBranchId, { role: "user", content: "More?" });
    await s.turn();
    const reply = await lastOf(s.chats, s.chat.activeBranchId);
    expect(await s.chats.swipeTrace(reply.id, reply.swipes[0]!.id)).toMatchObject({ estimate: { samples: 1 } });
  });

  test("two takes answering at once are tracked apart: Stop reaches the right one, and opening the scene resumes neither", async () => {
    let releaseA!: () => void;
    let releaseB!: () => void;
    const gates = [new Promise<void>((r) => (releaseA = r)), new Promise<void>((r) => (releaseB = r))];
    let call = 0;
    const provider: Provider = { id: "fake", send: (req, io) => scripted({ pieces: [call === 0 ? "A" : "B"], gate: gates[call++]! }).provider.send(req, io) };
    const s = await scene(provider);
    const a = s.turn();
    await waitFor(s.events, "text");
    const turnA = turnIdOf(s.events);
    const take = await s.chats.fork(s.chat.activeBranchId, s.hello.id);
    const eventsB: TurnEvent[] = [];
    const b = runTurn(s.deps, { chatId: s.chat.id, kind: "reply", expectedVersion: (await s.chats.readMessages(take!.id, { limit: 1 })).branchVersion! }, (e) => eventsB.push(e));
    await waitFor(eventsB, "text");
    expect(await resumeScene(s.deps.runtime, s.chats, s.chat.id)).toBe(0);
    expect(stopTurn(s.deps.runtime, "another-scene", turnIdOf(eventsB))).toBe(false);
    expect(stopTurn(s.deps.runtime, s.chat.id, turnIdOf(eventsB))).toBe(true);
    await b;
    releaseB();
    releaseA();
    await a;
    expect(s.events.at(-1)?.type).toBe("done");
    expect(eventsB.at(-1)?.type).toBe("stopped");
    expect(stopTurn(s.deps.runtime, s.chat.id, turnA)).toBe(false);
  });

  test("add it anyway and discard never touch a turn that is still streaming", async () => {
    let release!: () => void;
    const s = await scene(scripted({ pieces: ["Live."], gate: new Promise((r) => (release = r)) }).provider);
    const running = s.turn();
    await waitFor(s.events, "text");
    expect(await commitAnyway(s.deps.runtime, s.chats, s.chat.id, turnIdOf(s.events))).toBeNull();
    expect(await discardWaiting(s.deps.runtime, s.chats, s.chat.id, turnIdOf(s.events))).toBe(false);
    release();
    await running;
    expect(s.events.at(-1)?.type).toBe("done");
  });

  test("a reply that arrives but cannot be saved is kept whole, and comes back when the scene reopens", async () => {
    const s = await scene(scripted({ pieces: ["Whole ", "reply."] }).provider);
    const failing = { ...s.chats, commitTurn: async () => { throw new Error("the library is busy in another window"); } } as ChatStore;
    const events: TurnEvent[] = [];
    await runTurn({ ...s.deps, chats: failing }, { chatId: s.chat.id, kind: "reply", expectedVersion: await s.version() }, (e) => events.push(e));
    expect(events.at(-1)).toMatchObject({ type: "failed", draft: "Whole reply." });
    expect((await s.chats.resumeIncomplete())[0]!.content).toBe("Whole reply.");
    expect(await resumeScene(s.deps.runtime, s.chats, s.chat.id)).toBe(1);
    expect((await s.texts()).at(-1)).toBe("Whole reply.");
  });
});

describe("a crash keeps what arrived", () => {
  test("an open checkpoint with text is committed as interrupted; an empty one is dropped", async () => {
    const s = await scene(scripted({ pieces: [] }).provider);
    const open = await s.chats.beginTurn(s.chat.activeBranchId, { kind: "reply" });
    await s.chats.saveCheckpoint(open!.id, { content: "Cut off mid" });
    expect(await resumeScene(s.deps.runtime, s.chats, s.chat.id)).toBe(1);
    const reply = await lastOf(s.chats, s.chat.activeBranchId);
    expect([reply.swipes[0]!.content, reply.swipes[0]!.generation?.finishReason]).toEqual(["Cut off mid", "interrupted"]);

    await s.chats.appendMessage(s.chat.activeBranchId, { role: "user", content: "and?" });
    await s.chats.beginTurn(s.chat.activeBranchId, { kind: "reply" });
    expect(await resumeScene(s.deps.runtime, s.chats, s.chat.id)).toBe(0);
    expect(await s.chats.resumeIncomplete()).toEqual([]);
  });

  test("a crashed reply whose take moved on still lands, at the end", async () => {
    const s = await scene(scripted({ pieces: [] }).provider);
    const open = await s.chats.beginTurn(s.chat.activeBranchId, { kind: "reply" });
    await s.chats.saveCheckpoint(open!.id, { content: "Late" });
    await s.chats.appendMessage(s.chat.activeBranchId, { role: "user", content: "later" });
    expect(await resumeScene(s.deps.runtime, s.chats, s.chat.id)).toBe(1);
    expect((await s.texts()).slice(-2)).toEqual(["later", "Late"]);
  });
});

describe("the turn kind reaches the lore engine (2e-d7 plan step 5)", () => {
  const veraWithBook = {
    kind: "character",
    id: "vera",
    body: {
      identity: { name: "Vera", description: "Keeps the light." }, persona: {}, prompts: {}, greetings: {}, examples: {},
      media: {}, attribution: {}, discovery: {}, knowledgeRefs: ["b1"],
    },
  };
  const swipeOnlyEntry = {
    ...emptyLoreEntry("e1"),
    title: "Swipe-only", content: "SWIPEHIT", constant: false, position: "prepend_top" as const,
    triggers: [{ keyword: "[generationType:swipe]", isRegex: false }],
  };
  const bookB1 = { id: "b1", name: "Book", body: { ...emptyLorebookBody("Book"), entries: [swipeOnlyEntry] } };

  test("a reply runs generationType 'normal' (a [generationType:swipe] entry stays silent); a swipe fires it", async () => {
    let now = 1_000;
    const chats = memoryChatStore(() => now);
    const state = memoryStateStore();
    const chat = await chats.createChat({ title: "Night", cast: { character: { id: "vera", version: 1 } }, snapshot: { character: veraWithBook } });
    await chats.setConnection(chat.id, { id: "conn", model: "vera-1" });
    await chats.appendMessages(chat.activeBranchId, [{ role: "assistant", content: "Evening." }, { role: "user", content: "Any storms?" }]);
    const deps = { runtime: createTurnRuntime(),
      chats,
      state,
      connect: async (): Promise<Connected | null> => ({ provider: scripted({ pieces: ["Maybe."] }).provider, kind: "openrouter", context: 32_000 }),
      readPreset: async () => null,
      readLorebook: async (id: string) => (id === "b1" ? bookB1 : null),
      now: () => (now += 10),
      randomSeed: () => 7,
    };
    const version = async () => (await chats.readMessages(chat.activeBranchId, { limit: 1 })).branchVersion!;

    const replyEvents: TurnEvent[] = [];
    await runTurn(deps, { chatId: chat.id, kind: "reply", expectedVersion: await version() }, (e) => replyEvents.push(e));
    await waitFor(replyEvents, "done");
    const replied = await lastOf(chats, chat.activeBranchId);
    const replyTrace = (await chats.swipeTrace(replied.id, replied.swipes[replied.current]!.id)) as { lore?: { injected: unknown[] } } | null;
    expect(replyTrace?.lore?.injected).toEqual([]);

    const swipeEvents: TurnEvent[] = [];
    await runTurn(deps, { chatId: chat.id, kind: "swipe", expectedVersion: await version() }, (e) => swipeEvents.push(e));
    await waitFor(swipeEvents, "done");
    const swiped = await lastOf(chats, chat.activeBranchId);
    const swipeTrace = (await chats.swipeTrace(swiped.id, swiped.swipes[swiped.current]!.id)) as { lore?: { injected: unknown[] } } | null;
    expect(swipeTrace?.lore?.injected.length).toBe(1);
  });
});

describe("the trace's verdicts are plain JSON, even with an undefined detail field (th-t3 plan step 1)", () => {
  const veraWithBook = {
    kind: "character",
    id: "vera",
    body: {
      identity: { name: "Vera", description: "Keeps the light." }, persona: {}, prompts: {}, greetings: {}, examples: {},
      media: {}, attribution: {}, discovery: {}, knowledgeRefs: ["b1"],
    },
  };
  // An "entry" budget mode book cutting an entry gives that miss's verdict a `detail.left` the
  // engine leaves explicitly undefined (budget.ts / engine.ts): the exact shape checkTrace's isJson
  // (chat-rules.ts) refuses unless traceOf strips it before the store ever sees it.
  const kept = { ...emptyLoreEntry("keep"), title: "Keep", content: "KEEP", constant: true, priority: 100, sortOrder: 0 };
  const budgetCut = { ...emptyLoreEntry("cut"), title: "Cut", content: "CUT", constant: true, priority: 1, sortOrder: 1 };
  const off = { ...emptyLoreEntry("off"), title: "Off", content: "OFF", enabled: false };
  const book = { id: "b1", name: "Book", body: { ...emptyLorebookBody("Book"), budgetMode: "entry" as const, entryBudget: 1, entries: [kept, budgetCut, off] } };

  test("a reply with a per-book entry-budget cut and a disabled entry still commits", async () => {
    let now = 1_000;
    const chats = memoryChatStore(() => now);
    const state = memoryStateStore();
    const chat = await chats.createChat({ title: "Night", cast: { character: { id: "vera", version: 1 } }, snapshot: { character: veraWithBook } });
    await chats.setConnection(chat.id, { id: "conn", model: "vera-1" });
    await chats.appendMessages(chat.activeBranchId, [{ role: "assistant", content: "Evening." }, { role: "user", content: "Any storms?" }]);
    const deps = { runtime: createTurnRuntime(),
      chats,
      state,
      connect: async (): Promise<Connected | null> => ({ provider: scripted({ pieces: ["Maybe."] }).provider, kind: "openrouter", context: 32_000 }),
      readPreset: async () => null,
      readLorebook: async (id: string) => (id === "b1" ? book : null),
      now: () => (now += 10),
      randomSeed: () => 7,
    };
    const version = async () => (await chats.readMessages(chat.activeBranchId, { limit: 1 })).branchVersion!;
    const events: TurnEvent[] = [];
    await runTurn(deps, { chatId: chat.id, kind: "reply", expectedVersion: await version() }, (e) => events.push(e));
    await waitFor(events, "done");
    expect(events.map((e) => e.type)).toEqual(["start", "text", "done"]);
    const reply = await lastOf(chats, chat.activeBranchId);
    const trace = (await chats.swipeTrace(reply.id, reply.swipes[reply.current]!.id)) as {
      blocks: unknown[];
      lore?: { verdicts: { entryKey: string; fired: boolean; reason: string; detail?: Record<string, unknown> }[] };
    } | null;
    const byKey = new Map(trace!.lore!.verdicts.map((v) => [v.entryKey, v]));
    expect(byKey.get("b1:keep")).toMatchObject({ fired: true });
    expect(byKey.get("b1:off")).toMatchObject({ fired: false, reason: "disabled" });
    const cutVerdict = byKey.get("b1:cut")!;
    expect(cutVerdict).toMatchObject({ fired: false, reason: "budget-cut" });
    // The engine's own undefined `left` never reaches the stored trace.
    expect(cutVerdict.detail && "left" in cutVerdict.detail).toBe(false);
    expect(JSON.parse(JSON.stringify(trace))).toEqual(trace);

    // Rule 22, in the same commit: request.texts lines up with the stored trace's blocks.
    const lastRequest = await chats.lastRequest(chat.activeBranchId);
    expect(lastRequest).toEqual({ messageId: reply.id, swipeId: reply.swipes[reply.current]!.id, texts: expect.any(Array) });
    expect(lastRequest!.texts).toHaveLength(trace!.blocks.length);
  });
});

describe("reasoning", () => {
  /** A provider that thinks natively, then writes a tagged thought and the reply, with the clock set by hand at each step. */
  function thinker(clock: { t: number }, [open, close] = ["<think>", "</think>"]) {
    const steps: [number, ProviderEvent][] = [
      [100, { channel: "reasoning", delta: "Weigh " }],
      [150, { channel: "reasoning", delta: "the sky." }],
      [400, { channel: "content", delta: open + "plan" }],
      [1_000, { channel: "content", delta: " it" + close }],
      [1_100, { channel: "content", delta: "Yes." }],
    ];
    const provider: Provider = {
      id: "fake",
      async send(_request, io) {
        for (const [t, event] of steps) { clock.t = t; io?.onEvent?.(event); }
        clock.t = 1_200;
        return { content: open + "plan it" + close + "Yes.", reasoning: "Weigh the sky.", finish_reason: "stop", model: "m", raw: {} } as ProviderCompletion;
      },
    };
    return provider;
  }

  test("native reasoning streams as its own events and both thinking times are stored with the reply", async () => {
    const clock = { t: 0 };
    const s = await scene(thinker(clock));
    s.deps.now = () => clock.t;
    await s.turn();
    expect(s.events.filter((e) => e.type === "reasoning")).toEqual([{ type: "reasoning", delta: "Weigh " }, { type: "reasoning", delta: "the sky." }]);
    const generation = (await lastOf(s.chats, s.chat.activeBranchId)).swipes[0]!.generation;
    expect(generation?.reasoningMs).toBe(300);
    expect(generation?.tagThinkingMs).toBe(600);
  });

  test("the preset's own markers time the tagged thinking", async () => {
    const clock = { t: 0 };
    const s = await scene(thinker(clock, ["[[", "]]"]));
    s.deps.readPreset = async () => ({ name: "P", prompts: [], reasoning: { prefix: "[[", suffix: "]]", separator: "" } }) as never;
    await s.chats.setPreset(s.chat.id, { kind: "preset", id: "p", toggles: {}, samplers: {} });
    s.deps.now = () => clock.t;
    await s.turn();
    expect((await lastOf(s.chats, s.chat.activeBranchId)).swipes[0]!.generation?.tagThinkingMs).toBe(600);
  });

  test("a reply with no thinking stores no thinking time", async () => {
    const s = await scene(scripted({ pieces: ["Plain."] }).provider);
    await s.turn();
    const generation = (await lastOf(s.chats, s.chat.activeBranchId)).swipes[0]!.generation;
    expect(generation).not.toHaveProperty("reasoningMs");
    expect(generation).not.toHaveProperty("tagThinkingMs");
  });
});
