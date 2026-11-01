/**
 * The turn loop: one reply, one new version of the last reply, or more text
 * on the end of it (Continue, rule 13), the way RoleCall does it. Checkpoint, load, assemble, write the variables, stream through the scene's
 * connection while saving the text as it arrives, commit with the trace, then teach the meter.
 * Stop keeps what arrived; a failure saves nothing and hands back the draft; a crash keeps what
 * arrived, found by resumeScene the next time the scene opens.
 *
 * Errors before the checkpoint opens (no connection, a stale take) throw, so the route answers them
 * as plain HTTP errors. From the checkpoint on, every outcome is an event.
 */
import { toErrorMessage } from "../error-message";
import type { TurnEvent } from "./scene-turn-events";
export type { TurnEvent } from "./scene-turn-events";
import type { TurnRuntime } from "./scene-turn-runtime";
import { enterTurn } from "./scene-turn-entry";
import { registerTurn } from "./scene-turn-running";
export { stopTurn } from "./scene-turn-running";
export { commitAnyway, discardWaiting, resumeScene } from "./scene-turn-resume";
import { outOfTimeOf } from "../core/assembly/macro-report";
import { globalDeltas } from "../core/scene-state/globals";
import { varsDeltas } from "../core/scene-state/vars-bridge";
import { PresetPlanError } from "../core/assembly/preset";
import { GUIDANCE_MAX } from "../core/assembly/guided-swipe";
import { continuationAddition } from "../core/assembly/continuation";
import { tagThinkingState } from "../core/reasoning-tags";
import { recoverThinkingEnd } from "./scene-turn-recover";
import { thinkingSignature } from "./scene-turn-reasoning";
import { modelTakesPrefill } from "../core/assembly/request";
import { modelKey } from "../core/tokens";
import type { Chat, ChatConnection, ChatStore, Generation, JsonObject, Message } from "../stage/contracts/chat-store";
import { ProviderError, type Provider, type ProviderEvent, type ProviderRole } from "../stage/contracts/provider";
import type { StateStore } from "../stage/contracts/state-store";
import { NoConnectionError, StudioConflictError, StudioNotFoundError, StudioValidationError } from "./errors";
export { NoConnectionError } from "./errors";

import { assembleRequest, openedWith, overflowMessage, prepareRequest, shapeRequest } from "./scene-turn-build";
import { tickDeltas } from "./scene-turn-ticks";
import { loadTurn, type LoadedTurn, type ReadPreset, type TurnKind } from "./scene-turn-load";
import { isFallbackWorthy } from "./scene-turn-fallback";
import { learnReply } from "./scene-turn-meter";
import { awaitReview } from "./scene-turn-review";
import { promptRegex, recounted } from "./scene-turn-regex";
import { appendExtensionPrompts, measurePromptRequest, rejectOversizedPrompt } from "./scene-turn-prompts";
import { finalCutStage } from "./scene-turn-final-cut";
import type { RegexSetBody } from "../entities/regex/schema";
import type { ReadLorebook } from "./scene-lore";
import { recallSection, runRecall } from "./compendium-recall";
import { directorOn } from "../core/director/settings";
import type { ExtensionCommitContext } from "../stage/contracts/extension-store";
import { summaryOf } from "../core/director/tracker-round";
import { cancelTrackerRound, startTrackerRound } from "./scene-director-trackers";
import { commitDirector, runDirector, type DirectorDeps, type DirectorRun } from "./scene-director";
import { turnWrites } from "./scene-turn-writes";
import { sendReply, sentTools, toolsRefusal, toolTurn, withToolCalls, type NarratorToolsFor } from "./scene-turn-tools";
import { skillDelta } from "../core/skill";
import { failedAttempt, requestParams, routeOf, splitEntryKey, traceOf, traceOptions, type RouteAttempt } from "./scene-turn-trace";
import { BookCancelledError, bookTrace, prepareBookReply, runBookPhases, type PhaseRun } from "./book-phase";
import { replyPhase } from "../core/promptbook";

export { splitEntryKey };

/** A scene's connection, resolved: the provider to send through, and what it says about itself. */
export interface Connected {
  provider: Provider;
  /** Host-only digest of the exact saved provider config used to resolve this provider. */
  providerConfigFingerprint?: string;
  /** The connection's kind (its Kit spoke), for the meter's key. */
  kind: string;
  /** The model's context window, when the connection states one. */
  context?: number;
  /** Whether a scene sends this connection tool calls: it has a scene endpoint and the model is not one that refuses tools (sceneTools). */
  tools?: boolean;
}

export interface TurnDeps {
  runtime: TurnRuntime;
  chats: ChatStore;
  state: StateStore;
  /** Resolves the scene's saved connection; null when Kit no longer has it. */
  connect(connection: ChatConnection, signal?: AbortSignal): Promise<Connected | null>;
  /** The library's current body of the scene's preset (ChatStore rule 19). */
  readPreset: ReadPreset;
  /** The library's current body of a lorebook the scene reads (2e-d4 plan step 1). */
  readLorebook: ReadLorebook;
  /** The library's current body of a regex set the scene has on (ChatStore rule 42); absent: a scene's regex is not applied. */
  readRegex?(id: string): Promise<RegexSetBody | null>;
  /** Reads a library piece by kind and id, raw: the linked trackers and skills a turn reads, and the cast of a migration-22 development scene whose frozen cells were dropped. Absent: none are read. */
  readLibrary?(kind: string, id: string): Promise<unknown | null>;
  /** The person's saved choice answers for a preset (the pref `scenes.presetChoiceDefaults`), under the scene's own; absent: none. */
  choiceDefaults?(presetId: string): Promise<Record<string, unknown> | undefined>;
  /** The person's own Anti-Slop banks (studio/final-cut-library.ts), merged into the Anti-Slop pass; absent: none. */
  finalCutBanks?(): Promise<Record<string, import("../core/final-cut/banks").Bank>>;
  /** The first-party tools a reply may call when the scene's Narrator Tool Access is on (scene-turn-tools.ts). */
  narratorTools?: NarratorToolsFor;
  /** The time all of a reply's tool calls may take (ms), from the setting `scenes.toolBudgetMs`; absent or unset: the default (tool-rounds.ts). */
  toolBudgetMs?(): Promise<number | undefined>;
  /** The time all the macros of one prompt build may take (ms), from the setting `scenes.promptBudgetMs`; absent or unset: the default (tool-rounds.ts). */
  promptBudgetMs?(): Promise<number | undefined>;
  /** The clock the budgets read (real monotonic time when absent); a test hands in its own. */
  clock?(): number;
  now(): number;
  randomSeed(): number;
  /** The Story Director's pause, jitter and call limit, so a test need not wait; absent: the real ones (scene-director-call.ts). */
  director?: DirectorDeps["director"];
  /** Applies only manifest-declared, grant-filtered named prompt appends before inspection and send. */
  applyExtensionPrompts?(sceneId: string, messages: readonly { role: ProviderRole; content: string }[], signal: AbortSignal): Promise<readonly string[]>;
}

/** Save the streamed text every 400 characters or every second, whichever comes first. */
const SAVE_EVERY_CHARS = 400;
const SAVE_EVERY_MS = 1_000;

/**
 * One turn. The scene counts as having a turn running from the moment this is called, not from the checkpoint: the state is read for the prompt before the checkpoint opens, so a write
 * to the scene's state that lands in between (a person's tracker edit) would be overwritten by the turn's own whole-row update. The early claim has its own key, so Stop (which finds a turn by
 * its id) and the resume sweep are unchanged, and it is released however the turn ends, a refusal before the checkpoint included.
 */
export function runTurn(
  deps: TurnDeps,
  input: Parameters<typeof runTurnBody>[1],
  emit: (event: TurnEvent) => void,
  extensionCommit?: ExtensionCommitContext,
): Promise<void> {
  return enterTurn(deps.runtime, input.chatId, (controller) => runTurnBody(deps, input, emit, controller, extensionCommit), () => emit({ type: "stopped", message: null }));
}

async function runTurnBody(
  deps: TurnDeps,
  /** `fallback`: the person's Fallback Model (Control Booth), tried once if the scene's model fails before writing anything. `guidance`: a guided re-roll's instruction, a swipe's alone. */
  input: { chatId: string; kind: TurnKind; expectedVersion: number; fallback?: ChatConnection; guidance?: string; /** Prompt Inspector on: stop with the exact request before anything is written or sent. */ inspect?: boolean },
  emit: (event: TurnEvent) => void,
  controller: AbortController,
  extensionCommit?: ExtensionCommitContext,
): Promise<void> {
  const { chats, state } = deps;
  const guidance = input.guidance?.trim() ?? "";
  if (guidance && input.kind !== "swipe") throw new StudioValidationError("guidance belongs to a new version of a reply");
  if (guidance.length > GUIDANCE_MAX) throw new StudioValidationError(`guidance is longer than ${GUIDANCE_MAX} characters`);
  const initialChat = await chats.getChat(input.chatId);
  if (!initialChat) throw new StudioNotFoundError("that scene does not exist");
  let chat: Chat = initialChat;
  // A tracker round still running for the last reply writes the trackers this turn reads: it stops and finishes writing or undoing first.
  await cancelTrackerRound(deps.runtime, chat.id);
  if (!chat.connection) throw new NoConnectionError();
  let connected = await deps.connect(chat.connection, controller.signal);
  if (!connected) throw new NoConnectionError("this scene's connection is gone from Kit; pick another in the AI wing");
  const initialLoaded = await loadTurn(chats, chat.id, input.kind, deps.readPreset, deps.readLorebook, deps.readLibrary, deps.choiceDefaults);
  if (!initialLoaded) throw new StudioNotFoundError("that scene does not exist");
  let loaded: LoadedTurn = initialLoaded;
  const bookBase = loaded;
  const bookChat = chat;
  const bookRuns: PhaseRun[] = [];
  let bookAfter = false;
  let bookComplete = input.kind === "continue";
  let completedBookTrace: JsonObject | undefined;
  const replacedId = loaded.target?.id;
  /** Who spoke, for the Director's tracker request after the reply. */
  const loadedTurn = loaded;
  const exchange = { characterName: loaded.character.identity.name, personaName: loaded.persona?.name ?? "User", userMessage: loaded.current.content };
  const target = loaded.target ? { kind: input.kind === "continue" ? ("continue" as const) : ("swipe" as const), messageId: loaded.target.id } : { kind: "reply" as const };
  /** The text a continue extends: the reply's current version, as stored (rule 13). */
  const original = input.kind === "continue" ? loaded.target!.swipes[loaded.target!.current]!.content : "";
  /** What the checkpoint and the commit hold: a continue holds only its addition, with any echo cut off. */
  let model = chat.connection.model;
  const stored = (streamed: string): string => (input.kind === "continue" ? continuationAddition(original, streamed, !modelTakesPrefill(model)) : streamed);
  const writes = turnWrites(deps.now);
  const narratorTools = extensionCommit ? undefined : deps.narratorTools;
  let toolsTurn = await toolTurn(narratorTools, input.kind, chat, loaded, deps.randomSeed(), writes, await deps.toolBudgetMs?.());
  if (controller.signal.aborted) { emit({ type: "stopped", message: null }); return; }
  const turn = await chats.beginTurn(loaded.branchId, target, { expectedVersion: input.expectedVersion }, extensionCommit);
  if (!turn) throw new StudioNotFoundError("that scene does not exist");
  const dropTurn = () => chats.dropTurn(turn.id, extensionCommit);
  const saveCheckpoint = (progress: Parameters<ChatStore["saveCheckpoint"]>[1]) => chats.saveCheckpoint(turn.id, progress, extensionCommit);
  if (controller.signal.aborted) { await dropTurn(); emit({ type: "stopped", message: null }); return; }

  registerTurn(deps.runtime, turn.id, chat.id, controller);
  emit({ type: "start", turnId: turn.id, kind: input.kind, messageId: turn.messageId });
  let text = "";
  // Once the reply is in hand, nothing may throw it away: an error saving it keeps the checkpoint,
  // and the reply comes back when the scene next opens (rule 4).
  let answered = false;
  /** The Story Director's plan for this reply; its snapshot is stored when, and only when, the reply commits. */
  let director: DirectorRun | null = null;
  /** The Director's call is stopped with the turn, and also whenever the turn ends for any other reason: a failure after it started must not leave it running, billed, behind a turn that is over. */
  const directorStop = new AbortController();
  controller.signal.addEventListener("abort", () => directorStop.abort(controller.signal.reason), { once: true });
  if (controller.signal.aborted) directorStop.abort(controller.signal.reason);
  try {
    const started = deps.now();
    if (loaded.promptbook) {
      ({ loaded, chat, connected, model } = await prepareBookReply({ deps, chat: bookChat, loaded: bookBase, connected, model, runs: bookRuns, writes, turnId: turn.id, kind: input.kind, inspect: input.inspect, signal: controller.signal, emit }));
      toolsTurn = await toolTurn(narratorTools, input.kind, chat, loaded, deps.randomSeed(), writes, await deps.toolBudgetMs?.());
    }
    const prep = await prepareRequest(deps, chat, loaded, connected, model, started);
    const { window, options, presetName, reasoningFormat, meter, key, startGlobal } = prep;
    // Recall (compendium-recall.ts) runs once, here: the Inspector's pause, the fallback model and a draft never ask it again.
    // The Director plans beside the Compendium's recall; both finish before anything is assembled. A Director that fails never fails the reply.
    if (directorOn(chat) && input.kind !== "continue") emit({ type: "director", status: "planning" });
    const planning = extensionCommit ? Promise.resolve(null) : runDirector(deps, chat, loaded, { connected, model }, directorStop.signal, { kind: input.kind, format: reasoningFormat }).catch((error: unknown) => {
      emit({ type: "director", status: "failed", reason: toErrorMessage(error, "the Story Director failed") });
      return null;
    });
    const recall = await runRecall(deps, chat, loaded, { connected, model }, controller.signal, () => emit({ type: "world", status: "recalling" }));
    director = await planning;
    if (controller.signal.aborted) {
      await dropTurn();
      emit({ type: "stopped", message: null });
      return;
    }
    if (recall) emit({ type: "world", status: recall.status === "empty" ? "recalled" : recall.status, count: recall.entries.length, ...(recall.reason ? { reason: recall.reason } : {}) });
    if (director) emit({ type: "director", status: director.status, ...(director.reason ? { reason: director.reason } : {}), entries: director.entries });
    const built = await assembleRequest(deps, { chat, loaded, prep, started, kind: input.kind, original, guidance, recall, ...(director?.directive ? { director: director.directive } : {}), reserved: sentTools(toolsTurn, connected).map((t) => JSON.stringify(t)) });
    const { result, guided } = built;
    const outOfTime = outOfTimeOf(result.macros);
    toolsTurn.macros.context = result.expansion.context;
    if (result.budget.overflow) {
      await dropTurn();
      emit({ type: "failed", category: "invalid_request_error", code: "context_length_exceeded", message: overflowMessage(result), draft: "" });
      return;
    }
    let edits: Readonly<Record<number, string>> = {};
    const shape = (forModel: string) => shapeRequest({ chat, loaded, kind: input.kind, original, built, connected }, forModel, edits);
    let messages = shape(model);
    const regex = await promptRegex({ runtime: deps.runtime, setIds: chat.regex?.sets, readRegex: deps.readRegex, trace: result.trace, messages, expansion: result.expansion, turnId: turn.id, chatId: chat.id, signal: controller.signal, emit });
    if (regex.stop) { await dropTurn(); emit(regex.stop); return; }
    const regexEdits = regex.edits;
    edits = regexEdits;
    const prompted = await deps.applyExtensionPrompts?.(chat.id, shape(model), controller.signal) ?? [];
    const withExtensions = (forModel: string, currentEdits: Readonly<Record<number, string>>) => appendExtensionPrompts(shape(forModel), recounted(result, currentEdits).trace, prompted);
    let extensionRequest = withExtensions(model, regexEdits);
    messages = extensionRequest.messages;
    const opened = (forModel: string): string | undefined => openedWith({ chat, kind: input.kind, built }, forModel);
    if (opened(model)) emit({ type: "prefill", text: opened(model)! });
    let measured = measurePromptRequest(messages, meter, key, started, window);
    let { estimate } = measured;
    if (!measured.fits) { await rejectOversizedPrompt(chats, turn.id, emit, false, extensionCommit); return; }
    const recalled = recall ? recallSection(recall, result.recall) : undefined;
    let route: RouteAttempt[] = [{ connectionId: chat.connection!.id, kind: connected.kind, model }];
    // The turn's local variable changes, as scene-state deltas (rule 17), and its global ones, as operations in the shared `global` slot (core/scene-state/globals.ts): both wait on the checkpoint and reach the version only when the turn commits, so a turn that does not commit has written none, and a continue makes none of its own. Their size is bounded by their source (the macro engine's output cap), so nothing is refused here.
    // A picked skill whose close rule held this turn (core/skill.ts) is closed with them, as the reply's own write.
    const sharedGlobalDeltas = extensionCommit ? [] : globalDeltas(result.globalWrites, started, () => crypto.randomUUID());
    const deltas = input.kind === "continue" ? [] : [...writes.pending(), ...varsDeltas(result.local, started), ...sharedGlobalDeltas, ...(result.skills ?? []).filter((s) => s.close).map((s) => skillDelta(s.id, false, started))];
    let trace = (traceOf({ ...recounted(result, regexEdits), trace: extensionRequest.trace }, model, window, estimate, traceOptions(options, connected.provider.params, model), guided, recalled));
    if (loaded.promptbook && input.kind !== "continue") trace["book"] = bookTrace(bookRuns, "running");
    if (input.inspect) {
      // F16: the one pause gate. Cancel and Stop drop the checkpoint, so nothing was written, saved or sent.
      emit({ type: "review", turnId: turn.id, messages: messages.map((m) => ({ role: m.role, content: m.content })), tokens: estimate.mid, params: requestParams(traceOptions(options, connected.provider.params, model)), ...(sentTools(toolsTurn, connected).length > 0 ? { tools: sentTools(toolsTurn, connected) } : {}) });
      const decision = await awaitReview(deps.runtime, turn.id, chat.id, controller.signal);
      if (decision.kind === "cancel") {
        await dropTurn();
        emit({ type: "stopped", message: null });
        return;
      }
      edits = { ...regexEdits, ...decision.edits };
      extensionRequest = withExtensions(model, edits);
      messages = extensionRequest.messages;
      measured = measurePromptRequest(messages, meter, key, started, window);
      ({ estimate } = measured);
      if (!measured.fits) { await rejectOversizedPrompt(chats, turn.id, emit, true, extensionCommit); return; }
      trace = traceOf({ ...recounted(result, edits), trace: extensionRequest.trace }, model, window, estimate, traceOptions(options, connected.provider.params, model), guided, recalled);
      if (loaded.promptbook && input.kind !== "continue") trace["book"] = bookTrace(bookRuns, "running");
    }
    // ChatStore rule 22: the take's latest request text, aligned with the stored trace's blocks
    // (result.messages and result.trace share the same order and length, section 9's own build).
    const request = { texts: messages.map((m) => m.content) };
    let savedChars = 0;
    let savedAt = deps.now();
    // The save that carries the turn's deltas is awaited, not left to the best-effort chain: a lost one would commit the reply without the variables it wrote. A failure takes the catch below, as the old variable write did.
    let saving: Promise<unknown> = deltas.length > 0 ? Promise.resolve(await saveCheckpoint({ content: "", trace, deltas })) : saveCheckpoint({ content: "", trace });
    // A tool's state writes join the same pending set and are saved with the reply's text so far, awaited: the model is told if one could not be kept.
    writes.open(deltas, (all) => saveCheckpoint({ content: stored(text), deltas: all }));
    const save = () => {
      savedChars = text.length;
      savedAt = deps.now();
      // A save that finds the library busy is skipped: the next one supersedes it.
      saving = saving.then(() => saveCheckpoint({ content: stored(text) })).catch(() => undefined);
    };
    // The clock for "Reasoned for" (first reasoning token to first reply token) and "Thought for" (the reply's own opening tag to its closing one).
    let reasoningFrom: number | undefined;
    let reasoningEnd: number | undefined;
    let tagFrom: number | undefined;
    let tagEnd: number | undefined;
    const onEvent = (event: ProviderEvent) => {
      if (event.channel === "reasoning") {
        reasoningFrom ??= deps.now();
        if ("full" in event) emit({ type: "reasoning", delta: event.full, full: true });
        else if (event.delta) emit({ type: "reasoning", delta: event.delta });
        return;
      }
      if (reasoningFrom !== undefined) reasoningEnd ??= deps.now();
      if ("full" in event) {
        if (event.full === text) return;
        text = event.full;
        emit({ type: "text", delta: text, full: true });
      } else {
        if (!event.delta) return;
        text += event.delta;
        emit({ type: "text", delta: event.delta });
      }
      if (tagEnd === undefined && input.kind !== "continue") {
        const state = tagThinkingState(text, reasoningFormat);
        if (state !== "none") tagFrom ??= deps.now();
        if (state === "closed") tagEnd = deps.now();
      }
      if (text.length - savedChars >= SAVE_EVERY_CHARS || deps.now() - savedAt >= SAVE_EVERY_MS) save();
    };

    let completion;
    try {
      try {
        completion = await sendReply(connected, { model, messages, options }, { signal: controller.signal, onEvent }, toolsTurn, deps.now);
      } catch (first) {
        // RoleCall's fallback (worker.ts): only a transient failure, only before anything was written, never a Stop, and
        // never the model that just failed. One try; if it fails too, the main model's error is the one reported.
        const fb = input.fallback;
        const eligible = !controller.signal.aborted && !text && reasoningFrom === undefined && toolsTurn.calls.length === 0 && isFallbackWorthy(first) && !(fb?.id === chat.connection!.id && fb.model === model);
        const next = fb && eligible ? await deps.connect(fb, controller.signal).catch(() => null) : null;
        if (!fb || !next) throw first;
        const before = { connected, model, messages, trace, route };
        route = [failedAttempt(route[0]!, first), { connectionId: fb.id, kind: next.kind, model: fb.model }];
        connected = next;
        model = fb.model;
        extensionRequest = withExtensions(model, regexEdits);
        messages = extensionRequest.messages;
        measured = measurePromptRequest(messages, meter, key, started, window);
        ({ estimate } = measured);
        if (!measured.fits) { await rejectOversizedPrompt(chats, turn.id, emit, false, extensionCommit); return; }
        trace = traceOf({ ...recounted(result, regexEdits), trace: extensionRequest.trace }, model, window, estimate, traceOptions(options, connected.provider.params, model), guided, recalled);
        if (loaded.promptbook && input.kind !== "continue") trace["book"] = bookTrace(bookRuns, "running");
        try {
          completion = await sendReply(connected, { model, messages, options }, { signal: controller.signal, onEvent }, toolsTurn, deps.now);
        } catch (second) {
          if (controller.signal.aborted || text || reasoningFrom !== undefined) throw second;
          ({ connected, model, messages, trace, route } = before);
          throw first;
        }
      }
    } catch (error) {
      await saving.catch(() => undefined);
      if (controller.signal.aborted) {
        // Stop keeps what arrived; with nothing (or, for a continue, nothing but an echo), nothing is stored.
        if (!stored(text)) {
          await dropTurn();
          emit({ type: "stopped", message: null });
          return;
        }
        answered = true;
        if (loaded.promptbook) {
          trace["book"] = bookTrace(bookRuns, "stopped"); completedBookTrace = trace;
          await saveCheckpoint({ content: stored(text), trace, deltas: [...writes.pending()] });
        }
        await commit({ content: stored(text), generation: { model, finishReason: "stopped", presetName, generationMs: deps.now() - started, ...(guidance ? { guidance } : {}), ...(outOfTime ? { outOfTime } : {}) }, ...(input.kind === "continue" ? {} : withToolCalls(toolsTurn, { ...trace, route: routeOf(route, "stopped") }, request)) }, "stopped");
        return;
      }
      await dropTurn();
      const failure = error instanceof ProviderError ? error : null;
      emit({
        type: "failed",
        category: failure?.category ?? "api_error",
        code: failure?.code ?? "backend_error",
        message: toolsRefusal(error, model, toolsTurn, connected) ?? toErrorMessage(error, "the reply failed"),
        draft: text,
      });
      return;
    }
    await saving.catch(() => undefined);
    // The provider trims a completion, and a continuation's leading space is part of the sentence it
    // finishes (" and the glass"): a continue keeps what streamed, trimmed only at the end.
    text = input.kind === "continue" && text ? text.trimEnd() : completion.content;
    // A reply that is only native reasoning is still a reply and is kept, as an empty message the bubble labels
    // (RoleCall refuses it, worker.ts MODEL_RESPONSE_MISSING). A continue has no
    // message of its own to keep, so one that adds nothing is refused whatever the model thought.
    const thoughtOnly = input.kind !== "continue" && !text && Boolean(completion.reasoning?.trim());
    if (!stored(text) && !thoughtOnly) {
      // A continue the model answered with nothing new: nothing to store, and the person is told.
      await dropTurn();
      emit({ type: "failed", category: "invalid_request_error", code: "nothing_to_add", message: "The model had nothing to add to this reply.", draft: "" });
      return;
    }
    answered = true;
    // Smart Recovery (Auto): thinking run into the reply with no wrapper, found by the scene's model and kept as a boundary.
    const thinkingEnd = input.kind === "continue" ? undefined : await recoverThinkingEnd({ provider: connected.provider, model, text, history: loaded.history, format: reasoningFormat, ...(completion.reasoning ? { native: completion.reasoning } : {}), signal: controller.signal });
    const done = deps.now();
    const reasoningMs = reasoningFrom !== undefined && completion.reasoning ? (reasoningEnd ?? done) - reasoningFrom : 0;
    const tagMs = tagFrom !== undefined ? (tagEnd ?? done) - tagFrom : 0;
    const generation: Generation = {
      model: completion.model ?? model,
      ...(completion.finish_reason ? { finishReason: completion.finish_reason } : {}),
      ...(toolsTurn.rounds > 0 ? { promptTokens: toolsTurn.tokens.prompt, completionTokens: toolsTurn.tokens.output } : {
        ...(completion.usage?.promptTotal !== undefined ? { promptTokens: completion.usage.promptTotal } : {}),
        ...(completion.usage?.output !== undefined ? { completionTokens: completion.usage.output } : {}),
      }),
      generationMs: done - started,
      ...(reasoningMs > 0 ? { reasoningMs } : {}),
      ...(tagMs > 0 ? { tagThinkingMs: tagMs } : {}),
      presetName,
      ...(guidance ? { guidance } : {}),
      ...(outOfTime ? { outOfTime } : {}),
      ...(thinkingEnd ? { thinkingEnd } : {}),
      ...(opened(model) ? { prefill: opened(model)! } : {}),
      // Kept for the same model only to be sent back (pipeline-hooks behavior 7, step 2f).
      ...(completion.reasoning ? { reasoning: { text: completion.reasoning, ...(thinkingSignature(completion.reasoning_details) ? { signature: thinkingSignature(completion.reasoning_details)! } : {}), provider: connected.provider.id, model: completion.model ?? model } } : {}),
    };
    // Through JSON, so the stored trace is JSON exactly (the store refuses anything else).
    const usage = completion.usage ? (JSON.parse(JSON.stringify(completion.usage)) as JsonObject) : undefined;
    const cut = input.kind === "continue" ? null : await finalCutStage({ deps, chat, text, history: [...loaded.history, loaded.current], format: reasoningFormat, signal: controller.signal, emit, turnId: turn.id, ...(deps.finalCutBanks ? { userBanks: deps.finalCutBanks } : {}) });
    if (cut && "stop" in cut) { await dropTurn(); emit(cut.stop); return; }
    if (cut) text = cut.text;
    if (loaded.promptbook && input.kind !== "continue") {
      const phase = replyPhase(loaded.promptbook);
      bookRuns.push({ id: phase.id, name: phase.name, role: "reply", status: "ran", why: "The reply.", text, request: messages.map((m) => m.content), model });
      bookAfter = true;
      await runBookPhases({ deps, chat: bookChat, loaded: bookBase, connected, role: "after", runs: bookRuns, writes, turnId: turn.id, content: stored(text), inspect: input.inspect, signal: controller.signal, emit });
      bookAfter = false;
      trace["book"] = bookTrace(bookRuns);
    }
    const answer: Parameters<typeof commit>[0] = { content: stored(text), generation: { ...generation, ...(cut ? { finalCut: cut.summary } : {}) }, ...(input.kind === "continue" ? {} : withToolCalls(toolsTurn, { ...trace, route: routeOf(route, "answered", completion.model), ...(usage ? { usage } : {}), ...(cut ? { finalCut: cut.trace } : {}) }, request)) };
    if (loaded.promptbook) { bookComplete = true; completedBookTrace = answer.trace; await saveCheckpoint({ content: answer.content, ...(answer.trace ? { trace: answer.trace } : {}), deltas: [...writes.pending()] }); }
    const committed = await commit(answer, "done");
    // Step 7, best-effort: a lost calibration sample is harmless.
    // Not after tool rounds: their usage covers more than the request the meter would be taught it against.
    if (committed && toolsTurn.rounds === 0 && !extensionCommit) {
      await learnReply(state, modelKey(connected.kind, model, completion.model), messages.map((m) => m.content), completion.usage, deps.now()).catch(() => undefined);
    }
  } catch (error) {
    if (error instanceof BookCancelledError || (bookAfter && controller.signal.aborted)) {
      await dropTurn().catch(() => undefined);
      emit({ type: "stopped", message: null });
    } else if (bookBase.promptbook && !bookComplete && !controller.signal.aborted) {
      await dropTurn().catch(() => undefined);
      emit({ type: "failed", category: "api_error", code: "promptbook_failed", message: toErrorMessage(error, "The Promptbook could not finish. Nothing from this turn was committed."), draft: text });
    } else if (controller.signal.aborted && !text && !answered) {
      await dropTurn().catch(() => undefined);
      emit({ type: "stopped", message: null });
    } else if (answered) {
      // Best-effort: the checkpoint then holds the whole reply, not just the last periodic save.
      await saveCheckpoint({ content: stored(text), ...(completedBookTrace ? { trace: completedBookTrace } : {}) }).catch(() => undefined);
      emit({ type: "failed", category: "api_error", code: "backend_error", message: "The reply arrived but could not be saved yet. It is kept, and comes back when the scene reopens.", draft: stored(text) });
    } else {
      await dropTurn().catch(() => undefined);
      // A preset block the assembler cannot place fails the same way every time: not worth a Retry.
      const plan = error instanceof PresetPlanError;
      emit({ type: "failed", category: plan ? "invalid_request_error" : "api_error", code: plan ? "invalid_preset" : "backend_error", message: toErrorMessage(error, "the reply failed"), draft: text });
    }
  } finally {
    directorStop.abort();
    deps.runtime.running.delete(turn.id);
  }

  /** Commits guarded by the version the turn began from; a conflict keeps the checkpoint, holding the whole text. */
  async function commit(result: { content: string; generation: Generation; trace?: JsonObject; request?: { texts: string[] } }, as: "done" | "stopped"): Promise<boolean> {
    try {
      // The version being replaced, read before it is: an edit the person made to it while the Director's call was out is carried onto the new one.
      const replaced = director && replacedId ? await chats.getDirector(input.chatId, replacedId).catch(() => null) : null;
      // The Spellbook counts down with the reply (rule 43): its tick joins the deltas the checkpoint holds, so the version it is stamped on is the version that carried the cast. Not on Stop or Continue.
      if (as === "done" && input.kind !== "continue") {
        const failed = await writes.tick(tickDeltas(loadedTurn, deps.now()));
        if (failed) throw new Error(failed);
      }
      const message = await chats.commitTurn(turn!.id, result, { expectedVersion: turn!.baseVersion }, extensionCommit);
      if (!message) {
        await dropTurn();
        emit({ type: "failed", category: "invalid_request_error", code: "invalid_parameter", message: "the message this was a new version of is gone", draft: result.content });
        return false;
      }
      // The reply is in: now, and only now, the Director's state for it is stored (a reply that fails or is dropped leaves no snapshot).
      // A snapshot that could not be stored is said so; the reply is safe and the next turn plans from the last state that was.
      const stored = director ? await commitDirector(deps, input.chatId, director, message, replaced) : true;
      if (stored !== true) emit({ type: "director", status: "failed", reason: stored });
      // After the reply, in the background: the Director updates the trackers that are on and due from the exchange that just happened. Never on Stop or Continue.
      if (!deps.runtime.closed && as === "done" && stored === true && director?.status === "planned" && input.kind !== "continue") {
        startTrackerRound(deps.runtime, { chats, connect: deps.connect, now: deps.now }, {
          chatId: input.chatId, branchId: loadedTurn.branchId, messageId: message.id, swipeId: message.swipes[message.current]!.id, turn: director.turn, ...exchange, reply: message.swipes[message.current]?.content ?? result.content, ...(director.directive ? { directive: summaryOf(director.directive) } : {}),
        });
      }
      emit(as === "done" ? { type: "done", message } : { type: "stopped", message });
      return true;
    } catch (error) {
      if (!(error instanceof StudioConflictError)) throw error;
      await saveCheckpoint({ content: result.content, ...(result.trace ? { trace: result.trace } : {}) });
      emit({ type: "conflict", turnId: turn!.id, draft: result.content });
      return false;
    }
  }
}
