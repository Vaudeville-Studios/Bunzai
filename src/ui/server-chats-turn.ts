/**
 * The turn routes: a reply or a new version streamed as server-sent
 * events, Stop, "add it anyway" or "discard" after a conflict, and the AI wing's picker (the saved Kit
 * connections a scene may use, a connection's models, and the scene's pick, ChatStore rule 18), and
 * the scene's preset with its own toggles and samplers (ChatStore rule 19).
 * A turn keeps running if the page closes: the reply lands in the scene either way.
 *
 * PERF: every provider's "text" events arrive here through the same funnel
 * - `runTurn`'s one `emit` callback (scene-turn.ts) - regardless of which spoke produced them, so one
 * coalescer at this single choke point batches Anthropic, OpenAI-compatible, and any future spoke
 * alike; no provider reader needs its own copy. `coalesceTurnEvents` throttles "text" events to at
 * most one emitted frame per ~40 ms or ~768 characters, whichever comes first, and flushes whatever
 * is pending immediately before any other event type (start/done/stopped/failed/conflict) - so a
 * terminal outcome, Stop included, is never held behind a batched token and no text is ever dropped
 * or reordered.
 */
import { toErrorMessage } from "../error-message";
import { createSceneCore } from "./server-scene-composition";
import { sceneRuntimeFor } from "./server-scene-runtime";
import { hasErrorName, isRecord, str } from "../core/guards";
import type { ChatBackdrop, ChatConnection, ChatPreset, ChatStore } from "../stage/contracts/chat-store";
import type { ProviderRole } from "../stage/contracts/provider";
import type { StateStore } from "../stage/contracts/state-store";
import { listModelsFor } from "../kit/providers/adapters";
import { connect } from "../kit/providers/scene-connect";
import { spokes } from "../kit/providers/registry";
import { sceneRefusal } from "../kit/providers/scene";
import { readVault } from "../kit/providers/vault";
import { commitAnyway, discardWaiting, stopTurn, type Connected, type TurnEvent } from "../studio/scene-turn";
import type { ReadPreset } from "../studio/scene-turn-load";
import { answerReview, type ReviewDecision } from "../studio/scene-turn-review";
import { answerRegex, regexAnswerOf } from "../studio/scene-turn-regex";
import type { ReadLorebook } from "../studio/scene-lore";
import type { SettingsStoreLike, StudioStoreLike } from "../studio/contracts";
import type { CompendiumDeps } from "../studio/compendium-deps";
import { BASE_SUPPORT } from "../stage/params/wire";
import { libraryFor } from "../studio/library-content";
import type { CoreTurnOwner, CoreTurnFrame, CoreTurnStart } from "../studio/core-turn-owner";
import { choiceDefaultsOf, regexReaderOf, toolBudgetOf } from "./server-scene-readers";
import { corePromptRegex } from "./server-core-regex";
import { coreFinalCut } from "./server-core-final-cut";
import { finalCutBanksOf } from "../studio/final-cut-library";
import type { RegexSetBody } from "../entities/regex/schema";
import { ensureCoreScene, INCOMPLETE_CORE_SCENE_MESSAGE } from "../studio/core-scene";
import { projectCoreSceneTurnEvent } from "../extensions/contracts/events";
import { corePlan, type CoreSceneParts } from "../studio/core-turn-plan";
import { narratorTools } from "../studio/library-tools";
import { runOwnedTask } from "../studio/scene-turn-runtime";
import { sceneFollowOns } from "./server-scene-composition";
import { err, json } from "./server-security";

type Body = Record<string, unknown>;

async function coreStream(chats: ChatStore, owner: CoreTurnOwner, sessionId: string, b: Body, dispatchExtensionEvent?: (payload: unknown) => Promise<void>, applyExtensionPrompts?: (sceneId: string, messages: readonly { role: ProviderRole; content: string }[], signal: AbortSignal) => Promise<readonly string[]>, hasPromptContributors?: (sceneId: string) => Promise<boolean>, choiceDefaults?: CoreTurnStart["choiceDefaults"], readRegex?: (id: string) => Promise<RegexSetBody | null>, cutDeps?: { readPreset: ReadPreset; readLorebook: ReadLorebook; state: StateStore; readLibrary?: (kind: string, id: string) => Promise<unknown | null>; compendium?: CompendiumDeps | null | undefined; toolBudgetMs?: () => Promise<number | undefined> }): Promise<Response> {
  const chatId = str(b["chatId"]);
  const kind = b["kind"] === "reply" || b["kind"] === "swipe" || b["kind"] === "continue" ? b["kind"] : null;
  const chat = await chats.getChat(chatId);
  if (!chat || !kind || !chat.connection || typeof b["expectedVersion"] !== "number") return err("choose a model and send a message first");
  const branch = (await chats.listBranches(chatId)).find((take) => take.id === chat.activeBranchId);
  if (branch?.version !== b["expectedVersion"]) return err("the scene changed; reload it and try again", 409);
  let started!: () => void;
  let rejectStart!: (error: unknown) => void;
  let didStart = false;
  const firstEvent = new Promise<void>((resolve, reject) => { started = resolve; rejectStart = reject; });
  const buffered: TurnEvent[] = [];
  let send: (event: TurnEvent) => void = (event) => { buffered.push(event); };
  const coalescer = coalesceTurnEvents((event) => send(event));
  const transformRequest = corePromptRegex({ chatId, setIds: chat.regex?.sets, readRegex, runtime: sceneRuntimeFor(chats),
    names: { user: chat.cast.persona?.name ?? "User", char: chat.cast.character.name ?? "" }, emit: (event) => coalescer.push(event) });
  const extensionHooks = applyExtensionPrompts ? {
    appendSystemContributions: async ({ messages }: { messages: readonly import("rp-core").PromptMsg[] }, context: import("rp-core").HookCtx) => {
      if (messages.some((message) => message.blocks.some((block) => block.k !== "text"))) {
        if (!hasPromptContributors || !await hasPromptContributors(chatId)) return [];
        throw new Error("The active extension prompt hooks cannot safely represent non-text Core messages.");
      }
      return applyExtensionPrompts(chatId, messages.map((message) => ({ role: message.role as ProviderRole, content: message.blocks.filter((block) => block.k === "text").map((block) => block.text).join("") })), context.signal);
    },
  } : undefined;
  const cut = cutDeps ? coreFinalCut({ chats, chat, emit: (event) => coalescer.push(event), banks: () => finalCutBanksOf(cutDeps.state),
    deps: { connect, now: Date.now, readPreset: cutDeps.readPreset, ...(readRegex ? { readRegex } : {}), runtime: sceneRuntimeFor(chats) } }) : undefined;
  const hooked = { ...extensionHooks, ...(transformRequest ? { transformRequest } : {}), ...(cut?.transformReply ? { transformReply: cut.transformReply } : {}) };
  // Bunzai's Director, recall and the jobs a reply starts; without the library's readers the turn runs on what it has (a headless consumer).
  const runtime = sceneRuntimeFor(chats);
  const plan = cutDeps ? corePlan({ chats, state: cutDeps.state, readPreset: cutDeps.readPreset, readLorebook: cutDeps.readLorebook, ...(cutDeps.readLibrary ? { readLibrary: cutDeps.readLibrary } : {}), ...(choiceDefaults ? { choiceDefaults } : {}),
    connect, now: Date.now, runtime, emit: (event) => coalescer.push(event), narratorTools: narratorTools(cutDeps.readLibrary), ...(cutDeps.toolBudgetMs ? { toolBudgetMs: cutDeps.toolBudgetMs } : {}) }, chat, kind) : undefined;
  const followOns = cutDeps ? sceneFollowOns(chats, connect, cutDeps.readLibrary, cutDeps.compendium) : undefined;
  const after = (event: TurnEvent) => { if (followOns && !runtime.closed) void runOwnedTask(runtime, () => followOns({ chatId, kind }, event)).catch(() => undefined); };
  let scenePlan: CoreSceneParts | undefined;
  const hostHooks = plan ? (_fingerprint: string, scene: { parts?: CoreSceneParts } | null) => { scenePlan = scene?.parts; return plan.hooks(hooked, scene?.parts); } : Object.keys(hooked).length ? hooked : undefined;
  const work = owner.run({ sceneId: chatId, sessionId, kind, expectedBranchVersion: b["expectedVersion"], actor: { kind: "host" }, ...(choiceDefaults ? { choiceDefaults } : {}), ...(cut || plan ? { replyExtras: async (as: "done" | "stopped") => { const made = cut?.extras(), recalled = plan?.trace(), deltas = await plan?.deltas(as, scenePlan?.closing); return { ...made, ...(made?.trace || recalled ? { trace: { ...made?.trace, ...recalled } } : {}), ...(deltas?.length ? { deltas } : {}) }; } } : {}),
    ...(hostHooks ? { hostHooks } : {}), ...(typeof b["guidance"] === "string" ? { guidance: b["guidance"] } : {}), ...(b["inspect"] === true ? { inspect: true } : {}),
  }, async ({ event, projected }: CoreTurnFrame) => {
    let output: TurnEvent | null = null;
    if (event.type === "start") output = { type: "start", turnId: event.turnId, kind: event.kind, messageId: null };
    else if (event.type === "text" || event.type === "reasoning") output = { type: event.type, delta: event.delta };
    else if (event.type === "prefill") output = { type: "prefill", text: event.text };
    else if (event.type === "gate" && event.kind === "review") {
      const payload = event.payload as { messages?: Array<{ role: string; blocks: Array<{ k: string; text?: string }> }> };
      const messages = (payload.messages ?? []).map((item) => ({ role: item.role as ProviderRole, content: item.blocks.filter((block) => block.k === "text").map((block) => block.text ?? "").join("") }));
      output = { type: "review", turnId: event.turnId, messages, tokens: Math.ceil(messages.reduce((n, item) => n + item.content.length, 0) / 4) };
    } else if (event.type === "failed") output = { type: "failed", category: event.category, code: event.code, message: event.message, draft: event.draft };
    else if (event.type === "conflict") output = { type: "conflict", turnId: event.turnId, draft: event.draft };
    else if (event.type === "done" && projected) output = { type: "done", message: projected };
    else if (event.type === "stopped") output = { type: "stopped", message: projected };
    if (event.type === "start" || event.type === "done" || event.type === "failed" || event.type === "stopped") {
      const payload = projectCoreSceneTurnEvent(chatId, kind, event.type);
      await dispatchExtensionEvent?.(payload).catch(() => undefined);
    }
    if (event.type === "done" && projected) await plan?.landed(projected).catch(() => undefined);
    if (output) { coalescer.push(output); after(output); }
    if (event.type === "start" && !didStart) { didStart = true; started(); }
  });
  void work.catch((error) => { if (!didStart) rejectStart(error); });
  try { await firstEvent; }
  catch (error) { return err(toErrorMessage(error, "the Core turn could not start"), error instanceof Error && hasErrorName(error, "StudioConflictError") ? 409 : 400); }
  const encoder = new TextEncoder();
  let detached = false;
  const response = new Response(new ReadableStream<Uint8Array>({
    start(controller) {
      const write = (event: TurnEvent) => { if (!detached) controller.enqueue(encoder.encode(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`)); };
      for (const event of buffered.splice(0)) write(event);
      send = write;
      void work.then(() => { coalescer.flush(); if (!detached) controller.close(); }, (error) => { if (!detached) controller.error(error); });
    },
    cancel() { detached = true; coalescer.flush(); },
  }), { headers: { "content-type": "text/event-stream", "cache-control": "no-store", "x-accel-buffering": "no" } });
  return response;
}

const FLUSH_MS = 40;
const FLUSH_CHARS = 768;

/**
 * Batches a turn's "text" and "reasoning" events before they reach `send` (M5): a throttle, not a debounce - the
 * timer starts when the first token of a batch arrives and is never pushed back by the next one, so
 * a steady stream still flushes every ~40 ms instead of waiting for a lull. `full` events (a whole
 * replace, never a delta) reset the pending run instead of appending to it, exactly as the client's
 * own `applyStreamEvent` would read the merged result: no text is ever dropped or reordered.
 */
function coalesceTurnEvents(send: (e: TurnEvent) => void): { push(e: TurnEvent): void; flush(): void } {
  // Reply text and native reasoning are two streams with one batch open at a time: a piece of the other kind sends the open batch first.
  let kind: "text" | "reasoning" = "text";
  let pendingFull: string | null = null;
  let pendingDelta = "";
  let pendingChars = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;

  function clearTimer(): void {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  }
  function flush(): void {
    clearTimer();
    if (pendingFull === null && pendingDelta === "") return;
    const event: TurnEvent = pendingFull !== null ? { type: kind, delta: pendingFull, full: true } : { type: kind, delta: pendingDelta };
    pendingFull = null;
    pendingDelta = "";
    pendingChars = 0;
    send(event);
  }
  function push(e: TurnEvent): void {
    if (e.type !== "text" && e.type !== "reasoning") {
      // Every other event ends or redirects the turn: whatever text is pending goes first, in order,
      // then this event, immediately - never batched behind the next timer or char threshold.
      flush();
      send(e);
      return;
    }
    if (e.type !== kind) {
      flush();
      kind = e.type;
    }
    if (e.full) {
      pendingFull = e.delta;
      pendingDelta = "";
    } else if (pendingFull !== null) {
      pendingFull += e.delta;
    } else {
      pendingDelta += e.delta;
    }
    pendingChars += e.delta.length;
    if (pendingChars >= FLUSH_CHARS) {
      flush();
      return;
    }
    if (timer === null) timer = setTimeout(flush, FLUSH_MS);
  }
  return { push, flush };
}

/** The connections the AI wing lists: never a key, and each one a scene cannot use says why. */
async function connections(): Promise<Response> {
  const [vault, catalog] = await Promise.all([readVault(), spokes()]);
  return json(
    vault.providers.flatMap((p) => {
      if (!p.id) return [];
      const spoke = catalog.get(p.kind);
      const why = sceneRefusal(spoke);
      return [{
        id: p.id,
        kind: p.kind,
        label: p.name ?? spoke?.label ?? p.kind,
        model: p.model,
        ...(p.context ? { context: p.context } : {}),
        ...(spoke?.scene ? { params: Object.keys(spoke.scene.params ?? BASE_SUPPORT) } : {}),
        ...(why ? { unavailable: why } : {}),
      }];
    }),
  );
}

async function models(id: string): Promise<Response> {
  const saved = (await readVault()).providers.find((p) => p.id === id);
  if (!saved) return err("that connection is gone from Kit", 404);
  try {
    const list = await listModelsFor(saved);
    // null: the provider has no model list; the wing offers the model saved on the connection.
    return json({ models: list, saved: saved.model });
  } catch (e) {
    return json({ models: null, saved: saved.model, failed: toErrorMessage(e, "the model list could not be read") });
  }
}

/** One turn as server-sent events. Errors before it opens are plain HTTP errors, thrown to the caller. */
async function stream(chats: ChatStore, state: StateStore, readPreset: ReadPreset, readLorebook: ReadLorebook, b: Body, studio?: StudioStoreLike, compendium?: CompendiumDeps | null, settings?: SettingsStoreLike, dispatchExtensionEvent?: (payload: unknown) => Promise<void>, applyExtensionPrompts?: (sceneId: string, messages: readonly { role: ProviderRole; content: string }[], signal: AbortSignal) => Promise<readonly string[]>): Promise<Response> {
  const kind = b["kind"] === "swipe" || b["kind"] === "reply" || b["kind"] === "continue" ? b["kind"] : null;
  const expectedVersion = b["expectedVersion"];
  if (!kind || typeof expectedVersion !== "number") return err('expected { chatId, kind: "reply" | "swipe" | "continue", expectedVersion }');
  if (b["guidance"] !== undefined && typeof b["guidance"] !== "string") return err("guidance must be text");
  if (b["inspect"] !== undefined && typeof b["inspect"] !== "boolean") return err("inspect must be true or false");
  // The person's Fallback Model rides with the request (their pref lives in the browser); only a whole connection counts.
  const fb = b["fallback"] as Body | null | undefined;
  const fallback = fb && typeof fb === "object" && str(fb["id"]) && str(fb["model"]) ? { id: str(fb["id"]), model: str(fb["model"]) } : undefined;
  const encoder = new TextEncoder();
  let controllerSend: (e: TurnEvent) => void = () => {};
  const buffered: TurnEvent[] = [];
  let opened!: () => void;
  const start = new Promise<void>((resolve) => (opened = resolve));
  // Coalesced once, ahead of both the pre-open buffer and the live controller (M5): whichever sink is
  // live when a batch flushes gets the same merged event either way.
  let turnId = "";
  const coalescer = coalesceTurnEvents((e) => {
    buffered.push(e);
    controllerSend(e);
  });
  const core = createSceneCore(chats, state, readPreset, readLorebook, studio, settings, compendium, dispatchExtensionEvent, applyExtensionPrompts);
  const turn = core.runTurn(
    { chatId: str(b["chatId"]), kind, expectedVersion, ...(fallback ? { fallback } : {}), ...(typeof b["guidance"] === "string" ? { guidance: b["guidance"] } : {}), ...(b["inspect"] === true ? { inspect: true } : {}) },
    (e) => {
      if (e.type === "start") { opened(); turnId = e.turnId; }
      coalescer.push(e);
    },
  );
  // Refused before a checkpoint opened: answer it as an error, not an empty stream.
  await Promise.race([start, turn]);
  let done = false;
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (e: TurnEvent) => {
        if (done) return;
        try {
          controller.enqueue(encoder.encode(`event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`));
        } catch {
          done = true;
        }
      };
      for (const e of buffered) send(e);
      controllerSend = send;
      void turn.catch(() => undefined).finally(() => {
        // Stop and abort still flush what arrived: the turn is over, so nothing more will coalesce
        // with it.
        coalescer.flush();
        if (done) return;
        done = true;
        try { controller.close(); } catch { /* the page already left */ }
      });
    },
    cancel() {
      // A turn paused for review has no one left to answer it: it is cancelled, so nothing waits forever.
      answerReview(sceneRuntimeFor(chats), str(b["chatId"]), turnId, { kind: "cancel" });
      answerRegex(sceneRuntimeFor(chats), str(b["chatId"]), turnId, { kind: "cancel" });
      // The page left; the turn does not stop with it. Still clear the pending flush timer: nothing
      // is listening for it to fire.
      done = true;
      coalescer.flush();
    },
  });
  return new Response(body, { headers: { "content-type": "text/event-stream", "cache-control": "no-store", "x-accel-buffering": "no" } });
}

/** The Prompt Inspector's answer, parsed once: Cancel, or Send with each edit a whole-number index and its text. */
function reviewDecision(b: Body): ReviewDecision | null {
  if (b["kind"] === "cancel") return { kind: "cancel" };
  if (b["kind"] !== "send") return null;
  const raw = b["edits"] ?? {};
  if (!isRecord(raw)) return null;
  const edits: Record<number, string> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (!/^[0-9]{1,4}$/.test(k) || typeof v !== "string") return null;
    edits[Number(k)] = v;
  }
  return { kind: "send", edits };
}

/** The turn routes, or null when the path is not one of them. */
export async function handleTurnRoute(req: Request, url: URL, chats: ChatStore, state: StateStore, readPreset: ReadPreset, readLorebook: ReadLorebook, b: Body | null, studio?: StudioStoreLike, compendium?: CompendiumDeps | null, settings?: SettingsStoreLike, dispatchExtensionEvent?: (payload: unknown) => Promise<void>, applyExtensionPrompts?: (sceneId: string, messages: readonly { role: ProviderRole; content: string }[], signal: AbortSignal) => Promise<readonly string[]>, hasPromptContributors?: (sceneId: string) => Promise<boolean>): Promise<Response | null> {
  const p = url.pathname;
  if (req.method === "GET") {
    if (p === "/api/chats/connections") return connections();
    if (p === "/api/chats/models") return models(url.searchParams.get("id") ?? "");
    return null;
  }
  if (!b) return null;
  if (p === "/api/chats/turn") {
    const home = studio?.studioPath();
    const stores = home ? libraryFor(home) : null;
    const records = stores?.core;
    const resolvedCore = records && home ? await ensureCoreScene(chats, records, home, str(b["chatId"])) : null;
    if (resolvedCore?.incomplete) return err(INCOMPLETE_CORE_SCENE_MESSAGE, 409);
    const core = resolvedCore?.link ?? null;
    if (core && (await chats.getChat(str(b["chatId"])))?.activeBranchId !== core.branchId) return err("this take is not connected to rp-core yet", 409);
    if (records && core) return stores?.coreTurns ? coreStream(chats, stores.coreTurns, core.sessionId, b, dispatchExtensionEvent, applyExtensionPrompts, hasPromptContributors, choiceDefaultsOf(settings), regexReaderOf(studio), { readPreset, readLorebook, state, ...(studio ? { readLibrary: (kind: string, id: string) => studio.read(kind, id) } : {}), compendium, ...(toolBudgetOf(settings) ? { toolBudgetMs: toolBudgetOf(settings)! } : {}) }) : err("the Core turn owner is unavailable", 503);
    return stream(chats, state, readPreset, readLorebook, b, studio, compendium, settings, dispatchExtensionEvent, applyExtensionPrompts);
  }
  if (p === "/api/chats/review") {
    const decision = reviewDecision(b);
    if (!decision) return err('expected { chatId, turnId, kind: "send", edits?: { [index]: text } } or kind: "cancel"');
    const home = studio?.studioPath();
    const owner = home ? libraryFor(home)?.coreTurns : undefined;
    if (owner) {
      const answered = await owner.answerReview(str(b["chatId"]), { kind: "host" }, str(b["turnId"]), decision.kind === "cancel" ? { action: "cancel" } : { action: "send", edits: Object.entries(decision.edits).map(([index, text]) => ({ index: Number(index), text })) });
      if (answered) return json({ answered });
    }
    return json({ answered: answerReview(sceneRuntimeFor(chats), str(b["chatId"]), str(b["turnId"]), decision) });

  }
  if (p === "/api/chats/regex-answer") {
    const answer = regexAnswerOf(b);
    return answer ? json({ answered: answerRegex(sceneRuntimeFor(chats), str(b["chatId"]), str(b["turnId"]), answer) }) : err('expected { chatId, turnId, kind: "done", texts: { [index]: text } }, kind: "failed", error, or kind: "cancel"');
  }
  if (p === "/api/chats/stop") {
    const home = studio?.studioPath();
    const owner = home ? libraryFor(home)?.coreTurns : undefined;
    if (owner && await owner.stop(str(b["chatId"]))) return json({ stopped: true });
    return json({ stopped: stopTurn(sceneRuntimeFor(chats), str(b["chatId"]), str(b["turnId"])) });
  }

  if (p === "/api/chats/discard" || p === "/api/chats/add-anyway") {
    const owner = studio ? libraryFor(studio.studioPath())?.coreTurns : undefined;
    const linked = await libraryFor(studio?.studioPath() ?? "")?.core?.sceneFor(str(b["chatId"]));
    if (owner && linked) {
      const held = await owner.resolveHeld({ sceneId: str(b["chatId"]), turnId: str(b["turnId"]), action: p === "/api/chats/discard" ? "discard" : "commit" });
      if (!held) return err("that reply is no longer waiting", 404);
      return json("message" in held ? held.message : held);
    }
  }
  if (p === "/api/chats/discard") {
    return (await discardWaiting(sceneRuntimeFor(chats), chats, str(b["chatId"]), str(b["turnId"]))) ? json({ discarded: true }) : err("that reply is no longer waiting", 404);
  }
  if (p === "/api/chats/add-anyway") {
    const message = await commitAnyway(sceneRuntimeFor(chats), chats, str(b["chatId"]), str(b["turnId"]));
    return message ? json(message) : err("that reply is no longer waiting", 404);
  }
  if (p === "/api/chats/preset") {
    // The store checks the value strictly (ChatStore rule 19): an id, toggles, and samplers, or null.
    const chat = await chats.setPreset(str(b["chatId"]), b["preset"] as ChatPreset | null);
    return chat ? json(chat) : err("that scene is gone", 404);
  }
  if (p === "/api/chats/connection") {
    // The store checks the pick strictly (ChatStore rule 18): exactly an id and a model, or null.
    const chat = await chats.setConnection(str(b["chatId"]), b["connection"] as ChatConnection | null);
    return chat ? json(chat) : err("that scene is gone", 404);
  }
  if (p === "/api/chats/backdrop") {
    // The store checks the pick strictly (ChatStore rule 36): a pack, an item and an optional dim, or null.
    const chat = await chats.setBackdrop(str(b["chatId"]), b["backdrop"] as ChatBackdrop | null);
    return chat ? json(chat) : err("that scene is gone", 404);
  }
  return null;
}
