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
import { runOwnedTurn } from "../studio/scene-turn-runtime";
import { createSceneCore } from "./server-scene-composition";
import { sceneRuntimeFor } from "./server-scene-runtime";
import { isRecord, str } from "../core/guards";
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
import { checkCoreProjection, openCoreScene } from "../studio/core-scene";
import type { AsyncSessionHandle } from "rp-core";
import type { Event as CoreEvent, MessageView } from "rp-core";
import { err, json } from "./server-security";

type Body = Record<string, unknown>;

type CoreRunning = Map<string, { session: AsyncSessionHandle; turnId: string; gateId?: string }>;
const coreRuntimes = new WeakMap<ChatStore, CoreRunning>();
function runningFor(chats: ChatStore): CoreRunning {
  let running = coreRuntimes.get(chats);
  if (!running) { running = new Map(); coreRuntimes.set(chats, running); }
  return running;
}
const coreText = (message: MessageView): string => message.blocks.filter((block) => block.k === "text").map((block) => block.text).join("");

/** Projects rp-core's committed answer into Bunzai's existing scene read model. */
async function coreMessage(chats: ChatStore, chatId: string, kind: "reply" | "swipe" | "continue", answer: MessageView, expectedVersion: number) {
  const chat = await chats.getChat(chatId);
  if (!chat) throw new Error("the scene is gone");
  const branch = (await chats.listBranches(chatId)).find((take) => take.id === chat.activeBranchId);
  if (branch?.version !== expectedVersion) throw new Error("the scene changed during the rp-core turn; export it before continuing");
  const content = coreText(answer);
  const generation = { ...(answer.gen?.model ? { model: answer.gen.model } : {}), ...(answer.gen?.finish ? { finishReason: answer.gen.finish } : {}) };
  if (kind === "reply") {
    const message = await chats.appendMessage(chat.activeBranchId, { role: "assistant", content, generation });
    if (!message) throw new Error("the scene is gone");
    return message;
  }
  const page = await chats.readMessagesBefore(chat.activeBranchId, { limit: 100 });
  const target = [...page.messages].reverse().find((message) => message.role === "assistant" && !message.cut);
  if (!target) throw new Error("the reply to update is gone");
  if (kind === "swipe") {
    const message = await chats.addSwipe(target.id, { content, generation });
    if (!message) throw new Error("the reply to update is gone");
    return message;
  }
  const swipe = target.swipes[target.current];
  if (!swipe) throw new Error("the reply to continue is gone");
  const message = await chats.editSwipe(target.id, swipe.id, content);
  if (!message) throw new Error("the reply to continue is gone");
  return message;
}

async function coreStream(chats: ChatStore, records: NonNullable<ReturnType<typeof libraryFor>>["core"], home: string, sessionId: string, b: Body): Promise<Response> {
  let ready!: (response: Response) => void;
  let failed!: (reason: unknown) => void;
  const response = new Promise<Response>((resolve, reject) => { ready = resolve; failed = reject; });
  void runOwnedTurn(sceneRuntimeFor(chats), str(b["chatId"]), async (controller) => {
    try { await ownedCoreStream(chats, records, home, sessionId, b, controller, ready); }
    catch (error) { failed(error); throw error; }
  }).catch(failed);
  return response;
}

async function ownedCoreStream(chats: ChatStore, records: NonNullable<ReturnType<typeof libraryFor>>["core"], home: string, sessionId: string, b: Body, abortController: AbortController, ready: (response: Response) => void): Promise<void> {
  if (!records) return ready(err("the core journal is unavailable", 503));
  const chatId = str(b["chatId"]);
  const kind = b["kind"] === "reply" || b["kind"] === "swipe" || b["kind"] === "continue" ? b["kind"] : null;
  const chat = await chats.getChat(chatId);
  if (!chat || !kind || !chat.connection || typeof b["expectedVersion"] !== "number") return ready(err("choose a model and send a message first"));
  const branch = (await chats.listBranches(chatId)).find((take) => take.id === chat.activeBranchId);
  if (branch?.version !== b["expectedVersion"]) return ready(err("the scene changed; reload it and try again", 409));
  const { engine, session } = await openCoreScene(records, home, sessionId, chat.connection);
  let turn;
  try {
    await checkCoreProjection(chats, chatId, session);
    abortController.signal.throwIfAborted();
    turn = await session.runTurn({ kind, expectedVersion: await session.version(), ...(typeof b["guidance"] === "string" ? { guidance: b["guidance"] } : {}), ...(b["inspect"] === true ? { inspect: true } : {}), emptyReply: "keep" });
  }
  catch (error) { await engine.close(); throw error; }
  runningFor(chats).set(chatId, { session, turnId: turn.turnId });
  const stop = () => { void session.stop(turn.turnId).catch(() => undefined); };
  abortController.signal.addEventListener("abort", stop, { once: true });
  if (abortController.signal.aborted) stop();
  let finished = Promise.resolve();
  const encoder = new TextEncoder();
  let detached = false;
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const coalescer = coalesceTurnEvents((event) => { if (!detached) controller.enqueue(encoder.encode(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`)); });
      const send = coalescer.push;
      finished = (async () => {
        try {
          for await (const event of turn.events) {
            const e = event as CoreEvent;
            if (e.type === "start") send({ type: "start", turnId: e.turnId, kind: e.kind, messageId: null });
            else if (e.type === "text" || e.type === "reasoning") send({ type: e.type, delta: e.delta });
            else if (e.type === "prefill") send({ type: "prefill", text: e.text });
            else if (e.type === "gate" && e.kind === "review") {
              const running = runningFor(chats).get(chatId);
              if (running) running.gateId = e.gateId;
              const payload = e.payload as { messages?: Array<{ role: string; blocks: Array<{ k: string; text?: string }> }> };
              const messages = (payload.messages ?? []).map((item) => ({ role: item.role as "system" | "user" | "assistant", content: item.blocks.filter((block) => block.k === "text").map((block) => block.text ?? "").join("") }));
              send({ type: "review", turnId: e.turnId, messages, tokens: Math.ceil(messages.reduce((n, item) => n + item.content.length, 0) / 4) });
            }
            else if (e.type === "failed") send({ type: "failed", category: e.category, code: e.code, message: e.message, draft: e.draft });
            else if (e.type === "conflict") send({ type: "conflict", turnId: e.turnId, draft: e.draft });
            else if (e.type === "done") send({ type: "done", message: await coreMessage(chats, chatId, kind, e.message, b["expectedVersion"] as number) });
            else if (e.type === "stopped") send({ type: "stopped", message: e.message ? await coreMessage(chats, chatId, kind, e.message, b["expectedVersion"] as number) : null });
          }
          await turn.result;
          coalescer.flush();
          if (!detached) controller.close();
        } catch (error) { if (!detached) controller.error(error); }
        finally { abortController.signal.removeEventListener("abort", stop); runningFor(chats).delete(chatId); await engine.close(); }
      })();
    },
    cancel() { detached = true; },
  });
  ready(new Response(body, { headers: { "content-type": "text/event-stream", "cache-control": "no-store", "x-accel-buffering": "no" } }));
  await finished;
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
export async function handleTurnRoute(req: Request, url: URL, chats: ChatStore, state: StateStore, readPreset: ReadPreset, readLorebook: ReadLorebook, b: Body | null, studio?: StudioStoreLike, compendium?: CompendiumDeps | null, settings?: SettingsStoreLike, dispatchExtensionEvent?: (payload: unknown) => Promise<void>, applyExtensionPrompts?: (sceneId: string, messages: readonly { role: ProviderRole; content: string }[], signal: AbortSignal) => Promise<readonly string[]>): Promise<Response | null> {
  const p = url.pathname;
  if (req.method === "GET") {
    if (p === "/api/chats/connections") return connections();
    if (p === "/api/chats/models") return models(url.searchParams.get("id") ?? "");
    return null;
  }
  if (!b) return null;
  if (p === "/api/chats/turn") {
    const home = studio?.studioPath();
    const records = home ? libraryFor(home)?.core : undefined;
    const core = records ? await records.sceneFor(str(b["chatId"])) : null;
    if (core && (await chats.getChat(str(b["chatId"])))?.activeBranchId !== core.branchId) return err("this take is not connected to rp-core yet", 409);
    return records && home && core ? coreStream(chats, records, home, core.sessionId, b) : stream(chats, state, readPreset, readLorebook, b, studio, compendium, settings, dispatchExtensionEvent, applyExtensionPrompts);
  }
  if (p === "/api/chats/review") {
    const decision = reviewDecision(b);
    if (!decision) return err('expected { chatId, turnId, kind: "send", edits?: { [index]: text } } or kind: "cancel"');
    const running = runningFor(chats).get(str(b["chatId"]));
    if (running && running.turnId === str(b["turnId"]) && running.gateId) {
      const answered = await running.session.answerGate(running.turnId, running.gateId, decision.kind === "cancel" ? { action: "cancel" } : { action: "send", edits: Object.entries(decision.edits).map(([index, text]) => ({ index: Number(index), text })) });
      if (answered) running.gateId = undefined;
      return json({ answered });
    }
    return json({ answered: answerReview(sceneRuntimeFor(chats), str(b["chatId"]), str(b["turnId"]), decision) });

  }
  if (p === "/api/chats/regex-answer") {
    const answer = regexAnswerOf(b);
    return answer ? json({ answered: answerRegex(sceneRuntimeFor(chats), str(b["chatId"]), str(b["turnId"]), answer) }) : err('expected { chatId, turnId, kind: "done", texts: { [index]: text } }, kind: "failed", error, or kind: "cancel"');
  }
  if (p === "/api/chats/stop") {
    const running = runningFor(chats).get(str(b["chatId"]));
    if (running && running.turnId === str(b["turnId"])) { await running.session.stop(running.turnId); return json({ stopped: true }); }
    return json({ stopped: stopTurn(sceneRuntimeFor(chats), str(b["chatId"]), str(b["turnId"])) });
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
