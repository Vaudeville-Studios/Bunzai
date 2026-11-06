/**
 * Bunzai's own story systems around an rp-core turn, so a Core scene has one Director, one Compendium and one set of trackers, the
 * ones its panels read. `coreSceneParts` runs the assembler a send runs, with nothing asked or written, for what those systems add to
 * the prompt (core-library.ts seats it in the scene's preset). `corePlan` makes the calls a model answers before the request (the
 * Director's plan and the Compendium's recall, rp-core's beforeAssemble hook) and writes what the reply leaves behind once it has
 * landed on the page. rp-core's own Director and Compendium stay off on these scenes.
 */
import type { HookCtx, HostHooks, Placement, PromptMsg, Tool } from "rp-core";
import type { AssemblyResult } from "../core/assembly/types";
import { NARRATOR_AUTHORITY, renderDirective } from "../core/assembly/director";
import { DEFAULT_LORE_SHARE } from "../core/assembly/types";
import { loreShareTokens, placeRecall, RECALL_NO_WINDOW_TOKENS } from "../core/assembly/recall-place";
import { directorOn } from "../core/director/settings";
import { summaryOf } from "../core/director/tracker-round";
import { resolveReasoning } from "../core/reasoning-capture";
import { toErrorMessage } from "../error-message";
import type { Chat, ChatConnection, ChatStore, DirectorSnapshot, JsonObject, Message } from "../stage/contracts/chat-store";
import type { StateStore } from "../stage/contracts/state-store";
import { recallSection, runRecall } from "./compendium-recall";
import { StudioConflictError, StudioValidationError } from "./errors";
import { bookTrace, composeBookPhase, continuedBookRuns, runBookPhases, type PhaseRun } from "./book-phase";
import { replyPhase } from "../core/promptbook";
import { commitDirector, runDirector, type DirectorRun } from "./scene-director";
import { startTrackerRound } from "./scene-director-trackers";
import type { ReadLorebook } from "./scene-lore";
import type { Connected, TurnDeps, TurnEvent } from "./scene-turn";
import { assembleRequest, prepareRequest } from "./scene-turn-build";
import { loadTurn, type LoadedTurn, type ReadPreset, type TurnKind } from "./scene-turn-load";
import type { TurnRuntime } from "./scene-turn-runtime";
import { toolTurn, withToolCalls, type NarratorToolsFor, type ToolTurn } from "./scene-turn-tools";
import { turnWrites } from "./scene-turn-writes";
import { skillDelta } from "../core/skill";
import type { Delta } from "../core/scene-state/types";
import type { NarratorTool, ToolCallRecord, ToolDeadline } from "../stage/provider/tool-loop";
import { tickDeltas } from "./scene-turn-ticks";

export interface CoreSceneRead {
  chats: ChatStore;
  state: Pick<StateStore, "read">;
  readPreset: ReadPreset;
  readLorebook: ReadLorebook;
  readLibrary?: (kind: string, id: string) => Promise<unknown | null>;
  choiceDefaults?: (presetId: string) => Promise<Record<string, unknown> | undefined>;
}

/** What Bunzai's systems add to a Core scene's request, already through the macro pass. */
export interface CoreSceneParts {
  features: AssemblyResult["parts"]["features"];
  /** The recaps' texts, which ride in front of the history they stand in for. */
  recaps: string[];
  /** The take's saved chat summary, for the preset's summary slot. */
  summary?: string;
  /** Messages the summary and the recaps stand in for. */
  covered: string[];
  /** What the lore engine already placed: recall never repeats it and shares its room. */
  lore: AssemblyResult["parts"]["lore"];
  /** The turn's macro context as the prompt left it, for a formula a tool runs. */
  macros: AssemblyResult["expansion"]["context"];
  /** Picked skills whose close rule held this turn: the reply closes them. */
  closing: string[];
  /** A Promptbook reply's own blocks that go out as written (dice, earlier phases' notes), and its marker nonce. */
  literals?: Readonly<Record<string, string>>;
  slotNonce?: string;
}

/** A Promptbook turn's reply phase, composed once its private phases have run: what the turn sends in place of the scene's own setup. */
export interface CoreBook {
  chat: Chat; loaded: LoadedTurn; connection?: ChatConnection;
  /** Messages the reply phase's agent does not read (its Context messages). */
  unread: string[];
}

/** The scene's parts for a turn of this kind; null when the scene is gone. Asks no model and writes nothing. */
export async function coreSceneParts(deps: CoreSceneRead, sceneId: string, kind: TurnKind | "draft", book?: CoreBook | null): Promise<CoreSceneParts | null> {
  const chat = book?.chat ?? await deps.chats.getChat(sceneId);
  if (!chat) return null;
  // A swipe with no reply to swipe is the turn's own refusal to make, in rp-core's words (core-turn-owner.ts).
  const loaded = book?.loaded ?? await loadTurn(deps.chats, chat.id, kind, deps.readPreset, deps.readLorebook, deps.readLibrary, deps.choiceDefaults).catch((error: unknown) => {
    if (error instanceof StudioConflictError) return null;
    throw error;
  });
  if (!loaded) return null;
  const started = Date.now();
  const prep = await prepareRequest({ chats: deps.chats, state: deps.state }, chat, loaded, undefined, "", started);
  const { result } = await assembleRequest({ state: deps.state, randomSeed: () => Math.floor(Math.random() * 2 ** 31) }, { chat, loaded, prep, started, kind: kind === "draft" ? "reply" : kind, original: "", guidance: "", unbudgeted: true });
  const recaps = result.messages.flatMap((message, index) => (result.trace[index]?.source.kind === "summary" ? [message.content] : []));
  return {
    features: result.parts.features, recaps, ...(prep.summary ? { summary: prep.summary.text } : {}), lore: result.parts.lore,
    covered: [...(result.chatSummary?.hidden ?? []), ...(result.summaries?.dropped ?? []), ...(book?.unread ?? [])],
    macros: result.expansion.context, closing: (result.skills ?? []).filter((skill) => skill.close).map((skill) => skill.id),
    ...(loaded.literalPrompts ? { literals: loaded.literalPrompts } : {}), ...(loaded.slotNonce ? { slotNonce: loaded.slotNonce } : {}),
  };
}

export interface CorePlanDeps extends CoreSceneRead {
  connect(connection: ChatConnection, signal?: AbortSignal): Promise<Connected | null>;
  now(): number;
  runtime: TurnRuntime;
  emit(event: TurnEvent): void;
  narratorTools?: NarratorToolsFor;
  toolBudgetMs?(): Promise<number | undefined>;
  /** What a Promptbook's phases run on; absent: no Promptbook phases run (a headless consumer). */
  turnDeps?: TurnDeps;
}

/** The calls of one reply, one at a time as the old tool loop ran them: rp-core runs a round's read tools together, and these share held writes and a time budget. */
function toolLane(budgetMs: number) {
  let queue: Promise<unknown> = Promise.resolve();
  let spent = 0;
  return {
    run<T>(tool: NarratorTool<never>, work: (deadline: ToolDeadline | undefined) => Promise<T>): Promise<T> {
      const turn = queue.then(async () => {
        const left = budgetMs - spent;
        // A state write is cheap and keeps the narration and the state in step, so a spent budget does not refuse it (tool-loop.ts).
        if (left <= 0 && !tool.stateScoped) throw new Error("The tool time budget for this reply is spent.");
        const began = performance.now();
        try { return await work(tool.stateScoped ? undefined : { at: began + left, now: () => performance.now() }); }
        finally { spent += performance.now() - began; }
      });
      queue = turn.catch(() => undefined);
      return turn;
    },
  };
}

/** One of Bunzai's narrator tools as rp-core calls it. rp-core keeps its own tools read-only; this one's only write is held for the reply (scene-turn-writes.ts). */
function asCoreTool(tool: NarratorTool<never>, lane: ReturnType<typeof toolLane>, calls: ToolCallRecord[]): Tool {
  const { name, description, parameters } = tool.definition.function;
  return {
    name, description: description ?? "", schema: parameters as Tool["schema"], effect: "read", repeats: true,
    ...(tool.resultCap ? { maxOutput: () => tool.resultCap! } : {}),
    async run(args, ctx) {
      const began = performance.now();
      const noted = (text: string, error?: string): void => {
        // rp-core's round is not told to a tool; the calls are in the order they were made.
        calls.push({ round: 1, id: `${name}-${calls.length}`, name, args: JSON.stringify(args).slice(0, 2_000), ok: error === undefined, ...(error ? { error } : {}), ms: Math.round(performance.now() - began), text });
      };
      const read = tool.parse(args);
      if ("error" in read) { noted(read.error, read.error); return { text: read.error, summary: "refused", error: true }; }
      try {
        const out = await lane.run(tool, (deadline) => tool.run(read.args, ctx.signal, deadline));
        noted(out.text);
        return { text: out.text, summary: name };
      } catch (error) {
        const text = toErrorMessage(error, "the tool failed");
        noted(text, text);
        return { text, summary: "failed", error: true };
      }
    },
  };
}

/** One Core turn's Director and recall, and what they leave behind. */
export function corePlan(deps: CorePlanDeps, sceneChat: Chat, kind: TurnKind, inspect = false) {
  let bookBase: LoadedTurn | null = null;
  let phasesRunning = false;
  let chat = sceneChat;
  let book: CoreBook | null = null;
  const runs: PhaseRun[] = [];
  let afterFailed = false;
  let toolsTurn: ToolTurn | null = null;
  const turnId = crypto.randomUUID();
  let loaded: LoadedTurn | null = null;
  let director: DirectorRun | null = null;
  let replaced: DirectorSnapshot | null = null;
  let recalled: JsonObject | undefined;
  const writes = turnWrites(deps.now);
  // Nothing is saved until the reply lands: a stopped or failed turn loses what its tools wrote, as a dropped checkpoint does.
  const held = async () => true;
  writes.open([], held);
  return {
    /** A Promptbook's private phases, before the turn opens, so the reply goes out on its own setup and model. Null for any other scene. */
    async prepare(signal: AbortSignal): Promise<CoreBook | null> {
      if (sceneChat.preset?.kind !== "promptbook" || !deps.turnDeps || !sceneChat.connection) return null;
      const base = await loadTurn(deps.chats, sceneChat.id, kind, deps.readPreset, deps.readLorebook, deps.readLibrary, deps.choiceDefaults);
      if (!base?.promptbook) return null;
      bookBase = base;
      const connected = await deps.connect(sceneChat.connection, signal);
      if (!connected) throw new StudioValidationError("this scene's connection is gone from Kit; pick another in the AI wing");
      if (kind === "continue") runs.push(...await continuedBookRuns(deps.turnDeps, base));
      else {
        phasesRunning = true;
        try { await runBookPhases({ deps: deps.turnDeps, chat: sceneChat, loaded: base, connected, role: "private", runs, writes, turnId, inspect, save: held, signal, emit: deps.emit }); }
        finally { phasesRunning = false; }
      }
      const phase = replyPhase(base.promptbook);
      const prepared = await composeBookPhase(deps.turnDeps, sceneChat, base, phase, runs, writes, kind === "continue");
      deps.emit({ type: "phase", name: phase.name, role: "reply" });
      chat = { ...prepared.chat, regex: { ...prepared.chat.regex, sets: prepared.regex } };
      if (prepared.connection) chat.connection = prepared.connection;
      const read = new Set(prepared.loaded.history.map((message) => message.id));
      book = { chat, loaded: { ...prepared.loaded, promptbook: base.promptbook }, unread: base.history.filter((message) => !read.has(message.id)).map((message) => message.id), ...(prepared.connection ? { connection: prepared.connection } : {}) };
      return book;
    },
    /** The regex sets the reply runs: a Promptbook phase's own, once it is composed. */
    regexSets: () => chat.regex?.sets,
    /** The chat the reply goes out on: a Promptbook phase's once it is composed. */
    currentChat: () => chat,
    /** A phase is running, and may be waiting on the page. */
    inPhases: () => phasesRunning,
    /** The turn's hooks with the plan in them, over the others the turn has. */
    hooks(base: HostHooks | undefined, parts: CoreSceneParts | undefined): HostHooks {
      const lore = parts?.lore;
      return {
        ...base,
        async tools(context: HookCtx) {
          const read = book?.loaded ?? loaded ?? await loadTurn(deps.chats, chat.id, kind, deps.readPreset, deps.readLorebook, deps.readLibrary, deps.choiceDefaults);
          if (!read) return [];
          const turn = await toolTurn(deps.narratorTools, kind, chat, read, Math.floor(Math.random() * 2 ** 31), writes, await deps.toolBudgetMs?.());
          if (parts) turn.macros.context = parts.macros;
          const lane = toolLane(turn.budgetMs);
          toolsTurn = turn;
          return turn.tools.map((tool) => asCoreTool(tool, lane, turn.calls));
        },
        async beforeAssemble(context: HookCtx) {
          const placed = (await base?.beforeAssemble?.(context)) ?? [];
          try { return await plan(context, placed); }
          catch (error) {
            if (context.signal.aborted) throw error;
            // The reply goes on without the plan, as it does when the Director alone fails, and the person is told.
            const reason = toErrorMessage(error, "the story systems could not run for this reply");
            if (directorOn(chat)) deps.emit({ type: "director", status: "failed", reason });
            else deps.emit({ type: "world", status: "failed", reason });
            return placed;
          }
        },
        // The standing contract goes with a directive and only then, so it waits for the plan.
        async appendSystemContributions(input: { messages: readonly PromptMsg[] }, context: HookCtx) {
          const others = (await base?.appendSystemContributions?.(input, context)) ?? [];
          return director?.directive && renderDirective(director.directive) ? [NARRATOR_AUTHORITY, ...others] : others;
        },
      };
      async function plan(context: HookCtx, placed: Placement[]): Promise<Placement[]> {
          loaded = book?.loaded ?? await loadTurn(deps.chats, chat.id, kind, deps.readPreset, deps.readLorebook, deps.readLibrary, deps.choiceDefaults);
          const connected = loaded && chat.connection ? await deps.connect(chat.connection, context.signal) : null;
          if (!loaded || !connected) return placed;
          const scene = { connected, model: chat.connection!.model };
          if (directorOn(chat) && kind !== "continue") deps.emit({ type: "director", status: "planning" });
          const planning = runDirector(deps, chat, loaded, scene, context.signal, { kind, format: resolveReasoning(loaded.preset?.reasoning, chat.prompting) }).catch((error: unknown) => {
            deps.emit({ type: "director", status: "failed", reason: toErrorMessage(error, "the Story Director failed") });
            return null;
          });
          const recall = await runRecall(deps, chat, loaded, scene, context.signal, () => deps.emit({ type: "world", status: "recalling" }));
          director = await planning;
          if (recall) deps.emit({ type: "world", status: recall.status === "empty" ? "recalled" : recall.status, count: recall.entries.length, ...(recall.reason ? { reason: recall.reason } : {}) });
          if (director) deps.emit({ type: "director", status: director.status, ...(director.reason ? { reason: director.reason } : {}), entries: director.entries });
          const room = connected.context ? Math.max(0, loreShareTokens(connected.context, DEFAULT_LORE_SHARE) - (lore?.tokens ?? 0)) : RECALL_NO_WINDOW_TOKENS;
          const picks = recall && loaded.current.content !== "" ? placeRecall(recall.entries, room, new Set(lore?.keys ?? [])) : null;
          if (recall) recalled = recallSection(recall, picks ?? undefined);
          const directive = director?.directive ? renderDirective(director.directive) : "";
          // rp-core's depth 1 is right above the message being answered: recall first, the Director's constraints after it (source rank), as the old turn places them.
          return [...placed,
            ...(picks?.text ? [{ depth: 1, role: "system" as const, text: picks.text, src: "compendium" as const }] : []),
            ...(directive ? [{ depth: 1, role: "system" as const, text: directive, src: "director" as const }] : [])];
      }
    },
    /** What the plan adds to the stored version's trace. */
    trace: (): JsonObject | undefined => {
      const tools = toolsTurn?.calls.length ? withToolCalls(toolsTurn, {}, { texts: [] }).trace : undefined;
      return recalled || runs.length || tools ? { ...tools, ...(recalled ? { recall: recalled } : {}), ...(runs.length ? { book: bookTrace(runs, afterFailed ? "stopped" : "complete") } : {}) } : undefined;
    },
    /** What the reply itself wrote, stamped on the version it lands as: its tools' writes, its skills' closes and, unless it was stopped, the Props' tick. */
    async deltas(as: "done" | "stopped", closing: readonly string[] = [], text = "", signal?: AbortSignal): Promise<readonly Delta[]> {
      // The version being replaced holds the person's edits to its story, those made while this reply was written too; read now, since the commit moves the scene off it.
      if (director && loaded?.target) replaced = await deps.chats.getDirector(chat.id, loaded.target.id).catch(() => null);
      if (kind === "continue") return [];
      if (as === "done" && loaded) await writes.tick(tickDeltas(loaded, deps.now()));
      // A Promptbook's after phases read the reply, and a failed one costs the phase, never the reply that is already written.
      if (as === "done" && book?.loaded.promptbook && bookBase && deps.turnDeps && chat.connection) {
        const reply = replyPhase(book.loaded.promptbook);
        runs.push({ id: reply.id, name: reply.name, role: "reply", status: "ran", why: "The reply.", text, request: [] });
        const connected = await deps.connect(sceneChat.connection ?? chat.connection, signal);
        const kept = writes.pending();
        const failedAfter = (why: string) => {
          afterFailed = true;
          // What a phase wrote before it failed goes with it, and the reply stays.
          writes.open(kept, held);
          deps.emit({ type: "world", status: "failed", reason: `The reply is saved, but a Promptbook after phase did not finish: ${why}` });
        };
        if (!connected) failedAfter("its model connection is gone.");
        phasesRunning = true;
        if (connected) await runBookPhases({ deps: deps.turnDeps, chat: sceneChat, loaded: bookBase, connected, role: "after", runs, writes, turnId, content: text, inspect, save: held, signal: signal ?? new AbortController().signal, emit: deps.emit })
          .catch((error: unknown) => { failedAfter(toErrorMessage(error, "it stopped")); });
        phasesRunning = false;
      }
      // A skill's close first: a tool that reopens it in this reply wins, as on an old scene.
      return [...closing.map((id) => skillDelta(id, false, deps.now())), ...writes.pending()];
    },
    /** The reply is on the page: what it leaves behind is written to the version it landed as. Never fails the reply. */
    async landed(message: Message, as: "done" | "stopped"): Promise<void> {
      const swipe = message.swipes[message.current];
      if (!loaded || !swipe) return;
      const branchId = (await deps.chats.getChat(chat.id))?.activeBranchId;
      if (!branchId) return;
      const stored = director ? await commitDirector(deps, chat.id, director, message, replaced) : true;
      if (stored !== true) deps.emit({ type: "director", status: "failed", reason: stored });
      if (kind === "continue" || as === "stopped") return;
      if (!deps.runtime.closed && stored === true && director?.status === "planned") {
        startTrackerRound(deps.runtime, { chats: deps.chats, connect: deps.connect, now: deps.now }, {
          chatId: chat.id, branchId, messageId: message.id, swipeId: swipe.id, turn: director.turn,
          characterName: loaded.character.identity.name, personaName: loaded.persona?.name ?? "User", userMessage: loaded.current.content, reply: swipe.content,
          ...(director.directive ? { directive: summaryOf(director.directive) } : {}),
        });
      }
    },
  };
}
