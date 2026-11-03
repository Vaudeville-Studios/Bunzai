/**
 * The ChatStore contract: chats, branches, forking, messages, swipes,
 * edits, bounded transcript reads, and selected-only swipe reads; then checkpoints, stored traces,
 * scene state (macro variables are its first slot), the scene's connection, the scene's preset, its lorebook choices, its switched-on
 * Props, and the take's latest request text (rules 15 to 22). Shapes follow RoleCall's stored ChatMessage and SwipeData, because prompts are built from
 * these records and prompt construction matches RoleCall. Types only.
 */
import type { RerunEntry } from "../../core/final-cut/trace";
import type { ChatBackdrop, ChatCompendium, ChatCompendiumPatch, ChatConnection, ChatLore, ChatOpening, ChatPreset, ChatPrompting, ChatPromptingPatch, ChatProps } from "./chat-settings-types";
import type { CompendiumReceipt, ReceiptInput, ReceiptSettle } from "./chat-receipt-types";
import type { StoredLayout, StoredTree } from "./chat-tree-types";
import type { ChatParticipants, ParticipantChange } from "./chat-participant-types";
import type { ChatRegex, ChatRegexPatch } from "./chat-regex-types";
import type { ChatFinalCut, ChatFinalCutPatch } from "./chat-final-cut-types";
import type { ChatTrackerPatch, ChatTrackers, TrackerModule } from "./chat-tracker-types";
import type { ChatStoreSummaries, ChatSummary, SummarySettingsPatch, TakeSummary, TakeSummaryInput } from "./chat-summary-types";
import type { Delta, SceneState } from "../../core/scene-state/types";
import type { ExtensionCommitContext } from "./extension-store";
import type { CoreMessageProjection } from "./core-record-store";
import type { CoreStateMessageTarget, CoreStateTurnBinding } from "./core-extension-state";
import type { PromptAttachmentInfo } from "../../core/media/prompt-attachment";
import type { ExtensionTurnOwner } from "./extension-turn-owner";
export type { ExtensionTurnOwner } from "./extension-turn-owner";
import type { PartText } from "./content-store";
import type { MessageAtPage, MessageDeltaGuard, SceneDeltaRange, MessagePage, MessageSwipePage, MessageTailPage, TranscriptSearchPage, TranscriptSearchQuery, TranscriptSwipeSelection } from "./chat-store-pages";
export type * from "./chat-store-pages";
export type * from "./chat-store-messages";
import type { CutSwipe, Generation, Message, MessageRole, Swipe } from "./chat-store-messages";

/** A library entity at the exact ContentStore version a chat started from. */
export interface CastRef {
  id: string;
  version: number;
  /** What a listing shows, taken from the same read as the snapshot, so a list never opens one. */
  name?: string;
  hasArt?: boolean;
  /** The card's own signature color at the same read, so a scene list can tint a row without
   * decrypting the frozen snapshot to get it (P3b UI). Absent when the card carries none. */
  accent?: string;
}

export interface Cast {
  character: CastRef;
  persona?: CastRef;
}

/** JSON exactly: plain objects, arrays, text, finite numbers, true, false, and null. */
export type JsonValue = null | boolean | number | string | JsonValue[] | JsonObject;
export type JsonObject = { [key: string]: JsonValue };

/**
 * What the library held for each cast member when the chat started, as opaque JSON (spec rule 10).
 * The chat keeps its own copy, so a later edit, a pruned version, or a purged card never changes or
 * breaks a running chat; moving a chat to a newer card is an explicit action. Its members match the
 * cast's exactly.
 */
export interface CastSnapshot {
  character: JsonObject;
  persona?: JsonObject;
}

/** Outside-backend codec for arbitrary frozen JSON. The backend sees only named opaque parts/blobs. */
export interface CastSnapshotCodec {
  prepare(snapshot: CastSnapshot): readonly PartText[];
  assemble(parts: readonly PartText[]): CastSnapshot;
  light(parts: readonly Pick<PartText, "name" | "text" | "blobs">[], selectedOnly?: boolean): CastSnapshot;
  /** Complete skeleton refs for topology checks and the authored-text subset the projection opens. */
  lightBlobKeys(part: Pick<PartText, "name" | "text">): { expected: readonly string[]; selected: readonly string[] };
  portrait(snapshot: CastSnapshot): PartText | null;
  portraitReference(part: Pick<PartText, "name" | "text" | "blobs"> | null, metadataOnly?: boolean): FrozenPortraitRef | null;
}

export interface FrozenPortraitRef { sha: string; mime: string }
export interface LightCastSnapshot { snapshot: CastSnapshot; snapshotVersion: number }
export interface CastPortraitReference {
  snapshotVersion: number;
  ref: FrozenPortraitRef | null;
  /** Migration 22 intentionally dropped old development snapshot cells; callers show the live card. */
  liveCardFallback: boolean;
}

/** One swipe of an imported message: its text, when it was made, and how it was generated (rule 29). */
export interface ImportedSwipe { content: string; createdAt: number; generation?: Generation }

/** A message that already happened elsewhere (rule 29): all its swipes, the one showing, and who wrote it. */
export interface ImportedMessage {
  role: MessageRole;
  createdAt: number;
  swipes: ImportedSwipe[];
  current: number;
  /** The persona that wrote this user message, as stamped (rule 26); absent leaves the message unstamped. */
  persona?: { id: string; name: string };
  /** Hidden from the prompt, as in the source (rule 30). */
  hidden?: boolean;
}

/** A finished conversation handed to `createChat`, so a scene can be born with its history (rule 29). `source` names where it came from: one live scene per source (rule 33). */
export interface ChatHistory { createdAt: number; updatedAt: number; messages: ImportedMessage[]; source?: string }

/** RoleCall's persona stats (rule 28): user messages sent, scenes that play the persona now, and the day streak. */
export interface PersonaStats { messages: number; scenes: number; streak: number }

export interface Chat {
  id: string;
  title: string;
  cast: Cast;
  activeBranchId: string;
  /** Epoch ms. */
  createdAt: number;
  updatedAt: number;
  /** Monotonic version of the frozen cast parts; zero names a pre-migration development scene. */
  snapshotVersion: number;
  /** The cast before the last setCast, while revertCast can put it back (spec rule 13). */
  previousCast?: Cast;
  /** The character's alt-art variant this scene plays (spec rule 27); absent plays the base card. */
  variantId?: string;
  /** The Kit connection and model the scene last used (spec rule 18); absent until one is picked. */
  connection?: ChatConnection;
  /** The library preset the scene follows, with its own overrides (spec rule 19); absent until one is picked. */
  preset?: ChatPreset;
  /** The scene's own lorebook choices (spec rule 20); absent until the scene sets one. */
  lore?: ChatLore;
  /** The scene's switched-on Props (spec rule 21); absent until the scene sets one. */
  props?: ChatProps;
  /** The person's edits of the scene's greetings, per greeting (spec rule 34); absent until one is edited. */
  opening?: ChatOpening;
  /** The guides switched on and the scene note (spec rule 37); absent until the Prompting wing sets one. */
  prompting?: ChatPrompting;
  /** The picture behind the scene's messages (spec rule 36); absent until one is picked. */
  backdrop?: ChatBackdrop;
  /** The scene's Compendium choices (spec rule 38), sparse; absent until one is changed. */
  compendium?: ChatCompendium;
  /** The scene's stored participants (spec rule 41), sparse: the card and the player are read from the cast; absent until one is added or changed. */
  participants?: ChatParticipants;
  /** The regex sets the scene has switched on (spec rule 42), sparse; absent until one is. */
  regex?: ChatRegex;
  /** The scene's Final Cut switch, passes and tool overrides (spec rule 44), sparse; absent until one is changed. */
  finalCut?: ChatFinalCut;
  /** What the scene's tracker Props remember as SETTINGS (spec rule 43), sparse; absent until one is changed. Their state is scene state, not here. */
  trackers?: ChatTrackers;
  /** The scene's summary settings and its last automatic run's failure (spec rule 45), sparse; absent until one is set. The texts are per take (`summaryOf`). */
  summary?: ChatSummary;
  /** The scene's Story Director settings (spec rule 47), sparse; absent until one is set. On or off is the `story-director` Prop. The story state is per reply (`getDirector`). */
  director?: DirectorSettings;
  /** Epoch ms when the scene was starred as a Fan Favorite (spec rule 23); absent when it is not one. */
  favoredAt?: number;
  /** The story folder this scene lives in, by id (spec rule 24); absent when it is in none. */
  folderId?: string;
}

/** A user-made story folder a scene can live in, at most one at a time (spec rule 24). */
export interface SceneFolder { id: string; name: string; /** Epoch ms. */ createdAt: number }

export type { ChatBackdrop, ChatCompendium, ChatCompendiumBook, ChatCompendiumFiling, ChatCompendiumPatch, ChatCompendiumHistorian, ChatCompendiumIngest, ChatCompendiumRecall, ChatCompendiumStandardize, ChatCompendiumTreeBuild, ChatCompendiumTreeConstraints, ChatConnection, CompendiumAccess, ChatLore, ChatNote, ChatOpening, ChatPreset, ChatPresetSamplers, ChatPrompting, ChatPromptingPatch, ChatProps, ChatReasoningEffort } from "./chat-settings-types";
export * from "./chat-receipt-types";
export * from "./chat-tree-types";
export * from "./chat-participant-types";
export * from "./chat-regex-types";
export * from "./chat-final-cut-types";
export * from "./chat-tracker-types";
export * from "./chat-summary-types";
export * from "./director-types";
export * from "./dramaturg-types";
import type { ChatStoreDirector, DirectorSettings } from "./director-types";
import type { ChatStoreDramaturg } from "./dramaturg-types";
import type { SceneSettingChange, SceneSettingSelector, SceneSettingValue } from "./scene-settings";

export interface Branch {
  id: string;
  chatId: string;
  name: string;
  parentBranchId: string | null;
  forkMessageId: string | null;
  /** The swipe that was showing at the fork point, kept on the new branch. */
  forkSwipeId: string | null;
  /** Epoch ms. */
  createdAt: number;
  /** Starts at 1 and rises by one with every change to this branch's messages (spec edge case 9). */
  version: number;
  /** Only listBranches fills it: where the take forked, as its place among the live messages of the take it came from; null for the original. */
  forkPosition?: number | null;
}

/**
 * RoleCall's stale-write check (spec edge case 9). A write that names the branch version it was
 * based on throws StudioConflictError and changes nothing when the branch has moved on since.
 * Without it the write is unconditional.
 */
export interface WriteGuard {
  expectedVersion?: number;
}

/** What a turn writes into: a new reply, a new version of an assistant message, or more text on its current version (rule 31). */
export type TurnTarget = { kind: "reply" } | { kind: "swipe"; messageId: string } | { kind: "continue"; messageId: string };

/** An open turn: a reply or swipe still streaming, or left behind by a crash (spec rule 16, D13). */
export interface TurnCheckpoint {
  id: string;
  chatId: string;
  branchId: string;
  /** A reply appends a new assistant message; a swipe adds a swipe to `messageId`; a continue appends to its current swipe (rule 31). */
  kind: "reply" | "swipe" | "continue";
  messageId: string | null;
  /** The text so far. */
  content: string;
  /** The prompt trace so far: opaque JSON whose shape prompt assembly owns (rule 15). */
  trace?: JsonObject;
  providerRequestId?: string;
  /** Trusted admission identity; pending extension state is only valid for this same live authority. */
  extensionOwner?: ExtensionTurnOwner;
  /** The scene-state changes this turn made, pending: `commitTurn` stamps them onto the version it stores, and a dropped turn takes them with it (rule 17). */
  deltas?: Delta[];
  /**
   * The branch's version when the turn began. A reply resumed after a crash commits guarded by it, so
   * anything written to the branch since the turn began is a conflict, not silently overtaken.
   */
  baseVersion: number;
  /** Epoch ms. */
  startedAt: number;
  /** Epoch ms of the last save. */
  savedAt: number;
}

/**
 * Every implementation makes each method atomic on its own: nothing here spans two calls, so there
 * is no interface module above it to race. Absent ids give null or an empty list; invalid input
 * throws StudioValidationError; a stale WriteGuard throws StudioConflictError. Absence is checked
 * before staleness, so a write to a message that is gone is null, not a conflict.
 */
export interface ChatStore extends ChatStoreSummaries, ChatStoreDirector, ChatStoreDramaturg {
  createChat(input: { title: string; cast: Cast; snapshot: CastSnapshot; history?: ChatHistory }, extensionCommit?: ExtensionCommitContext): Promise<Chat>;
  /** Host-only creation path for libraries whose scene lifecycle requires an RP-Core session. */
  createCoreChat?(input: { title: string; cast: Cast; snapshot: CastSnapshot; history?: ChatHistory }, extensionCommit?: ExtensionCommitContext): Promise<Chat>;
  getChat(id: string): Promise<Chat | null>;
  /** The chat's frozen cast; null when the chat is absent or deleted, like getChat. */
  castSnapshot(chatId: string): Promise<CastSnapshot | null>;
  /** The frozen cast and the row version captured with its part range. */
  castSnapshotVersioned(chatId: string): Promise<LightCastSnapshot | null>;
  lightCastSnapshot(chatId: string): Promise<LightCastSnapshot | null>;
  castPortraitRef(chatId: string): Promise<CastPortraitReference | null>;
  /**
   * `chats` are the rows that decrypted and parsed cleanly; `quarantined` names any row that did
   * not (a DamagedDataError or a JSON parse failure), by id, so one damaged row never hides the
   * rest of the list (rule 25). Anything else still throws: only a decode failure is quarantined.
   */
  listChats(filter?: { characterId?: string }): Promise<{ chats: Chat[]; quarantined: string[] }>;
  renameChat(id: string, title: string): Promise<Chat | null>;
  deleteChat(id: string): Promise<boolean>;
  /** Same quarantine contract as listChats (rule 25). */
  chatGraveyard(): Promise<{ chats: Array<Chat & { deletedAt: number }>; quarantined: string[] }>;
  restoreChat(id: string): Promise<Chat | null>;
  /**
   * `before` ends deleted chats and takes; `cutBefore` (default `before`) ends cut messages, which wait a shorter
   * time than the rest. Removed versions are never purged by either (rule 32).
   */
  purgeChats(before: number, cutBefore?: number): Promise<number>;

  listBranches(chatId: string): Promise<Branch[]>;
  setActiveBranch(chatId: string, branchId: string): Promise<Chat | null>;
  /** Copies every message up to and including `atMessageId`; the branches share nothing afterwards. */
  fork(
    branchId: string,
    atMessageId: string,
    opts?: { name?: string; swipeId?: string } & WriteGuard,
    extensionCommit?: ExtensionCommitContext,
  ): Promise<Branch | null>;

  /** SQLite-only repair of an already committed Core message, atomic with its identity mapping. */
  projectCoreMessage?(input: CoreMessageProjection): Promise<string>;
  stageCoreExtensionState?(commit: ExtensionCommitContext, target: CoreStateTurnBinding, deltas: readonly Delta[]): Promise<boolean>;
  recordCoreExtensionState?(commit: ExtensionCommitContext, target: CoreStateMessageTarget, deltas: readonly Delta[]): Promise<boolean>;
  applyCoreExtensionState?(sessionId: string, coreMessageId?: string): Promise<void>;
  discardCorePendingState?(turnOperationId: string, turnId: string): Promise<void>;
  projectCoreMessages?(inputs: readonly CoreMessageProjection[]): Promise<string[]>;
  appendMessage(
    branchId: string,
    input: { role: MessageRole; content: string; generation?: Generation },
    guard?: WriteGuard,
    extensionCommit?: ExtensionCommitContext,
  ): Promise<Message | null>;
  /**
   * Appends several messages in order as one write: all of them or none (the first send's greeting
   * and message). Every input is checked before anything is written; the version rises by one each.
   */
  appendMessages(
    branchId: string,
    inputs: readonly { role: MessageRole; content: string; generation?: Generation }[],
    guard?: WriteGuard,
    extensionCommit?: ExtensionCommitContext,
  ): Promise<Message[] | null>;
  readMessages(branchId: string, page: { fromSeq?: number; limit: number }): Promise<MessagePage>;
  /** A bounded page from the branch tail; `beforeSeq` is exclusive and `nextSeq` is its next cursor. */
  readMessagesBefore(branchId: string, page: { beforeSeq?: number; limit: number; liveOnly?: boolean }): Promise<MessageTailPage>;
  /** Resolves a bounded batch of absolute live ordinals for display macros that demand off-page text. */
  readMessagesAt(branchId: string, indices: number[]): Promise<MessageAtPage>;
  /** The live messages of a branch whose shown version holds every word, newest first, up to a limit (spec rule 35); an unknown branch answers nothing. */
  searchMessages(branchId: string, query: TranscriptSearchQuery): Promise<TranscriptSearchPage>;
  /** Opens one swipe cell for lazy transcript browsing, without opening the other alternatives. */
  readMessageSwipe(branchId: string, messageId: string, index: number): Promise<MessageSwipePage>;
  /** Selects one swipe without opening text, only when the named branch is active for this chat and owns the message. */
  selectTranscriptSwipe(chatId: string, branchId: string, messageId: string, index: number, guard?: WriteGuard): Promise<TranscriptSwipeSelection | null>;
  /** How many messages a branch holds, without reading them; 0 when the branch is absent. */
  countMessages(branchId: string): Promise<number>;
  addSwipe(messageId: string, input: { content: string; generation?: Generation }, guard?: WriteGuard): Promise<Message | null>;
  selectSwipe(messageId: string, index: number, guard?: WriteGuard): Promise<Message | null>;
  /** Replaces a swipe's text and keeps the text it replaced (D23). */
  editSwipe(messageId: string, swipeId: string, content: string, guard?: WriteGuard, extensionCommit?: ExtensionCommitContext): Promise<Message | null>;
  /** Every text a swipe has had before its current one, oldest first. */
  swipeHistory(messageId: string, swipeId: string): Promise<string[]>;
  setPinned(messageId: string, swipeId: string, pinned: boolean, guard?: WriteGuard): Promise<Message | null>;
  /** Removes one version softly (spec rule 32): out of every read and prompt, kept for `restoreSwipe`; the last live one is refused. */
  cutSwipe(messageId: string, swipeId: string, guard?: WriteGuard): Promise<Message | null>;
  /** Puts a removed version back in its place; the one that shows does not change (rule 32). */
  restoreSwipe(messageId: string, swipeId: string, guard?: WriteGuard): Promise<Message | null>;
  /** Removed versions whose message, take and scene are all live, newest cut first (rule 32). */
  swipeGraveyard(): Promise<CutSwipe[]>;
  /** Hides a message from the prompt, or shows it again (spec rule 30). It stays on the take, visible to the reader. */
  setHidden(messageId: string, hidden: boolean, guard?: WriteGuard): Promise<Message | null>;

  /** Cuts one message of the branch, or it and every live message after it, as one cut at one time (spec rule 11). */
  cutMessages(branchId: string, messageId: string, scope: "one" | "from", guard?: WriteGuard, extensionCommit?: ExtensionCommitContext): Promise<{ cutId: string; count: number } | null>;
  /** Puts a cut back in place, or on a new take when a "from here" cut is no longer the end (rule 11). */
  restoreCut(branchId: string, cutId: string, guard?: WriteGuard): Promise<{ branchId: string; count: number } | null>;

  renameBranch(branchId: string, name: string): Promise<Branch | null>;
  /** Soft (spec rule 12); `main` cannot be deleted. */
  deleteBranch(branchId: string): Promise<boolean>;
  /** Deleted branches whose chat is live, newest first. */
  branchGraveyard(): Promise<Array<Branch & { deletedAt: number }>>;
  restoreBranch(branchId: string): Promise<Branch | null>;

  /** Moves the chat to a newer copy of the same character, keeping the one it replaces (rule 13). */
  setCast(chatId: string, input: { cast: Cast; snapshot: CastSnapshot }): Promise<Chat | null>;
  /**
   * Changes only the persona a scene plays, or clears it with nulls (rule 13). Bumps `snapshotVersion`,
   * leaves `previousCast` alone, and refuses while a turn is open (rule 26). `expectedSnapshotVersion`
   * names the snapshot the caller saw; a stale one is a conflict.
   */
  setPersona(chatId: string, input: { persona: CastRef | null; snapshot: JsonObject | null; expectedSnapshotVersion?: number }): Promise<Chat | null>;
  /**
   * Swaps back to the previous card, keeping the persona the scene plays now (rule 13); `fromVersion`
   * names the character version it expects to leave (a stale one is a conflict).
   */
  revertCast(chatId: string, opts?: { fromVersion?: number }): Promise<Chat | null>;

  /** The trace a committed turn stored with this swipe, or null (rule 15). Never part of readMessages. */
  swipeTrace(messageId: string, swipeId: string): Promise<JsonObject | null>;
  /**
   * Opens the branch's one checkpoint; a second while one is open is a conflict (rule 16). A swipe
   * or a continue targets an assistant message on this branch. The guard names the version the prompt was built from.
   */
  beginTurn(branchId: string, target: TurnTarget, guard?: WriteGuard, extensionCommit?: ExtensionCommitContext): Promise<TurnCheckpoint | null>;
  /** Records progress. Bumps no version and moves no updatedAt. */
  saveCheckpoint(turnId: string, progress: { content: string; trace?: JsonObject; providerRequestId?: string; deltas?: Delta[] }, extensionCommit?: ExtensionCommitContext): Promise<TurnCheckpoint | null>;
  /** Append package-namespaced state deltas to the live turn checkpoint; commitTurn applies them with that turn or dropTurn discards them. */
  appendPendingExtensionDeltas(turnId: string, packageId: string, expectedVersion: number, deltas: readonly Delta[], extensionCommit: ExtensionCommitContext): Promise<boolean>;
  /**
   * Stores the reply or swipe with its trace and removes the checkpoint, as one transaction. A stale
   * guard throws StudioConflictError and leaves the checkpoint as it was.
   */
  commitTurn(turnId: string, result: { content: string; generation?: Generation; trace?: JsonObject; request?: { texts: string[]; files?: PromptAttachmentInfo[] } }, guard?: WriteGuard, extensionCommit?: ExtensionCommitContext): Promise<Message | null>;
  dropTurn(turnId: string, extensionCommit?: ExtensionCommitContext): Promise<boolean>;
  /** Every open checkpoint on a live branch of a live chat, oldest first. */
  resumeIncomplete(): Promise<TurnCheckpoint[]>;
  /** The branch's latest committed reply's request text (rule 22); null when it is absent, or the
   * branch is absent or deleted. */
  lastRequest(branchId: string): Promise<{ messageId: string; swipeId: string; texts: string[]; files?: PromptAttachmentInfo[] } | null>;

  /** Scene state (rule 17): every slot's value after the versions the branch shows, rebuilt from their deltas; the macro variables are the `vars` slot. Every method that changes what is shown rebuilds it in its own transaction. Null when the branch is absent or deleted. */
  sceneState(branchId: string): Promise<SceneState | null>;
  /** The state after every shown message before `messageId`, and that message's own deltas: what a new version of it, or a continue, builds from. Null when the branch or the message is absent, deleted or cut. */
  sceneStateBefore(branchId: string, messageId: string): Promise<SceneState | null>;
  /** The live messages from `fromMessageId` through `toMessageId` (the tip when omitted) with the state before the first (everything shown before it, not its own deltas) and each message's deltas, its shown version's then its own: one forward pass shows what each message changed. Given `slotPrefixes`, only the deltas of slots starting with one are loaded (the state before is still whole). A range that ends before it starts is empty. Null when the branch is absent or deleted, or either message is absent or cut. */
  sceneDeltas(branchId: string, fromMessageId: string, toMessageId?: string, slotPrefixes?: readonly string[]): Promise<SceneDeltaRange | null>;
  /** The library's global-variable operations (the shared `global` slot): every one a version shown in at least one live take carries, each once however many takes show it, in write order (time, then version, then the order written). `exceptSwipeIds` leaves out those versions' operations: what a new version of a reply builds from. */
  globalOps(exceptSwipeIds?: readonly string[]): Promise<Delta[]>;
  /** Replaces what the take starts with, before any message (an import's variables): these deltas folded over nothing. It shows with no message, is what the first message builds from, survives a cut of every message, and a fork or a restored take gets its own copy. Refused whole when malformed or one write is past the hostile-input ceiling (unusually large); empty clears it; false when the branch is absent or deleted. */
  setBranchBase(branchId: string, deltas: Delta[]): Promise<boolean>;
  /** Appends deltas to a live message of this take, what it carries whichever version shows (a person's edit on a reply). They fold after the version's own and win on that message, `sceneStateBefore` includes them, a fork copies them, and a write of what the message already shows (its version's deltas included) adds nothing. Refused whole when malformed or when one write is past the hostile-input ceiling (unusually large; there is no per-message cap); false when the branch or message is absent or cut. A guard naming the branch version the caller read, or the values it read (`expect`), refuses a stale one with StudioConflictError and writes nothing. */
  recordMessageDeltas(branchId: string, messageId: string, deltas: Delta[], guard?: MessageDeltaGuard): Promise<boolean>;
  /** Package-namespaced state write. Context is created by the broker and checked inside the SQLite transaction. */
  recordExtensionMessageDeltas(context: ExtensionCommitContext, branchId: string, messageId: string, deltas: Delta[], guard?: MessageDeltaGuard): Promise<boolean>;
  /** A write made after a commit that names the version of a reply it is about (the chat summary's generated pieces). The rows belong to THIS take: they are kept with its message, tied to that version, apply only while that version is shown there, and are copied with the message when the take is forked (a fork inherits the prefix's writes; its own later writes stay in the fork, and a write here never reaches another take). The version's own deltas, which every take that shows it shares, are never appended to. The version may be shown or not; a swipe that is cut, absent, or on a message that is not live in this take is false. The guard is `recordMessageDeltas`'s and is judged against the state as if this version were the one shown; a write of what that state already holds adds nothing. Refused whole when malformed, when a value does not fit its slot's shape, or past the hostile-input ceiling. */
  recordDeltas(branchId: string, swipeId: string, deltas: Delta[], guard?: MessageDeltaGuard): Promise<boolean>;
  /** Host automatic summary row only, scoped to an explicitly reviewed extension turn. */
  recordExtensionSummaryDeltas(context: ExtensionCommitContext, branchId: string, swipeId: string, deltas: Delta[], guard?: MessageDeltaGuard): Promise<boolean>;

  /** A persona's running counters (rule 28); zeros for a persona nothing has played. */
  personaStats(personaId: string): Promise<PersonaStats>;
  /**
   * Counts the scenes that predate the counters, one scene per write, handing control back through
   * `pause` between scenes (rule 28). Safe to call again: a scene is counted once. Resolves with how many it counted.
   */
  backfillPersonaStats(pause?: () => Promise<void>): Promise<number>;

  /** Remembers which of the character's variants the scene plays, or the base card with null (rule 27); bumps no version and moves no updatedAt. */
  setVariant(chatId: string, variantId: string | null): Promise<Chat | null>;

  /** Remembers the scene's connection and model, or forgets it with null (rule 18); bumps no version and moves no updatedAt. */
  setConnection(chatId: string, connection: ChatConnection | null): Promise<Chat | null>;

  /** Remembers the scene's preset, toggles, and sampler overrides, or forgets it with null (rule 19); bumps no version and moves no updatedAt. */
  setPreset(chatId: string, preset: ChatPreset | null): Promise<Chat | null>;

  /** Remembers the scene's added and switched-off lorebooks, or forgets them with null (rule 20); bumps no version and moves no updatedAt. */
  setLore(chatId: string, lore: ChatLore | null): Promise<Chat | null>;

  /** Remembers the scene's switched-on Props, or forgets them with null (rule 21); bumps no version and moves no updatedAt. */
  setProps(chatId: string, props: ChatProps | null): Promise<Chat | null>;

  /** Remembers the person's edits of the scene's greetings, or forgets them with null (rule 34); bumps no version and moves no updatedAt. */
  setOpening(chatId: string, opening: ChatOpening | null): Promise<Chat | null>;

  /** Changes the scene's switched-on guides and scene note (rule 37); a key left out of the patch stays, null clears it. Bumps no version and moves no updatedAt. */
  setPrompting(chatId: string, patch: ChatPromptingPatch): Promise<Chat | null>;

  /** Remembers the scene's backdrop, or forgets it with null (rule 36); bumps no version and moves no updatedAt. */
  setBackdrop(chatId: string, backdrop: ChatBackdrop | null): Promise<Chat | null>;

  /** Changes the scene's Compendium choices (rule 38); a key left out of the patch stays, null clears it, `books`, `recall` and `filing` merge field by field. Bumps no version and moves no updatedAt. */
  setCompendium(chatId: string, patch: ChatCompendiumPatch): Promise<Chat | null>;

  /** Changes the scene's participant roster (rule 41): add NPCs from one run, edit one, set or unset the main, or retire a run. Refused whole when malformed, a name is taken or the target is missing; nothing is deleted. Bumps no version and moves no updatedAt; null for an absent or deleted scene. */
  updateParticipants(chatId: string, change: ParticipantChange): Promise<Chat | null>;

  /** Changes the scene's regex sets (rule 42): a key left out of the patch stays, null clears it. Refused whole when malformed. Bumps no version and moves no updatedAt; null for an absent or deleted scene. */
  setRegex(chatId: string, patch: ChatRegexPatch): Promise<Chat | null>;

  /** Changes the scene's Final Cut (rule 44): a key left out of the patch stays, null clears it. Refused whole when malformed, with an unknown field or choice, or past a cap. Bumps no version and moves no updatedAt; null for an absent or deleted scene. */
  setFinalCut(chatId: string, patch: ChatFinalCutPatch): Promise<Chat | null>;

  /** Adds a re-run the person applied to the Final Cut run in a reply's trace (rule 46); false when the reply or its run is gone, refused when the entry is malformed or the reply already keeps 20. Touches nothing else. */
  appendFinalCutRerun(messageId: string, swipeId: string, entry: RerunEntry): Promise<boolean>;
  /** Changes one tracker module's SETTINGS (rule 43): `context` (AI Context), `auto` (the Story Director's choice), `subs` (the sub-feature switches) and, for a Storyboard, its profile as `data`; a key of the patch given replaces it, null clears it, a key left out stays. A module's state is not a setting: it is the scene-state slot `tracker.<module>` and is written with recordMessageDeltas or recordDeltas, so `data` on any other module is refused. Refused whole when malformed. Bumps no version and moves no updatedAt; null for an absent or deleted scene. */
  setTracker(chatId: string, module: TrackerModule, patch: ChatTrackerPatch): Promise<Chat | null>;

  /** Reads one strict, redacted scene-settings projection and an opaque revision token. */
  readSceneSetting(chatId: string, selector: SceneSettingSelector): Promise<{ value: SceneSettingValue; revision: string } | null>;
  /** Computes the canonical before/after projection from the same validators used by ordinary setters. */
  previewSceneSetting(chatId: string, selector: SceneSettingSelector, change: SceneSettingChange): Promise<{ before: SceneSettingValue; after: SceneSettingValue; revision: string } | null>;
  /** Compares the selected group's full stored value and writes under the native transaction fence. */
  applySceneSetting(chatId: string, selector: SceneSettingSelector, change: SceneSettingChange, expectedRevision: string, extensionCommit: ExtensionCommitContext): Promise<{ status: "saved"; revision: string } | { status: "stale" } | null>;

  /** Appends a Compendium receipt to a scene (rule 39); null for an absent or deleted scene. The store assigns id, at and settledAt. A running receipt never blocks another append. */
  appendReceipt(chatId: string, input: ReceiptInput, extensionCommit?: ExtensionCommitContext): Promise<CompendiumReceipt | null>;
  /** Moves a receipt to a new status (rule 39), only along the allowed transitions; null when it is gone. Undoing an already undone receipt returns it unchanged. */
  settleReceipt(receiptId: string, settle: ReceiptSettle, extensionCommit?: ExtensionCommitContext): Promise<CompendiumReceipt | null>;
  /** One receipt by id (rule 39); null when it or its scene is gone. */
  receipt(receiptId: string): Promise<CompendiumReceipt | null>;
  /** A scene's receipts, newest first, optionally one take's or one message's (rule 39); `before` is a receipt id to page past. Empty for an absent or deleted scene. */
  listReceipts(chatId: string, page?: { branchId?: string; messageId?: string; before?: string; limit?: number }): Promise<CompendiumReceipt[]>;
  /** Marks every queued or running receipt of the scene interrupted (rule 39), as the scene opens after a crash; returns how many. */
  sweepReceipts(chatId: string): Promise<number>;
  /** Stores a tree layout for one book of a scene (rule 40) as the book's newest; refused whole when malformed; null for an absent or deleted scene. Nothing is replaced: an older layout stays under it. */
  appendTree(chatId: string, bookId: string, layout: StoredLayout): Promise<StoredTree | null>;
  /** The book's newest live layout (rule 40), or null when it has none (the page then shows the derived tree) or the scene is absent. */
  currentTree(chatId: string, bookId: string): Promise<StoredTree | null>;
  /** Takes back the book's newest live layout (rule 40): it is marked undone, never deleted, and the one before it shows again. `undone` is false when there was nothing to take back; null for an absent scene. */
  undoTree(chatId: string, bookId: string): Promise<{ undone: boolean; current: StoredTree | null } | null>;

  /** Stars or unstars a scene as a Fan Favorite (rule 23); bumps no version and moves no updatedAt. */
  setFavorite(chatId: string, on: boolean): Promise<Chat | null>;

  /** Every story folder, oldest first, each with its live (not deleted) scene count (rule 24). */
  listFolders(): Promise<(SceneFolder & { count: number })[]>;
  /** Makes a new story folder (rule 24). */
  createFolder(name: string): Promise<SceneFolder>;
  /** Renames a story folder (rule 24); null when it is gone. */
  renameFolder(id: string, name: string): Promise<SceneFolder | null>;
  /** Deletes a story folder (rule 24); its scenes stay and lose their folderId, in the same transaction. */
  deleteFolder(id: string): Promise<boolean>;
  /** Moves a scene into a folder, or out of one with null (rule 24); bumps no version and moves no
   * updatedAt. An unknown folderId throws StudioValidationError. */
  setFolder(chatId: string, folderId: string | null): Promise<Chat | null>;
}
