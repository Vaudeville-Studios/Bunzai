/**
 * The reply's request, built once, split out of scene-turn.ts for its file-size cap and so the Context wing's Next send forecast
 * (scene-forecast.ts) is the very code a send runs, not a second assembly path that has to be kept in step with it. `prepareRequest` reads what assembly needs (the scene's
 * window, request options, meter and variables); `assembleRequest` runs the assembler over the loaded scene; `shapeRequest` fits the result to one model (prefill, the
 * continue cue, last-as-user, reasoning continuity, the person's edits). Nothing here writes, sends or asks a model: the turn does that, in its own order.
 */
import { assemble } from "../core/assembly/assemble";
import { appBudgeter } from "../core/assembly/budget-app";
import { appendGuidedSwipe, guidedBlocks } from "../core/assembly/guided-swipe";
import { CONTINUE_CUE, continuationPrefill } from "../core/assembly/continuation";
import { lastAsUser, modelTakesPrefill, presetWindow, sceneOptions, turnWindow, withPrefill } from "../core/assembly/request";
import { DEFAULT_LORE_SHARE, type AssemblyInput, type AssemblyResult } from "../core/assembly/types";
import type { MacroDeadline, MacroVariable } from "../core/macros";
import { PROMPT_BUDGET_MS_DEFAULT } from "../core/assembly/tool-rounds";
import { SUMMARY_DEFAULTS, contextWindow, resolveSummary } from "../core/summary/settings";
import { resolveReasoning } from "../core/reasoning-capture";
import { readKey, type Meter } from "../core/tokens";
import type { Chat, ChatStore, Message, NarratorDirective } from "../stage/contracts/chat-store";
import type { ProviderOptions, ProviderRole } from "../stage/contracts/provider";
import type { PromptMessage } from "./scene-turn-attachments";
import type { StateStore } from "../stage/contracts/state-store";
import { selectedGuides } from "./guides";
import type { RecallRun } from "./compendium-recall";
import { recapsOf } from "./compendium-summaries";
import { readGlobals, type LoadedTurn, type TurnKind } from "./scene-turn-load";
import { measureFor, readMeter } from "./scene-turn-meter";
import { withContinuity } from "./scene-turn-reasoning";
import { applyEdits } from "./scene-turn-review";
import type { Connected } from "./scene-turn";

/** What assembly needs before the request is built; nothing in it has been written. */
export interface Prep {
  window: ReturnType<typeof presetWindow> & { stated: boolean };
  options: ProviderOptions;
  presetName: string;
  reasoningFormat: ReturnType<typeof resolveReasoning>;
  meter: Meter;
  key: string;
  startGlobal: Map<string, MacroVariable>;
  /** The take's saved chat summary as the assembler takes it; absent when the take has none or Include in AI context is off. */
  summary?: AssemblyInput["chatSummary"];
}

const NO_PRESET = "No Preset (Defaults)";

export async function prepareRequest(deps: { chats: Pick<ChatStore, "globalOps">; state: Pick<StateStore, "read"> }, chat: Chat, loaded: LoadedTurn, connected: Connected | undefined, model: string, started: number): Promise<Prep> {
  // With no connection (a formula's Try reads the scene without asking a model) the window is the unstated default; assembly is then run unbudgeted.
  const base = turnWindow(connected?.context);
  const window = { ...presetWindow(base, loaded.preset), stated: base.stated };
  const options = { ...sceneOptions(loaded.preset, loaded.generation ?? {}, chat.prompting), stream: true, max_tokens: window.reply };
  const meter = await readMeter(deps.state);
  // A new version of a reply starts its local variables from the state before the reply it replaces (scene-turn-load.ts), and the library's
  // global ones from every shown version but the one it replaces (core/scene-state/globals.ts), so nothing is counted twice.
  const startGlobal = await readGlobals(deps.chats, loaded.target ? [loaded.target.swipes[loaded.target.current]!.id] : [], loaded.pendingGlobals);
  // The take's own summary (ChatStore rule 45), sent only while Include in AI context is on; hiding what it covers keeps Keep recent messages (RoleCall resolveSummaryContextWindowSize).
  const settings = resolveSummary(chat.summary?.settings);
  const take = settings.include ? (loaded.savedSummary ?? null) : null;
  const summary = take && take.text.trim() ? { text: take.text, through: take.through, ...(settings.hideOld ? { hideKeep: contextWindow(settings) ?? SUMMARY_DEFAULTS.keepRecent } : {}) } : undefined;
  return {
    window, options, meter, ...(summary ? { summary } : {}),
    presetName: loaded.preset?.name ?? NO_PRESET,
    reasoningFormat: resolveReasoning(loaded.preset?.reasoning, chat.prompting),
    key: readKey(meter, connected?.kind ?? "", model),
    startGlobal,
  };
}

export interface Built {
  result: AssemblyResult;
  /** The assembled messages, with a guided re-roll's rejected draft and directive added. */
  asked: AssemblyResult["messages"];
  guided: ReturnType<typeof guidedBlocks>;
}

/** Runs the assembler over the loaded scene. `recall` is the Compendium's pass when it ran; a forecast passes none. */
/** The deadline for one prompt build's macros: the setting, else the default, from now on the build's clock (real monotonic time unless a test hands one in). */
export async function promptBudget(deps: { promptBudgetMs?(): Promise<number | undefined> }): Promise<number> {
  return (await deps.promptBudgetMs?.()) ?? PROMPT_BUDGET_MS_DEFAULT;
}

/** The deadline itself, started now: call it right before the macro passes, after every read that comes first, so those reads do not spend the budget. */
export function promptDeadline(deps: { clock?(): number }, budgetMs: number): MacroDeadline {
  const clock = deps.clock ?? (() => performance.now());
  return { at: clock() + budgetMs, now: clock, soft: true };
}

/** What to tell the person when the request does not fit: the card and the message alone, or, when there are fixed parts too, them as well. */
export const overflowMessage = (result: AssemblyResult): string =>
  result.budget.fixed ? "The card, your message and the fixed parts of the request (the trackers' block and the tool definitions) alone are longer than this model's window." : "The card and your message alone are longer than this model's window.";

export async function assembleRequest(
  deps: { state: Pick<StateStore, "read">; randomSeed(): number; clock?(): number; promptBudgetMs?(): Promise<number | undefined> },
  a: { chat: Chat; loaded: LoadedTurn; prep: Prep; started: number; kind: TurnKind; original: string; guidance: string; recall?: RecallRun | null; director?: NarratorDirective; reserved?: readonly string[]; /** Build the macro context and the scene's text without fitting a window: nothing is sent, so nothing has to fit. */ unbudgeted?: boolean },
): Promise<Built> {
  const { chat, loaded, prep, kind, recall } = a;
  const loreInput: AssemblyInput["lore"] = loaded.lore ? { ...loaded.lore, budgetShare: DEFAULT_LORE_SHARE } : undefined;
  const recaps = recapsOf(chat, loaded);
  const budgetMs = await promptBudget(deps);
  const guides = await selectedGuides(deps.state, chat.prompting?.guides);
  const result = assemble({
    ...loaded,
    deadline: promptDeadline(deps, budgetMs),
    ...(recall ? { recall: { entries: recall.entries } } : {}),
    ...(a.director ? { director: a.director } : {}),
    ...(a.reserved && a.reserved.length > 0 ? { reserved: a.reserved } : {}),
    ...(recaps ? { summaries: { recaps } } : {}),
    ...(prep.summary ? { chatSummary: prep.summary } : {}),
    globalVariables: prep.startGlobal,
    now: a.started,
    randomSeed: deps.randomSeed(),
    ...(a.unbudgeted ? {} : { window: prep.window, budgeter: appBudgeter(measureFor(prep.meter, prep.key, a.started)) }),
    lore: loreInput,
    // The Prompting wing's switched-on guides and scene note (ChatStore rule 37).
    guides,
    ...(chat.prompting?.note ? { note: chat.prompting.note } : {}),
    ...(chat.prompting?.prefill ? { prefill: chat.prompting.prefill } : {}),
    reasoning: prep.reasoningFormat,
    ...(chat.prompting?.keepThinking ? { keepThinking: true } : {}),
    // "Regenerate" is UI language for a swipe (scene-page.tsx); the turn loop itself only begins a
    // "reply", a "swipe" or a "continue" (loadTurn's TurnKind), so those are the only generation
    // types the lore engine's [generationType:...] trigger can see here.
    generationType: kind === "swipe" ? "swipe" : kind === "continue" ? "continue" : "normal",
    ...(kind === "continue" ? { continuation: a.original } : {}),
  });
  /** A guided re-roll's request: the version being replaced as a rejected draft, then RoleCall's directive, before any prefill. */
  const asked = a.guidance ? appendGuidedSwipe(result.messages, loaded.target!.swipes[loaded.target!.current]!.content, a.guidance) : result.messages;
  return { result, asked, guided: guidedBlocks(asked.slice(result.messages.length)) };
}

/** The request for one model: the prefill and the continue cue depend on what that model accepts. */
export function shapeRequest(
  a: { chat: Chat; loaded: LoadedTurn; kind: TurnKind; original: string; built: Built; connected: Connected | null },
  forModel: string,
  edits: Readonly<Record<number, string>>,
): PromptMessage[] {
  const { chat, loaded, kind, built, connected } = a;
  const out = withPrefill(built.asked, built.result.prefill, forModel, kind === "continue" ? "assistant" : chat.prompting?.prefillRole);
  // Rule 13: a model that refuses the reply as a final assistant turn is shown it as an assistant turn and then
  // asked to go on, with the preset's Continue Nudge or else the cue RoleCall adds to any assistant tail it must drop, so the request ends on a user turn.
  if (kind === "continue" && !modelTakesPrefill(forModel)) {
    out.push({ role: "assistant", content: continuationPrefill(a.original) }, { role: "user", content: built.result.continueNudge ?? CONTINUE_CUE });
  }
  // Last Message as User (ChatStore rule 37): after the prefill and the continue cue, as RoleCall's worker does.
  return withContinuity(applyEdits(chat.prompting?.lastAsUser ? lastAsUser(out) : out, edits), built.result.trace, loaded.history, { on: chat.prompting?.continuity === true, kind: connected?.kind ?? "", connectionId: connected?.provider.id ?? "", model: forModel });
}

/** The prefill that opens this reply as the assistant's own words: not a continue's, not a user hint or system note, and not for a model that refuses one. */
export function openedWith(a: { chat: Chat; kind: TurnKind; built: Built }, forModel: string): string | undefined {
  return a.kind !== "continue" && !a.chat.prompting?.prefillRole && modelTakesPrefill(forModel) && a.built.result.prefill?.trim() ? a.built.result.prefill : undefined;
}
