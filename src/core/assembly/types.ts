/**
 * The pure prompt assembler's input and output.
 * RoleCall's `assemblePrompt` loads its own data; here the loader reads the stores and hands this
 * over, and the assembler does no I/O: same input, same messages, which is what lets RoleCall's
 * recorded fixtures prove the port.
 */
import type { MacroContext, MacroDeadline, MacroVariable } from "../macros";
import type { GlobalWrite } from "../macros/types";
import type { ReasoningFormat } from "../reasoning-tags";
import type { CharacterBody } from "../../entities/character/schema";
import type { PersonaBody } from "../../entities/persona/schema";
import type { PresetBody } from "../../entities/preset/schema";
import type { PresetAttachment } from "../../entities/preset/schema";
import type { LoreUndo } from "./lore-effects";
import type { LoreBookInput, LoreFire, LoreHit, LoreRun, LoreVerdict } from "../lore/engine";
import type { ChatNote } from "../../stage/contracts/chat-settings-types";
import type { Perspective } from "../draft-prompts";
import type { AssemblyGuide } from "./guides";
import type { RecallEntry, RecallHit } from "./recall-place";
import type { SummaryRecap } from "./summary-cut";
import type { TrackersInput } from "./trackers";
import type { StoryboardsInput } from "./storyboards";
import type { AssemblySkill, SkillRun } from "./skills";
import type { LinkedTracker } from "../tracker";
import type { NarratorDirective } from "../../stage/contracts/director-types";

/**
 * The lore share of the context (2e-d4 plan step 3): owner may change; a quarter of the window, so
 * lore never crowds out recent history (lorebook fix 6).
 */
export const DEFAULT_LORE_SHARE = 0.25;

export type AssembledRole = "system" | "user" | "assistant";

/** One message of the request, structurally a ProviderMessage (src/stage/contracts/provider.ts). */
export interface AssembledMessage {
  role: AssembledRole;
  content: string;
  attachments?: readonly PresetAttachment[];
  /** Derived prompt block identity, used only for Inspector association and companion wording. */
  attachmentOwner?: { id: string; name: string };
}

/** A stored message the prompt may use: the loader passes the current swipe of each live one. */
export interface HistoryMessage {
  id: string;
  role: AssembledRole;
  content: string;
  /** Epoch ms, when the store has one; powers the lore engine's [recency:...] (2e-d4 plan step 3). */
  at?: number;
  /** The message's place among the take's live messages (the greeting is 0), the space a Historian recap's `turn_range` is in. Absent: no recap can cover it (summary-cut.ts). */
  index?: number;
  /** Smart Recovery: where the thinking a helper model found in this reply ends (reasoning-rescue.ts); the history cleans it like a tagged block. */
  thinkingEnd?: number;
  /** The provider reasoning this reply was written with, for the model that wrote it (Reasoning continuity, scene-turn-reasoning.ts); the check for Smart Recovery reads that it had some. */
  reasoning?: { text: string; signature?: string; provider?: string; model?: string };
}

/** Where a block of the request came from, for the trace (turn-loop spec item 10, D14). */
export type BlockSource =
  | { kind: "prompt"; name: string; id?: string }
  | { kind: "greeting"; messageId: string }
  | { kind: "history"; messageId: string }
  | { kind: "current"; messageId: string }
  | { kind: "depth"; depth: number }
  | { kind: "lore"; entryKey: string }
  /** The Compendium's recall block (recall-place.ts): one system message, the entries its selector picked. */
  | { kind: "recall" }
  /** A Historian recap standing in for the messages it covers (summary-cut.ts). */
  | { kind: "summary"; entryKey: string }
  /** The scene note (note.ts) and a guide the worker steps place (guides.ts). */
  | { kind: "note" }
  | { kind: "guide" }
  /** The trackers' state (trackers.ts): one system message. */
  | { kind: "trackers" }
  /** The Storyboards' digest of the book (storyboards.ts): one system message. */
  | { kind: "storyboards" }
  /** The skills that are on this turn (skills.ts): one system message. */
  | { kind: "skills" }
  /** The Story Director's two blocks (director.ts): the authority contract at the top and this turn's directive just above the last user message. */
  | { kind: "director" }
  /** A guided re-roll's two added messages (guided-swipe.ts): not assembled blocks, but sent, so traced. */
  | { kind: "guided-draft" }
  | { kind: "guided-directive" };

export interface TraceBlock {
  source: BlockSource;
  role: AssembledRole;
  /** The block's own text tokens (src/core/tokens countText), before any per-message framing. */
  tokens: number;
}

/** What the budget kept: history messages trimmed, by id, and at which pass. */
export interface BudgetDecision {
  budgeter: "parity" | "app" | "none";
  trimmed: string[];
  /**
   * How many of `trimmed` the final pass itself dropped (RoleCall's finalPassBudgetTrim), as opposed
   * to an earlier pass (`fitHistory`) that already excluded some before assembly ever built a block
   * for them. `trimmed` is always the complete, accurate list of dropped message ids; this is only
   * ever a sub-count of it, by stage, for diagnostics (`scene-turn.ts`'s stored trace; nothing in the
   * app branches on it). The parity budgeter's own `fitHistory` already trims for real, so for it this
   * has always been smaller than `trimmed.length` whenever it dropped anything up front. The app
   * budgeter's `fitHistory` used to be a no-op, so for it this used to equal `trimmed.length` always;
   * since its P2 exact pre-trim, it behaves the
   * same as parity's always has - a large scene's drop is now mostly attributed to `fitHistory`
   * instead, with `finalPassDropped` covering only whatever chunk-aligned remainder was left for it to
   * decide. The assembled request itself never depends on this split.
   */
  finalPassDropped: number;
  /**
   * Set by the app budgeter when even the card, the greeting, and the message being answered do not
   * fit: the turn loop says so instead of sending. RoleCall sends anyway, so the parity budgeter
   * never sets it.
   */
  overflow?: true;
  /** Set when the request carries fixed parts beside the card (the library trackers' block, the tool definitions), so an overflow can say they are among what does not fit. */
  fixed?: true;
}

/** A variable diff for one scope, in ChatStore rule 17's shape: set some names, delete others. */
export interface VariableDiff {
  set: Record<string, MacroVariable["value"]>;
  delete: string[];
}

/** One macro the prompt used (macro-report.ts): how often, the first call as written, what it first produced (cut for the report) and the tokens of everything it produced. */
export interface MacroUse { name: string; count: number; tokens: number; example: string; value: string }
/** One variable write a macro made while the request was built. */
export interface MacroMutation { scope: "local" | "global"; key: string; value?: MacroVariable["value"]; deleted?: true; cause?: string }
/** What the macro pass of one assembly did, for the Context wing. */
export interface MacroReport { total: number; used: MacroUse[]; errors: { macro: string; message: string }[]; mutations: MacroMutation[] }
/** A variable that ended the assembly different from how it began: absent `before` is new, `deleted` is gone. */
export interface MacroChange { scope: "local" | "global"; key: string; before?: MacroVariable["value"]; after?: MacroVariable["value"]; deleted?: true }

/** The window the prompt must fit, and what is held back for the reply. */
export interface Window {
  context: number;
  reply: number;
}

/**
 * The budget seam (turn-loop rule 6). Assembly asks what fits; the parity budgeter answers as
 * RoleCall's ContextBudget does, the app budgeter with the token meter's safe bound.
 */
export interface Budgeter {
  readonly name: "parity" | "app";
  /**
   * How many of the newest history messages to keep. `required` and `important` are what RoleCall
   * reserves before it trims (the character prompt, the greeting, the current message; the persona);
   * `raw` is each message's stored text, which RoleCall's loose pre-trim measures.
   */
  fitHistory(input: {
    window: Window;
    required: readonly (string | readonly AssembledMessage[])[];
    important: readonly string[];
    raw: readonly string[];
    history: readonly AssembledMessage[];
    /**
     * P2: the fewest of the newest `raw` messages a safe pre-trim may ever drop
     * below, so a depth note, in-chat block, append block or lore hit placed by depth still lands
     * exactly where a full-history pass would put it (history-cut.ts derives it; conversationally,
     * not in tokens). Absent or 0: nothing in this turn places anything by depth, so there is no
     * floor. A budgeter that does not pre-trim (parity) may ignore it.
     */
    minKeep?: number;
    /**
     * P2: the real content `finalPass` will measure for the `i`-th newest stored
     * history message (0 = the newest, matching `raw`'s reverse order) - assemble.ts's own text
     * unless it contains a macro, in which case its macro-expanded form, memoized so a message this
     * inspects and later keeps is never expanded twice. Lets a budgeter that pre-trims (app) sum the
     * *exact* per-message cost `finalPass` uses, from the newest backward, instead of estimating one,
     * so it can prove an overflow (and stop) without ever risking a bound that undercounts some
     * tokenizer's real output. Absent: falls back to `raw` itself (a budgeter that does not pre-trim,
     * or a caller with no macros to expand, needs nothing more).
     */
    contentFromNewest?: (i: number) => string;
  }): number;
  /**
   * Drops from the finished request until it fits under `cap`. `history` marks the stored history
   * messages; RoleCall's pass ignores it and drops any turn before the last user message.
   */
  finalPass(messages: readonly AssembledMessage[], cap: number, history: readonly boolean[]): { keep: boolean[]; dropped: number; overflow?: boolean };
}

export interface AssemblyInput {
  /** The chat's frozen character: a canonical character body (ChatStore rule 10). */
  character: CharacterBody;
  persona?: PersonaBody;
  /** The scene's preset. Absent: RoleCall's "No Preset (Defaults)" set. */
  preset?: PresetBody;
  /** Runtime data for named prompt blocks, inserted after macro evaluation and before budgeting. Never evaluated as authored instructions. */
  literalPrompts?: Readonly<Record<string, string>>;
  /** Shared nonce for host-compiled, late-bound preset slots. */
  slotNonce?: string;
  /** The scene's own on/off per preset block id, over the preset's switches (RoleCall's promptEnabledStates). */
  promptToggles?: Readonly<Record<string, boolean>>;
  /** The scene's answers to this preset's choice groups, by group id (ChatStore rule 42); absent groups take their declared default. */
  choices?: Readonly<Record<string, unknown>>;
  /**
   * Every live message before the one being answered, oldest first. The first, when it is the
   * assistant's, is the greeting the scene opened with.
   */
  history: readonly HistoryMessage[];
  /** The user message being answered: the branch's last user message. */
  current: HistoryMessage;
  localVariables: ReadonlyMap<string, MacroVariable>;
  globalVariables: ReadonlyMap<string, MacroVariable>;
  /** Epoch ms, for time macros and variable times. */
  now: number;
  randomSeed: number;
  /** Absent: no trimming at all, as RoleCall does without a context limit. */
  window?: Window;
  budgeter?: Budgeter;
  /** The scene's lorebooks (2e-d4 plan step 3): absent turns run no lore at all. */
  lore?: { books: LoreBookInput[]; recentFires: LoreFire[]; budgetShare: number };
  /** The kind of turn this is, for the lore engine's [generationType:...] trigger (2e-d7 plan step 5).
   * Absent defaults to "normal". */
  generationType?: "normal" | "regenerate" | "swipe" | "continue" | "impersonate";
  /**
   * Continue (turn-loop rule 13): the text of the reply being continued. It becomes the result's
   * `prefill`, trimmed and not macro-expanded, in place of the preset's own. `history` then ends
   * before that reply and `current` is the message it answers, exactly as for a swipe.
   */
  continuation?: string;
  /**
   * Expand as character (draft-prompts.ts): the request ends on one system message asking for {{user}}'s next
   * message, and its prefill is the preset's impersonation prefill, never the character-voice one.
   */
  impersonation?: { brief: string; perspective: Perspective };
  /** The scene's switched-on guides, in the order they were switched on, with their text (guides.ts). */
  guides?: readonly AssemblyGuide[];
  /** What the history's thinking is read by (Catch thinking, reasoning-capture.ts resolveReasoning); absent: the three default tags. */
  reasoning?: ReasoningFormat;
  /** "Let the model see its old thinking": the assistant's earlier replies go as stored. Off (absent), their thinking is taken out of the history and of what history macros read. */
  keepThinking?: boolean;
  /** The scene's own Start Reply With text (ChatStore rule 37): chat-level, so it replaces the preset's prefill and leads the assistant guides. */
  prefill?: string;
  /** The scene note (note.ts); absent runs none. */
  note?: ChatNote;
  /** The tracker Props that are on and what they kept (trackers.ts); absent adds nothing. */
  trackers?: TrackersInput;
  /** The library trackers the scene links, each with its current value (core/tracker.ts): the Trackers block and the tracker macro; absent adds nothing. */
  linkedTrackers?: readonly LinkedTracker[];
  /** Texts that ride in the request beside the messages (the tool definitions): measured by the budget like a fixed block, so history gives way to them. */
  reserved?: readonly string[];
  /** The time all the macros of this build may take together, as a point in time and the caller's clock (the assembler reads no ambient time); absent: the engine's own caps only. */
  deadline?: MacroDeadline;
  /** The Storyboard Props that are on and the books they read (storyboards.ts); absent adds nothing. */
  storyboards?: StoryboardsInput;
  /** The library skills the scene links, in order, each with whether the model has it open (skills.ts); absent adds nothing. */
  skills?: readonly AssemblySkill[];
  /** This turn's Story Director directive (director.ts), planned for this turn only; absent places nothing. */
  director?: NarratorDirective;
  /** What the Compendium's recall picked for this reply, in the selector's order (recall-place.ts); absent runs none. */
  recall?: { entries: readonly RecallEntry[] };
  /** Summary-aware context truncation (summary-cut.ts): the Compendium's live recaps. Present only when the setting is on; absent keeps every message. */
  summaries?: { recaps: readonly SummaryRecap[] };
  /** The take's chat summary (chat-summary.ts): its text is what {{summary}} expands to; `through` counts the live messages it covers (the greeting is 0), and `hideKeep`, when hiding what it covers is on, is how many of the newest messages stay whatever it covers. Absent: no summary is sent. */
  chatSummary?: { text: string; through: number; hideKeep?: number };
}

/**
 * One lore hit as the trace keeps it: enough to explain why and where, none of the content itself.
 * `position` feeds TrackHare's "place" label (th-t3 plan step 3); it is not RoleCall's, so an older
 * stored trace lacks it and the route falls back to the entry's current position.
 */
export type AssemblyLoreHit = Pick<LoreHit, "entryKey" | "title" | "reason" | "matched" | "tokens" | "position">;

export interface AssemblyResult {
  /** What the trackers, the storyboards and the skills add by feature marker, and what lore placed: a host with its own layout (a Core scene) seats these itself (studio/core-turn-plan.ts). */
  parts: { features: Partial<Record<string, string[]>>; lore: { keys: string[]; tokens: number } };
  /**
   * What a scene's prompt regex needs after its sandbox run (studio/scene-turn-regex.ts): `{{user}}` and `{{char}}` for a rule's find pattern, and
   * `expand`, the read-only macro pass history gets, for the authored macros in a replacement. It sets no variable. `context` is the
   * turn's macro context as the prompt left it, for a formula a tool runs (core/formula.ts runs it on a copy). Runtime only, never stored.
   */
  expansion: { names: { user: string; char: string }; expand(text: string): string; context: MacroContext };
  messages: AssembledMessage[];
  trace: TraceBlock[];
  budget: BudgetDecision;
  local: VariableDiff;
  global: VariableDiff;
  /** Every write to a global variable this assembly made, as the operation it was, in order (core/scene-state/globals.ts keeps them with the reply). */
  globalWrites: GlobalWrite[];
  /** The macro pass's own account of itself; absent when no macro ran. */
  macros?: MacroReport;
  /** Every variable the assembly left different, with what it was before; absent when none changed. */
  changes?: MacroChange[];
  /**
   * The preset's reply cap, else RoleCall's default, as RoleCall's samplerSettings reports it. The
   * request sends the turn window's reply instead (request.ts presetWindow), which also fits the model.
   */
  maxTokens: number;
  /** The preset's assistant prefill, macros expanded; the turn loop places it (request.ts withPrefill). */
  prefill?: string;
  /** A continue's preset Continue Nudge, macros expanded; absent when blank. The turn loop sends it only to a model that refuses the prefill (turn-loop rule 13). */
  continueNudge?: string;
  /**
   * Straight from the lore engine's run (2e-d4 plan step 3), with the seed it ran on. Absent without
   * lore. `verdicts` comes from running the engine with `explain: true` (th-t3 plan step 1): one per
   * book entry, up to 1000; above that, every fired one, then misses up to 1000 total, with
   * `verdictsTruncated` set.
   */
  /** Recall's block as placed: what went in, what the lore share cut, and what lore had already placed (keys). Absent without `input.recall`. */
  recall?: { injected: RecallHit[]; cut: RecallHit[]; repeated: string[]; totalTokens: number };
  /** Summary-aware truncation: the ids of the messages recaps replaced, and the recap blocks sent in their place. Absent when nothing was replaced. */
  summaries?: { dropped: string[]; injected: { entryKey: string; title: string; tokens: number }[] };
  /** The messages the chat summary stood in for (Hide messages already covered), by id. Absent when none were hidden. */
  chatSummary?: { hidden: string[] };
  /** Each linked skill's verdict this turn (on or off, and why; a picked one whose triggers stopped matching closes). Absent without `input.skills`. */
  skills?: SkillRun[];
  lore?: {
    fires: LoreRun["fires"];
    injected: AssemblyLoreHit[];
    cut: AssemblyLoreHit[];
    totalTokens: number;
    seed: number;
    /** What this turn's Side Effects replaced, so a new version of the reply starts from before them (lore-effects.ts). */
    undo: LoreUndo[];
    verdicts: LoreVerdict[];
    verdictsTruncated?: true;
  };
}
