/**
 * Scenes: the Studio's chats, over the open library's ChatStore. Starting
 * a scene freezes its cast at the pieces' current versions (rule 10), and everything a scene shows,
 * its portrait included, comes from that frozen copy. The greeting is shown, not stored, until the
 * first send, which saves the chosen greeting and the message as one write, as RoleCall does
 * (useHandleSubmit). No reply is generated here: that arrives with prompt assembly. Cuts, takes, and
 * moving a scene to the latest card follow the store's rules 11 to 13; each returns the scene as it
 * now stands, so the page redraws from one answer.
 */
import { takeName } from "./scene-take-name";
export { takeName };
import { checkUserMessage } from "./final-cut-user-check";
import type { Branch, Cast, CastSnapshot, Chat, ChatStore, JsonObject, Message, MessageAtPage, MessageRole, MessageSwipePage } from "../stage/contracts/chat-store";
import type { ParsedCanonicalEntity } from "../entities/runtime-schema";
import { breather } from "../stage/store/breather";
import { summaryPreview } from "./scene-summary-list";
import { summaryDefaultsOf } from "../stage/store/summary-rules";
import { DEFAULT_SUMMARY_PREF } from "../core/summary/settings";
import { bodyOf, isRecord, str } from "../core/guards";
import { StudioLockedError, StudioNotFoundError, StudioValidationError, StudioConflictError } from "./errors";

import type { SettingsStoreLike, StudioStoreLike } from "./contracts";
import { hasPortrait } from "./portrait";
import { pieceAccent } from "./summary";
import { readChatCast } from "./cast-snapshot";
import { CHARACTER_DEFAULTS_PREF, applyCharacterDefaults } from "./scene-character-defaults";

/** The pref the persona editor sets and a new scene reads. */
export const DEFAULT_PERSONA_PREF = "persona.default";
export { DEFAULT_SUMMARY_PREF };
type Entity = Parameters<typeof hasPortrait>[0];
/** The persona's own display name, as the cast and the stamp on a message carry it (a persona's name is on its body, a character's on its identity). */
export const personaNameOf = (entity: unknown): string => str(bodyOf(entity)["name"]);
const nameOf = (entity: unknown): string => str(isRecord(bodyOf(entity)["identity"]) ? (bodyOf(entity)["identity"] as Record<string, unknown>)["name"] : "");

export function requireChats(chats: ChatStore | null): ChatStore {
  if (!chats) throw new StudioLockedError();
  return chats;
}

/** A character's greetings in RoleCall's order: the first message, then the alternates. */
export function greetingsOf(character: unknown): string[] {
  const g = isRecord(bodyOf(character)["greetings"]) ? (bodyOf(character)["greetings"] as Record<string, unknown>) : {};
  const alternates = Array.isArray(g["alternateGreetings"]) ? g["alternateGreetings"] : [];
  return [str(g["firstMessage"]), ...alternates.map((a) => str(isRecord(a) ? a["text"] : a))].filter((t) => t !== "");
}

/** The cast and its frozen snapshot a new scene starts from: the card (and persona, when it is still in the library) at their current versions, as the library holds them now. */
export async function freezeCast(studio: Pick<StudioStoreLike, "readVersioned">, characterId: string, personaId: unknown): Promise<{ title: string; cast: Cast; snapshot: CastSnapshot }> {
  const character = await studio.readVersioned("character", characterId);
  if (!character) throw new StudioNotFoundError(`character "${characterId}" is not in the library`);
  const persona = typeof personaId === "string" && personaId ? await studio.readVersioned("persona", personaId) : null;
  const snapshot: CastSnapshot = { character: character.entity as unknown as JsonObject };
  if (persona) snapshot.persona = persona.entity as unknown as JsonObject;
  return {
    title: nameOf(character.entity) || characterId,
    cast: {
      character: {
        id: characterId, version: character.version, name: nameOf(character.entity),
        hasArt: hasPortrait(character.entity), accent: pieceAccent(character.entity as unknown as ParsedCanonicalEntity),
      },
      ...(persona ? { persona: { id: str(personaId), version: persona.version, name: personaNameOf(persona.entity) } } : {}),
    },
    snapshot,
  };
}

/** A new scene with the saved starting defaults applied, and the plain sentences for any that could not be (the scene exists either way). */
export const startScene = async (chats: ChatStore, studio: StudioStoreLike, settings: SettingsStoreLike, characterId: string): Promise<Chat> => (await startSceneWithNotes(chats, studio, settings, characterId)).chat;

export async function startSceneWithNotes(chats: ChatStore, studio: StudioStoreLike, settings: SettingsStoreLike, characterId: string, coreFirst = false): Promise<{ chat: Chat; notes: string[] }> {
  const prefs = await settings.read();
  const frozen = await freezeCast(studio, characterId, prefs[DEFAULT_PERSONA_PREF]);
  const created = coreFirst
    ? await chats.createCoreChat?.(frozen) ?? (() => { throw new StudioValidationError("this host cannot create an rp-core scene"); })()
    : await chats.createChat(frozen);
  const defaults = summaryDefaultsOf(prefs[DEFAULT_SUMMARY_PREF]);
  // The scene exists whether or not its defaults apply; defaults that are not valid settings are left off rather than refusing to start it.
  const chat = defaults ? ((await chats.setSummarySettings(created.id, defaults)) ?? created) : created;
  return applyCharacterDefaults(chats, studio, chat, characterId, frozen.title, prefs[CHARACTER_DEFAULTS_PREF]);
}

export interface SceneSummary extends Chat {
  characterName: string;
  messageCount: number;
  /** Whether the frozen character carries art, so a card asks for it only when it exists. */
  hasPortrait: boolean;
  /** The scene's live takes (branches), for the Scenes list (P2 data). */
  takeCount: number;
  /** The active branch's own name and whether it is the original take, for the list card's take
   * strip (P3 UI): the scene page's own rule ("Director's Cut" when original, else the name) reads
   * `original` rather than repeating the label here, so both surfaces stay one rule. */
  activeTake: { name: string; original: boolean };
  /** The character's colour (summary.ts pieceAccent), read once when the cast is written and never re-derived from the snapshot, which listScenes must not decrypt per scene; absent when the card carries none; the
   * Scenes list's own rows fall back to the character deck's pastel (P3b UI). */
  accent?: string;
  /** A one-line preview of the active take's chat summary, for the card (scene-summary-list.ts); absent when the take has none. */
  summaryPreview?: string;
  /** The scene froze no copy of its character and the Library no longer has the card: it cannot open (a pre-migration-22 row). */
  castMissing?: true;
}

/** A frozen scene's art is whatever its snapshot holds, which the cast's `hasArt` flag (set when it was created) can overstate. */
const frozenHasPortrait = async (chats: ChatStore, chatId: string): Promise<boolean> =>
  (await chats.castPortraitRef(chatId).catch(() => null))?.ref != null;

/** Every scene, newest first, with what its card shows: the cast's own fields and a count, never a snapshot. */
export async function listScenes(chats: ChatStore, studio?: StudioStoreLike): Promise<SceneSummary[]> {
  const out: SceneSummary[] = [];
  const breathe = breather();
  // A damaged chat row (bug 5) is quarantined, not thrown:
  // it silently drops out of the Scenes list here until a "Damaged" shelf (needs a wireframe;
  // tracked separately) plumbs `quarantined` through to the UI.
  for (const chat of (await chats.listChats()).chats) {
    await breathe();
    const { character } = chat.cast;
    // One listBranches call already pays for takeCount; the active branch it also finds is free -
    // reading every take's name/parent here would tempt a per-card open elsewhere, so only the
    // active one is kept on the summary.
    const branches = await chats.listBranches(chat.id);
    const active = branches.find((b) => b.id === chat.activeBranchId);
    const preview = summaryPreview((await chats.summaryOf(chat.activeBranchId))?.text ?? "");
    out.push({
      ...chat,
      characterName: character.name || character.id,
      messageCount: await chats.countMessages(chat.activeBranchId),
      hasPortrait: chat.snapshotVersion > 0 ? await frozenHasPortrait(chats, chat.id) : character.hasArt === true,
      takeCount: branches.length,
      activeTake: { name: active?.name ?? "main", original: active ? active.parentBranchId === null : true },
      // From the lightweight cast reference (set at startScene / updateSceneCard), never the frozen
      // snapshot - listScenes reads every chat's cast already; it must never also decrypt every
      // chat's snapshot just to answer this.
      accent: character.accent,
      ...(preview ? { summaryPreview: preview } : {}),
      ...(chat.snapshotVersion === 0 && studio?.summary && !(await studio.summary("character", character.id)) ? { castMissing: true as const } : {}),
    });
  }
  return out.sort((a, b) => b.updatedAt - a.updatedAt);
}

export interface TakeSummary extends Branch {
  messageCount: number;
}

export interface OpenScene {
  chat: Chat;
  /** This scene's turns and Compendium are owned by the linked rp-core journal. */
  core?: true;
  /** The frozen cast without its art or source file, which the page never reads (the portrait route serves the art). */
  snapshot: CastSnapshot;
  hasPortrait: boolean;
  /** Every message of the active take, cut ones included so the page can draw their restore lines. */
  messages: Message[];
  /** Count of live messages before the first transcript row, for stable numbering across cuts and forks. */
  messageOffset: number;
  /** Total live messages on this take. */
  messageCount: number;
  /** Exclusive sequence cursor for the next older page, or null when the beginning is loaded. */
  beforeSeq: number | null;
  hasMore: boolean;
  userMessageCount: number;
  assistantMessageCount: number;
  lastUserMessageIndex: number | null;
  lastAssistantMessageIndex: number | null;
  branchVersion: number;
  /** The live takes, the original first. */
  takes: TakeSummary[];
  /** The library's version of the scene's character now, or null when the card is gone (rule 13). */
  latestCardVersion: number | null;
}

export interface SceneMessagePage {
  messages: Message[];
  messageOffset: number;
  messageCount: number;
  beforeSeq: number | null;
  hasMore: boolean;
  userMessageCount: number;
  assistantMessageCount: number;
  lastUserMessageIndex: number | null;
  lastAssistantMessageIndex: number | null;
  branchId: string;
  branchVersion: number;
}

export const SCENE_MESSAGE_PAGE_SIZE = 60;

const light = (entity: JsonObject): JsonObject => ({ ...entity, original: null, body: { ...bodyOf(entity), media: null } as JsonObject });

export async function openScene(chats: ChatStore, studio: StudioStoreLike, chatId: string): Promise<OpenScene | null> {
  const chat = await chats.getChat(chatId);
  const cast = chat && (await readChatCast(chats, studio, chat, true));
  return cast ? sceneOf(chats, studio, cast.chat, cast.snapshot, cast.hasPortrait) : null;
}

/** An open scene from a chat and snapshot already read, so a send does not decrypt the cast twice. */
async function sceneOf(chats: ChatStore, studio: StudioStoreLike, chat: Chat, snapshot: CastSnapshot, portrait = hasPortrait(snapshot.character as unknown as Entity)): Promise<OpenScene> {
  const page = await sceneMessagePage(chats, chat.activeBranchId);
  const takes: TakeSummary[] = [];
  for (const branch of await chats.listBranches(chat.id)) takes.push({ ...branch, messageCount: await chats.countMessages(branch.id) });
  return {
    chat,
    snapshot: { character: light(snapshot.character), ...(snapshot.persona ? { persona: light(snapshot.persona) } : {}) },
    hasPortrait: portrait,
    ...page,
    takes,
    latestCardVersion: (await studio.summary?.("character", chat.cast.character.id))?.version ?? null,
  };
}

async function sceneMessagePage(chats: ChatStore, branchId: string, beforeSeq?: number): Promise<SceneMessagePage> {
  const page = await chats.readMessagesBefore(branchId, { ...(beforeSeq === undefined ? {} : { beforeSeq }), limit: SCENE_MESSAGE_PAGE_SIZE });
  return {
    messages: page.messages,
    messageOffset: page.beforeCount,
    messageCount: page.totalCount,
    beforeSeq: page.nextSeq,
    hasMore: page.nextSeq !== null,
    userMessageCount: page.userCount,
    assistantMessageCount: page.assistantCount,
    lastUserMessageIndex: page.lastUserIndex,
    lastAssistantMessageIndex: page.lastAssistantIndex,
    branchId,
    branchVersion: page.branchVersion ?? 1,
  };
}

/** Reads demanded off-page macro inputs in bounded batches, against the same visible take/version. */
export async function sceneMacroMessages(
  chats: ChatStore,
  input: { chatId: string; branchId: string; expectedVersion: number; indices: number[] },
): Promise<MessageAtPage & { branchId: string } | null> {
  const chat = await chats.getChat(input.chatId);
  if (!chat) return null;
  if (chat.activeBranchId !== input.branchId) throw new StudioConflictError("the active take changed while scene macros were loading");
  const page = await chats.readMessagesAt(input.branchId, input.indices);
  if (page.branchVersion !== input.expectedVersion || (await chats.getChat(input.chatId))?.activeBranchId !== input.branchId) throw new StudioConflictError("the scene changed while scene macros were loading");
  return { ...page, branchId: input.branchId };
}

/** Reads one alternate swipe cell for the scene's version counter, without opening sibling swipes. */
export async function sceneSwipe(
  chats: ChatStore,
  input: { chatId: string; branchId: string; expectedVersion: number; messageId: string; index: number },
): Promise<MessageSwipePage | null> {
  const chat = await chats.getChat(input.chatId);
  if (!chat) return null;
  if (chat.activeBranchId !== input.branchId) throw new StudioConflictError("the active take changed while a swipe was loading");
  const page = await chats.readMessageSwipe(input.branchId, input.messageId, input.index);
  if (page.branchId !== input.branchId || page.branchVersion !== input.expectedVersion || (await chats.getChat(input.chatId))?.activeBranchId !== input.branchId) throw new StudioConflictError("the scene changed while a swipe was loading");
  return page;
}

/**
 * The texts a version of a message had before its current one, oldest first (ChatStore rule 5), for the
 * Edit history list. Read through the same guards as sceneSwipe: the scene's active take, at the version
 * the page shows, so another scene's message or a stale page is refused. Null when the version is absent.
 */
export async function swipeHistoryOf(
  chats: ChatStore,
  input: { chatId: string; branchId: string; expectedVersion: number; messageId: string; index: number },
): Promise<{ swipeId: string; texts: string[] } | null> {
  const page = await sceneSwipe(chats, input);
  if (!page?.swipe) return null;
  return { swipeId: page.swipe.id, texts: await chats.swipeHistory(input.messageId, page.swipe.id) };
}

/** Fetches one older transcript page from the same active take and version the page opened on. */
export async function olderSceneMessages(
  chats: ChatStore,
  input: { chatId: string; branchId: string; beforeSeq: number; expectedVersion: number },
): Promise<SceneMessagePage | null> {
  const chat = await chats.getChat(input.chatId);
  if (!chat) return null;
  if (chat.activeBranchId !== input.branchId) throw new StudioConflictError("the active take changed while older messages were loading");
  const page = await sceneMessagePage(chats, input.branchId, input.beforeSeq);
  if (page.branchVersion !== input.expectedVersion || (await chats.getChat(input.chatId))?.activeBranchId !== input.branchId) throw new StudioConflictError("the scene changed while older messages were loading");
  return page;
}

/** Reopens a scene after a change, or null when it is gone. */
async function reopen(chats: ChatStore, studio: StudioStoreLike, chatId: string, changed: unknown): Promise<OpenScene | null> {
  return changed ? openScene(chats, studio, chatId) : null;
}
const activeOf = async (chats: ChatStore, chatId: string) => (await chats.getChat(chatId))?.activeBranchId ?? "";
/** A take of this scene, so a request naming one scene can never change another's. */
const takeOf = async (chats: ChatStore, chatId: string, branchId: string) => (await chats.listBranches(chatId)).some((b) => b.id === branchId);

/** Cuts one message, or it and everything after it, leaving restore lines (store rule 11). */
export async function cutInScene(
  chats: ChatStore,
  studio: StudioStoreLike,
  input: { chatId: string; messageId: string; scope: "one" | "from"; expectedVersion: number },
): Promise<OpenScene | null> {
  const cut = await chats.cutMessages(await activeOf(chats, input.chatId), input.messageId, input.scope, { expectedVersion: input.expectedVersion });
  return reopen(chats, studio, input.chatId, cut);
}

/** Restores a cut in place, or as a new take when the scene has moved on (store rule 11). */
export async function restoreInScene(
  chats: ChatStore,
  studio: StudioStoreLike,
  input: { chatId: string; cutId: string; expectedVersion: number },
): Promise<OpenScene | null> {
  const back = await chats.restoreCut(await activeOf(chats, input.chatId), input.cutId, { expectedVersion: input.expectedVersion });
  return reopen(chats, studio, input.chatId, back);
}

export async function switchTake(chats: ChatStore, studio: StudioStoreLike, input: { chatId: string; branchId: string }): Promise<OpenScene | null> {
  const moved = await chats.setActiveBranch(input.chatId, input.branchId);
  return reopen(chats, studio, input.chatId, moved);
}

/** A new take from a message (takeName). */
export async function forkScene(
  chats: ChatStore,
  studio: StudioStoreLike,
  input: { chatId: string; messageId: string; name?: string; expectedVersion: number },
): Promise<OpenScene | null> {
  const name = await takeName(chats, input.chatId, input.name);
  const take = await chats.fork(await activeOf(chats, input.chatId), input.messageId, { name, expectedVersion: input.expectedVersion });
  return reopen(chats, studio, input.chatId, take);
}

export async function renameTake(chats: ChatStore, studio: StudioStoreLike, input: { chatId: string; branchId: string; name: string }): Promise<OpenScene | null> {
  if (!(await takeOf(chats, input.chatId, input.branchId))) return null;
  return reopen(chats, studio, input.chatId, await chats.renameBranch(input.branchId, input.name));
}

/** Sends a take to the Trash; the original take cannot go (store rule 12). */
export async function deleteTake(chats: ChatStore, studio: StudioStoreLike, input: { chatId: string; branchId: string }): Promise<OpenScene | null> {
  if (!(await takeOf(chats, input.chatId, input.branchId))) return null;
  const gone = await chats.deleteBranch(input.branchId);
  return reopen(chats, studio, input.chatId, gone);
}

/** Moves the scene onto the library's current card, keeping the frozen one to go back to (store rule 13). */
export async function updateSceneCard(chats: ChatStore, studio: StudioStoreLike, chatId: string): Promise<OpenScene | null> {
  const chat = await chats.getChat(chatId);
  const cast = chat && (await readChatCast(chats, studio, chat));
  if (!cast) return null;
  const current = cast.chat;
  const { snapshot } = cast;
  const { id } = current.cast.character;
  const latest = await studio.readVersioned("character", id);
  if (!latest) throw new StudioNotFoundError("the card is not in the library, so there is nothing newer to move to");
  const character = {
    id, version: latest.version, name: nameOf(latest.entity),
    hasArt: hasPortrait(latest.entity), accent: pieceAccent(latest.entity as unknown as ParsedCanonicalEntity),
  };
  const moved = await chats.setCast(chatId, {
    cast: { ...current.cast, character },
    snapshot: { ...snapshot, character: latest.entity as unknown as JsonObject },
  });
  return reopen(chats, studio, chatId, moved);
}

/** Back to the card the last update replaced; `fromVersion` is the version the page shows, so a repeat is refused (409). */
export async function revertSceneCard(chats: ChatStore, studio: StudioStoreLike, input: { chatId: string; fromVersion: number }): Promise<OpenScene | null> {
  return reopen(chats, studio, input.chatId, await chats.revertCast(input.chatId, { fromVersion: input.fromVersion }));
}

/**
 * Shows another version of a message on the scene's current take (store rule 4). It moves the
 * take's version, so a turn begun before it is stale (turn-loop rule 5).
 */
export async function selectVersion(
  chats: ChatStore,
  studio: StudioStoreLike,
  input: { chatId: string; messageId: string; index: number; expectedVersion: number },
): Promise<OpenScene | null> {
  const branchId = await activeOf(chats, input.chatId);
  const target = await chats.selectTranscriptSwipe(input.chatId, branchId, input.messageId, input.index, { expectedVersion: input.expectedVersion });
  if ((await activeOf(chats, input.chatId)) !== branchId) throw new StudioConflictError("the active take changed while a swipe was selected");
  if (!target || target.branchId !== branchId) return null;
  return reopen(chats, studio, input.chatId, target);
}

/**
 * Hides a message of the scene's current take from the prompt, or shows it again (store rule 30). The
 * message stays on the page, dimmed; it moves the take's version, so a reply begun before it is stale.
 * A message of another scene is refused and nothing changes.
 */
export async function hideInScene(
  chats: ChatStore,
  studio: StudioStoreLike,
  input: { chatId: string; messageId: string; hidden: boolean; expectedVersion: number },
): Promise<OpenScene | null> {
  const branchId = await activeOf(chats, input.chatId);
  if (!branchId || (await chats.readMessageSwipe(branchId, input.messageId, 0)).branchId !== branchId) return null;
  return reopen(chats, studio, input.chatId, await chats.setHidden(input.messageId, input.hidden, { expectedVersion: input.expectedVersion }));
}

/**
 * Removes one version of a message of the scene's current take, softly (store rule 32): it leaves the
 * version counter and the prompt but waits in the Trash. The last version is refused. It moves the
 * take's version, so a reply begun before it is stale. A message or version of another scene or take is
 * refused and nothing changes.
 */
export async function cutVersionInScene(
  chats: ChatStore,
  studio: StudioStoreLike,
  input: { chatId: string; messageId: string; swipeId: string; expectedVersion: number },
): Promise<OpenScene | null> {
  const branchId = await activeOf(chats, input.chatId);
  if (!branchId || (await chats.readMessageSwipe(branchId, input.messageId, 0)).branchId !== branchId) return null;
  return reopen(chats, studio, input.chatId, await chats.cutSwipe(input.messageId, input.swipeId, { expectedVersion: input.expectedVersion }));
}

/**
 * Puts a removed version back (rule 32), from the scene's own page or from the Trash. The version that
 * shows does not change. Unguarded when the caller has no take version (the Trash has none).
 */
export async function restoreVersion(
  chats: ChatStore,
  studio: StudioStoreLike,
  input: { messageId: string; swipeId: string; expectedVersion?: number },
): Promise<OpenScene | null> {
  const grave = (await chats.swipeGraveyard()).find((g) => g.messageId === input.messageId && g.swipeId === input.swipeId);
  if (!grave) return null;
  const restored = await chats.restoreSwipe(input.messageId, input.swipeId, input.expectedVersion === undefined ? undefined : { expectedVersion: input.expectedVersion });
  return reopen(chats, studio, grave.chatId, restored);
}

/** The scene edits /api/chats serves, each named by its route (src/ui/server-chats.ts). */
export type SceneAction = "cut" | "restore-cut" | "take" | "fork" | "rename-take" | "delete-take" | "update-card" | "revert-card" | "select-swipe" | "persona" | "variant" | "opening" | "hide" | "cut-version" | "restore-version";

/** What the Trash shows for scenes and takes: the chat store's own graveyards, newest first. */
export interface SceneGrave {
  kind: "scene" | "take" | "version";
  /** The chat id for a scene, the branch id for a take, `messageId:swipeId` for a version: what restoring names. */
  id: string;
  name: string;
  /** The scene a take belongs to, or the character a scene is with. */
  of: string;
  messageCount: number;
  deletedAt: number;
  /** For a version: the number of the message it was removed from. */
  at?: number;
}

/** The first line of a removed version, for its Trash row. */
const VERSION_NAME_MAX = 60;
const versionName = (content: string): string => {
  const line = content.trim().replace(/\s+/g, " ");
  return line.length > VERSION_NAME_MAX ? `${line.slice(0, VERSION_NAME_MAX).trimEnd()}...` : line || "(empty version)";
};

export async function sceneTrash(chats: ChatStore): Promise<SceneGrave[]> {
  const graves: SceneGrave[] = [];
  // Same quarantine note as listScenes: a damaged deleted chat drops out of the trash list here.
  for (const c of (await chats.chatGraveyard()).chats) {
    graves.push({ kind: "scene", id: c.id, name: c.title, of: c.cast.character.name || c.cast.character.id, messageCount: await chats.countMessages(c.activeBranchId), deletedAt: c.deletedAt });
  }
  for (const b of await chats.branchGraveyard()) {
    graves.push({ kind: "take", id: b.id, name: b.name, of: (await chats.getChat(b.chatId))?.title ?? "", messageCount: await chats.countMessages(b.id), deletedAt: b.deletedAt });
  }
  const titles = new Map<string, string>();
  for (const v of await chats.swipeGraveyard()) {
    if (!titles.has(v.chatId)) titles.set(v.chatId, (await chats.getChat(v.chatId))?.title ?? "");
    graves.push({ kind: "version", id: `${v.messageId}:${v.swipeId}`, name: versionName(v.content), of: titles.get(v.chatId)!, messageCount: 1, at: v.seq, deletedAt: v.cutAt });
  }
  return graves.sort((a, b) => b.deletedAt - a.deletedAt);
}

/** The frozen character, for its art (served by the scene portrait route). */
export async function frozenCharacter(chats: ChatStore, chatId: string): Promise<Entity | null> {
  const snapshot = await chats.castSnapshot(chatId);
  return snapshot ? (snapshot.character as unknown as Entity) : null;
}

/** Saves the person's message, and first the chosen greeting (the person's edit of it, when there is one) when the branch is still empty: one write. */
export async function sendToScene(
  chats: ChatStore,
  studio: StudioStoreLike,
  input: { chatId: string; content: string; greetingIndex: number; expectedVersion: number; coreGreeting?: string },
): Promise<OpenScene | null> {
  if (input.content.trim() === "") throw new StudioValidationError("a message needs some text");
  const chat = await chats.getChat(input.chatId);
  const cast = chat && (await readChatCast(chats, studio, chat, true));
  if (!cast) return null;
  const current = cast.chat;
  checkUserMessage(current, input.content);
  const { snapshot } = cast;
  const empty = (await chats.readMessages(current.activeBranchId, { limit: 1 })).messages.length === 0;
  const greetings = greetingsOf(snapshot.character);
  if (empty && greetings.length > 0 && !Number.isInteger(input.greetingIndex)) throw new StudioValidationError("greetingIndex must be a whole number");
  const chosen = empty && greetings.length > 0 ? greetings[input.greetingIndex] : undefined;
  if (empty && greetings.length > 0 && chosen === undefined) throw new StudioValidationError("that greeting does not exist");
  // The person's edit of this greeting (rule 34, RoleCall first_message_override) is the message when there is one.
  const greeting = chosen === undefined ? undefined : input.coreGreeting ?? current.opening?.edits.find((e) => e.index === input.greetingIndex)?.text ?? chosen;
  const inputs = [...(greeting !== undefined ? [{ role: "assistant" as const, content: greeting }] : []), { role: "user" as const, content: input.content }];
  if (!(await chats.appendMessages(current.activeBranchId, inputs, { expectedVersion: input.expectedVersion }))) return null;
  return sceneOf(chats, studio, (await chats.getChat(current.id)) ?? current, snapshot, cast.hasPortrait);
}

export { sceneTail, type SceneTailMessage } from "./scene-tail";
