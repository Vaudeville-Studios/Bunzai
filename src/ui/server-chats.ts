/** Scene HTTP routes over the open library; turn streaming and core ownership have dedicated modules. */
import { ownChatRequest } from "./server-chat-owned";
import { coreWriteGuard } from "./server-core-guard";
import { bodyOf, isRecord, str } from "../core/guards";
import { sceneRuntimeFor } from "./server-scene-runtime";
import { countText } from "../core/tokens";
import type { CharacterBody } from "../entities/character/schema";
import { playedBody } from "../entities/character/variant";
import type { PersonaBody } from "../entities/persona/schema";
import type { Chat, ChatOpening, ChatProps, ChatStore, JsonObject } from "../stage/contracts/chat-store";
import type { SettingsStoreLike, StudioStoreLike } from "../studio/contracts";
import { libraryChatsFor, libraryFor, libraryStateFor } from "../studio/library-content";
import { INCOMPLETE_CORE_SCENE_MESSAGE, reconcileCoreScene, resolveCoreScene } from "../studio/core-scene";
import { lorebookReader, resolveBooks, type ReadLorebook } from "../studio/scene-lore";
import { presetReader } from "../studio/scene-turn-load";
import { StudioLockedError } from "../studio/errors";
import { WHOLE_BRANCH } from "../studio/scene-branch";
import { resumeScene } from "../studio/scene-turn";
import type { SceneLore, SceneLoreBook, SceneLoreChoice, SceneLoreFired } from "./app-contract-scenes";
import {
  cutInScene,
  cutVersionInScene,
  deleteTake,
  forkScene,
  frozenCharacter,
  greetingsOf,
  hideInScene,
  listScenes,
  olderSceneMessages,
  openScene,
  renameTake,
  requireChats,
  restoreInScene,
  restoreVersion,
  revertSceneCard,
  selectVersion,
  sceneTail,
  sceneMacroMessages,
  sceneSwipe,
  swipeHistoryOf,
  sceneTrash,
  switchTake,
  updateSceneCard,
  type OpenScene,
} from "../studio/scenes";
import { changeScenePersona, personaStatsOf, saveSceneMember, setSceneOpening, setSceneVariant } from "../studio/scene-cast";
import { searchScene } from "../studio/scene-search";
import { parseStudioPatchRequest } from "./_shared/studio-patch-request";
import { AssetStageError, consumeSessionUploads, openSessionUploads } from "./server-asset-staging";
import { handleGuideRoute } from "./server-chats-guides";
import { handleCompendiumSettingsRoute } from "./server-chats-compendium-settings";
import { handleParticipantsRoute } from "./server-chats-participants";
import { handleLoadoutRoute } from "./server-chats-loadouts";
import { handleTraceRoute } from "./server-chats-trace";
import { handleVariablesRoute } from "./server-chats-variables";
import { handleVariableHistoryRoute } from "./server-chats-variable-history";
import { searchSummaries } from "../studio/scene-summary-list";
import { handleSummaryRoute } from "./server-chats-summary";
import { handleDirectorRoute } from "./server-chats-director";
import { handleDramaturgRoute } from "./server-chats-dramaturg";
import { handleDraftRoute } from "./server-chats-draft";
import { regexReaderOf, trackerReaderOf } from "./server-scene-readers";
import { handleLibraryTrackersRoute } from "./server-chats-library-trackers";
import { handleTrackerChangesRoute } from "./server-chats-tracker-changes";
import { handleTrackerStateRoute } from "./server-chats-tracker-state";
import { handleCompareRoute } from "./server-chats-compare";
import { handleFinalCutRoute } from "./server-chats-final-cut";
import { handleTrackerItemRoute } from "./server-chats-tracker-item";
import { handleTrackerRefreshRoute } from "./server-chats-tracker-refresh";
import { handleForecastRoute } from "./server-chats-forecast";
import { handleLinkedRoute } from "./server-chats-links";
import { handleTurnRoute } from "./server-chats-turn";
import { handleCoreSettings, handleCoreRead } from "./server-chats-core-settings";
import { handleCoreChatWrite } from "./server-chats-core-write";
import { compendiumDepsFor, compendiumDepsOf, handleCompendiumRoute } from "./server-chats-compendium";
import { filingsOfVersion, filingsUnderCut, undoWithCut } from "../studio/compendium-hooks";
import { busy } from "../studio/compendium-queue";
import { lockedBooks } from "../studio/compendium-standardize";
import { portraitResponse } from "./server-portrait";
import { err, json, readJsonObject, studioErr } from "./server-security";

type Body = Record<string, unknown>;

async function body(req: Request): Promise<Body | Response> {
  const parsed = await readJsonObject(req);
  return parsed.ok ? parsed.value : parsed.response;
}

const activeTake = async (chats: ChatStore, chatId: string): Promise<string> => (await chats.getChat(chatId))?.activeBranchId ?? "";
const scene = (open: OpenScene | null) => (open ? json(open) : err("that scene is gone", 404));
/** The branch version a guarded write was based on, or a 400 naming the fields the route wants. */
const versioned = (b: Body, shape: string): number | Response =>
  typeof b["expectedVersion"] === "number" ? b["expectedVersion"] : err(`expected ${shape}`);

function firedOf(h: Record<string, unknown>, cut: boolean): SceneLoreFired {
  return {
    bookId: str(h["bookId"]),
    entryId: str(h["entryId"]),
    title: str(h["title"]),
    reason: (typeof h["reason"] === "string" ? h["reason"] : "key") as SceneLoreFired["reason"],
    matched: Array.isArray(h["matched"]) ? h["matched"].map(String) : [],
    tokens: typeof h["tokens"] === "number" ? h["tokens"] : 0,
    cut,
  };
}

/** The World wing's Lorebook tab (2e-d4 plan step 5): which books this scene reads, and what the
 * active take's last reply's trace says fired. */
async function sceneLoreFor(chats: ChatStore, readLorebook: ReadLorebook, chat: Chat): Promise<SceneLore> {
  const snapshot = await chats.castSnapshot(chat.id);
  const character = playedBody(bodyOf(snapshot?.character) as unknown as CharacterBody, chat.variantId);
  const persona = snapshot?.persona ? (bodyOf(snapshot.persona) as unknown as PersonaBody) : undefined;
  const resolved = await resolveBooks(character, persona, chat.lore, readLorebook);
  const books: SceneLoreBook[] = resolved.map((r) => ({
    id: r.id,
    name: r.book?.name ?? r.id,
    source: r.source,
    enabled: r.enabled,
    missing: r.book === null,
    entries: r.book?.body.entries.length ?? 0,
    tokens: r.book ? r.book.body.entries.reduce((sum, e) => sum + countText(e.content), 0) : 0,
  }));

  const page = await chats.readMessages(chat.activeBranchId, { limit: WHOLE_BRANCH });
  const lastAssistant = [...page.messages].reverse().find((m) => !m.cut && m.role === "assistant");
  let lastTurn: SceneLore["lastTurn"] = null;
  const swipe = lastAssistant?.swipes[lastAssistant.current];
  const trace = swipe ? await chats.swipeTrace(lastAssistant!.id, swipe.id) : null;
  const loreTrace = isRecord(trace?.["lore"]) ? (trace["lore"] as Record<string, unknown>) : undefined;
  if (loreTrace) {
    const injected = Array.isArray(loreTrace["injected"]) ? (loreTrace["injected"] as unknown[]) : [];
    const cut = Array.isArray(loreTrace["cut"]) ? (loreTrace["cut"] as unknown[]) : [];
    const fired = [...injected.filter(isRecord).map((h) => firedOf(h, false)), ...cut.filter(isRecord).map((h) => firedOf(h, true))];
    lastTurn = { fired, totalTokens: typeof loreTrace["totalTokens"] === "number" ? loreTrace["totalTokens"] : 0 };
  }
  return { books, lastTurn };
}

/** The Props wing's own route (T1 infra, ChatStore rule 21): an unset field answers `{ on: [] }`. */
const propsOf = (chat: Chat): { on: string[] } => ({ on: chat.props?.on ?? [] });

/** Each scene write: the fields it reads from the body, and what it answers. */
const WRITES: Record<string, (chats: ChatStore, store: StudioStoreLike, b: Body, settings: SettingsStoreLike, session: string) => Promise<Response>> = {
  "/api/chats/cut": async (chats, store, b) => {
    const expectedVersion = versioned(b, "{ chatId, messageId, scope, expectedVersion }");
    if (expectedVersion instanceof Response) return expectedVersion;
    const scope = b["scope"] === "from" ? "from" : b["scope"] === "one" ? "one" : null;
    if (!scope) return err('scope must be "one" or "from"');
    const [chatId, messageId] = [str(b["chatId"]), str(b["messageId"])];
    const deps = compendiumDepsOf(chats, store);
    // What the cut message filed is taken back once the cut has landed (04b D7); a filing that cannot be undone never blocks the cut.
    return scene(await undoWithCut(deps, chatId, async () => filingsUnderCut(deps!, chatId, await activeTake(chats, chatId), messageId, scope), () => cutInScene(chats, store, { chatId, messageId, scope, expectedVersion })));
  },
  "/api/chats/restore-cut": async (chats, store, b) => {
    const expectedVersion = versioned(b, "{ chatId, cutId, expectedVersion }");
    if (expectedVersion instanceof Response) return expectedVersion;
    return scene(await restoreInScene(chats, store, { chatId: str(b["chatId"]), cutId: str(b["cutId"]), expectedVersion }));
  },
  "/api/chats/take": async (chats, store, b) => scene(await switchTake(chats, store, { chatId: str(b["chatId"]), branchId: str(b["branchId"]) })),
  "/api/chats/fork": async (chats, store, b) => {
    const expectedVersion = versioned(b, "{ chatId, messageId, name?, expectedVersion }");
    if (expectedVersion instanceof Response) return expectedVersion;
    const name = typeof b["name"] === "string" ? b["name"] : undefined;
    return scene(await forkScene(chats, store, { chatId: str(b["chatId"]), messageId: str(b["messageId"]), ...(name === undefined ? {} : { name }), expectedVersion }));
  },
  "/api/chats/rename-take": async (chats, store, b) =>
    scene(await renameTake(chats, store, { chatId: str(b["chatId"]), branchId: str(b["branchId"]), name: str(b["name"]) })),
  "/api/chats/delete-take": async (chats, store, b) => scene(await deleteTake(chats, store, { chatId: str(b["chatId"]), branchId: str(b["branchId"]) })),
  "/api/chats/update-card": async (chats, store, b) => scene(await updateSceneCard(chats, store, str(b["chatId"]))),
  "/api/chats/revert-card": async (chats, store, b) => {
    const fromVersion = b["fromVersion"];
    if (typeof fromVersion !== "number") return err("expected { chatId, fromVersion }");
    return scene(await revertSceneCard(chats, store, { chatId: str(b["chatId"]), fromVersion }));
  },
  "/api/chats/select-swipe": async (chats, store, b) => {
    const expectedVersion = versioned(b, "{ chatId, messageId, index, expectedVersion }");
    if (expectedVersion instanceof Response) return expectedVersion;
    if (typeof b["index"] !== "number") return err("expected { chatId, messageId, index, expectedVersion }");
    return scene(await selectVersion(chats, store, { chatId: str(b["chatId"]), messageId: str(b["messageId"]), index: b["index"], expectedVersion }));
  },
  "/api/chats/hide": async (chats, store, b) => {
    const expectedVersion = versioned(b, "{ chatId, messageId, hidden, expectedVersion }");
    if (expectedVersion instanceof Response) return expectedVersion;
    if (typeof b["hidden"] !== "boolean") return err("expected { chatId, messageId, hidden, expectedVersion }");
    return scene(await hideInScene(chats, store, { chatId: str(b["chatId"]), messageId: str(b["messageId"]), hidden: b["hidden"], expectedVersion }));
  },
  // A POST although it only reads: the words typed are the person's text, kept out of URLs and logs.
  "/api/chats/search": async (chats, store, b) => {
    if (typeof b["query"] !== "string") return err("expected { chatId, query }");
    const found = await searchScene(chats, store, { chatId: str(b["chatId"]), query: b["query"] });
    return found ? json(found) : err("that scene is gone", 404);
  },
  "/api/chats/cut-version": async (chats, store, b) => {
    const expectedVersion = versioned(b, "{ chatId, messageId, swipeId, expectedVersion }");
    if (expectedVersion instanceof Response) return expectedVersion;
    const [chatId, messageId, swipeId] = [str(b["chatId"]), str(b["messageId"]), str(b["swipeId"])];
    const deps = compendiumDepsOf(chats, store);
    return scene(await undoWithCut(deps, chatId, async () => filingsOfVersion(deps!, chatId, await activeTake(chats, chatId), messageId, swipeId), () => cutVersionInScene(chats, store, { chatId, messageId, swipeId, expectedVersion })));
  },
  // A removed version comes back from the scene page or the Trash: both name it `messageId:swipeId` (SceneGrave).
  "/api/chats/restore-version": async (chats, store, b) => {
    const [messageId, swipeId, ...extra] = str(b["id"]).split(":");
    if (!messageId || !swipeId || extra.length > 0) return err("expected { id: \"messageId:swipeId\" }");
    const open = await restoreVersion(chats, store, { messageId, swipeId });
    return open ? json(open) : err("the Trash no longer holds that version", 404);
  },
  "/api/chats/persona": async (chats, store, b) => {
    const { personaId, expectedSnapshotVersion } = b;
    if ((personaId !== null && typeof personaId !== "string") || (expectedSnapshotVersion !== undefined && typeof expectedSnapshotVersion !== "number")) return err("expected { chatId, personaId, expectedSnapshotVersion? }");
    return scene(await changeScenePersona(chats, store, { chatId: str(b["chatId"]), personaId, ...(expectedSnapshotVersion === undefined ? {} : { expectedSnapshotVersion }) }));
  },
  "/api/chats/opening": async (chats, store, b) => scene(await setSceneOpening(chats, store, { chatId: str(b["chatId"]), opening: b["opening"] as ChatOpening | null })),
  "/api/chats/variant": async (chats, store, b) => {
    if (b["variantId"] !== null && typeof b["variantId"] !== "string") return err("expected { chatId, variantId }");
    return scene(await setSceneVariant(chats, store, { chatId: str(b["chatId"]), variantId: b["variantId"] }));
  },
  // The editor's own patch save for the scene's character or persona, then this scene follows it (rules 13, 26).
  "/api/chats/save-member": async (chats, store, b, _settings, session) => {
    const member = b["member"];
    const envelope = parseStudioPatchRequest(b["save"]);
    if ((member !== "character" && member !== "persona") || !envelope.ok) return err(envelope.ok ? "expected { chatId, member, save }" : envelope.error);
    if (!store.comparePatch) return err("patch saves are unavailable", 501);
    const chat = await chats.getChat(str(b["chatId"]));
    const target = member === "character" ? chat?.cast.character.id : chat?.cast.persona?.id;
    // Only the piece this scene plays can be written through it.
    if (!chat || !target || envelope.value.kind !== member || envelope.value.id !== target) return err("that scene does not play that piece", 404);
    const { expectedRevision, patch, uploads: refs, intent } = envelope.value;
    try {
      const result = await saveSceneMember(chats, store, {
        chatId: chat.id, kind: member,
        save: async () => {
          const uploads = await openSessionUploads(refs, session);
          const saved = await store.comparePatch!(member, target, expectedRevision, patch, uploads, intent);
          if (saved.status === "saved") await consumeSessionUploads(refs, session);
          return saved;
        },
      });
      if (!result) return err("that scene is gone", 404);
      if (result.status !== "saved") return result.status === "stale" ? err("piece changed since it was opened", 409) : err("piece no longer exists", 404);
      return json({ summary: result.summary, scene: result.scene, applied: result.applied });
    } catch (error) {
      if (error instanceof AssetStageError) return err(error.message, error.status);
      throw error;
    }
  },
  "/api/chats/restore-scene": async (chats, _store, b) => {
    const chat = await chats.restoreChat(str(b["id"]));
    return chat ? json(chat) : err("the Trash no longer holds that scene", 404);
  },
  "/api/chats/restore-take": async (chats, _store, b) => {
    const take = await chats.restoreBranch(str(b["id"]));
    return take ? json(take) : err("the Trash no longer holds that take", 404);
  },
  "/api/chats/edit": async (chats, _store, b) => {
    const { content, expectedVersion } = b;
    if (typeof content !== "string" || content.trim() === "" || typeof expectedVersion !== "number") return err("expected { messageId, swipeId, content, expectedVersion } with some text");
    const message = await chats.editSwipe(str(b["messageId"]), str(b["swipeId"]), content, { expectedVersion });
    return message ? json(message) : err("that message is gone", 404);
  },
  "/api/chats/rename": async (chats, _store, b) => {
    const chat = await chats.renameChat(str(b["id"]), str(b["title"]));
    return chat ? json(chat) : err("that scene is gone", 404);
  },
  "/api/chats/delete": async (chats, _store, b) => json({ deleted: await chats.deleteChat(str(b["id"])) }),
  "/api/chats/lore": async (chats, store, b) => {
    // No default to null: an absent field is a validation error, as the preset route treats it.
    const chat = await chats.setLore(str(b["chatId"]), b["lore"] as SceneLoreChoice | null);
    return chat ? json(await sceneLoreFor(chats, lorebookReader(store), chat)) : err("that scene is gone", 404);
  },
  "/api/chats/props": async (chats, _store, b) => {
    // No default to null: an absent field is a validation error, as the lore and preset routes treat it.
    const chat = await chats.setProps(str(b["chatId"]), b["props"] as ChatProps | null);
    return chat ? json(propsOf(chat)) : err("that scene is gone", 404);
  },
  "/api/chats/favorite": async (chats, _store, b) => {
    if (typeof b["on"] !== "boolean") return err("expected { id, on }");
    const chat = await chats.setFavorite(str(b["id"]), b["on"]);
    return chat ? json(chat) : err("that scene is gone", 404);
  },
  "/api/chats/folders": async (chats, _store, b) => json(await chats.createFolder(str(b["name"]))),
  "/api/chats/folders/rename": async (chats, _store, b) => {
    if (typeof b["id"] !== "string" || b["id"] === "") return err("expected { id, name }");
    const folder = await chats.renameFolder(b["id"], str(b["name"]));
    return folder ? json(folder) : err("that folder is gone", 404);
  },
  "/api/chats/folders/delete": async (chats, _store, b) => {
    if (typeof b["id"] !== "string" || b["id"] === "") return err("expected { id }");
    return json({ deleted: await chats.deleteFolder(b["id"]) });
  },
  "/api/chats/folder": async (chats, _store, b) => {
    const folderId = b["folderId"];
    if (typeof b["id"] !== "string" || b["id"] === "" || (folderId !== null && typeof folderId !== "string")) return err("expected { id, folderId }");
    const chat = await chats.setFolder(b["id"], folderId);
    return chat ? json(chat) : err("that scene is gone", 404);
  },
};

async function handleChatRouteOwned(req: Request, url: URL, store: StudioStoreLike, settings: SettingsStoreLike, session = "", dispatchExtensionEvent?: (payload: unknown) => Promise<void>, applyExtensionPrompts?: (sceneId: string, messages: readonly { role: import("../stage/contracts/provider").ProviderRole; content: string }[], signal: AbortSignal) => Promise<readonly string[]>, hasPromptContributors?: (sceneId: string) => Promise<boolean>): Promise<Response> {
  const p = url.pathname;
  try {
    const chats = requireChats(libraryChatsFor(store.studioPath()));
    const state = libraryStateFor(store.studioPath());
    if (!state) throw new StudioLockedError();
    const readPreset = presetReader(store);
    const readLorebook = lorebookReader(store);
    const filingDeps = compendiumDepsFor(chats, state, store);
    if (req.method === "GET") {
      const turn = await handleTurnRoute(req, url, chats, state, readPreset, readLorebook, null, store, filingDeps, settings, dispatchExtensionEvent, applyExtensionPrompts, hasPromptContributors);
      if (turn) return turn;
      const filing = await handleCompendiumRoute(req, url, chats, filingDeps, null);
      if (filing) return filing;
      const guides = await handleGuideRoute(req, p, chats, state, null);
      if (guides) return guides;
      const finalCut = await handleFinalCutRoute(req, url, chats, state, readPreset, regexReaderOf(store), null, store);
      if (finalCut) return finalCut;
      const compare = await handleCompareRoute(req, url, chats);
      if (compare) return compare;
      const loadouts = await handleLoadoutRoute(req, url, chats, state, null);
      if (loadouts) return loadouts;
      if (p === "/api/chats/list") return json(await listScenes(chats, store));
      const coreRead = await handleCoreRead(url, chats, libraryFor(store.studioPath())?.core, store.studioPath());
      if (coreRead) return coreRead;
      if (p === "/api/chats/summary-search") return json({ ids: await searchSummaries(chats, url.searchParams.get("q") ?? "") });
      if (p === "/api/chats/trash") return json(await sceneTrash(chats));
      if (p === "/api/chats/portrait") return portraitResponse(await frozenCharacter(chats, url.searchParams.get("id") ?? ""));
      if (p === "/api/chats/open") {
        const id = url.searchParams.get("id") ?? "";
        const records = libraryFor(store.studioPath())?.core;
        const resolvedCore = records ? await resolveCoreScene(records, id) : null;
        if (resolvedCore?.incomplete) return err(INCOMPLETE_CORE_SCENE_MESSAGE, 409);
        const core = resolvedCore?.link ?? null;
        if (records && core) await reconcileCoreScene(chats, id, core.branchId, records, store.studioPath(), core.sessionId);
        else await resumeScene(sceneRuntimeFor(chats), chats, id);

        // A receipt left in flight with nothing running in this process (no pass in the scene lane, no Standardize run) is a crash's (rule 39); one being worked on now is left alone.
        if (!busy(id) && lockedBooks(id).length === 0) await chats.sweepReceipts(id);
        const opened = await openScene(chats, store, id);
        return scene(opened && core ? { ...opened, core: true } : opened);
      }
      if (p === "/api/chats/page") {
        const chatId = url.searchParams.get("id") ?? "";
        const branchId = url.searchParams.get("branchId") ?? "";
        const beforeSeq = Number(url.searchParams.get("beforeSeq"));
        const expectedVersion = Number(url.searchParams.get("expectedVersion"));
        if (!chatId || !branchId || !Number.isSafeInteger(beforeSeq) || beforeSeq < 1 || !Number.isSafeInteger(expectedVersion) || expectedVersion < 1) {
          return err("expected id, branchId, beforeSeq and expectedVersion");
        }
        const page = await olderSceneMessages(chats, { chatId, branchId, beforeSeq, expectedVersion });
        return page ? json(page) : err("that scene is gone", 404);
      }
      if (p === "/api/chats/macro-messages") {
        const chatId = url.searchParams.get("chatId") ?? "";
        const branchId = url.searchParams.get("branchId") ?? "";
        const expectedVersion = Number(url.searchParams.get("expectedVersion"));
        const raw = url.searchParams.get("indices") ?? "";
        const indices = raw === "" ? [] : raw.split(",").map(Number);
        if (!chatId || !branchId || !Number.isSafeInteger(expectedVersion) || expectedVersion < 1 || indices.length > 60 || indices.some((n) => !Number.isSafeInteger(n) || n < 0)) {
          return err("expected chatId, branchId, expectedVersion and at most 60 non-negative indices");
        }
        const page = await sceneMacroMessages(chats, { chatId, branchId, expectedVersion, indices });
        return page ? json(page) : err("that scene is gone", 404);
      }
      if (p === "/api/chats/swipe") {
        const chatId = url.searchParams.get("chatId") ?? "";
        const branchId = url.searchParams.get("branchId") ?? "";
        const messageId = url.searchParams.get("messageId") ?? "";
        const index = Number(url.searchParams.get("index"));
        const expectedVersion = Number(url.searchParams.get("expectedVersion"));
        if (!chatId || !branchId || !messageId || !Number.isSafeInteger(index) || index < 0 || !Number.isSafeInteger(expectedVersion) || expectedVersion < 1) {
          return err("expected chatId, branchId, messageId, index and expectedVersion");
        }
        const page = await sceneSwipe(chats, { chatId, branchId, messageId, index, expectedVersion });
        return page ? json(page) : err("that scene is gone", 404);
      }
      if (p === "/api/chats/swipe-history") {
        const chatId = url.searchParams.get("chatId") ?? "";
        const branchId = url.searchParams.get("branchId") ?? "";
        const messageId = url.searchParams.get("messageId") ?? "";
        const index = Number(url.searchParams.get("index"));
        const expectedVersion = Number(url.searchParams.get("expectedVersion"));
        if (!chatId || !branchId || !messageId || !Number.isSafeInteger(index) || index < 0 || !Number.isSafeInteger(expectedVersion) || expectedVersion < 1) {
          return err("expected chatId, branchId, messageId, index and expectedVersion");
        }
        const found = await swipeHistoryOf(chats, { chatId, branchId, messageId, index, expectedVersion });
        return found ? json(found) : err("that version is gone", 404);
      }
      if (p === "/api/chats/lore") {
        const chat = await chats.getChat(url.searchParams.get("chatId") ?? "");
        return chat ? json(await sceneLoreFor(chats, readLorebook, chat)) : err("that scene is gone", 404);
      }
      if (p === "/api/chats/trace") return await handleTraceRoute(url, chats, readLorebook, readPreset);
      if (p === "/api/chats/variables") return await handleVariablesRoute(url, chats);
      if (p === "/api/chats/variable-history") return await handleVariableHistoryRoute(url, chats);
      if (p === "/api/chats/tracker-changes") return await handleTrackerChangesRoute(url, chats, trackerReaderOf(store));
      const libraryTrackers = await handleLibraryTrackersRoute(req, url, chats, trackerReaderOf(store), Date.now, null);
      if (libraryTrackers) return libraryTrackers;
      const trackerStates = await handleTrackerStateRoute(req, url, chats, Date.now, null);
      if (trackerStates) return trackerStates;
      if (p === "/api/chats/props") {
        const chat = await chats.getChat(url.searchParams.get("chatId") ?? "");
        return chat ? json(propsOf(chat)) : err("that scene is gone", 404);
      }
      if (p === "/api/chats/folders") return json(await chats.listFolders());
      if (p === "/api/chats/persona-stats") return json(await personaStatsOf(chats, url.searchParams.get("id") ?? ""));
      const roster = await handleParticipantsRoute(req, url, chats, null);
      if (roster) return roster;
      const summary = await handleSummaryRoute(req, url, chats, store, null);
      if (summary) return summary;
      const director = await handleDirectorRoute(req, url, chats, Date.now, null);
      if (director) return director;
      const linked = await handleLinkedRoute(req, url, chats);
      if (linked) return linked;
      const dramaturg = await handleDramaturgRoute(req, url, chats, readPreset, readLorebook, null, store, settings);
      if (dramaturg) return dramaturg;
      if (p === "/api/chats/tail") {
        const n = url.searchParams.has("n") ? Number(url.searchParams.get("n")) : 3;
        const tail = await sceneTail(chats, url.searchParams.get("id") ?? "", n, store);
        return tail ? json(tail) : err("that scene is gone", 404);
      }
      return err("not found", 404);
    }
    if (req.method !== "POST") return err("not found", 404);
    const b = await body(req);
    if (b instanceof Response) return b;
    const records = libraryFor(store.studioPath())?.core;
    const refusal = await coreWriteGuard(p, b, records);
    if (refusal) return refusal;
    if (p === "/api/chats/core-settings") return handleCoreSettings(b, chats, records, store.studioPath());
    const turn = await handleTurnRoute(req, url, chats, state, readPreset, readLorebook, b, store, filingDeps, settings, dispatchExtensionEvent, applyExtensionPrompts, hasPromptContributors);
    if (turn) return turn;
    const filing = await handleCompendiumRoute(req, url, chats, filingDeps, b);
    if (filing) return filing;
    const roster = await handleParticipantsRoute(req, url, chats, b);
    if (roster) return roster;
    const draft = await handleDraftRoute(req, p, chats, state, readPreset, readLorebook, b, store, settings);
    if (draft) return draft;
    const libraryTrackers = await handleLibraryTrackersRoute(req, url, chats, trackerReaderOf(store), Date.now, b);
    if (libraryTrackers) return libraryTrackers;
    const trackerStates = await handleTrackerStateRoute(req, url, chats, Date.now, b);
    if (trackerStates) return trackerStates;
    const trackerItem = await handleTrackerItemRoute(req, p, chats, b, store);
    if (trackerItem) return trackerItem;
    const trackerRefresh = await handleTrackerRefreshRoute(req, p, chats, b, store);
    if (trackerRefresh) return trackerRefresh;
    const summary = await handleSummaryRoute(req, url, chats, store, b);
    if (summary) return summary;
    const director = await handleDirectorRoute(req, url, chats, Date.now, b);
    if (director) return director;
    const dramaturg = await handleDramaturgRoute(req, url, chats, readPreset, readLorebook, b, store, settings);
    if (dramaturg) return dramaturg;
    const forecast = await handleForecastRoute(req, p, chats, state, readPreset, readLorebook, b, store, settings);
    if (forecast) return forecast;
    const guides = await handleGuideRoute(req, p, chats, state, b);
    if (guides) return guides;
    const finalCut = await handleFinalCutRoute(req, url, chats, state, readPreset, regexReaderOf(store), b, store);
    if (finalCut) return finalCut;
    const compendium = await handleCompendiumSettingsRoute(p, chats, b);
    if (compendium) return compendium;
    const loadouts = await handleLoadoutRoute(req, url, chats, state, b);
    if (loadouts) return loadouts;
    const coreWrite = await handleCoreChatWrite(p, chats, store, settings, b);
    if (coreWrite) return coreWrite;
    const write = WRITES[p];
    if (!write) return err("not found", 404);
    return await write(chats, store, b, settings, session);
  } catch (e) {
    return studioErr(e);
  }
}

export function handleChatRoute(req: Request, url: URL, store: StudioStoreLike, settings: SettingsStoreLike, session = "", dispatchExtensionEvent?: (payload: unknown) => Promise<void>, applyExtensionPrompts?: (sceneId: string, messages: readonly { role: import("../stage/contracts/provider").ProviderRole; content: string }[], signal: AbortSignal) => Promise<readonly string[]>, hasPromptContributors?: (sceneId: string) => Promise<boolean>): Promise<Response> {
  return ownChatRequest(store, () => handleChatRouteOwned(req, url, store, settings, session, dispatchExtensionEvent, applyExtensionPrompts, hasPromptContributors));
}
