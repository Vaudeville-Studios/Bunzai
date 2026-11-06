/**
 * Bunzai's own story systems around an rp-core turn, so a Core scene has one Director, one Compendium and one set of trackers, the
 * ones its panels read. `coreSceneParts` runs the assembler a send runs, with nothing asked or written, for what those systems add to
 * the prompt (core-library.ts seats it in the scene's preset). `corePlan` makes the calls a model answers before the request (the
 * Director's plan and the Compendium's recall, rp-core's beforeAssemble hook) and writes what the reply leaves behind once it has
 * landed on the page. rp-core's own Director and Compendium stay off on these scenes.
 */
import type { HookCtx, HostHooks, PromptMsg, Tool } from "rp-core";
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
import { StudioConflictError } from "./errors";
import { commitDirector, runDirector, type DirectorRun } from "./scene-director";
import { startTrackerRound } from "./scene-director-trackers";
import type { ReadLorebook } from "./scene-lore";
import type { Connected, TurnEvent } from "./scene-turn";
import { assembleRequest, prepareRequest } from "./scene-turn-build";
import { loadTurn, type LoadedTurn, type ReadPreset, type TurnKind } from "./scene-turn-load";
import type { TurnRuntime } from "./scene-turn-runtime";
import { toolTurn, type NarratorToolsFor } from "./scene-turn-tools";
import { turnWrites } from "./scene-turn-writes";
import { skillDelta } from "../core/skill";
import type { Delta } from "../core/scene-state/types";
import type { NarratorTool, ToolDeadline } from "../stage/provider/tool-loop";
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
}

/** The scene's parts for a turn of this kind; null when the scene is gone. Asks no model and writes nothing. */
export async function coreSceneParts(deps: CoreSceneRead, sceneId: string, kind: TurnKind | "draft"): Promise<CoreSceneParts | null> {
  const chat = await deps.chats.getChat(sceneId);
  if (!chat) return null;
  // A swipe with no reply to swipe is the turn's own refusal to make, in rp-core's words (core-turn-owner.ts).
  const loaded = await loadTurn(deps.chats, chat.id, kind, deps.readPreset, deps.readLorebook, deps.readLibrary, deps.choiceDefaults).catch((error: unknown) => {
    if (error instanceof StudioConflictError) return null;
    throw error;
  });
  if (!loaded) return null;
  const started = Date.now();
  const prep = await prepareRequest({ chats: deps.chats, state: deps.state }, chat, loaded, undefined, "", started);
  const { result } = await assembleRequest({ state: deps.state, randomSeed: () => 0 }, { chat, loaded, prep, started, kind: kind === "draft" ? "reply" : kind, original: "", guidance: "", unbudgeted: true });
  const recaps = result.messages.flatMap((message, index) => (result.trace[index]?.source.kind === "summary" ? [message.content] : []));
  return {
    features: result.parts.features, recaps, ...(prep.summary ? { summary: prep.summary.text } : {}), lore: result.parts.lore,
    covered: [...(result.chatSummary?.hidden ?? []), ...(result.summaries?.dropped ?? [])],
    macros: result.expansion.context, closing: (result.skills ?? []).filter((skill) => skill.close).map((skill) => skill.id),
  };
}

export interface CorePlanDeps extends CoreSceneRead {
  connect(connection: ChatConnection, signal?: AbortSignal): Promise<Connected | null>;
  now(): number;
  runtime: TurnRuntime;
  emit(event: TurnEvent): void;
  narratorTools?: NarratorToolsFor;
  toolBudgetMs?(): Promise<number | undefined>;
}

/** One of Bunzai's narrator tools as rp-core calls it. rp-core keeps its own tools read-only; this one's only write is held for the reply (scene-turn-writes.ts). */
function asCoreTool(tool: NarratorTool<never>, deadline: () => ToolDeadline): Tool {
  const { name, description, parameters } = tool.definition.function;
  return {
    name, description: description ?? "", schema: parameters as Tool["schema"], effect: "read",
    ...(tool.resultCap ? { maxOutput: () => tool.resultCap! } : {}),
    async run(args, ctx) {
      const read = tool.parse(args);
      if ("error" in read) return { text: read.error, summary: "refused", error: true };
      try {
        const out = await tool.run(read.args, ctx.signal, deadline());
        return { text: out.text, summary: name };
      } catch (error) {
        return { text: toErrorMessage(error, "the tool failed"), summary: "failed", error: true };
      }
    },
  };
}

/** One Core turn's Director and recall, and what they leave behind. */
export function corePlan(deps: CorePlanDeps, chat: Chat, kind: TurnKind) {
  let loaded: LoadedTurn | null = null;
  let director: DirectorRun | null = null;
  let replaced: DirectorSnapshot | null = null;
  let recalled: JsonObject | undefined;
  const writes = turnWrites(deps.now);
  // Nothing is saved until the reply lands: a stopped or failed turn loses what its tools wrote, as a dropped checkpoint does.
  writes.open([], async () => true);
  return {
    /** The turn's hooks with the plan in them, over the others the turn has. */
    hooks(base: HostHooks | undefined, parts: CoreSceneParts | undefined): HostHooks {
      const lore = parts?.lore;
      return {
        ...base,
        async tools(context: HookCtx) {
          const read = loaded ?? await loadTurn(deps.chats, chat.id, kind, deps.readPreset, deps.readLorebook, deps.readLibrary, deps.choiceDefaults);
          if (!read) return [];
          const turn = await toolTurn(deps.narratorTools, kind, chat, read, Math.floor(Math.random() * 2 ** 31), writes, await deps.toolBudgetMs?.());
          if (parts) turn.macros.context = parts.macros;
          const until = performance.now() + turn.budgetMs;
          return turn.tools.map((tool) => asCoreTool(tool, () => ({ at: until, now: () => performance.now() })));
        },
        async beforeAssemble(context: HookCtx) {
          const placed = (await base?.beforeAssemble?.(context)) ?? [];
          loaded = await loadTurn(deps.chats, chat.id, kind, deps.readPreset, deps.readLorebook, deps.readLibrary, deps.choiceDefaults);
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
          // The version being replaced holds the person's edits to its story; read now, since the commit moves the scene off it.
          if (director && loaded.target) replaced = await deps.chats.getDirector(chat.id, loaded.target.id).catch(() => null);
          const room = connected.context ? Math.max(0, loreShareTokens(connected.context, DEFAULT_LORE_SHARE) - (lore?.tokens ?? 0)) : RECALL_NO_WINDOW_TOKENS;
          const picks = recall && loaded.current.content !== "" ? placeRecall(recall.entries, room, new Set(lore?.keys ?? [])) : null;
          if (recall) recalled = recallSection(recall, picks ?? undefined);
          const directive = director?.directive ? renderDirective(director.directive) : "";
          // rp-core's depth 1 is right above the message being answered: recall first, the Director's constraints after it (source rank), as the old turn places them.
          return [...placed,
            ...(picks?.text ? [{ depth: 1, role: "system" as const, text: picks.text, src: "compendium" as const }] : []),
            ...(directive ? [{ depth: 1, role: "system" as const, text: directive, src: "director" as const }] : [])];
        },
        // The standing contract goes with a directive and only then, so it waits for the plan.
        async appendSystemContributions(input: { messages: readonly PromptMsg[] }, context: HookCtx) {
          const others = (await base?.appendSystemContributions?.(input, context)) ?? [];
          return director?.directive && renderDirective(director.directive) ? [NARRATOR_AUTHORITY, ...others] : others;
        },
      };
    },
    /** What the plan adds to the stored version's trace. */
    trace: (): JsonObject | undefined => (recalled ? { recall: recalled } : undefined),
    /** What the reply itself wrote, stamped on the version it lands as: its tools' writes, its skills' closes and, unless it was stopped, the Props' tick. */
    async deltas(as: "done" | "stopped", closing: readonly string[] = []): Promise<readonly Delta[]> {
      if (kind === "continue") return [];
      if (as === "done" && loaded) await writes.tick(tickDeltas(loaded, deps.now()));
      return [...writes.pending(), ...closing.map((id) => skillDelta(id, false, deps.now()))];
    },
    /** The reply is on the page: what it leaves behind is written to the version it landed as. Never fails the reply. */
    async landed(message: Message): Promise<void> {
      const swipe = message.swipes[message.current];
      if (!loaded || !swipe) return;
      const branchId = (await deps.chats.getChat(chat.id))?.activeBranchId;
      if (!branchId) return;
      const stored = director ? await commitDirector(deps, chat.id, director, message, replaced) : true;
      if (stored !== true) deps.emit({ type: "director", status: "failed", reason: stored });
      if (kind === "continue") return;
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
