/**
 * The scene half of the app contract's `api` (src/ui/app-contract.ts): the library's scenes, their
 * edits, and a scene's turn and connection. Split out for the file-size cap.
 */
import type { TakeComparison } from "../studio/scene-take-compare";
import type { AgentRecord, BankRecord } from "../studio/final-cut-library";
import type { GuideInput, GuideRecord } from "../core/guide-record";
import type { MacroChange, MacroReport } from "../core/assembly/types";
import type { RouteAttempt } from "../studio/scene-turn-trace";
import type { PromptAttachmentInfo } from "../core/media/prompt-attachment";
import type { LoadoutReceipt, LoadoutRecord } from "../studio/loadout-record";
import type { SummarySettingsPatch, Chat, ChatBackdrop, ChatCompendiumPatch, ChatConnection, JsonValue, ChatPreset, ChatPromptingPatch, ChatFinalCutPatch, ChatRegexPatch, ChatTrackerPatch, TrackerModule, Message, MessageAtPage, MessageSwipePage, SceneFolder } from "../stage/contracts/chat-store";
import type { DraftInput } from "../studio/scene-draft";
import type { SummaryState } from "../studio/scene-summary";
import type { DirectorEdit, DirectorPanel } from "../studio/scene-director-edit";
import type { CoreSceneState } from "../studio/core-inspect";
import type { DirectorSettingsPatch } from "../stage/contracts/director-types";
import type { DramaturgApi } from "./app-contract-dramaturg";
import type { TrackerItemInput } from "../studio/scene-tracker-item";
import type { TrackerRefresh, TrackerRefreshInput } from "../studio/scene-tracker-refresh";
import type { TurnEvent } from "../studio/scene-turn";
import type { FormulaTry } from "../studio/scene-forecast";
import type { LinkedScene } from "../studio/piece-links";
import type { SceneTrackers } from "../studio/scene-trackers";
import type { TrackerEditInput } from "../studio/tracker-edit";
import type { TrackerStates, TrackerWriteInput } from "../studio/tracker-state";
import type { MessageTrackerChanges } from "../studio/tracker-changes";
import type { SceneSearchResult } from "../studio/scene-search";
import type { OpenScene, SceneAction, SceneGrave, SceneMessagePage, SceneSummary, SceneTailMessage } from "../studio/scenes";

/** One of Kit's saved connections as the AI wing lists it (src/ui/server-chats-turn.ts). */
export interface SceneConnectionInfo {
  id: string;
  kind: string;
  label: string;
  model: string;
  context?: number;
  /** The generation parameter ids this provider accepts, for the Generation tab's "not sent to" marker; absent when scenes cannot send through it. */
  params?: string[];
  /** Why scenes cannot send through it; absent when they can. */
  unavailable?: string;
}

/** The settings a loadout reads and writes, straight from the store: the scene's own fields and the persona's id. */
export type SceneSettings = Pick<Chat, "connection" | "preset" | "lore" | "props" | "prompting" | "backdrop" | "regex" | "finalCut"> & { persona: string | null };

export interface ScenesApi extends DramaturgApi {
  /** Scenes (src/studio/scenes.ts): the library's chats, newest first. */
  listScenes(): Promise<SceneSummary[]>;
  openScene(id: string): Promise<OpenScene>;
  /** One older page, guarded by the active branch and version returned from openScene. */
  olderSceneMessages(input: { chatId: string; branchId: string; beforeSeq: number; expectedVersion: number }): Promise<SceneMessagePage>;
  /** At most 60 exact off-page macro dependencies from the same active take/version. */
  getSceneMacroMessages(input: { chatId: string; branchId: string; expectedVersion: number; indices: number[] }): Promise<MessageAtPage & { branchId: string }>;
  /** One alternate swipe cell, opened on demand from the transcript's lightweight swipe metadata. */
  getSceneSwipe(input: { chatId: string; branchId: string; messageId: string; index: number; expectedVersion: number }): Promise<MessageSwipePage>;
  /** The texts a version had before its current one, oldest first (the Edit history list); `swipeId` is what an edit or a restore names. */
  getSceneSwipeHistory(input: { chatId: string; branchId: string; messageId: string; index: number; expectedVersion: number }): Promise<{ swipeId: string; texts: string[] }>;
  /** Searches the scene's active take (ChatStore rule 35): every word of the query, newest first, each hit with RoleCall's 50-character context. */
  searchScene(chatId: string, query: string): Promise<SceneSearchResult>;
  /** A new scene with this character and the default persona, its cast frozen at their current versions, and the character's saved starting setup (`startNotes` says, in words, any part of it that could not be applied). */
  startScene(characterId: string): Promise<Chat & { startNotes?: string[] }>;
  /** Saves the message, and first the chosen greeting (the person's edit of it, when there is one) when the scene is still empty. */
  sendToScene(input: { chatId: string; content: string; greetingIndex: number; expectedVersion: number }): Promise<OpenScene>;
  editSceneMessage(input: { messageId: string; swipeId: string; content: string; expectedVersion: number }): Promise<Message>;
  renameScene(id: string, title: string): Promise<Chat>;
  deleteScene(id: string): Promise<{ deleted: boolean }>;
  /** One change to an open scene (cuts, takes, the card); answers the scene as it now stands. */
  editScene(action: SceneAction, input: Record<string, unknown>): Promise<OpenScene>;
  /**
   * One reply, or a new version of the last one, streamed. Rejects
   * before anything opens (no connection, a stale take); from the start event on, every outcome
   * is an event.
   */
  runSceneTurn(input: { chatId: string; kind: "reply" | "swipe" | "continue"; expectedVersion: number; fallback?: ChatConnection; guidance?: string; inspect?: boolean }, onEvent: (event: TurnEvent) => void): Promise<void>;
  /**
   * One draft tool's answer (studio/scene-draft.ts): Expand as character, Polish Input, Spellcheck, Correct or a
   * passage Rewrite. It answers text and writes nothing to the scene; a refusal or a provider failure rejects.
   * `signal` abandons it.
   */
  runSceneDraft(input: DraftInput, signal?: AbortSignal): Promise<{ text: string }>;
  /**
   * Generate or Refresh one item of a legacy tracker (studio/scene-tracker-item.ts): the scene's model answers one item as a PROPOSAL. Nothing is written to the
   * scene; the panel shows it and `setSceneTracker` keeps it once the person accepts. A refusal, a provider failure or an unreadable answer rejects.
   */
  proposeTrackerItem(input: TrackerItemInput, signal?: AbortSignal): Promise<{ item: unknown }>;
  /**
   * Refresh one whole legacy tracker from the chat history (studio/scene-tracker-refresh.ts): the scene's model answers the tracker's next state as a PROPOSAL with what it
   * changes. Nothing is written to the scene; `setSceneTracker` keeps `proposed` once the person accepts, and only if `chatId` is still the open scene. A refusal, a provider
   * failure or an unreadable answer rejects, and the tracker stays as it was.
   */
  proposeTrackerRefresh(input: TrackerRefreshInput, signal?: AbortSignal): Promise<TrackerRefresh>;
  stopSceneTurn(chatId: string, turnId: string): Promise<{ stopped: boolean }>;
  /** The Prompt Inspector's answer to a turn paused with its request: Send (with the changed messages, by position) or Cancel. */
  answerSceneReview(chatId: string, turnId: string, answer: { kind: "send"; edits: Record<number, string> } | { kind: "cancel" }): Promise<{ answered: boolean }>;
  /** The page's answer to a turn holding its request for the scene's prompt regex (ChatStore rule 42): the changed texts by message index, or why the rules could not run. */
  answerSceneRegex(chatId: string, turnId: string, answer: { kind: "done"; texts: Record<number, string> } | { kind: "failed"; error: string } | { kind: "cancel" }): Promise<{ answered: boolean }>;
  /** A reply held when the take changed while it was written: add it at the end, or discard it. */
  keepWaitingReply(chatId: string, turnId: string): Promise<Message>;
  discardWaitingReply(chatId: string, turnId: string): Promise<{ discarded: boolean }>;
  /** The scene's connection and model (ChatStore rule 18), or null to forget it. */
  setSceneConnection(chatId: string, connection: ChatConnection | null): Promise<Chat>;
  /** The scene's preset with its own toggles and samplers (ChatStore rule 19), or null for none. */
  setScenePreset(chatId: string, preset: ChatPreset | null): Promise<Chat>;
  /** The Prompting wing's per-scene settings (ChatStore rule 37): a key given replaces it, null clears it, a key left out stays. */
  setScenePrompting(chatId: string, patch: ChatPromptingPatch): Promise<Chat>;
  /** The scene's Compendium choices (ChatStore rule 38), the one writer: a key given replaces it, null clears it, a key left out stays; `books`, `recall` and `filing` merge field by field. */
  setSceneCompendium(chatId: string, patch: ChatCompendiumPatch): Promise<Chat>;
  /** The regex sets the scene uses (ChatStore rule 42): `sets` is the ordered list of library set ids, null clears it, a key left out stays. */
  setSceneRegex(chatId: string, patch: ChatRegexPatch): Promise<Chat>;
  /** The scene's Final Cut (ChatStore rule 44): a key given replaces it, null clears it, a key left out stays. */
  setSceneFinalCut(chatId: string, patch: ChatFinalCutPatch): Promise<Chat>;
  /** What the passes did to one saved reply (its trace's `finalCut`, unread) with the text it shows; `run` is null when no pass ran on it. */
  /** Two takes of one scene side by side from where they part (the Branching Tree's compare). */
  compareTakes(chatId: string, a: string, b: string): Promise<TakeComparison>;
  getFinalCutRun(chatId: string, messageId: string): Promise<{ messageId: string; swipeId: string; text: string; run: unknown }>;
  /** Runs the scene's passes over a saved reply again and answers the result; nothing is written (apply it as an edit). */
  rerunFinalCut(chatId: string, messageId: string, signal?: AbortSignal): Promise<{ rerunId: string; messageId: string; swipeId: string; text: string; run: unknown; summary: { passes: number; changed: boolean; failed: number } }>;
  /** The person's own Anti-Slop banks and saved Custom Agents (studio/final-cut-library.ts). */
  /** Writes a previewed re-run over the reply as an edit and keeps it in the reply's run; the server applies what it ran, never text from the page. */
  applyFinalCutRerun(chatId: string, rerunId: string, expectedVersion: number): Promise<{ recorded: boolean }>;
  getFinalCutLibrary(): Promise<{ banks: BankRecord[]; agents: AgentRecord[] }>;
  saveFinalCutBank(bank: Record<string, unknown>): Promise<BankRecord>;
  deleteFinalCutBank(id: string): Promise<{ deleted: boolean }>;
  saveFinalCutAgent(agent: Record<string, unknown>): Promise<AgentRecord>;
  deleteFinalCutAgent(id: string, revision: string): Promise<{ deleted: boolean }>;
  /** One tracker module's SETTINGS (ChatStore rule 43): `context` its AI Context, `auto` its automatic-update choice, `subs` its sub-feature switches, and a Storyboard's profile as `data`; a key given replaces it, null clears it, a key left out stays. A module's state is written with `writeTrackerStates`. */
  setSceneTracker(chatId: string, module: TrackerModule, patch: ChatTrackerPatch): Promise<Chat>;
  /** The Props trackers' state at the take's tip (studio/tracker-state.ts): each module's data, the last update a reply made to each, and the branch version and tip message a write must name back (read only). */
  getTrackerStates(chatId: string): Promise<TrackerStates>;
  /** Writes the state of one or more Props trackers in one step (all or nothing), as the person's edit on the tip message or, for an accepted Refresh, for the tip's shown version; answers the trackers as they now stand and the fields left alone because the person edited them on this reply. Rejects with the sentence that says why when it is refused. */
  writeTrackerStates(input: TrackerWriteInput): Promise<TrackerStates>;
  /** The scene's backdrop, a pack and one item in it (ChatStore rule 36), or null to forget it. */
  setSceneBackdrop(chatId: string, backdrop: ChatBackdrop | null): Promise<Chat>;
  /** The guide library, most recently changed first; a deleted guide is not listed. */
  listGuides(): Promise<GuideRecord[]>;
  /** Makes a guide, or changes the one named by `guide.id`. */
  saveGuide(guide: GuideInput & { id?: string }): Promise<GuideRecord>;
  /** Deletes a guide softly: it leaves every list and every prompt, and the library keeps the record. */
  deleteGuide(id: string): Promise<{ deleted: boolean }>;
  /** The scene's settings as the store holds them now (never the open scene's copy, which the lore and props wings do not refresh); the loadout engine's one read. */
  sceneSettings(chatId: string): Promise<SceneSettings>;
  /** The loadout library, most recently changed first; with `removed`, the soft-deleted ones. */
  listLoadouts(removed?: boolean): Promise<LoadoutRecord[]>;
  /** Makes a loadout, or replaces the name and values of the one named by `loadout.id`. A 101st loadout is refused (409). */
  saveLoadout(loadout: { id?: string; name: string; values: Record<string, JsonValue> }): Promise<LoadoutRecord>;
  /** Deletes a loadout softly; it can be restored. */
  deleteLoadout(id: string): Promise<{ deleted: boolean }>;
  restoreLoadout(id: string): Promise<LoadoutRecord>;
  /** Stores a receipt before an apply writes; the answer carries the store's times (applied now, undo 15 minutes on). */
  saveLoadoutReceipt(receipt: LoadoutReceipt): Promise<LoadoutReceipt>;
  /** Replaces a receipt's rows once the apply has run. */
  finishLoadoutReceipt(code: string, rows: LoadoutReceipt["rows"]): Promise<LoadoutReceipt>;
  /** Closes a receipt after Undo; refused after its window or when already undone. */
  markLoadoutReceiptUndone(code: string): Promise<LoadoutReceipt>;
  /** The scene's newest receipt that is neither undone nor expired, or null. */
  latestLoadoutReceipt(chatId: string): Promise<LoadoutReceipt | null>;
  /**
   * The Cast wing's save (ChatStore rules 13 and 26): the editor's own patch save of the scene's character or
   * persona, then this scene follows it. `applied` is false when a reply started in between.
   */
  saveSceneMember(input: { chatId: string; member: "character" | "persona"; kind: string; id: string; expectedRevision: string; patch: import("../stage/contracts/content-store").PiecePatch; uploads?: string[] }): Promise<{ summary: { revision?: string; version?: number }; scene: OpenScene | null; applied: boolean }>;
  /** A persona's messages, scenes and day streak (ChatStore rule 28). */
  personaStats(personaId: string): Promise<{ messages: number; scenes: number; streak: number }>;
  /** Kit's saved connections, keys never included; one scenes cannot use says why. */
  sceneConnections(): Promise<SceneConnectionInfo[]>;
  /** A connection's models from Kit's discovery; null when it has no list, with the saved model. */
  connectionModels(id: string): Promise<{ models: { id: string; label?: string; context?: number }[] | null; saved: string; failed?: string }>;
  /** Cut scenes and deleted takes, newest first; restoring names the kind and id. */
  listSceneTrash(): Promise<SceneGrave[]>;
  restoreSceneGrave(kind: SceneGrave["kind"], id: string): Promise<unknown>;
  /** The World wing's Lorebook tab: the books this scene reads, and the last reply's trace. */
  getSceneLore(chatId: string): Promise<SceneLore>;
  /** The scene's own lorebook choice (spec rule 20), or null to clear it; answers the recomputed SceneLore. */
  setSceneLore(chatId: string, lore: SceneLoreChoice | null): Promise<SceneLore>;
  /** The Props wing: which registered props this scene has switched on (spec rule 21). An unset field answers `{ on: [] }`. */
  getSceneProps(chatId: string): Promise<SceneProps>;
  /** Sets the scene's switched-on props; answers the recomputed SceneProps. */
  setSceneProps(chatId: string, on: string[]): Promise<SceneProps>;
  /** A reply's trace for TrackHare's views (the take's latest without a messageId); null when the take has no reply. */
  getSceneTrace(chatId: string, messageId?: string): Promise<SceneTrace | null>;
  /** The live scenes whose prompting links this library tracker or tool (read only; settings alone, no message is read). */
  getLinkedScenes(kind: string, id: string): Promise<LinkedScene[]>;
  /** The Trackers panel's library trackers: each the scene links with its value at the take's tip and the reply that last changed it, one read for all (read only). */
  getSceneTrackers(chatId: string): Promise<SceneTrackers>;
  /** The person's own edit of one linked tracker, written on the tip message (the update is the narrator tool's own shape); answers the trackers as they now stand, rejects with the sentence that says why when it is refused. */
  editSceneTracker(input: TrackerEditInput): Promise<SceneTrackers>;
  /** What each live message from `from` through `to` (the tip when left out) changed in the library trackers, with each tracker's change style and icons (read only). */
  getTrackerChanges(branchId: string, from: string, to?: string): Promise<{ messages: MessageTrackerChanges[] }>;
  /** The Context wing's Next send: the request a send of `draft` would build now (read only; asks no model). */
  getSceneForecast(chatId: string, draft: string, signal?: AbortSignal): Promise<SceneForecast>;
  /** The formula editor's Try: the formula text run read-only on a copy of the scene's macro context, with how long it took (read only; asks no model). */
  tryFormula(chatId: string, text: string, signal?: AbortSignal): Promise<FormulaTry>;
  /** The Context wing's Memory tab: the saved summary settings, the active take's text and how far it reaches, and whether a run is going. */
  getSceneSummary(chatId: string): Promise<ChatSummaryState>;
  /** Read-only Director and Compendium state from the linked rp-core session. */
  getCoreSceneState(chatId: string, offset?: number): Promise<CoreSceneState>;
  /** Persist a linked rp-core session's Director or Compendium switch. */
  setCoreSceneFeature(chatId: string, feature: "director" | "memory", enabled: boolean): Promise<CoreSceneState>;
  /** Changes the summary settings (ChatStore rule 45; a key given as null goes back to its default) and answers the new state. */
  setSceneSummarySettings(chatId: string, patch: SummarySettingsPatch): Promise<ChatSummaryState>;
  /** Saves the person's own summary text for the active take. */
  saveSceneSummary(chatId: string, text: string): Promise<ChatSummaryState>;
  /** Rebuilds the active take's summary from its whole history; rejects with the sentence that says why when it cannot. */
  backfillSceneSummary(chatId: string, signal?: AbortSignal): Promise<ChatSummaryState>;
  /** Runs the automatic summary step once now (Summarize now); rejects with the sentence that says why when a run is already going or it cannot. */
  summarizeSceneNow(chatId: string, signal?: AbortSignal): Promise<ChatSummaryState>;
  /** The Story Director panel (ChatStore rule 47): the take's story state at its tip, the scene's settings and the version an edit must send back. */
  getSceneDirector(chatId: string, opts?: { at?: string }): Promise<DirectorPanel>;
  /** One edit of the Director's story (resolve or remove an item, plant a hidden arc, add a note, clear the activity, Reset), guarded by the version the panel showed; rejects with a conflict when the story moved on. */
  editSceneDirector(chatId: string, edit: DirectorEdit, expectedVersion: number | null): Promise<DirectorPanel>;
  /** Undoes the update a reply made to one tracker on its own (the Trackers states' `updates[module].messageId`): the tracker goes back to before it, written as the person's own edit on that reply, only while it still holds exactly what the update left; rejects with a conflict, changing nothing, when it has changed since. Answers the panel. */
  undoSceneTrackerUpdate(chatId: string, module: TrackerModule, messageId: string): Promise<DirectorPanel>;
  /** Changes the scene's Director settings (a key given as null goes back to its default) and answers the panel. */
  setSceneDirectorSettings(chatId: string, patch: DirectorSettingsPatch): Promise<DirectorPanel>;
  /** The Context wing's State tab: the active take's macro variables and the library's globals (read only). */
  getSceneVariables(chatId: string): Promise<SceneVariables>;
  /** The Scenes list's search: the ids of the scenes whose active take's chat summary holds every word of the query. */
  searchSceneSummaries(query: string): Promise<{ ids: string[] }>;
  /** One variable's changes over the take's replies, newest first (State's history); `scope` and `key` are the stored ones. */
  getSceneVariableHistory(chatId: string, scope: "local" | "global", key: string): Promise<VariableHistory>;
  /** Stars or unstars a scene as a Fan Favorite (ChatStore rule 23). */
  setSceneFavorite(id: string, on: boolean): Promise<Chat>;
  /** Every story folder, oldest first, each with its live scene count (ChatStore rule 24). */
  listSceneFolders(): Promise<(SceneFolder & { count: number })[]>;
  createSceneFolder(name: string): Promise<SceneFolder>;
  renameSceneFolder(id: string, name: string): Promise<SceneFolder>;
  deleteSceneFolder(id: string): Promise<{ deleted: boolean }>;
  /** Moves a scene into a folder, or out of one with null. */
  setSceneFolder(id: string, folderId: string | null): Promise<Chat>;
  /** The active take's last few messages, for the Scenes list preview panel (P2 data). */
  getSceneTail(chatId: string, n: number): Promise<SceneTailMessage[]>;
}

/** Where a book this scene reads came from (World wing, version B's source badge). */
export type SceneLoreSource = "character" | "persona" | "scene";

export interface SceneLoreBook {
  id: string;
  name: string;
  source: SceneLoreSource;
  /** false when the scene switched it off */
  enabled: boolean;
  /** true when the scene names a book the library no longer has */
  missing: boolean;
  entries: number;
  tokens: number;
}

/** Why an entry fired on the last turn (RoleCall's ActiveLorePanel). */
export type SceneLoreReason = "constant" | "key" | "secondary" | "sticky" | "recursion" | "special" | "emotion";

export interface SceneLoreFired {
  bookId: string;
  entryId: string;
  title: string;
  reason: SceneLoreReason;
  matched: string[];
  tokens: number;
  /** matched, but dropped for space */
  cut: boolean;
}

export interface SceneLore {
  books: SceneLoreBook[];
  /** from the last reply's trace on the active take; null before any reply or with no lore */
  lastTurn: { fired: SceneLoreFired[]; totalTokens: number } | null;
}

/** The scene's own lorebook choice (ChatStore rule 20): which library books it added, which it turned off. */
export interface SceneLoreChoice {
  added: string[];
  off: string[];
}

/** The Props wing's own route answer (ChatStore rule 21): which registered prop ids this scene has switched on. */
export interface SceneProps {
  on: string[];
}

/** What the Memory tab reads (studio/scene-summary.ts). */
export type ChatSummaryState = SummaryState;

/** The Next send forecast: the request as the provider would get it, with the assembler's own counts, the turn's estimate for the whole, and what a forecast leaves out. */
export interface SceneForecast {
  messages: { role: "system" | "user" | "assistant"; content: string; tokens: number }[];
  files?: PromptAttachmentInfo[];
  mediaEstimateIncomplete?: boolean;
  tokens: number;
  window: { context: number; reply: number; stated: boolean };
  model: string;
  notes: string[];
}

/** One macro variable as the store holds it: its stored key, value and times (epoch ms). */
export interface SceneVariable { key: string; value: unknown; createdAt: number; updatedAt: number }

/** The State tab's answer: the active take's variables (ChatStore rule 17) and the library's globals, each sorted by key. */
export interface SceneVariables { local: SceneVariable[]; global: SceneVariable[] }

/** One change to a variable by one reply: its number as the scene shows it, when it was written, and the value before and after (`deleted` is gone). */
export interface VariableHistoryEntry { number: number; messageId: string; at: number; before?: MacroChange["before"]; after?: MacroChange["after"]; deleted?: true }
/** A variable's history: `truncated` when the take has more replies than one request reads. */
export interface VariableHistory { entries: VariableHistoryEntry[]; truncated: boolean }

/** Which part of the prompt a sent block belongs to, for the Tokens view. */
export type TraceCategory = "preset" | "character" | "persona" | "lore" | "history" | "current" | "trackers" | "other";

/** One block exactly as a reply sent it (the trace's own order). `text` only when `rawAvailable`. */
export interface TraceBlockView {
  /** the block's source kind: prompt, greeting, history, current, depth, lore */
  kind: string;
  /** what a person calls it: the preset block's name, "Greeting", "Message 12", an entry's title, "Depth note (4)" */
  label: string;
  role: "system" | "user" | "assistant";
  tokens: number;
  category: TraceCategory;
  text?: string;
}

/** A lore entry that went into (or was cut from) a reply. */
export interface TraceLoreHit {
  bookId: string;
  entryId: string;
  bookName: string;
  title: string;
  reason: SceneLoreReason;
  matched: string[];
  tokens: number;
  /** "World", "Character", "Scene", "Before examples", "After examples", "@ Depth 4", "Append @ 2", "Pin top", "Pin bottom" */
  place: string;
  /** the recursion loop it fired on; 0 for a direct match */
  loop: number;
  /** present when a chance roll decided it: rolled out of 100, and what it needed */
  roll?: { rolled: number; needed: number };
  /** present only for reason "sticky": turns of forced firing left after this one */
  stickyLeft?: number;
}

/** An enabled entry that did not fire, and why in one plain line. */
export interface TraceLoreMiss {
  bookId: string;
  entryId: string;
  bookName: string;
  title: string;
  /** the engine's skip reason */
  reason: string;
  why: string;
}

/** One entry the Compendium's recall put in front of the narrator, or cut for the lore share; `reason` is the selector's, for the person only. */
export interface TraceRecallHit {
  bookId: string;
  entryId: string;
  bookName: string;
  title: string;
  tokens: number;
  reason: string;
}

/** What the Compendium's recall did before a reply: its outcome, the entries it placed and the ones the lore share cut. */
export interface TraceRecall {
  status: "recalled" | "empty" | "skipped" | "failed";
  /** When the reply it ran for was written (epoch ms): the Activity feed's time for it. Absent on a trace read without it. */
  at?: number;
  /** Why it was skipped or failed. */
  reason?: string;
  model?: string;
  /** Model calls made for it: 0 when its picks came from the cache. */
  calls: number;
  cached: boolean;
  injected: TraceRecallHit[];
  cut: TraceRecallHit[];
  /** How many of its picks lore had already placed this turn. */
  alreadyPlaced: number;
}

/** One tool call the narrator made while writing a reply (turn-loop rule 18): what it asked, whether it worked, and the entries it returned. */
export interface TraceToolCall {
  round: number;
  name: string;
  /** The arguments as the model sent them. */
  args: string;
  ok: boolean;
  /** Why it failed, in words for the person. */
  error?: string;
  ms: number;
  /** What the model was told, in tokens. */
  tokens: number;
  query?: string;
  entries: { bookId: string; entryId: string; bookName: string; title: string; tokens: number }[];
}

/** The narrator's tool calls for a reply, for the Activity feed's LIVE cards. `model` is the narrator's, which made the calls. */
export interface TraceTools {
  /** When the reply it ran for was written (epoch ms). */
  at: number;
  model: string;
  maxRounds: number;
  rounds: number;
  calls: TraceToolCall[];
}

/**
 * The one model call a reply made, as its turn stored it (the Context wing's This turn). `sent` and `back` are the provider's own counts (`exact`);
 * without them only the turn's `estimate` is known and nothing is recounted. `at` is when the reply was written (epoch ms).
 */
export interface TraceTurn {
  sent?: number;
  back?: number;
  exact: boolean;
  estimate?: number;
  ms?: number;
  finish?: string;
  /** How long the native reasoning ran, and how long the reply's own tags held thinking (the stored generation's, when it has them). */
  reasoningMs?: number;
  tagThinkingMs?: number;
  at: number;
}

/** Everything TrackHare shows about one reply (the trace route's answer). */
export interface SceneTrace {
  book?: import("../core/promptbook-run").BookRun;
  /** `number` is the reply's #N in the take, as the scene shows it; `take` is the active take's name
   * as the scene's take pill shows it ("Director's Cut" for the original, else the branch name) */
  reply: { messageId: string; swipeId: string; number: number; model: string; take: string };
  blocks: TraceBlockView[];
  /** File metadata from the final committed request; payload bytes and storage refs are never retained here. */
  files?: PromptAttachmentInfo[];
  window: { context: number; reply: number; stated: boolean };
  /** messages the budget left out for space */
  trimmed: number;
  /** the numbers of the messages summaries replaced (the Compendium's recaps under Summary-aware context truncation, and what the chat summary hid under Hide messages already covered), as the scene shows them; absent when none were */
  summarized?: number[];
  /** the scene's preset name when it has one, for the Tokens sheet's "Preset prompts (<name>)" header */
  presetName?: string;
  lore: {
    injected: TraceLoreHit[];
    cut: TraceLoreHit[];
    missed: TraceLoreMiss[];
    /** entry titles; only between entries that fired, `to` fired by recursion */
    chains: { from: string; to: string; keyword: string }[];
    totalTokens: number;
    /** the lore share cap, in tokens */
    share: number;
    seed: number;
  } | null;
  /** The Compendium's recall before this reply; absent or null when it did not run (off, or a reply older than recall). */
  recall?: TraceRecall | null;
  /** The narrator's tool calls while it wrote this reply; null when it made none (or the reply is older than tools). */
  tools?: TraceTools | null;
  /** The reply's own call: counts, time, finish reason. */
  turn?: TraceTurn;
  /** The macro pass the request was built with (the Macros tab); absent on a reply from before it was kept. */
  macros?: MacroReport;
  /** The variables the request left different, with what each was before (State's history); absent when none changed. */
  variables?: MacroChange[];
  /** Every try at the reply, the Fallback Model's included (the Route view); absent on a reply from before it was kept. */
  route?: { attempts: RouteAttempt[] };
  /** true when blocks carry `text`: raw text is kept for each take's latest reply only */
  rawAvailable: boolean;
  /** the take's assistant replies, newest first */
  replies: { messageId: string; swipeId: string; number: number }[];
}
